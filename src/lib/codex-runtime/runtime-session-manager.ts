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
export type RuntimeSessionStopReason = 'idle' | 'shutdown' | 'recover'
export interface RuntimeSessionPersistence {
  /** Idempotently settle an abandoned product Turn before a new placement. */
  reconcileBeforeStart(scope: RuntimeSessionScope): Promise<void>
  /** Materialize disposable scratch and the scope's stable native Codex home. */
  materialize(scope: RuntimeSessionScope): Promise<RuntimeSessionMaterialization>
  /** Delete disposable scratch; the Codex home remains on the durable volume. */
  destroyMaterialization(materialization: RuntimeSessionMaterialization): Promise<void>
  /** Idempotently delete the scope's opaque native Codex home. */
  clearScope(scope: RuntimeSessionScope): Promise<void>
}

export interface RuntimeSessionOwnershipClaim {
  readonly ownerToken: string
  /** Resolves or rejects when the external exclusive claim is no longer held. */
  readonly lost: Promise<void>
  /** Fail before a native mutation when this process no longer owns the scope. */
  assertCurrent(): Promise<void>
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
  /** Native Codex Thread identity persisted by the product binding. */
  readonly runtimeThreadId: string | null
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

export type RuntimeSessionManagerListener = (event: RuntimeSessionManagerEvent) => void

export type RuntimeSessionManagerOptions = {
  readonly container: RuntimeContainerAdapter
  readonly persistence: RuntimeSessionPersistence
  readonly ownership: RuntimeSessionOwnership
  readonly idleTimeoutMs: number
  readonly idleSweepIntervalMs?: number
  /** Close process-local protocol sessions before releasing the placement lease. */
  readonly closePlacementTransportSessions: (placement: {
    readonly scope: RuntimeSessionScope
    readonly ownerToken: string
  }) => Promise<void>
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
}

type ThreadSlot = {
  readonly entry: Promise<ManagedThread>
}

type ActiveTurn = {
  readonly productThreadId: string
  readonly runtimeTurnId: string | null
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
  unsubscribeRuntime: (() => void) | null
  status: SessionStatus
  lastActivityAt: number
  activeTurn: ActiveTurn | null
  skillsStale: boolean
  transition: Promise<void> | null
}

type SessionSlot = {
  readonly scope: RuntimeSessionScope
  readonly environmentFingerprint: string
  readonly entry: Promise<SessionEntry>
}

type ThreadRecoverySpec = {
  readonly productThreadId: string
  readonly runtimeThreadId: string
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
      if (entry.ownership.ownerToken !== ownerToken) {
        throw new Error('CODEX_RUNTIME_SESSION_OWNER_TOKEN_DIVERGED')
      }
      await entry.ownership.assertCurrent()
      if (entry.status === 'ready') {
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
    await session.ownership.assertCurrent()
    const productThreadId = requireIdentity(
      options.productThreadId,
      'CODEX_RUNTIME_PRODUCT_THREAD_ID_INVALID',
    )
    const existing = session.threads.get(productThreadId)
    if (existing) {
      const thread = await existing.entry
      if (options.runtimeThreadId && options.runtimeThreadId !== thread.thread.id) {
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
    await session.ownership.assertCurrent()
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
    await session.ownership.assertCurrent()
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

  async startTurn(
    scope: RuntimeSessionScope,
    productThreadId: string,
    params: Omit<RuntimeTurnStartParams, 'threadId'>,
    bindStartedTurn: (turn: RuntimeTurn) => Promise<void>,
  ): Promise<RuntimeTurn> {
    const managed = await this.requireManagedThread(scope, productThreadId)
    await managed.session.ownership.assertCurrent()
    if (managed.session.status !== 'ready') {
      throw new Error(`CODEX_RUNTIME_SESSION_NOT_READY:${managed.session.status}`)
    }
    if (managed.session.activeTurn) throw new Error('CODEX_RUNTIME_SESSION_TURN_ALREADY_ACTIVE')
    managed.session.lastActivityAt = Date.now()
    managed.session.activeTurn = {
      productThreadId: managed.thread.productThreadId,
      runtimeTurnId: null,
    }
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
      return turn
    } catch (error) {
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
    if (entry.transition) return await entry.transition
    const transition = (async () => {
      entry.status = 'stopping'
      await entry.container.stop('force').catch(() => undefined)
      try {
        await this.options.waitForTurnSettlement(entry.scope)
        await this.options.persistence.destroyMaterialization(entry.materialization)
        entry.unsubscribeRuntime?.()
        entry.unsubscribeRuntime = null
        await this.closePlacementTransportSessions(entry)
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
    await session.ownership.assertCurrent()
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
    await session.ownership.assertCurrent()
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
    await session.ownership.assertCurrent()
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
    reason: RuntimeSessionStopReason = 'shutdown',
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

  async clearPersistentScope(
    scopeValue: RuntimeSessionScope,
    ownerTokenValue: string,
  ): Promise<void> {
    const scope = normalizeScope(scopeValue)
    const scopeId = buildRuntimeSessionScopeId(scope)
    const ownerToken = requireIdentity(
      ownerTokenValue,
      'CODEX_RUNTIME_SESSION_OWNER_TOKEN_INVALID',
    )
    const slot = this.slots.get(scopeId)
    if (slot) {
      const entry = await slot.entry
      if (entry.ownership.ownerToken !== ownerToken) {
        throw new Error('CODEX_RUNTIME_SESSION_OWNER_TOKEN_DIVERGED')
      }
      if (entry.transition) {
        await entry.transition
        return await this.clearPersistentScope(scope, ownerToken)
      }
      await entry.ownership.assertCurrent()
      const transition = this.clearEntry(entry)
      entry.transition = transition
      try {
        return await transition
      } catch (error) {
        if (entry.transition === transition) entry.transition = null
        throw error
      }
    }
    const ownership = await this.options.ownership.acquire(scope, ownerToken)
    try {
      await ownership.assertCurrent()
      await this.options.persistence.clearScope(scope)
    } finally {
      await this.options.closePlacementTransportSessions({
        scope,
        ownerToken: ownership.ownerToken,
      })
      await ownership.release()
    }
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
        unsubscribeRuntime,
        status: 'ready',
        lastActivityAt: Date.now(),
        activeTurn: null,
        skillsStale: false,
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
      try {
        await this.options.closePlacementTransportSessions({
          scope,
          ownerToken: ownership.ownerToken,
        })
      } catch (closeError) {
        throw new AggregateError(
          [error, closeError],
          'CODEX_RUNTIME_SESSION_START_CLEANUP_FAILED',
        )
      }
      await ownership.release().catch(() => undefined)
      throw error
    }
  }

  private async startThreadSession(
    session: SessionEntry,
    options: RuntimeThreadSessionOptions,
  ): Promise<ManagedThread> {
    await session.ownership.assertCurrent()
    const thread = options.runtimeThreadId
      ? await session.container.runtime.resumeThread({
          ...options.configuration.resume,
          threadId: requireIdentity(
            options.runtimeThreadId,
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
      disposition: options.runtimeThreadId ? 'resumed' : 'started',
      configuration: options.configuration,
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
      if (!productThreadId) {
        // Wao disables Codex agents. A Turn on an unbound Runtime Thread is
        // protocol divergence, not a second lifecycle to track locally.
        this.scheduleRecovery(entry)
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
    if (!turn || !runtimeTurnId || typeof turn.status !== 'string') {
      this.scheduleRecovery(entry)
      return
    }
    if (!productThreadId) {
      this.scheduleRecovery(entry)
      return
    }
    entry.activeTurn = null
    if (!entry.threads.has(productThreadId)) {
      this.scheduleRecovery(entry)
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
      const specs = await this.buildRecoverySpecs(entry)
      await entry.container.stop('force')
      await this.options.waitForTurnSettlement(entry.scope)
      await this.options.persistence.destroyMaterialization(entry.materialization)
      entry.unsubscribeRuntime?.()
      entry.unsubscribeRuntime = null
      await this.closePlacementTransportSessions(entry)
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

  private async stopEntry(entry: SessionEntry, reason: RuntimeSessionStopReason): Promise<void> {
    entry.status = 'stopping'
    const activeTurn = entry.activeTurn
    try {
      const ownsScope = await entry.ownership.assertCurrent().then(() => true, () => false)
      if (activeTurn || !ownsScope) await entry.container.stop('force')
      await this.options.waitForTurnSettlement(entry.scope)
      if (!activeTurn && ownsScope) {
        await entry.container.stop('graceful')
      }
      await this.options.persistence.destroyMaterialization(entry.materialization)
      entry.unsubscribeRuntime?.()
      entry.unsubscribeRuntime = null
      await this.closePlacementTransportSessions(entry)
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

  private async clearEntry(entry: SessionEntry): Promise<void> {
    entry.status = 'stopping'
    const activeTurn = entry.activeTurn
    try {
      await entry.ownership.assertCurrent()
      if (activeTurn) await entry.container.stop('force')
      await this.options.waitForTurnSettlement(entry.scope)
      if (!activeTurn) await entry.container.stop('graceful')
      await this.options.persistence.destroyMaterialization(entry.materialization)
      await this.options.persistence.clearScope(entry.scope)
      entry.unsubscribeRuntime?.()
      entry.unsubscribeRuntime = null
      await this.closePlacementTransportSessions(entry)
      await entry.ownership.release()
      await this.deleteSlot(entry)
      this.publish(entry.scopeId, { type: 'state', state: 'stopped' })
    } catch (error) {
      await entry.container.stop('force').catch((stopError: unknown) => {
        this.reportError(entry.scope, 'blocked_runtime_force_stop', stopError)
      })
      entry.status = 'blocked'
      this.publish(entry.scopeId, { type: 'state', state: 'blocked' })
      throw error
    }
  }

  private async readManagedThreadsForScope(scope: RuntimeSessionScope): Promise<ManagedThread[]> {
    const normalized = normalizeScope(scope)
    const slot = this.slots.get(buildRuntimeSessionScopeId(normalized))
    if (!slot) return []
    return await this.readThreads(await slot.entry)
  }

  private async closePlacementTransportSessions(entry: SessionEntry): Promise<void> {
    await this.options.closePlacementTransportSessions({
      scope: entry.scope,
      ownerToken: entry.ownership.ownerToken,
    })
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
  if (!value.hostWorkspaceDirectory) {
    throw new Error('CODEX_RUNTIME_SESSION_MATERIALIZATION_INVALID')
  }
  return value
}

function validateManagerOptions(options: RuntimeSessionManagerOptions): void {
  if (typeof options.closePlacementTransportSessions !== 'function') {
    throw new Error('CODEX_RUNTIME_SESSION_TRANSPORT_CLOSER_REQUIRED')
  }
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
  }
}

function getRecord(value: RuntimeJsonValue | undefined): Record<string, RuntimeJsonValue> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value
}

function buildRecoverySpecsFromThreads(threads: readonly ManagedThread[]): ThreadRecoverySpec[] {
  return threads.map((thread) => ({
    productThreadId: thread.productThreadId,
    runtimeThreadId: thread.thread.id,
    configuration: thread.configuration,
  }))
}
