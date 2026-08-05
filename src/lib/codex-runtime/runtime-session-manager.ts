import { createHash } from 'node:crypto'
import type {
  RuntimeApprovalPolicy,
  RuntimeEvent,
  RuntimeJsonValue,
  RuntimeServerRequestResponse,
  RuntimeSandboxMode,
  RuntimeSkillsListEntry,
  RuntimeThread,
  RuntimeThreadResumeParams,
  RuntimeThreadStartParams,
  RuntimeTurn,
  RuntimeTurnStartParams,
  RuntimeTurnSteerParams,
} from './runtime-adapter'
import { normalizeRuntimeScopedEnvironment } from './runtime-container'
import type {
  RuntimeContainerAdapter,
  RuntimeContainerHandle,
  RuntimeContainerMaterialization,
} from './runtime-container'

export type RuntimeSessionScope = {
  readonly userId: string
  readonly projectId: string
}

export type RuntimeSessionMaterialization = RuntimeContainerMaterialization
export type RuntimeSessionCheckpointReason = 'turn_completed' | 'idle' | 'shutdown' | 'recover'
export interface RuntimeSessionPersistence {
  /** Idempotently settle an abandoned product Turn before a new placement. */
  reconcileBeforeStart(scope: RuntimeSessionScope): Promise<void>
  /** Materialize disposable scratch, read-only project facts, and opaque Codex home once per container. */
  materialize(scope: RuntimeSessionScope): Promise<RuntimeSessionMaterialization>
  /**
   * The unique durable runtime-thread binding writer. It must commit the opaque
   * Codex state before binding productThreadId to runtimeThreadId. A newly
   * started thread must never be persisted from threadReady alone.
   */
  checkpointRuntime(params: {
    readonly scope: RuntimeSessionScope
    readonly materialization: RuntimeSessionMaterialization
    readonly productThreadId: string
    readonly runtimeThreadId: string
    readonly reason: RuntimeSessionCheckpointReason
  }): Promise<void>
  destroyMaterialization(materialization: RuntimeSessionMaterialization): Promise<void>
}

export interface RuntimeSessionOwnershipClaim {
  readonly ownerToken: string
  /** Resolves or rejects when the external exclusive claim is no longer held. */
  readonly lost: Promise<void>
  release(): Promise<void>
}

export interface RuntimeSessionOwnership {
  acquire(
    scope: RuntimeSessionScope,
    ownerToken: string,
  ): Promise<RuntimeSessionOwnershipClaim>
}

export type RuntimeSessionThreadConfiguration = {
  readonly start: Omit<RuntimeThreadStartParams, 'cwd' | 'sandbox' | 'approvalPolicy'> & {
    readonly sandbox: RuntimeSandboxMode
    readonly approvalPolicy: RuntimeApprovalPolicy
  }
  readonly resume?: Omit<RuntimeThreadResumeParams, 'threadId' | 'cwd' | 'sandbox' | 'approvalPolicy'> & {
    readonly sandbox: RuntimeSandboxMode
    readonly approvalPolicy: RuntimeApprovalPolicy
  }
}

export type RuntimeSessionLaunchOptions = {
  readonly environment: Readonly<Record<string, string>>
  /** Signed Runtime capability generation; also owns the external lease. */
  readonly ownerToken: string
}

export type RuntimeThreadSessionOptions = {
  /** Canonical Wao ProjectAssistantThread identity; never inferred from workspace paths. */
  readonly productThreadId: string
  /** Only a runtime thread with a durably captured rollout may be resumed. */
  readonly recoveryThreadId: string | null
  readonly configuration: RuntimeSessionThreadConfiguration
}

export type RuntimeSessionView = {
  readonly scopeId: string
  readonly containerIdentity: string
}

export type RuntimeThreadSessionView = {
  readonly productThreadId: string
  readonly runtimeThreadId: string
  readonly disposition: 'started' | 'resumed'
  /** False until checkpointRuntime durably commits rollout and binding. */
  readonly durable: boolean
}

export type RuntimeSessionManagerEvent =
  | {
      readonly type: 'runtime'
      readonly event: RuntimeEvent
    }
  | {
      readonly type: 'state'
      readonly state: 'starting' | 'ready' | 'recovering' | 'idle_stopped' | 'stopped' | 'blocked'
    }
  | {
      readonly type: 'threadReady'
      readonly thread: RuntimeThreadSessionView
    }
  | {
      readonly type: 'threadCheckpointed'
      readonly thread: RuntimeThreadSessionView & { readonly durable: true }
    }

export type RuntimeSessionManagerListener = (event: RuntimeSessionManagerEvent) => void

export type RuntimeSessionManagerOptions = {
  readonly container: RuntimeContainerAdapter
  readonly persistence: RuntimeSessionPersistence
  readonly ownership: RuntimeSessionOwnership
  readonly idleTimeoutMs: number
  readonly idleSweepIntervalMs?: number
  /** Wait until the product projector has committed every live Turn terminal. */
  readonly waitForTurnSettlement: (scope: RuntimeSessionScope) => Promise<void>
  readonly onError: (params: {
    readonly scope: RuntimeSessionScope
    readonly phase: string
    readonly error: Error
  }) => void
}

type SessionStatus = 'starting' | 'ready' | 'recovering' | 'stopping' | 'blocked'

type ManagedThread = {
  readonly productThreadId: string
  readonly thread: RuntimeThread
  readonly disposition: 'started' | 'resumed'
  readonly configuration: RuntimeSessionThreadConfiguration
  resumable: boolean
  checkpointRequired: boolean
  historySeeded: boolean
}

type ThreadSlot = {
  readonly entry: Promise<ManagedThread>
}

type ActiveTurn = {
  readonly productThreadId: string
  readonly runtimeTurnId: string | null
}

type ChildTurn = {
  readonly runtimeTurnId: string
  readonly completion: Promise<void>
  readonly resolveCompletion: () => void
  interruptRequested: boolean
}

const CHILD_TURN_DRAIN_TIMEOUT_MS = 15_000

function createChildTurn(runtimeTurnId: string): ChildTurn {
  let resolveCompletion!: () => void
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve
  })
  return {
    runtimeTurnId,
    completion,
    resolveCompletion,
    interruptRequested: false,
  }
}

async function withChildDrainTimeout<T>(promise: Promise<T>, code: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(code)), CHILD_TURN_DRAIN_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

type SessionEntry = {
  readonly scope: RuntimeSessionScope
  readonly scopeId: string
  readonly ownership: RuntimeSessionOwnershipClaim
  readonly materialization: RuntimeSessionMaterialization
  readonly container: RuntimeContainerHandle
  readonly environment: Readonly<Record<string, string>>
  readonly environmentFingerprint: string
  readonly threads: Map<string, ThreadSlot>
  readonly runtimeThreadToProductThread: Map<string, string>
  readonly childTurns: Map<string, ChildTurn>
  childDrain: Promise<void>
  childGenerationUsed: boolean
  restartRequired: boolean
  turnBindingBarrier: Promise<boolean> | null
  workspaceCaptureAllowed: boolean
  unsubscribeRuntime: (() => void) | null
  status: SessionStatus
  lastActivityAt: number
  activeTurn: ActiveTurn | null
  skillsStale: boolean
  persistenceQueue: Promise<void>
  transition: Promise<void> | null
}

type SessionSlot = {
  readonly scope: RuntimeSessionScope
  readonly environmentFingerprint: string
  readonly entry: Promise<SessionEntry>
}

type ThreadRecoverySpec = {
  readonly productThreadId: string
  readonly recoveryThreadId: string | null
  readonly configuration: RuntimeSessionThreadConfiguration
}

export class RuntimeSessionManager {
  private readonly options: RuntimeSessionManagerOptions
  private readonly slots = new Map<string, SessionSlot>()
  private readonly subscribers = new Map<string, Set<RuntimeSessionManagerListener>>()
  private readonly idleTimer: NodeJS.Timeout
  private shuttingDown = false

  constructor(options: RuntimeSessionManagerOptions) {
    validateManagerOptions(options)
    this.options = options
    const sweepIntervalMs = options.idleSweepIntervalMs
      ?? Math.min(Math.max(Math.floor(options.idleTimeoutMs / 2), 1_000), 60_000)
    this.idleTimer = setInterval(() => {
      void this.stopIdleSessions().catch((error: unknown) => {
        this.reportError({ userId: 'runtime-manager', projectId: 'idle-sweep' }, 'idle_sweep', error)
      })
    }, sweepIntervalMs)
    this.idleTimer.unref()
  }

  async ensure(
    scopeValue: RuntimeSessionScope,
    launchOptions: RuntimeSessionLaunchOptions,
  ): Promise<RuntimeSessionView> {
    return await this.startOrResume(scopeValue, launchOptions)
  }

  async startOrResume(
    scopeValue: RuntimeSessionScope,
    launchOptions: RuntimeSessionLaunchOptions,
  ): Promise<RuntimeSessionView> {
    if (this.shuttingDown) throw new Error('CODEX_RUNTIME_SESSION_MANAGER_SHUTTING_DOWN')
    const scope = normalizeScope(scopeValue)
    const scopeId = buildRuntimeSessionScopeId(scope)
    const environment = normalizeRuntimeScopedEnvironment(launchOptions.environment)
    const ownerToken = requireIdentity(
      launchOptions.ownerToken,
      'CODEX_RUNTIME_SESSION_OWNER_TOKEN_INVALID',
    )
    const environmentFingerprint = fingerprintEnvironment(environment)
    const existing = this.slots.get(scopeId)
    if (existing) {
      if (existing.environmentFingerprint !== environmentFingerprint) {
        throw new Error('CODEX_RUNTIME_SESSION_ENVIRONMENT_MISMATCH')
      }
      const entry = await existing.entry
      if (entry.status === 'ready') {
        if (entry.restartRequired) {
          await entry.persistenceQueue
          if (!entry.transition) this.scheduleRecovery(entry)
          if (entry.transition) {
            await entry.transition
            return await this.startOrResume(scope, launchOptions)
          }
          throw new Error('CODEX_RUNTIME_SESSION_RESTART_REQUIRED')
        }
        entry.lastActivityAt = Date.now()
        return toSessionView(entry)
      }
      if (entry.transition) {
        await entry.transition
        return await this.startOrResume(scope, launchOptions)
      }
      throw new Error(`CODEX_RUNTIME_SESSION_NOT_READY:${entry.status}`)
    }

    this.publish(scopeId, { type: 'state', state: 'starting' })
    const slot: SessionSlot = {
      scope,
      environmentFingerprint,
      entry: this.startContainerSession(
        scope,
        scopeId,
        environment,
        environmentFingerprint,
        ownerToken,
      ),
    }
    this.slots.set(scopeId, slot)
    try {
      const entry = await slot.entry
      if (this.slots.get(scopeId) !== slot) throw new Error('CODEX_RUNTIME_SESSION_SLOT_REPLACED')
      this.publish(scopeId, { type: 'state', state: 'ready' })
      return toSessionView(entry)
    } catch (error) {
      if (this.slots.get(scopeId) === slot) this.slots.delete(scopeId)
      throw error
    }
  }

  async ensureThread(
    scope: RuntimeSessionScope,
    options: RuntimeThreadSessionOptions,
  ): Promise<RuntimeThreadSessionView> {
    const session = await this.requireReadyEntry(scope)
    const productThreadId = requireIdentity(
      options.productThreadId,
      'CODEX_RUNTIME_PRODUCT_THREAD_ID_INVALID',
    )
    const existing = session.threads.get(productThreadId)
    if (existing) {
      const thread = await existing.entry
      if (options.recoveryThreadId && options.recoveryThreadId !== thread.thread.id) {
        throw new Error('CODEX_RUNTIME_PRODUCT_THREAD_BINDING_DIVERGED')
      }
      session.runtimeThreadToProductThread.set(thread.thread.id, productThreadId)
      return toThreadSessionView(thread)
    }

    const slot: ThreadSlot = {
      entry: this.startThreadSession(session, {
        ...options,
        productThreadId,
      }),
    }
    session.threads.set(productThreadId, slot)
    try {
      const thread = await slot.entry
      session.runtimeThreadToProductThread.set(thread.thread.id, productThreadId)
      session.lastActivityAt = Date.now()
      this.publish(session.scopeId, { type: 'threadReady', thread: toThreadSessionView(thread) })
      return toThreadSessionView(thread)
    } catch (error) {
      if (session.threads.get(productThreadId) === slot) session.threads.delete(productThreadId)
      throw error
    }
  }

  subscribe(scopeValue: RuntimeSessionScope, listener: RuntimeSessionManagerListener): () => void {
    const scopeId = buildRuntimeSessionScopeId(normalizeScope(scopeValue))
    const listeners = this.subscribers.get(scopeId) ?? new Set<RuntimeSessionManagerListener>()
    listeners.add(listener)
    this.subscribers.set(scopeId, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.subscribers.delete(scopeId)
    }
  }

  async readThread(
    scope: RuntimeSessionScope,
    productThreadId: string,
    includeTurns = true,
  ): Promise<RuntimeThread> {
    const { session, thread } = await this.requireManagedThread(scope, productThreadId)
    session.lastActivityAt = Date.now()
    return await session.container.runtime.readThread({
      threadId: thread.thread.id,
      includeTurns,
    })
  }

  async listSkills(
    scope: RuntimeSessionScope,
    forceReload = false,
  ): Promise<RuntimeSkillsListEntry> {
    const session = await this.requireReadyEntry(scope)
    session.lastActivityAt = Date.now()
    const response = await session.container.runtime.listSkills({
      cwds: [session.container.runtimeWorkspaceDirectory],
      forceReload: forceReload || session.skillsStale,
    })
    if (
      response.data.length !== 1
      || response.data[0].cwd !== session.container.runtimeWorkspaceDirectory
    ) {
      throw new Error('CODEX_RUNTIME_SKILLS_LIST_SCOPE_DIVERGED')
    }
    session.skillsStale = false
    return response.data[0]
  }

  async seedThreadHistory(
    scope: RuntimeSessionScope,
    productThreadId: string,
    items: readonly RuntimeJsonValue[],
  ): Promise<void> {
    const { session, thread } = await this.requireManagedThread(scope, productThreadId)
    if (thread.historySeeded) return
    if (session.activeTurn) throw new Error('CODEX_RUNTIME_HISTORY_SEED_DURING_ACTIVE_TURN')
    if (items.length > 0) {
      await session.container.runtime.injectThreadItems({
        threadId: thread.thread.id,
        items,
      })
    }
    thread.historySeeded = true
    session.lastActivityAt = Date.now()
  }

  async startTurn(
    scope: RuntimeSessionScope,
    productThreadId: string,
    params: Omit<RuntimeTurnStartParams, 'threadId'>,
    bindStartedTurn: (turn: RuntimeTurn) => Promise<void>,
  ): Promise<RuntimeTurn> {
    const managed = await this.requireManagedThread(scope, productThreadId)
    await managed.session.childDrain
    await managed.session.persistenceQueue
    if (managed.session.status !== 'ready') {
      throw new Error(`CODEX_RUNTIME_SESSION_NOT_READY:${managed.session.status}`)
    }
    if (managed.session.restartRequired || managed.session.childTurns.size > 0) {
      throw new Error('CODEX_RUNTIME_CHILD_GENERATION_NOT_CLOSED')
    }
    if (managed.session.activeTurn) throw new Error('CODEX_RUNTIME_SESSION_TURN_ALREADY_ACTIVE')
    managed.session.childGenerationUsed = false
    managed.session.lastActivityAt = Date.now()
    managed.session.activeTurn = {
      productThreadId: managed.thread.productThreadId,
      runtimeTurnId: null,
    }
    managed.session.workspaceCaptureAllowed = false
    let resolveBinding!: (bound: boolean) => void
    managed.session.turnBindingBarrier = new Promise<boolean>((resolve) => {
      resolveBinding = resolve
    })
    try {
      const turn = await managed.session.container.runtime.startTurn({
        ...params,
        threadId: managed.thread.thread.id,
      })
      managed.session.activeTurn = {
        productThreadId: managed.thread.productThreadId,
        runtimeTurnId: turn.id,
      }
      await bindStartedTurn(turn)
      managed.session.workspaceCaptureAllowed = true
      resolveBinding(true)
      return turn
    } catch (error) {
      resolveBinding(false)
      managed.session.activeTurn = null
      throw error
    }
  }

  /** Drop a native Turn that never obtained its product binding. */
  async discardUnboundTurn(scopeValue: RuntimeSessionScope): Promise<void> {
    const scope = normalizeScope(scopeValue)
    const scopeId = buildRuntimeSessionScopeId(scope)
    const slot = this.slots.get(scopeId)
    if (!slot) return
    const entry = await slot.entry
    if (entry.workspaceCaptureAllowed) {
      throw new Error('CODEX_RUNTIME_DISCARD_BOUND_TURN_FORBIDDEN')
    }
    if (entry.transition) return await entry.transition
    const transition = (async () => {
      entry.status = 'stopping'
      await entry.container.stop('force').catch(() => undefined)
      try {
        await entry.persistenceQueue
        await this.options.waitForTurnSettlement(entry.scope)
        await this.options.persistence.destroyMaterialization(entry.materialization)
        entry.unsubscribeRuntime?.()
        entry.unsubscribeRuntime = null
        await entry.ownership.release()
        await this.deleteSlot(entry)
        this.publish(entry.scopeId, { type: 'state', state: 'stopped' })
      } catch (error) {
        entry.status = 'blocked'
        this.publish(entry.scopeId, { type: 'state', state: 'blocked' })
        throw error
      }
    })()
    entry.transition = transition
    return await transition
  }

  async steerTurn(
    scope: RuntimeSessionScope,
    productThreadId: string,
    params: Omit<RuntimeTurnSteerParams, 'threadId'>,
  ): Promise<string> {
    const { session, thread } = await this.requireManagedThread(scope, productThreadId)
    session.lastActivityAt = Date.now()
    return await session.container.runtime.steerTurn({
      ...params,
      threadId: thread.thread.id,
    })
  }

  async interruptTurn(
    scope: RuntimeSessionScope,
    productThreadId: string,
    runtimeTurnId: string,
  ): Promise<void> {
    const { session, thread } = await this.requireManagedThread(scope, productThreadId)
    session.lastActivityAt = Date.now()
    await session.container.runtime.interruptTurn({
      threadId: thread.thread.id,
      turnId: runtimeTurnId,
    })
  }

  async respondToServerRequest(
    scope: RuntimeSessionScope,
    response: RuntimeServerRequestResponse,
  ): Promise<void> {
    const session = await this.requireReadyEntry(scope)
    session.lastActivityAt = Date.now()
    await session.container.runtime.respondToServerRequest(response)
  }

  touch(scopeValue: RuntimeSessionScope): void {
    const scope = normalizeScope(scopeValue)
    const slot = this.slots.get(buildRuntimeSessionScopeId(scope))
    if (!slot) return
    void slot.entry.then((entry) => {
      if (entry.status === 'ready') entry.lastActivityAt = Date.now()
    })
  }

  async readOwnerToken(scopeValue: RuntimeSessionScope): Promise<string | null> {
    const scope = normalizeScope(scopeValue)
    const slot = this.slots.get(buildRuntimeSessionScopeId(scope))
    if (!slot) return null
    return (await slot.entry).ownership.ownerToken
  }

  async recover(
    scopeValue: RuntimeSessionScope,
    launchOptions: RuntimeSessionLaunchOptions,
  ): Promise<RuntimeSessionView> {
    const scope = normalizeScope(scopeValue)
    const threads = await this.readManagedThreadsForScope(scope)
    await this.stop(scope, 'recover')
    const specs = buildRecoverySpecsFromThreads(threads)
    const view = await this.startOrResume(scope, launchOptions)
    await this.restoreThreads(scope, specs)
    return view
  }

  async stop(
    scopeValue: RuntimeSessionScope,
    reason: RuntimeSessionCheckpointReason = 'shutdown',
    expectedOwnerToken?: string,
  ): Promise<void> {
    const scope = normalizeScope(scopeValue)
    const scopeId = buildRuntimeSessionScopeId(scope)
    const slot = this.slots.get(scopeId)
    if (!slot) return
    const entry = await slot.entry
    if (expectedOwnerToken && entry.ownership.ownerToken !== expectedOwnerToken) {
      throw new Error('CODEX_RUNTIME_SESSION_OWNER_TOKEN_DIVERGED')
    }
    if (entry.transition) return await entry.transition
    const transition = this.stopEntry(entry, reason)
    entry.transition = transition
    return await transition
  }

  async stopIdleSessions(): Promise<number> {
    if (this.shuttingDown) return 0
    const now = Date.now()
    const entries = await Promise.all([...this.slots.values()].map(async (slot) => await slot.entry))
    const idleEntries = entries.filter((entry) => (
      entry.status === 'ready'
      && !entry.activeTurn
      && now - entry.lastActivityAt >= this.options.idleTimeoutMs
    ))
    const results = await Promise.allSettled(idleEntries.map(async (entry) => await this.stop(entry.scope, 'idle')))
    return results.filter((result) => result.status === 'fulfilled').length
  }

  async shutdownAll(): Promise<void> {
    if (this.shuttingDown) return
    this.shuttingDown = true
    clearInterval(this.idleTimer)
    const scopes = [...this.slots.values()].map((slot) => slot.scope)
    const results = await Promise.allSettled(scopes.map(async (scope) => await this.stop(scope, 'shutdown')))
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason)
    if (errors.length > 0) throw new AggregateError(errors, 'CODEX_RUNTIME_SESSION_MANAGER_SHUTDOWN_FAILED')
  }

  private async startContainerSession(
    scope: RuntimeSessionScope,
    scopeId: string,
    environment: Readonly<Record<string, string>>,
    environmentFingerprint: string,
    ownerToken: string,
  ): Promise<SessionEntry> {
    const ownership = await this.options.ownership.acquire(scope, ownerToken)
    requireIdentity(ownership.ownerToken, 'CODEX_RUNTIME_SESSION_OWNER_TOKEN_INVALID')
    let materialization: RuntimeSessionMaterialization | null = null
    let container: RuntimeContainerHandle | null = null
    let unsubscribeRuntime: (() => void) | null = null
    let readyEntry: SessionEntry | null = null
    try {
      await this.options.container.reconcile(scopeId)
      await this.options.persistence.reconcileBeforeStart(scope)
      materialization = validateMaterialization(await this.options.persistence.materialize(scope))
      container = await this.options.container.launch({
        scopeId,
        ownerToken: ownership.ownerToken,
        materialization,
        environment,
      })
      unsubscribeRuntime = container.runtime.subscribe((event) => {
        this.publish(scopeId, { type: 'runtime', event })
        if (readyEntry) this.handleRuntimeEvent(readyEntry, event)
      })
      await container.runtime.initialize()
      const entry: SessionEntry = {
        scope,
        scopeId,
        ownership,
        materialization,
        container,
        environment,
        environmentFingerprint,
        threads: new Map(),
        runtimeThreadToProductThread: new Map(),
        childTurns: new Map(),
        childDrain: Promise.resolve(),
        childGenerationUsed: false,
        restartRequired: false,
        turnBindingBarrier: null,
        workspaceCaptureAllowed: true,
        unsubscribeRuntime,
        status: 'ready',
        lastActivityAt: Date.now(),
        activeTurn: null,
        skillsStale: false,
        persistenceQueue: Promise.resolve(),
        transition: null,
      }
      readyEntry = entry
      void ownership.lost.then(
        () => this.handleOwnershipLost(entry),
        () => this.handleOwnershipLost(entry),
      )
      return entry
    } catch (error) {
      unsubscribeRuntime?.()
      if (container) await container.stop('force').catch(() => undefined)
      if (materialization) {
        await this.options.persistence.destroyMaterialization(materialization).catch(() => undefined)
      }
      await ownership.release().catch(() => undefined)
      throw error
    }
  }

  private async startThreadSession(
    session: SessionEntry,
    options: RuntimeThreadSessionOptions,
  ): Promise<ManagedThread> {
    const thread = options.recoveryThreadId
      ? await session.container.runtime.resumeThread({
          ...options.configuration.resume,
          threadId: requireIdentity(
            options.recoveryThreadId,
            'CODEX_RUNTIME_RECOVERY_THREAD_ID_INVALID',
          ),
          cwd: session.container.runtimeWorkspaceDirectory,
        })
      : await session.container.runtime.startThread({
          ...options.configuration.start,
          cwd: session.container.runtimeWorkspaceDirectory,
        })
    return {
      productThreadId: options.productThreadId,
      thread,
      disposition: options.recoveryThreadId ? 'resumed' : 'started',
      configuration: options.configuration,
      resumable: options.recoveryThreadId !== null,
      checkpointRequired: false,
      historySeeded: options.recoveryThreadId !== null,
    }
  }

  private async requireReadyEntry(scope: RuntimeSessionScope): Promise<SessionEntry> {
    const normalized = normalizeScope(scope)
    const slot = this.slots.get(buildRuntimeSessionScopeId(normalized))
    if (!slot) throw new Error('CODEX_RUNTIME_SESSION_MISSING')
    const entry = await slot.entry
    if (entry.status !== 'ready') throw new Error(`CODEX_RUNTIME_SESSION_NOT_READY:${entry.status}`)
    return entry
  }

  private async requireManagedThread(
    scope: RuntimeSessionScope,
    productThreadIdValue: string,
  ): Promise<{ readonly session: SessionEntry; readonly thread: ManagedThread }> {
    const session = await this.requireReadyEntry(scope)
    const productThreadId = requireIdentity(
      productThreadIdValue,
      'CODEX_RUNTIME_PRODUCT_THREAD_ID_INVALID',
    )
    const slot = session.threads.get(productThreadId)
    if (!slot) throw new Error('CODEX_RUNTIME_PRODUCT_THREAD_NOT_ENSURED')
    return { session, thread: await slot.entry }
  }

  private handleRuntimeEvent(entry: SessionEntry, event: RuntimeEvent): void {
    entry.lastActivityAt = Date.now()
    if (event.type === 'processExited') {
      for (const child of entry.childTurns.values()) child.resolveCompletion()
      entry.childTurns.clear()
      if (!event.expected && entry.status === 'ready') this.scheduleRecovery(entry)
      return
    }
    if (event.type !== 'notification') return
    if (event.method === 'skills/changed') {
      entry.skillsStale = true
      return
    }
    if (event.method === 'turn/started') {
      const runtimeThreadId = typeof event.params.threadId === 'string'
        ? event.params.threadId
        : null
      if (!runtimeThreadId) {
        this.scheduleRecovery(entry)
        return
      }
      const productThreadId = entry.runtimeThreadToProductThread.get(runtimeThreadId)
      const turn = getRecord(event.params.turn)
      const runtimeTurnId = turn && typeof turn.id === 'string' ? turn.id : null
      if (!runtimeTurnId) {
        this.scheduleRecovery(entry)
        return
      }
      // Native Subagents own child Threads in the same app-server process.
      // Their Turn lifecycle is projected through collab/subAgent items on the
      // parent Turn; it must not mutate or invalidate the Product Turn slot.
      if (!productThreadId) {
        entry.childGenerationUsed = true
        const existing = entry.childTurns.get(runtimeThreadId)
        if (existing) {
          if (existing.runtimeTurnId !== runtimeTurnId) {
            this.scheduleRecovery(entry)
          }
          return
        }
        entry.childTurns.set(runtimeThreadId, createChildTurn(runtimeTurnId))
        return
      }
      if (entry.activeTurn && entry.activeTurn.productThreadId !== productThreadId) {
        this.scheduleRecovery(entry)
        return
      }
      entry.activeTurn = { productThreadId, runtimeTurnId }
      return
    }
    if (event.method !== 'turn/completed') return
    const completedRuntimeThreadId = typeof event.params.threadId === 'string'
      ? event.params.threadId
      : null
    if (!completedRuntimeThreadId) {
      this.scheduleRecovery(entry)
      return
    }
    const productThreadId = entry.runtimeThreadToProductThread.get(completedRuntimeThreadId)
    const turn = getRecord(event.params.turn)
    const runtimeTurnId = turn && typeof turn.id === 'string' ? turn.id : null
    const status = turn && typeof turn.status === 'string' ? turn.status : null
    if (!runtimeTurnId || !status) {
      this.scheduleRecovery(entry)
      return
    }
    if (!productThreadId) {
      const child = entry.childTurns.get(completedRuntimeThreadId)
      if (child?.runtimeTurnId === runtimeTurnId) {
        entry.childTurns.delete(completedRuntimeThreadId)
        child.resolveCompletion()
      }
      return
    }
    entry.childDrain = entry.childDrain.then(
      async () => await this.interruptChildTurns(entry),
    )
    const childDrain = entry.childDrain
    const restartAfterChildTurns = entry.childGenerationUsed
    if (restartAfterChildTurns) entry.restartRequired = true
    const bindingBarrier = entry.turnBindingBarrier ?? Promise.resolve(true)
    entry.activeTurn = null
    const threadSlot = entry.threads.get(productThreadId)
    if (!threadSlot) {
      this.scheduleRecovery(entry)
      return
    }
    // Register the terminal runtime-state checkpoint barrier synchronously with
    // the native completion event. Disposable workspace scratch is never captured.
    void this.enqueuePersistence(entry, async () => {
      const thread = await threadSlot.entry
      const bound = await bindingBarrier
      await childDrain
      if (!bound) return
      // A native Subagent may spawn descendants on its own thread. Closing the
      // app-server after the observed generation drains is the only protocol
      // boundary that proves no delayed child notification or writer remains.
      if (restartAfterChildTurns) await entry.container.stop('graceful')
      if (status === 'completed') {
        await this.options.persistence.checkpointRuntime({
          scope: entry.scope,
          materialization: entry.materialization,
          productThreadId: thread.productThreadId,
          runtimeThreadId: thread.thread.id,
          reason: 'turn_completed',
        })
        thread.checkpointRequired = false
        thread.resumable = true
        this.publishThreadCheckpointed(entry, thread)
      }
    }).then(
      () => {
        if (restartAfterChildTurns) this.scheduleRecovery(entry)
      },
      (error: unknown) => {
        this.reportError(entry.scope, 'turn_terminal_persistence', error)
        if (entry.status === 'ready') this.scheduleRecovery(entry)
      },
    )
  }

  private async interruptChildTurns(entry: SessionEntry): Promise<void> {
    while (entry.childTurns.size > 0) {
      const turns = [...entry.childTurns.entries()]
      await Promise.all(turns.map(async ([threadId, child]) => {
        if (child.interruptRequested) return
        child.interruptRequested = true
        try {
          await withChildDrainTimeout(
            entry.container.runtime.interruptTurn({
              threadId,
              turnId: child.runtimeTurnId,
            }),
            'CODEX_RUNTIME_CHILD_INTERRUPT_TIMEOUT',
          )
        } catch (error) {
          // A completion notification racing the RPC has already removed the
          // writer and is equivalent to a successful drain.
          if (entry.childTurns.get(threadId) !== child) return
          this.reportError(entry.scope, 'child_turn_interrupt', error)
          throw error
        }
      }))
      await Promise.all(turns.map(async ([threadId, child]) => {
        if (entry.childTurns.get(threadId) !== child) return
        await withChildDrainTimeout(
          child.completion,
          'CODEX_RUNTIME_CHILD_COMPLETION_TIMEOUT',
        )
      }))
    }
  }

  private handleOwnershipLost(entry: SessionEntry): void {
    if (entry.status === 'ready') this.scheduleRecovery(entry)
  }

  private scheduleRecovery(entry: SessionEntry): void {
    if (entry.transition || this.shuttingDown) return
    entry.status = 'recovering'
    this.publish(entry.scopeId, { type: 'state', state: 'recovering' })
    const transition = this.recoverEntry(entry)
    entry.transition = transition
    void transition.catch((error: unknown) => this.reportError(entry.scope, 'recover', error))
  }

  private async recoverEntry(entry: SessionEntry): Promise<void> {
    try {
      const hadActiveTurn = entry.activeTurn !== null
      if (hadActiveTurn) await entry.container.stop('force')
      await entry.persistenceQueue
      const specs = await this.buildRecoverySpecs(entry)
      if (!hadActiveTurn) await entry.container.stop('force')
      const captureAllowed = await (entry.turnBindingBarrier ?? Promise.resolve(true))
      if (captureAllowed) await this.options.waitForTurnSettlement(entry.scope)
      await this.options.persistence.destroyMaterialization(entry.materialization)
      entry.unsubscribeRuntime?.()
      entry.unsubscribeRuntime = null
      await entry.ownership.release()
      await this.deleteSlot(entry)
      if (!this.shuttingDown && !hadActiveTurn) {
        await this.startOrResume(entry.scope, {
          environment: entry.environment,
          ownerToken: entry.ownership.ownerToken,
        })
        await this.restoreThreads(entry.scope, specs)
      }
    } catch (error) {
      await entry.container.stop('force').catch((stopError: unknown) => {
        this.reportError(entry.scope, 'blocked_runtime_force_stop', stopError)
      })
      entry.status = 'blocked'
      this.publish(entry.scopeId, { type: 'state', state: 'blocked' })
      throw error
    }
  }

  private async stopEntry(entry: SessionEntry, reason: RuntimeSessionCheckpointReason): Promise<void> {
    entry.status = 'stopping'
    const activeTurn = entry.activeTurn
    try {
      if (activeTurn) await entry.container.stop('force')
      await entry.persistenceQueue
      let forcedForChildDrain = false
      try {
        await entry.childDrain
      } catch (error) {
        this.reportError(entry.scope, 'child_turn_drain_force_stop', error)
        await entry.container.stop('force')
        forcedForChildDrain = true
      }
      const captureAllowed = await (entry.turnBindingBarrier ?? Promise.resolve(true))
      if (captureAllowed) await this.options.waitForTurnSettlement(entry.scope)
      if (!activeTurn && !forcedForChildDrain && captureAllowed) {
        const threads = await this.readThreads(entry)
        for (const thread of threads) {
          if (!thread.checkpointRequired) continue
          await this.options.persistence.checkpointRuntime({
            scope: entry.scope,
            materialization: entry.materialization,
            productThreadId: thread.productThreadId,
            runtimeThreadId: thread.thread.id,
            reason,
          })
          thread.checkpointRequired = false
          thread.resumable = true
          this.publishThreadCheckpointed(entry, thread)
        }
        await entry.container.stop('graceful')
      } else if (!activeTurn && !forcedForChildDrain) {
        await entry.container.stop('force')
      }
      await this.options.persistence.destroyMaterialization(entry.materialization)
      entry.unsubscribeRuntime?.()
      entry.unsubscribeRuntime = null
      await entry.ownership.release()
      await this.deleteSlot(entry)
      this.publish(entry.scopeId, {
        type: 'state',
        state: reason === 'idle' ? 'idle_stopped' : 'stopped',
      })
    } catch (error) {
      await entry.container.stop('force').catch((stopError: unknown) => {
        this.reportError(entry.scope, 'blocked_runtime_force_stop', stopError)
      })
      entry.status = 'blocked'
      this.publish(entry.scopeId, { type: 'state', state: 'blocked' })
      throw error
    }
  }

  private async enqueuePersistence(entry: SessionEntry, operation: () => Promise<void>): Promise<void> {
    const current = entry.persistenceQueue.then(operation)
    entry.persistenceQueue = current
    return await current
  }

  private async readManagedThreadsForScope(scope: RuntimeSessionScope): Promise<ManagedThread[]> {
    const normalized = normalizeScope(scope)
    const slot = this.slots.get(buildRuntimeSessionScopeId(normalized))
    if (!slot) return []
    return await this.readThreads(await slot.entry)
  }

  private async buildRecoverySpecs(entry: SessionEntry): Promise<ThreadRecoverySpec[]> {
    return buildRecoverySpecsFromThreads(await this.readThreads(entry))
  }

  private async restoreThreads(scope: RuntimeSessionScope, specs: readonly ThreadRecoverySpec[]): Promise<void> {
    for (const spec of specs) {
      await this.ensureThread(scope, spec)
    }
  }

  private async readThreads(entry: SessionEntry): Promise<ManagedThread[]> {
    return await Promise.all([...entry.threads.values()].map(async (slot) => await slot.entry))
  }

  private async requireThreadFromEntry(entry: SessionEntry, productThreadId: string): Promise<ManagedThread> {
    const slot = entry.threads.get(productThreadId)
    if (!slot) throw new Error('CODEX_RUNTIME_PRODUCT_THREAD_NOT_ENSURED')
    return await slot.entry
  }

  private async deleteSlot(entry: SessionEntry): Promise<void> {
    const slot = this.slots.get(entry.scopeId)
    if (slot && await slot.entry === entry) this.slots.delete(entry.scopeId)
  }

  private publish(scopeId: string, event: RuntimeSessionManagerEvent): void {
    const listeners = this.subscribers.get(scopeId)
    if (!listeners) return
    for (const listener of listeners) {
      try {
        listener(event)
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'UNKNOWN_LISTENER_ERROR'
        process.stderr.write(`CODEX_RUNTIME_SESSION_LISTENER_ERROR:${detail}\n`)
      }
    }
  }

  private publishThreadCheckpointed(entry: SessionEntry, thread: ManagedThread): void {
    this.publish(entry.scopeId, {
      type: 'threadCheckpointed',
      thread: {
        ...toThreadSessionView(thread),
        durable: true,
      },
    })
  }

  private reportError(scope: RuntimeSessionScope, phase: string, error: unknown): void {
    this.options.onError({
      scope,
      phase,
      error: error instanceof Error ? error : new Error('CODEX_RUNTIME_SESSION_UNKNOWN_ERROR'),
    })
  }
}

export function buildRuntimeSessionScopeId(scopeValue: RuntimeSessionScope): string {
  const scope = normalizeScope(scopeValue)
  const hash = createHash('sha256')
  addFramedHashValue(hash, scope.userId)
  addFramedHashValue(hash, scope.projectId)
  return hash.digest('hex')
}

function normalizeScope(scope: RuntimeSessionScope): RuntimeSessionScope {
  return {
    userId: requireIdentity(scope.userId, 'CODEX_RUNTIME_SESSION_USER_ID_INVALID'),
    projectId: requireIdentity(scope.projectId, 'CODEX_RUNTIME_SESSION_PROJECT_ID_INVALID'),
  }
}

function requireIdentity(value: string, code: string): string {
  if (value !== value.trim() || !/^[A-Za-z0-9_-]{1,191}$/u.test(value)) throw new Error(code)
  return value
}

function addFramedHashValue(hash: ReturnType<typeof createHash>, value: string): void {
  const bytes = Buffer.from(value, 'utf8')
  const length = Buffer.allocUnsafe(4)
  length.writeUInt32BE(bytes.byteLength)
  hash.update(length)
  hash.update(bytes)
}

function fingerprintEnvironment(environment: Readonly<Record<string, string>>): string {
  const hash = createHash('sha256')
  for (const [name, value] of Object.entries(environment).sort(([left], [right]) => left.localeCompare(right))) {
    addFramedHashValue(hash, name)
    addFramedHashValue(hash, value)
  }
  return hash.digest('hex')
}

function validateMaterialization(value: RuntimeSessionMaterialization): RuntimeSessionMaterialization {
  if (!value.hostWorkspaceDirectory || !value.hostCodexHomeDirectory) {
    throw new Error('CODEX_RUNTIME_SESSION_MATERIALIZATION_INVALID')
  }
  return value
}

function validateManagerOptions(options: RuntimeSessionManagerOptions): void {
  if (typeof options.waitForTurnSettlement !== 'function') {
    throw new Error('CODEX_RUNTIME_SESSION_SETTLEMENT_WAITER_REQUIRED')
  }
  if (!Number.isSafeInteger(options.idleTimeoutMs) || options.idleTimeoutMs <= 0) {
    throw new Error('CODEX_RUNTIME_SESSION_IDLE_TIMEOUT_INVALID')
  }
  if (
    options.idleSweepIntervalMs !== undefined
    && (!Number.isSafeInteger(options.idleSweepIntervalMs) || options.idleSweepIntervalMs <= 0)
  ) {
    throw new Error('CODEX_RUNTIME_SESSION_IDLE_SWEEP_INVALID')
  }
}

function toSessionView(entry: SessionEntry): RuntimeSessionView {
  return {
    scopeId: entry.scopeId,
    containerIdentity: entry.container.identity,
  }
}

function toThreadSessionView(thread: ManagedThread): RuntimeThreadSessionView {
  return {
    productThreadId: thread.productThreadId,
    runtimeThreadId: thread.thread.id,
    disposition: thread.disposition,
    durable: thread.resumable,
  }
}

function getRecord(value: RuntimeJsonValue | undefined): Record<string, RuntimeJsonValue> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value
}

function buildRecoverySpecsFromThreads(threads: readonly ManagedThread[]): ThreadRecoverySpec[] {
  return threads.map((thread) => ({
    productThreadId: thread.productThreadId,
    recoveryThreadId: thread.resumable ? thread.thread.id : null,
    configuration: thread.configuration,
  }))
}
