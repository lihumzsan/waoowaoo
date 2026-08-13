import type {
  RuntimeEvent,
  RuntimeSandboxMode,
  RuntimeSandboxPolicy,
  RuntimeUserInput,
} from '@/lib/codex-runtime/runtime-adapter'
import type {
  RuntimeSessionManager,
  RuntimeSessionManagerEvent,
  RuntimeSessionScope,
  RuntimeThreadSessionView,
} from '@/lib/codex-runtime/runtime-session-manager'
import {
  buildAgentTurnAssistantMessageId,
  createAgentTurnStreamPublisher,
  publishAgentSessionViewChanged,
} from '@/lib/agent-turn/stream-publisher'
import { createScopedLogger } from '@/lib/logging/core'
import type {
  AssistantRuntimeAdmissionReceipt,
  AssistantRuntimeClearCommand,
  AssistantRuntimeClearReceipt,
  AssistantRuntimeInterruptCommand,
  AssistantRuntimeInterruptReceipt,
  AssistantRuntimeMessageReceipt,
  AssistantRuntimePreparedInput,
  AssistantRuntimeServerRequestCommand,
  AssistantRuntimeSteerCommand,
  AssistantRuntimeSteerReceipt,
  AssistantRuntimeSubmitCommand,
  AssistantRuntimeTaskFollowUp,
  AssistantRuntimeTaskFollowUpReceipt,
  AssistantRuntimeTurnIdentity,
} from './contracts'
import { AssistantRuntimeEventProjector } from './event-projector'
import { prepareAssistantRuntimeUserInput } from './message-input'
import {
  acceptAssistantRuntimeSteer,
  admitAssistantRuntimeTaskFollowUp,
  admitAssistantRuntimeTurn,
  bindAssistantRuntimeThread,
  bindAssistantRuntimeTurn,
  claimAssistantRuntimeSteer,
  claimAssistantRuntimeTurnStart,
  claimAssistantRuntimeThreadClear,
  clearAssistantRuntimeThread,
  decideAssistantRuntimeInteraction,
  expireAssistantRuntimeInteraction,
  failAssistantRuntimeBoundTurnStart,
  failAssistantRuntimeTurnStart,
  getOrCreateAssistantRuntimeThread,
  loadAssistantRuntimeTaskFollowUp,
  markAssistantRuntimeSteerUncertain,
  persistAssistantRuntimeInteraction,
  persistAssistantRuntimeMessageSnapshot,
  readAssistantRuntimeActiveTurn,
  hashAssistantRuntimeSubmitCommand,
  readAssistantRuntimeMessageReplay,
  replaceAssistantRuntimePlan,
  resolveAssistantRuntimeMessageTarget,
  requestAssistantRuntimeInterrupt,
  resolveAssistantRuntimeInteraction,
  rollbackAssistantRuntimeTaskFollowUpPreparation,
  settleAssistantRuntimeTurn,
  type AssistantRuntimeMessageReplayDecision,
} from './persistence'
import {
  buildAssistantRuntimeTurnContext,
  type AssistantRuntimeAccess,
  type AssistantRuntimeModelConfiguration,
} from './runtime-access'

const logger = createScopedLogger({ module: 'assistant-runtime.service' })

export interface AssistantRuntimeAccessProvider {
  get(scope: RuntimeSessionScope): Promise<AssistantRuntimeAccess>
  invalidate(scope: RuntimeSessionScope): void
}

export interface AssistantRuntimeModelResolver {
  resolve(input: {
    readonly scope: RuntimeSessionScope
    readonly access: AssistantRuntimeAccess
  }): Promise<AssistantRuntimeModelConfiguration>
}

export type AssistantRuntimeServiceOptions = {
  readonly manager: RuntimeSessionManager
  readonly access: AssistantRuntimeAccessProvider
  readonly models: AssistantRuntimeModelResolver
}

type PreparedThread = {
  readonly threadId: string
  readonly runtime: RuntimeThreadSessionView
  readonly model: AssistantRuntimeModelConfiguration
}

type StartedProjection = {
  readonly identity: AssistantRuntimeTurnIdentity
  readonly runtimeThreadId: string
  readonly runtimeTurnId: string
}

type LiveProjection = {
  readonly started: StartedProjection
  readonly projector: AssistantRuntimeEventProjector
  readonly completion: Promise<void>
}

function requireBoundTurnIdentity(
  value: AssistantRuntimeTurnIdentity | null,
): AssistantRuntimeTurnIdentity {
  if (!value) throw new Error('ASSISTANT_RUNTIME_TURN_BINDING_MISSING')
  return value
}

function runtimeScope(input: { readonly userId: string; readonly projectId: string }): RuntimeSessionScope {
  return { userId: input.userId, projectId: input.projectId }
}

type AssistantRuntimeMessageReplayControl = {
  readonly outcome: 'resume_queued' | 'reconcile_unbound_start'
}

function isMessageReplayControl(
  value: AssistantRuntimeMessageReplayDecision | null,
): value is AssistantRuntimeMessageReplayControl {
  if (!value || !('outcome' in value)) return false
  return value.outcome === 'resume_queued' || value.outcome === 'reconcile_unbound_start'
}

function withTurnContext(
  inputs: readonly RuntimeUserInput[],
  locale: string,
  projectProductionContext: AssistantRuntimeModelConfiguration['projectProductionContext'],
): readonly RuntimeUserInput[] {
  return [
    { type: 'text', text: buildAssistantRuntimeTurnContext(locale, projectProductionContext) },
    ...inputs,
  ]
}

function buildTurnSandboxPolicy(mode: RuntimeSandboxMode | undefined): RuntimeSandboxPolicy {
  switch (mode) {
    case 'danger-full-access':
      return { type: 'dangerFullAccess' }
    case 'read-only':
      return { type: 'readOnly', networkAccess: false }
    case 'workspace-write':
      return {
        type: 'workspaceWrite',
        writableRoots: [],
        networkAccess: false,
        excludeTmpdirEnvVar: true,
        excludeSlashTmp: true,
      }
    default:
      throw new Error('ASSISTANT_RUNTIME_SANDBOX_MODE_REQUIRED')
  }
}

function isRuntimeEvent(
  event: RuntimeSessionManagerEvent,
): event is Extract<RuntimeSessionManagerEvent, { type: 'runtime' }> {
  return event.type === 'runtime'
}

export class AssistantRuntimeService {
  private readonly manager: RuntimeSessionManager
  private readonly access: AssistantRuntimeAccessProvider
  private readonly models: AssistantRuntimeModelResolver
  private readonly liveTurns = new Map<string, LiveProjection>()
  private readonly projectTransitions = new Map<string, Promise<void>>()
  private readonly settlementBarriers = new Map<string, {
    readonly scope: RuntimeSessionScope
    readonly promise: Promise<void>
  }>()
  constructor(options: AssistantRuntimeServiceOptions) {
    this.manager = options.manager
    this.access = options.access
    this.models = options.models
  }

  async waitForTurnSettlements(scope: RuntimeSessionScope): Promise<void> {
    const pending = [...this.settlementBarriers.values()]
      .filter((entry) => (
        entry.scope.userId === scope.userId
        && entry.scope.projectId === scope.projectId
      ))
      .map((entry) => entry.promise)
    await Promise.all(pending)
  }

  private async runProjectTransition<T>(
    scope: RuntimeSessionScope,
    action: () => Promise<T>,
  ): Promise<T> {
    const key = `${scope.userId.length}:${scope.userId}${scope.projectId.length}:${scope.projectId}`
    const prior = this.projectTransitions.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    this.projectTransitions.set(key, current)
    await prior.catch(() => undefined)
    try {
      return await action()
    } finally {
      release()
      if (this.projectTransitions.get(key) === current) this.projectTransitions.delete(key)
    }
  }

  async send(command: AssistantRuntimeSubmitCommand): Promise<AssistantRuntimeMessageReceipt> {
    return await this.runProjectTransition(runtimeScope(command), async () => {
      const clientPayloadHash = hashAssistantRuntimeSubmitCommand(command)
      let replay = await readAssistantRuntimeMessageReplay(command)
      if (isMessageReplayControl(replay) && replay.outcome === 'reconcile_unbound_start') {
        await this.ensureRuntimeForAdmission(command)
        replay = await readAssistantRuntimeMessageReplay(command)
        if (isMessageReplayControl(replay) && replay.outcome === 'reconcile_unbound_start') {
          throw new Error('ASSISTANT_RUNTIME_START_HANDOFF_RECONCILE_FAILED')
        }
      }
      if (replay && !isMessageReplayControl(replay)) return replay
      const prepared = await prepareAssistantRuntimeUserInput({
        message: command.message,
        userId: command.userId,
        projectId: command.projectId,
      })
      const normalizedCommand: AssistantRuntimeSubmitCommand = {
        ...command,
        message: prepared.message,
      }
      if (replay?.outcome === 'resume_queued') {
        return await this.submitExclusive(normalizedCommand, prepared, clientPayloadHash)
      }
      // A restarted Web process has no in-memory placement. Ensuring it before
      // selecting start/steer invokes the existing abandoned-Turn reconciler,
      // so a durable waiting_approval row can never keep a new message busy
      // after its native request disappeared.
      await this.ensureRuntimeForAdmission(normalizedCommand)
      const active = await resolveAssistantRuntimeMessageTarget(normalizedCommand)
      if (!active) {
        return await this.submitExclusive(normalizedCommand, prepared, clientPayloadHash)
      }
      return await this.steerExclusive({
        projectId: normalizedCommand.projectId,
        userId: normalizedCommand.userId,
        assistantId: normalizedCommand.assistantId,
        threadId: active.threadId,
        turnId: active.turnId,
        sourceId: normalizedCommand.sourceId,
        message: normalizedCommand.message,
      }, prepared, clientPayloadHash)
    })
  }

  private async submitExclusive(
    command: AssistantRuntimeSubmitCommand,
    preparedInput: AssistantRuntimePreparedInput,
    clientPayloadHash: string,
  ): Promise<AssistantRuntimeAdmissionReceipt> {
    const prepared = preparedInput
    const normalizedCommand: AssistantRuntimeSubmitCommand = {
      ...command,
      message: prepared.message,
    }
    const thread = await getOrCreateAssistantRuntimeThread(command)
    await this.ensureRuntimeForAdmission(command)
    const admission = await admitAssistantRuntimeTurn({
      command: normalizedCommand,
      threadId: thread.threadId,
      clientPayloadHash,
    })
    if (admission.replayed && (
      admission.turn.status !== 'queued' || admission.turn.runtimeTurnId !== null
    )) {
      return {
        outcome: 'replayed',
        threadId: admission.thread.threadId,
        turnId: admission.turn.turnId,
        runtimeThreadId: admission.thread.runtimeThreadId,
        runtimeTurnId: admission.turn.runtimeTurnId,
      }
    }
    await publishAgentSessionViewChanged({
      ...command,
      threadId: admission.thread.threadId,
      turnId: admission.turn.turnId,
      attempt: null,
      reason: 'runtime_turn_admitted',
    })
    let preparedThread: PreparedThread
    try {
      preparedThread = await this.prepareThread({
        scope: command,
        threadId: thread.threadId,
        runtimeThreadId: thread.runtimeThreadId,
      })
    } catch (error) {
      await failAssistantRuntimeTurnStart({
        scope: command,
        threadId: admission.thread.threadId,
        turnId: admission.turn.turnId,
        reason: 'runtime_thread_prepare_failed',
      }).catch(() => undefined)
      throw error
    }
    const started = await this.startProjection({
      scope: command,
      preparedThread,
      turn: admission.turn,
      sourceId: command.sourceId,
      locale: command.context.locale,
      inputs: prepared.inputs,
    })
    return {
      outcome: 'accepted',
      threadId: started.identity.threadId,
      turnId: started.identity.turnId,
      runtimeThreadId: started.runtimeThreadId,
      runtimeTurnId: started.runtimeTurnId,
    }
  }

  private async steerExclusive(
    command: AssistantRuntimeSteerCommand,
    preparedInput: AssistantRuntimePreparedInput,
    clientPayloadHash: string,
  ): Promise<AssistantRuntimeSteerReceipt> {
    const prepared = preparedInput
    const turn = await readAssistantRuntimeActiveTurn({
      scope: command,
      threadId: command.threadId,
      turnId: command.turnId,
    })
    if (!turn.runtimeTurnId) throw new Error('ASSISTANT_RUNTIME_STEER_RUNTIME_TURN_MISSING')
    const claim = await claimAssistantRuntimeSteer({
      scope: command,
      threadId: command.threadId,
      turnId: command.turnId,
      sourceId: command.sourceId,
      message: prepared.message,
      clientPayloadHash,
    })
    if (claim.outcome === 'replayed') {
      return {
        threadId: claim.threadId,
        turnId: claim.turnId,
        runtimeTurnId: claim.runtimeTurnId,
      }
    }
    const markUncertain = async (): Promise<void> => {
      await markAssistantRuntimeSteerUncertain({
        scope: command,
        threadId: command.threadId,
        turnId: command.turnId,
        sourceId: command.sourceId,
      }).catch(() => undefined)
    }
    try {
      const live = this.liveTurns.get(command.turnId)
      if (!live || live.started.runtimeTurnId !== turn.runtimeTurnId) {
        throw new Error('ASSISTANT_RUNTIME_STEER_LIVE_PROJECTION_MISSING')
      }
      const assistantBoundaryMessageId = await live.projector.createSteerBoundary()
      const acceptedRuntimeTurnId = await this.manager.steerTurn(
        runtimeScope(command),
        command.threadId,
        {
          expectedTurnId: turn.runtimeTurnId,
          clientUserMessageId: command.sourceId,
          input: prepared.inputs,
        },
      )
      if (acceptedRuntimeTurnId !== turn.runtimeTurnId) {
        throw new Error('ASSISTANT_RUNTIME_STEER_RESPONSE_DIVERGED')
      }
      await acceptAssistantRuntimeSteer({
        scope: command,
        threadId: command.threadId,
        turnId: command.turnId,
        sourceId: command.sourceId,
        runtimeTurnId: turn.runtimeTurnId,
        message: prepared.message,
        clientPayloadHash,
        assistantBoundaryMessageId,
      })
    } catch (error) {
      await markUncertain()
      throw new Error('ASSISTANT_RUNTIME_STEER_HANDOFF_UNCERTAIN', { cause: error })
    }
    await publishAgentSessionViewChanged({
      ...command,
      attempt: turn.attempt,
      reason: 'runtime_turn_steered',
    })
    return {
      threadId: command.threadId,
      turnId: command.turnId,
      runtimeTurnId: turn.runtimeTurnId,
    }
  }

  async interrupt(command: AssistantRuntimeInterruptCommand): Promise<AssistantRuntimeInterruptReceipt> {
    return await this.runProjectTransition(runtimeScope(command), async () => (
      await this.interruptExclusive(command)
    ))
  }

  private async interruptExclusive(
    command: AssistantRuntimeInterruptCommand,
  ): Promise<AssistantRuntimeInterruptReceipt> {
    const requested = await requestAssistantRuntimeInterrupt({
      scope: command,
      threadId: command.threadId,
      turnId: command.turnId,
      requestId: command.requestId,
      reason: command.reason,
    })
    if (requested.terminal) {
      await publishAgentSessionViewChanged({
        ...command,
        attempt: null,
        reason: 'runtime_turn_cancelled_before_start',
      })
      return { threadId: command.threadId, turnId: command.turnId, status: 'already_terminal' }
    }
    if (!requested.runtimeTurnId) {
      // The product Turn has claimed startup but app-server has not returned
      // its native id yet. bindStartedTurn will observe cancelRequestId, reject
      // the binding, and discard the unbound materialization.
      return { threadId: command.threadId, turnId: command.turnId, status: 'interrupt_requested' }
    }
    await this.manager.interruptTurn(
      runtimeScope(command),
      command.threadId,
      requested.runtimeTurnId,
    )
    return { threadId: command.threadId, turnId: command.turnId, status: 'interrupt_requested' }
  }

  async respondToServerRequest(command: AssistantRuntimeServerRequestCommand): Promise<void> {
    return await this.runProjectTransition(runtimeScope(command), async () => (
      await this.respondToServerRequestExclusive(command)
    ))
  }

  private async respondToServerRequestExclusive(
    command: AssistantRuntimeServerRequestCommand,
  ): Promise<void> {
    const runtimeRequestId = String(command.response.id)
    const decision = await decideAssistantRuntimeInteraction({
      scope: command,
      threadId: command.threadId,
      turnId: command.turnId,
      interactionId: command.interactionId,
      response: command.response,
    })
    if (runtimeRequestId !== decision.runtimeRequestId) {
      throw new Error('ASSISTANT_RUNTIME_INTERACTION_RESPONSE_ID_DIVERGED')
    }
    if (!decision.deliveryRequired) {
      await publishAgentSessionViewChanged({
        ...command,
        attempt: null,
        reason: 'runtime_server_request_response_replayed',
      })
      return
    }
    const requestIsLive = await this.manager.hasPendingServerRequest(
      runtimeScope(command),
      command.response.id,
    )
    if (!requestIsLive) {
      await this.expireServerRequest(command, runtimeRequestId)
      throw new Error('ASSISTANT_RUNTIME_INTERACTION_EXPIRED')
    }
    try {
      await this.manager.respondToServerRequest(runtimeScope(command), command.response)
    } catch {
      await this.expireServerRequest(command, decision.runtimeRequestId)
      throw new Error('ASSISTANT_RUNTIME_INTERACTION_EXPIRED')
    }
    await resolveAssistantRuntimeInteraction({
      scope: command,
      threadId: command.threadId,
      turnId: command.turnId,
      runtimeRequestId: decision.runtimeRequestId,
    })
    await publishAgentSessionViewChanged({
      ...command,
      attempt: null,
      reason: 'runtime_server_request_response_sent',
    })
  }

  private async expireServerRequest(
    command: AssistantRuntimeServerRequestCommand,
    runtimeRequestId: string,
  ): Promise<void> {
    await this.manager.stop(runtimeScope(command), 'recover').catch(() => undefined)
    await expireAssistantRuntimeInteraction({
      scope: command,
      threadId: command.threadId,
      turnId: command.turnId,
      interactionId: command.interactionId,
      runtimeRequestId,
    })
    await publishAgentSessionViewChanged({
      ...command,
      attempt: null,
      reason: 'runtime_server_request_expired',
    })
  }

  async clear(command: AssistantRuntimeClearCommand): Promise<AssistantRuntimeClearReceipt> {
    return await this.runProjectTransition(runtimeScope(command), async () => (
      await this.clearExclusive(command)
    ))
  }

  private async clearExclusive(
    command: AssistantRuntimeClearCommand,
  ): Promise<AssistantRuntimeClearReceipt> {
    const claim = await claimAssistantRuntimeThreadClear({
      scope: command,
      threadId: command.threadId,
      requestId: command.requestId,
    })
    if (claim === 'replayed') {
      return { threadId: command.threadId, archived: true }
    }
    const scope = runtimeScope(command)
    const access = await this.access.get(scope)
    const liveCompletions = [...this.liveTurns.values()]
      .filter(({ started }) => (
        started.identity.projectId === command.projectId
        && started.identity.userId === command.userId
        && started.identity.threadId === command.threadId
      ))
      .map(({ completion }) => completion)
    await this.manager.clearPersistentScope(scope, access.ownerToken)
    await Promise.all(liveCompletions)
    this.access.invalidate(scope)
    await clearAssistantRuntimeThread({
      scope: command,
      threadId: command.threadId,
      requestId: command.requestId,
    })
    await publishAgentSessionViewChanged({
      ...command,
      threadId: command.threadId,
      turnId: null,
      attempt: null,
      reason: 'runtime_thread_cleared',
    })
    return { threadId: command.threadId, archived: true }
  }

  async submitTaskFollowUp(batchId: string): Promise<AssistantRuntimeTaskFollowUpReceipt> {
    const loaded = await loadAssistantRuntimeTaskFollowUp(batchId)
    if (loaded.kind === 'cancelled') return { outcome: 'cancelled', batchId }
    return await this.runProjectTransition(runtimeScope(loaded.followUp), async () => (
      await this.submitTaskFollowUpExclusive(batchId, loaded.followUp)
    ))
  }

  private async submitTaskFollowUpExclusive(
    batchId: string,
    followUp: AssistantRuntimeTaskFollowUp,
  ): Promise<AssistantRuntimeTaskFollowUpReceipt> {
    const thread = await getOrCreateAssistantRuntimeThread(followUp)
    if (thread.threadId !== followUp.threadId) {
      throw new Error('ASSISTANT_RUNTIME_FOLLOW_UP_THREAD_DIVERGED')
    }
    await this.ensureRuntimeForAdmission(followUp)
    const admission = await admitAssistantRuntimeTaskFollowUp({
      batchId,
      expected: followUp,
    })
    if (admission.replayed && (
      admission.turn.status !== 'queued' || admission.turn.runtimeTurnId !== null
    )) {
      return {
        outcome: 'replayed',
        batchId,
        threadId: admission.thread.threadId,
        turnId: admission.turn.turnId,
        runtimeThreadId: admission.thread.runtimeThreadId,
        runtimeTurnId: admission.turn.runtimeTurnId,
      }
    }
    let preparedThread: PreparedThread
    try {
      preparedThread = await this.prepareThread({
        scope: followUp,
        threadId: thread.threadId,
        runtimeThreadId: thread.runtimeThreadId,
      })
    } catch (error) {
      await rollbackAssistantRuntimeTaskFollowUpPreparation({
        batchId,
        turnId: admission.turn.turnId,
      })
      throw error
    }
    const started = await this.startProjection({
      scope: followUp,
      preparedThread,
      turn: admission.turn,
      sourceId: followUp.batchId,
      locale: followUp.context.locale,
      inputs: followUp.inputs,
    })
    return {
      outcome: 'accepted',
      batchId,
      threadId: started.identity.threadId,
      turnId: started.identity.turnId,
      runtimeThreadId: started.runtimeThreadId,
      runtimeTurnId: started.runtimeTurnId,
    }
  }

  async shutdown(): Promise<void> {
    await this.manager.shutdownAll()
  }

  private async ensureRuntimeForAdmission(
    input: AssistantRuntimeSubmitCommand | AssistantRuntimeTaskFollowUp,
  ): Promise<void> {
    const scope = runtimeScope(input)
    const access = await this.access.get(scope)
    await this.manager.ensure(scope, {
      environment: access.environment,
      ownerToken: access.ownerToken,
    })
  }

  private async prepareThread(input: {
    readonly scope: AssistantRuntimeSubmitCommand | AssistantRuntimeTaskFollowUp
    readonly threadId: string
    readonly runtimeThreadId: string | null
  }): Promise<PreparedThread> {
    const scope = runtimeScope(input.scope)
    const access = await this.access.get(scope)
    const model = await this.models.resolve({ scope, access })
    await this.manager.ensure(scope, {
      environment: access.environment,
      ownerToken: access.ownerToken,
    })
    const preparedRuntime = await this.ensureThreadWithRecovery({
      scope,
      access,
      productThreadId: input.threadId,
      runtimeThreadId: input.runtimeThreadId,
      configuration: model.thread,
    })
    const runtime = preparedRuntime.runtime
    try {
      await bindAssistantRuntimeThread({
        scope: input.scope,
        threadId: input.threadId,
        runtimeThreadId: runtime.runtimeThreadId,
        expectedRuntimeThreadId: preparedRuntime.replacesRuntimeThreadId,
      })
    } catch (bindError) {
      if (runtime.disposition === 'started') {
        try {
          await this.manager.stop(scope, 'shutdown', access.ownerToken)
          await this.manager.clearPersistentScope(scope, access.ownerToken)
        } catch (cleanupError) {
          throw new AggregateError(
            [bindError, cleanupError],
            'ASSISTANT_RUNTIME_THREAD_BINDING_AND_CLEANUP_FAILED',
          )
        }
      }
      throw bindError
    }
    return { threadId: input.threadId, runtime, model }
  }

  private async ensureThreadWithRecovery(input: {
    readonly scope: RuntimeSessionScope
    readonly access: AssistantRuntimeAccess
    readonly productThreadId: string
    readonly runtimeThreadId: string | null
    readonly configuration: AssistantRuntimeModelConfiguration['thread']
  }): Promise<{
    readonly runtime: RuntimeThreadSessionView
    readonly replacesRuntimeThreadId: string | null
  }> {
    try {
      const runtime = await this.manager.ensureThread(input.scope, {
        productThreadId: input.productThreadId,
        runtimeThreadId: input.runtimeThreadId,
        configuration: input.configuration,
      })
      return { runtime, replacesRuntimeThreadId: null }
    } catch (resumeError) {
      if (!input.runtimeThreadId) throw resumeError

      // Wao's durable messages and task facts stay untouched. Native Codex
      // history cannot be reconstructed from them, so only discard the failed
      // App Server session and establish one new native Thread/MCP session.
      await this.manager.stop(input.scope, 'shutdown', input.access.ownerToken)
      await this.manager.ensure(input.scope, {
        environment: input.access.environment,
        ownerToken: input.access.ownerToken,
      })
      const runtime = await this.manager.ensureThread(input.scope, {
        productThreadId: input.productThreadId,
        runtimeThreadId: null,
        configuration: input.configuration,
      })
      return {
        runtime,
        replacesRuntimeThreadId: input.runtimeThreadId,
      }
    }
  }

  private async startProjection(input: {
    readonly scope: AssistantRuntimeSubmitCommand | AssistantRuntimeTaskFollowUp
    readonly preparedThread: PreparedThread
    readonly turn: AssistantRuntimeTurnIdentity
    readonly sourceId: string
    readonly locale: string
    readonly inputs: readonly RuntimeUserInput[]
  }): Promise<StartedProjection> {
    const scope = runtimeScope(input.scope)
    let resolveSettlement!: () => void
    let rejectSettlement!: (error: unknown) => void
    const settlementPromise = new Promise<void>((resolve, reject) => {
      resolveSettlement = resolve
      rejectSettlement = reject
    })
    const settlementEntry = { scope, promise: settlementPromise }
    this.settlementBarriers.set(input.turn.turnId, settlementEntry)
    const removeSettlementBarrier = (): void => {
      if (this.settlementBarriers.get(input.turn.turnId) === settlementEntry) {
        this.settlementBarriers.delete(input.turn.turnId)
      }
    }
    // A successful terminal write no longer needs to fence placement release.
    // A failed write remains registered so stop/recovery observes the rejection
    // and keeps the placement blocked instead of releasing an unsettled Turn.
    void settlementPromise.then(removeSettlementBarrier, () => undefined)
    const pendingEvents: RuntimeEvent[] = []
    let projector: AssistantRuntimeEventProjector | null = null
    const unsubscribe = this.manager.subscribe(scope, (managerEvent) => {
      if (!isRuntimeEvent(managerEvent)) return
      if (projector) projector.consume(managerEvent.event)
      else pendingEvents.push(managerEvent.event)
    })
    let runtimeTurnId: string | null = null
    const bindingState: { identity: AssistantRuntimeTurnIdentity | null } = { identity: null }
    try {
      await claimAssistantRuntimeTurnStart({
        scope: input.scope,
        threadId: input.preparedThread.threadId,
        turnId: input.turn.turnId,
      })
      const runtimeTurn = await this.manager.startTurn(scope, input.preparedThread.threadId, {
        clientUserMessageId: input.sourceId,
        input: withTurnContext(
          input.inputs,
          input.locale,
          input.preparedThread.model.projectProductionContext,
        ),
        model: input.preparedThread.model.runtimeModel,
        approvalPolicy: input.preparedThread.model.thread.start.approvalPolicy,
        sandboxPolicy: buildTurnSandboxPolicy(
          input.preparedThread.model.thread.start.sandbox,
        ),
        summary: 'concise',
        personality: 'none',
        collaborationMode: {
          mode: 'default',
          settings: {
            model: input.preparedThread.model.runtimeModel,
            reasoning_effort: null,
            developer_instructions: null,
          },
        },
      }, async (startedTurn) => {
        runtimeTurnId = startedTurn.id
        bindingState.identity = await bindAssistantRuntimeTurn({
          scope: input.scope,
          threadId: input.preparedThread.threadId,
          turnId: input.turn.turnId,
          runtimeTurnId: startedTurn.id,
        })
      })
      runtimeTurnId = runtimeTurn.id
      const identity = requireBoundTurnIdentity(bindingState.identity)
      const started: StartedProjection = {
        identity,
        runtimeThreadId: input.preparedThread.runtime.runtimeThreadId,
        runtimeTurnId,
      }
      const publisher = createAgentTurnStreamPublisher({
        projectId: identity.projectId,
        userId: identity.userId,
        threadId: identity.threadId,
        turnId: identity.turnId,
        attempt: identity.attempt,
        messageId: buildAgentTurnAssistantMessageId({
          turnId: identity.turnId,
          attempt: identity.attempt,
        }),
      })
      projector = new AssistantRuntimeEventProjector({
        identity: {
          ...identity,
          runtimeThreadId: input.preparedThread.runtime.runtimeThreadId,
        },
        modelKey: input.preparedThread.model.modelKey,
        sink: {
          reserveChunk: (chunk) => publisher.reserve(chunk),
          setMessageId: (messageId) => publisher.setMessageId(messageId),
          sealChunksThrough: (watermark) => publisher.sealThrough(watermark),
          publishChunksThrough: async (watermark) => await publisher.publishThrough(watermark),
          publishViewChanged: async (reason) => await publishAgentSessionViewChanged({
            projectId: identity.projectId,
            userId: identity.userId,
            threadId: identity.threadId,
            turnId: identity.turnId,
            attempt: identity.attempt,
            reason,
          }),
        },
        onInteraction: async (interaction) => await persistAssistantRuntimeInteraction({
          ...interaction,
          projectId: identity.projectId,
          userId: identity.userId,
        }),
        onInteractionResolved: async (requestId) => await resolveAssistantRuntimeInteraction({
          scope: input.scope,
          threadId: identity.threadId,
          turnId: identity.turnId,
          runtimeRequestId: requestId,
        }),
        onPlan: async (plan) => await replaceAssistantRuntimePlan({ identity, plan }),
        onMessageSnapshot: async (message) => await persistAssistantRuntimeMessageSnapshot({
          identity,
          message,
        }),
        onSkillsList: async (forceReload) => await this.manager.listSkills(scope, forceReload),
      })
      for (const event of pendingEvents.splice(0)) projector.consume(event)
      const completion = this.monitorProjection({ started, projector, publisher, unsubscribe })
      this.liveTurns.set(identity.turnId, { started, projector, completion })
      void completion.then(resolveSettlement, rejectSettlement)
      void completion
      await publishAgentSessionViewChanged({
        projectId: identity.projectId,
        userId: identity.userId,
        threadId: identity.threadId,
        turnId: identity.turnId,
        attempt: identity.attempt,
        reason: 'runtime_turn_started',
      })
      return started
    } catch (error) {
      unsubscribe()
      if (!runtimeTurnId) {
        try {
          await failAssistantRuntimeTurnStart({
            scope: input.scope,
            threadId: input.preparedThread.threadId,
            turnId: input.turn.turnId,
            reason: 'runtime_turn_start_failed',
          })
          resolveSettlement()
        } catch (settlementError) {
          rejectSettlement(settlementError)
        }
      } else if (!bindingState.identity) {
        try {
          await failAssistantRuntimeTurnStart({
            scope: input.scope,
            threadId: input.preparedThread.threadId,
            turnId: input.turn.turnId,
            reason: 'runtime_turn_binding_failed',
          })
          resolveSettlement()
        } catch (settlementError) {
          rejectSettlement(settlementError)
        }
        await this.manager.discardUnboundTurn(scope).catch(() => undefined)
      } else {
        try {
          await failAssistantRuntimeBoundTurnStart({
            scope: input.scope,
            threadId: input.preparedThread.threadId,
            turnId: input.turn.turnId,
            runtimeTurnId,
            reason: 'runtime_projection_start_failed',
          })
          resolveSettlement()
        } catch (settlementError) {
          rejectSettlement(settlementError)
        }
        const access = await this.access.get(scope)
        await this.manager.recover(scope, {
          environment: access.environment,
          ownerToken: access.ownerToken,
        }).catch(() => undefined)
      }
      throw error
    }
  }

  private async monitorProjection(input: {
    readonly started: StartedProjection
    readonly projector: AssistantRuntimeEventProjector
    readonly publisher: ReturnType<typeof createAgentTurnStreamPublisher>
    readonly unsubscribe: () => void
  }): Promise<void> {
    try {
      const terminal = await input.projector.terminal
      if (terminal.status === 'failed') {
        await this.manager.interruptTurn(
          runtimeScope(input.started.identity),
          input.started.identity.threadId,
          input.started.runtimeTurnId,
        ).catch(() => undefined)
      }
      await settleAssistantRuntimeTurn({
        identity: input.started.identity,
        projection: terminal,
      })
      await input.publisher.flush()
      await publishAgentSessionViewChanged({
        projectId: input.started.identity.projectId,
        userId: input.started.identity.userId,
        threadId: input.started.identity.threadId,
        turnId: input.started.identity.turnId,
        attempt: input.started.identity.attempt,
        reason: `runtime_turn_${terminal.status}`,
      })
    } catch (error) {
      logger.error({
        action: 'assistant_runtime.turn_projection_failed',
        message: 'assistant runtime terminal projection failed',
        projectId: input.started.identity.projectId,
        userId: input.started.identity.userId,
        details: {
          threadId: input.started.identity.threadId,
          turnId: input.started.identity.turnId,
          error: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
        },
      })
      // A terminal event was observed but its product projection did not
      // settle. Tear down this placement so the next admission must pass
      // reconcileBeforeStart instead of remaining permanently busy behind a
      // stale running Turn in the current in-memory session.
      const scope = runtimeScope(input.started.identity)
      void this.access.get(scope)
        .then(async (access) => await this.manager.recover(scope, {
          environment: access.environment,
          ownerToken: access.ownerToken,
        }))
        .catch((recoveryError: unknown) => {
          logger.error({
            action: 'assistant_runtime.turn_projection_recovery_failed',
            message: 'assistant runtime projection recovery failed',
            projectId: input.started.identity.projectId,
            userId: input.started.identity.userId,
            details: {
              threadId: input.started.identity.threadId,
              turnId: input.started.identity.turnId,
              error: recoveryError instanceof Error
                ? recoveryError.message
                : 'UNKNOWN_ERROR',
            },
          })
        })
      throw error
    } finally {
      this.liveTurns.delete(input.started.identity.turnId)
      input.unsubscribe()
    }
  }
}
