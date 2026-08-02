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
  admitAssistantRuntimeTaskFollowUp,
  admitAssistantRuntimeTurn,
  appendAssistantRuntimeSteerMessage,
  bindAssistantRuntimeTurn,
  clearAssistantRuntimeThread,
  decideAssistantRuntimeInteraction,
  failAssistantRuntimeTurnStart,
  getOrCreateAssistantRuntimeThread,
  loadAssistantRuntimeTaskFollowUp,
  persistAssistantRuntimeInteraction,
  persistAssistantRuntimeMessageSnapshot,
  readAssistantRuntimeActiveTurn,
  replaceAssistantRuntimePlan,
  requestAssistantRuntimeInterrupt,
  resolveAssistantRuntimeInteraction,
  rollbackAssistantRuntimeTaskFollowUpPreparation,
  settleAssistantRuntimeTurn,
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

function runtimeScope(input: { readonly userId: string; readonly projectId: string }): RuntimeSessionScope {
  return { userId: input.userId, projectId: input.projectId }
}

function withTurnContext(
  inputs: readonly RuntimeUserInput[],
  locale: string,
): readonly RuntimeUserInput[] {
  return [
    { type: 'text', text: buildAssistantRuntimeTurnContext(locale) },
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
  private readonly liveTurns = new Map<string, StartedProjection>()
  constructor(options: AssistantRuntimeServiceOptions) {
    this.manager = options.manager
    this.access = options.access
    this.models = options.models
  }

  async submit(command: AssistantRuntimeSubmitCommand): Promise<AssistantRuntimeAdmissionReceipt> {
    const prepared = await prepareAssistantRuntimeUserInput({
      message: command.message,
      userId: command.userId,
      projectId: command.projectId,
    })
    const normalizedCommand: AssistantRuntimeSubmitCommand = {
      ...command,
      message: prepared.message,
    }
    await this.ensureRuntimeForAdmission(command)
    const thread = await getOrCreateAssistantRuntimeThread(command)
    const admission = await admitAssistantRuntimeTurn({
      command: normalizedCommand,
      threadId: thread.threadId,
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
        recoveryThreadId: thread.runtimeThreadId,
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

  async steer(command: AssistantRuntimeSteerCommand): Promise<AssistantRuntimeSteerReceipt> {
    const prepared = await prepareAssistantRuntimeUserInput({
      message: command.message,
      userId: command.userId,
      projectId: command.projectId,
    })
    const turn = await readAssistantRuntimeActiveTurn({
      scope: command,
      threadId: command.threadId,
      turnId: command.turnId,
    })
    if (!turn.runtimeTurnId) throw new Error('ASSISTANT_RUNTIME_STEER_RUNTIME_TURN_MISSING')
    await this.manager.steerTurn(runtimeScope(command), command.threadId, {
      expectedTurnId: turn.runtimeTurnId,
      clientUserMessageId: command.sourceId,
      input: prepared.inputs,
    })
    await appendAssistantRuntimeSteerMessage({
      scope: command,
      threadId: command.threadId,
      turnId: command.turnId,
      message: prepared.message,
    })
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
    const requested = await requestAssistantRuntimeInterrupt({
      scope: command,
      threadId: command.threadId,
      turnId: command.turnId,
      requestId: command.requestId,
      reason: command.reason,
    })
    if (requested.terminal) {
      return { threadId: command.threadId, turnId: command.turnId, status: 'already_terminal' }
    }
    if (!requested.runtimeTurnId) {
      throw new Error('ASSISTANT_RUNTIME_INTERRUPT_RUNTIME_TURN_MISSING')
    }
    await this.manager.interruptTurn(
      runtimeScope(command),
      command.threadId,
      requested.runtimeTurnId,
    )
    return { threadId: command.threadId, turnId: command.turnId, status: 'interrupt_requested' }
  }

  async respondToServerRequest(command: AssistantRuntimeServerRequestCommand): Promise<void> {
    const decision = await decideAssistantRuntimeInteraction({
      scope: command,
      threadId: command.threadId,
      turnId: command.turnId,
      interactionId: command.interactionId,
      response: command.response,
    })
    if (String(command.response.id) !== decision.runtimeRequestId) {
      throw new Error('ASSISTANT_RUNTIME_INTERACTION_RESPONSE_ID_DIVERGED')
    }
    await this.manager.respondToServerRequest(runtimeScope(command), command.response)
    await publishAgentSessionViewChanged({
      ...command,
      attempt: null,
      reason: decision.replayed
        ? 'runtime_server_request_response_replayed'
        : 'runtime_server_request_response_sent',
    })
  }

  async clear(command: AssistantRuntimeClearCommand): Promise<AssistantRuntimeClearReceipt> {
    await this.manager.stop(runtimeScope(command), 'shutdown')
    this.access.invalidate(runtimeScope(command))
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
    const followUp = loaded.followUp
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
        recoveryThreadId: thread.runtimeThreadId,
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
    await this.manager.ensure(scope, { environment: access.environment })
  }

  private async prepareThread(input: {
    readonly scope: AssistantRuntimeSubmitCommand | AssistantRuntimeTaskFollowUp
    readonly threadId: string
    readonly recoveryThreadId: string | null
  }): Promise<PreparedThread> {
    const scope = runtimeScope(input.scope)
    const access = await this.access.get(scope)
    const model = await this.models.resolve({ scope, access })
    await this.manager.ensure(scope, { environment: access.environment })
    const runtime = await this.manager.ensureThread(scope, {
      productThreadId: input.threadId,
      recoveryThreadId: input.recoveryThreadId,
      configuration: model.thread,
    })
    return { threadId: input.threadId, runtime, model }
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
    const pendingEvents: RuntimeEvent[] = []
    let projector: AssistantRuntimeEventProjector | null = null
    const unsubscribe = this.manager.subscribe(scope, (managerEvent) => {
      if (managerEvent.type === 'threadCheckpointed'
        && managerEvent.thread.productThreadId === input.preparedThread.threadId) {
        void publishAgentSessionViewChanged({
          projectId: input.scope.projectId,
          userId: input.scope.userId,
          threadId: input.preparedThread.threadId,
          turnId: input.turn.turnId,
          attempt: input.turn.attempt || null,
          reason: 'runtime_thread_checkpointed',
        })
        return
      }
      if (!isRuntimeEvent(managerEvent)) return
      if (projector) projector.consume(managerEvent.event)
      else pendingEvents.push(managerEvent.event)
    })
    let runtimeTurnId: string | null = null
    try {
      const initialSkills = await this.manager.listSkills(scope)
      const runtimeTurn = await this.manager.startTurn(scope, input.preparedThread.threadId, {
        clientUserMessageId: input.sourceId,
        input: withTurnContext(input.inputs, input.locale),
        model: input.preparedThread.model.runtimeModel,
        approvalPolicy: 'on-request',
        sandboxPolicy: buildTurnSandboxPolicy(
          input.preparedThread.model.thread.start.sandbox,
        ),
        summary: 'concise',
        personality: 'pragmatic',
      })
      runtimeTurnId = runtimeTurn.id
      const identity = await bindAssistantRuntimeTurn({
        scope: input.scope,
        threadId: input.preparedThread.threadId,
        turnId: input.turn.turnId,
        runtimeTurnId,
      })
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
          publishChunk: (chunk) => publisher.publish(chunk),
          publishViewChanged: async (reason) => await publishAgentSessionViewChanged({
            projectId: identity.projectId,
            userId: identity.userId,
            threadId: identity.threadId,
            turnId: identity.turnId,
            attempt: identity.attempt,
            reason,
          }),
        },
        onInteraction: async (interaction) => await persistAssistantRuntimeInteraction(interaction),
        onInteractionResolved: async (requestId) => await resolveAssistantRuntimeInteraction({
          turnId: identity.turnId,
          runtimeRequestId: requestId,
        }),
        onPlan: async (plan) => await replaceAssistantRuntimePlan({
          scope: input.scope,
          threadId: identity.threadId,
          plan,
        }),
        onMessageSnapshot: async (message) => await persistAssistantRuntimeMessageSnapshot({
          identity,
          message,
        }),
        onSkillsList: async (forceReload) => await this.manager.listSkills(scope, forceReload),
      })
      projector.setInitialSkillsInventory(initialSkills)
      for (const event of pendingEvents.splice(0)) projector.consume(event)
      this.liveTurns.set(identity.turnId, started)
      void this.monitorProjection({ started, projector, publisher, unsubscribe })
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
        await failAssistantRuntimeTurnStart({
          scope: input.scope,
          threadId: input.preparedThread.threadId,
          turnId: input.turn.turnId,
          reason: 'runtime_turn_start_failed',
        }).catch(() => undefined)
      } else {
        await this.manager.recover(scope, {
          environment: (await this.access.get(scope)).environment,
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
    } finally {
      this.liveTurns.delete(input.started.identity.turnId)
      input.unsubscribe()
    }
  }
}
