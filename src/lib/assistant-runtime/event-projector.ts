import { createHash } from 'node:crypto'
import type { UIMessage, UIMessageChunk } from 'ai'
import type {
  RuntimeEvent,
  RuntimeJsonObject,
  RuntimeJsonValue,
  RuntimeServerRequest,
  RuntimeSkillsListEntry,
} from '@/lib/codex-runtime/runtime-adapter'
import { buildAgentTurnAssistantMessageId } from '@/lib/agent-turn/stream-publisher'
import {
  creativeRuntimeSkillReadToolName,
  resolveCreativeRuntimeSkillReadCommand,
} from '@/lib/creative-skills/runtime-skill-read'
import type {
  AssistantRuntimeEventSink,
  AssistantRuntimeInteractionView,
  AssistantRuntimeTerminalProjection,
  AssistantRuntimeTurnIdentity,
} from './contracts'
import { isAssistantRuntimeSupportedRequestMethod } from './view-contract'
import {
  assistantRuntimeFailureForStopReason,
  normalizeAssistantRuntimeFailure,
  type AssistantRuntimeFailure,
} from './runtime-error'

type UIMessagePart = UIMessage['parts'][number]

export type AssistantRuntimeProjectorOptions = {
  readonly identity: AssistantRuntimeTurnIdentity
  readonly sink: AssistantRuntimeEventSink
  readonly onInteraction: (interaction: AssistantRuntimeInteractionView) => Promise<void>
  readonly onInteractionResolved: (runtimeRequestId: string) => Promise<void>
  readonly onPlan: (plan: RuntimeJsonValue) => Promise<void>
  readonly onMessageSnapshot: (message: UIMessage) => Promise<void>
  readonly onSkillsList: (forceReload: boolean) => Promise<RuntimeSkillsListEntry>
  readonly modelKey: string
}

type PendingTextPart = {
  readonly kind: 'text' | 'reasoning'
  readonly itemId: string
  value: string
  started: boolean
  completedPrefixLength: number
}

function isRecord(value: RuntimeJsonValue | undefined): value is RuntimeJsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readString(record: RuntimeJsonObject, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readThreadId(params: RuntimeJsonObject): string | null {
  return readString(params, 'threadId')
}

function readTurnId(params: RuntimeJsonObject): string | null {
  const direct = readString(params, 'turnId')
  if (direct) return direct
  const turn = params.turn
  return isRecord(turn) ? readString(turn, 'id') : null
}

function requireItem(params: RuntimeJsonObject): RuntimeJsonObject | null {
  return isRecord(params.item) ? params.item : null
}

function stringifySummary(value: RuntimeJsonValue | undefined): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value
    .flatMap((entry): string[] => {
      if (typeof entry === 'string') return [entry]
      if (isRecord(entry)) {
        const text = readString(entry, 'text')
        return text ? [text] : []
      }
      return []
    })
    .join('\n\n')
}

export function projectAssistantRuntimeToolOutput(item: RuntimeJsonObject): RuntimeJsonValue {
  const status = readString(item, 'status') ?? 'unknown'
  const type = readString(item, 'type')
  if (type === 'commandExecution') {
    return {
      status,
      output: item.aggregatedOutput ?? null,
      exitCode: item.exitCode ?? null,
      durationMs: item.durationMs ?? null,
    }
  }
  if (type === 'fileChange') return { status, changes: item.changes ?? [] }
  if (type === 'mcpToolCall') {
    const result = isRecord(item.result) ? item.result : null
    const structuredContent = result && isRecord(result.structuredContent)
      ? result.structuredContent
      : null
    if (status === 'declined' || status === 'interrupted' || status === 'cancelled') {
      return { status, error: item.error ?? null }
    }
    // Wao MCP structuredContent is already the canonical success, decline, or
    // typed failure envelope. Wrapping it again changes the protocol shape and
    // hides actionable corrections from both the model and the persisted View.
    if (structuredContent) return structuredContent
    if (result?.isError === true || status === 'failed' || status === 'errored') {
      return {
        ok: false,
        status,
        error: item.error ?? structuredContent ?? result?.content ?? null,
      }
    }
    return {
      status,
      result: result ?? item.result ?? null,
      durationMs: item.durationMs ?? null,
    }
  }
  if (type === 'webSearch') {
    return {
      status: 'completed',
      action: item.action ?? null,
      results: item.results ?? [],
    }
  }
  if (status !== 'completed') return { status }
  const result = item.result
  if (result !== undefined) return { status, result }
  const contentItems = item.contentItems
  if (contentItems !== undefined) return { status, contentItems }
  return { status }
}

function normalizePlan(params: RuntimeJsonObject): RuntimeJsonValue {
  const plan = Array.isArray(params.plan) ? params.plan : []
  return {
    explanation: typeof params.explanation === 'string' ? params.explanation : null,
    plan: plan.flatMap((entry): RuntimeJsonValue[] => {
      if (!isRecord(entry)) return []
      const step = readString(entry, 'step')
      const status = readString(entry, 'status')
      if (!step || (status !== 'pending' && status !== 'inProgress' && status !== 'completed')) return []
      return [{ step, status: status === 'inProgress' ? 'in_progress' : status }]
    }),
  }
}

function toolNameForItem(item: RuntimeJsonObject): string | null {
  const type = readString(item, 'type')
  if (!type) return null
  switch (type) {
    case 'mcpToolCall': {
      const server = readString(item, 'server') ?? 'mcp'
      const tool = readString(item, 'tool') ?? 'tool'
      return `${server}.${tool}`
    }
    case 'dynamicToolCall':
      return readString(item, 'tool') ?? 'dynamic_tool'
    case 'commandExecution': {
      const skillId = resolveCreativeRuntimeSkillReadCommand(item.command)
      return skillId ? creativeRuntimeSkillReadToolName(skillId) : 'shell'
    }
    case 'fileChange':
      return 'file_change'
    case 'webSearch':
      return 'web_search'
    case 'imageView':
      return 'view_image'
    default:
      return null
  }
}

function toolInputForItem(item: RuntimeJsonObject): RuntimeJsonValue {
  const type = readString(item, 'type')
  switch (type) {
    case 'mcpToolCall':
    case 'dynamicToolCall':
      return item.arguments ?? {}
    case 'commandExecution': {
      const skillId = resolveCreativeRuntimeSkillReadCommand(item.command)
      return skillId
        ? { skillId, command: item.command ?? null, cwd: item.cwd ?? null }
        : { command: item.command ?? null, cwd: item.cwd ?? null }
    }
    case 'fileChange':
      return { changes: item.changes ?? [] }
    case 'webSearch':
      return { query: item.query ?? null, action: item.action ?? null }
    case 'imageView':
      return { viewed: true }
    default:
      return {}
  }
}

function finalToolPart(item: RuntimeJsonObject): UIMessagePart | null {
  const toolName = toolNameForItem(item)
  const toolCallId = readString(item, 'id')
  if (!toolName || !toolCallId) return null
  return {
    type: 'dynamic-tool',
    toolName,
    toolCallId,
    state: 'output-available',
    input: toolInputForItem(item),
    output: projectAssistantRuntimeToolOutput(item),
  }
}

function interactionId(turnId: string, requestId: string): string {
  const digest = createHash('sha256')
    .update(turnId, 'utf8')
    .update('\0', 'utf8')
    .update(requestId, 'utf8')
    .digest('hex')
  return `runtime-interaction:${digest}`
}

function requestIdString(request: RuntimeServerRequest): string {
  return typeof request.id === 'string' ? request.id : String(request.id)
}

export class AssistantRuntimeEventProjector {
  private readonly options: AssistantRuntimeProjectorOptions
  private readonly partsByItemId = new Map<string, UIMessagePart>()
  private readonly partOrder: string[] = []
  private readonly pendingText = new Map<string, PendingTextPart>()
  private readonly progressByItem = new Map<string, string>()
  private latestStreamSeq = 0
  private segmentIndex = 0
  private terminalProjection: AssistantRuntimeTerminalProjection | null = null
  private finalizing = false
  private persistenceFailureReason: string | null = null
  private skillsRefreshFailed = false
  private latestRuntimeFailure: AssistantRuntimeFailure | null = null
  private persistenceTail: Promise<void> = Promise.resolve()
  private skillsRefreshTail: Promise<void> = Promise.resolve()
  private terminalResolve: ((value: AssistantRuntimeTerminalProjection) => void) | null = null
  private readonly terminalPromise: Promise<AssistantRuntimeTerminalProjection>
  private usageBase: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly cachedInputTokens: number
  } | null = null
  private latestUsage: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly cachedInputTokens: number
  } | null = null
  private readonly usageSnapshots = new Set<string>()

  constructor(options: AssistantRuntimeProjectorOptions) {
    this.options = options
    this.terminalPromise = new Promise((resolve) => {
      this.terminalResolve = resolve
    })
  }

  get terminal(): Promise<AssistantRuntimeTerminalProjection> {
    return this.terminalPromise
  }

  async createSteerBoundary(): Promise<string | null> {
    if (this.terminalProjection || this.finalizing) {
      throw new Error('ASSISTANT_RUNTIME_STEER_BOUNDARY_TERMINAL')
    }
    const boundaryMessage = this.buildAssistantMessage()
    const watermark = this.latestStreamSeq
    this.segmentIndex += 1
    this.partsByItemId.clear()
    this.partOrder.splice(0)
    this.progressByItem.clear()
    for (const pending of this.pendingText.values()) {
      pending.completedPrefixLength += pending.value.length
      pending.value = ''
      pending.started = false
    }
    this.options.sink.setMessageId(this.buildAssistantMessageId())
    if (!boundaryMessage) return null
    this.queueCriticalPersistence(async () => {
      await this.options.onMessageSnapshot(boundaryMessage)
      await this.options.sink.publishChunksThrough(watermark)
      await this.options.sink.publishViewChanged('runtime_steer_boundary').catch(() => undefined)
    }, 'steer_boundary_persistence_failed')
    await this.persistenceTail
    if (this.persistenceFailureReason) {
      throw new Error('ASSISTANT_RUNTIME_STEER_BOUNDARY_PERSISTENCE_FAILED')
    }
    return boundaryMessage.id
  }

  consume(event: RuntimeEvent): void {
    if (this.terminalProjection || this.finalizing) return
    if (event.type === 'serverRequest') {
      if (!this.matchesRequest(event.request)) return
      if (!isAssistantRuntimeSupportedRequestMethod(event.request.method)) {
        this.finish({
          status: 'failed',
          stopReason: 'runtime_request_method_unsupported',
        })
        return
      }
      this.queueCriticalPersistence(
        async () => await this.persistInteraction(event.request),
        'interaction_persistence_failed',
      )
      return
    }
    if (event.type === 'processExited') {
      this.finish({
        status: 'interrupted',
        stopReason: event.expected ? 'runtime_process_stopped' : 'runtime_process_exited',
      })
      return
    }
    if (event.type === 'protocolError') {
      this.finish({ status: 'failed', stopReason: 'runtime_protocol_error' })
      return
    }
    if (event.type === 'notification' && event.method === 'skills/changed') {
      this.refreshSkillsInventory()
      return
    }
    if (event.type !== 'notification') return
    if (!this.matchesNotification(event.params)) return
    this.consumeNotification(event.method, event.params)
  }

  private consumeNotification(method: string, params: RuntimeJsonObject): void {
    switch (method) {
      case 'item/agentMessage/delta':
        this.consumeDelta('text', params)
        return
      case 'item/reasoning/summaryTextDelta':
        this.consumeDelta('reasoning', params)
        return
      case 'item/plan/delta':
        this.consumeDelta('reasoning', params)
        return
      case 'item/started':
        this.consumeItemStarted(params)
        return
      case 'item/completed':
        this.consumeItemCompleted(params)
        return
      case 'turn/plan/updated':
        this.queueCriticalPersistence(async () => {
          await this.options.onPlan(normalizePlan(params))
          await this.options.sink.publishViewChanged('runtime_plan_updated').catch(() => undefined)
        }, 'plan_persistence_failed')
        return
      case 'thread/goal/updated':
        this.consumeGoal(params)
        return
      case 'thread/goal/cleared':
        this.upsertAndPublishDataPart('runtime-goal', {
          type: 'data-assistant-runtime-goal',
          id: 'runtime-goal',
          data: { goal: null },
        })
        this.queueMessageSnapshot()
        return
      case 'item/commandExecution/outputDelta':
        this.consumeProgress(params, 'shell', 'delta')
        return
      case 'item/fileChange/outputDelta':
        this.consumeProgress(params, 'file', 'delta')
        return
      case 'item/fileChange/patchUpdated':
        this.consumeProgress(params, 'file', 'changes')
        return
      case 'item/mcpToolCall/progress':
        this.consumeProgress(params, 'mcp', 'message')
        return
      case 'turn/diff/updated':
        // Runtime diffs are internal execution telemetry. File-change items already
        // describe the user-relevant action, so never project raw patches into the
        // persistent assistant message view.
        return
      case 'thread/compacted':
        this.upsertAndPublishDataPart('runtime-compaction', {
          type: 'data-assistant-context-compacted',
          id: 'runtime-compaction',
          data: { replacedItemCount: 0 },
        })
        this.queueMessageSnapshot()
        return
      case 'thread/tokenUsage/updated':
        this.consumeTokenUsage(params)
        return
      case 'serverRequest/resolved': {
        const requestId = params.requestId
        if (typeof requestId !== 'string' && typeof requestId !== 'number') return
        this.queueCriticalPersistence(async () => {
          await this.options.onInteractionResolved(String(requestId))
          await this.options.sink.publishViewChanged('runtime_server_request_resolved').catch(() => undefined)
        }, 'interaction_resolution_failed')
        return
      }
      case 'error':
        this.consumeRuntimeError(params)
        return
      case 'turn/completed':
        this.consumeTurnCompleted(params)
        return
      default:
        return
    }
  }

  private consumeRuntimeError(params: RuntimeJsonObject): void {
    const failure = normalizeAssistantRuntimeFailure(params.error)
    if (failure) this.latestRuntimeFailure = failure
    // `willRetry=true` is an app-server-owned retry within the same Turn.
    // It is progress, not a second lifecycle or a Product Turn terminal fact.
  }

  private consumeGoal(params: RuntimeJsonObject): void {
    if (!isRecord(params.goal)) return
    this.upsertAndPublishDataPart('runtime-goal', {
      type: 'data-assistant-runtime-goal',
      id: 'runtime-goal',
      data: { goal: params.goal },
    })
    this.queueMessageSnapshot()
  }

  private consumeSkillsInventory(entry: RuntimeSkillsListEntry, changed: boolean): void {
    this.upsertAndPublishDataPart('runtime-skills', {
      type: 'data-assistant-runtime-skills',
      id: 'runtime-skills',
      data: {
        changed,
        skills: entry.skills.map((skill) => ({
          name: skill.name,
          description: skill.description,
          enabled: skill.enabled,
          scope: skill.scope,
        })),
        errorCount: entry.errors.length,
      },
    })
    this.queueMessageSnapshot()
  }

  private refreshSkillsInventory(): void {
    const operation = this.skillsRefreshTail.then(async () => {
      const entry = await this.options.onSkillsList(true)
      if (this.terminalProjection || this.finalizing) return
      this.consumeSkillsInventory(entry, true)
    })
    this.skillsRefreshTail = operation.catch(() => {
      this.skillsRefreshFailed = true
    })
    void operation.catch(() => {
      this.finish({ status: 'failed', stopReason: 'skills_list_failed' })
    })
  }

  private consumeProgress(
    params: RuntimeJsonObject,
    kind: 'shell' | 'file' | 'mcp',
    field: 'delta' | 'changes' | 'message',
  ): void {
    const itemId = readString(params, 'itemId')
    if (!itemId) return
    const raw = params[field]
    const fragment = typeof raw === 'string' ? raw : JSON.stringify(raw ?? null)
    const previous = this.progressByItem.get(itemId) ?? ''
    const combined = field === 'delta' ? `${previous}${fragment}` : fragment
    const message = combined.slice(-12_000)
    this.progressByItem.set(itemId, message)
    this.upsertAndPublishDataPart(`${itemId}:progress`, {
      type: 'data-assistant-runtime-progress',
      id: `${itemId}:progress`,
      data: { itemId, kind, message },
    })
    this.queueMessageSnapshot(false)
  }

  private consumeDelta(kind: PendingTextPart['kind'], params: RuntimeJsonObject): void {
    const itemId = readString(params, 'itemId')
    const delta = readString(params, 'delta')
    if (!itemId || !delta) return
    const pending = this.pendingText.get(itemId) ?? {
      kind,
      itemId,
      value: '',
      started: false,
      completedPrefixLength: 0,
    }
    if (pending.kind !== kind) return
    if (!pending.started) {
      this.publishChunk(kind === 'text'
        ? { type: 'text-start', id: itemId }
        : { type: 'reasoning-start', id: itemId })
      pending.started = true
    }
    pending.value += delta
    this.pendingText.set(itemId, pending)
    this.publishChunk(kind === 'text'
      ? { type: 'text-delta', id: itemId, delta }
      : { type: 'reasoning-delta', id: itemId, delta })
    this.upsertPart(itemId, kind === 'text'
      ? { type: 'text', text: pending.value, state: 'streaming' }
      : { type: 'reasoning', text: pending.value, state: 'streaming' })
    this.queueMessageSnapshot(false)
  }

  private consumeItemStarted(params: RuntimeJsonObject): void {
    const item = requireItem(params)
    if (!item) return
    const itemType = readString(item, 'type')
    if (itemType === 'collabAgentToolCall' || itemType === 'subAgentActivity') {
      this.finish({ status: 'failed', stopReason: 'runtime_protocol_error' })
      return
    }
    const itemId = readString(item, 'id')
    const toolName = toolNameForItem(item)
    if (!itemId || !toolName) return
    const input = toolInputForItem(item)
    this.upsertPart(itemId, {
      type: 'dynamic-tool',
      toolName,
      toolCallId: itemId,
      state: 'input-available',
      input,
    })
    const chunk: UIMessageChunk = {
      type: 'tool-input-available',
      toolCallId: itemId,
      toolName,
      input,
      dynamic: true,
    }
    this.publishChunk(chunk)
    this.queueMessageSnapshot()
  }

  private consumeItemCompleted(params: RuntimeJsonObject): void {
    const item = requireItem(params)
    if (!item) return
    const itemId = readString(item, 'id')
    const itemType = readString(item, 'type')
    if (!itemId || !itemType) return
    if (itemType === 'collabAgentToolCall' || itemType === 'subAgentActivity') {
      this.finish({ status: 'failed', stopReason: 'runtime_protocol_error' })
      return
    }
    if (itemType === 'agentMessage') {
      const text = readString(item, 'text') ?? this.pendingText.get(itemId)?.value ?? ''
      this.completeTextPart('text', itemId, text)
      this.queueMessageSnapshot()
      return
    }
    if (itemType === 'reasoning') {
      const summary = stringifySummary(item.summary) || this.pendingText.get(itemId)?.value || ''
      this.completeTextPart('reasoning', itemId, summary)
      this.queueMessageSnapshot()
      return
    }
    if (itemType === 'plan') {
      const text = readString(item, 'text') ?? this.pendingText.get(itemId)?.value ?? ''
      this.completeTextPart('reasoning', itemId, text)
      this.queueMessageSnapshot()
      return
    }
    if (itemType === 'contextCompaction') {
      this.upsertAndPublishDataPart('runtime-compaction', {
        type: 'data-assistant-context-compacted',
        id: 'runtime-compaction',
        data: { replacedItemCount: 0 },
      })
      this.queueMessageSnapshot()
      return
    }
    const part = finalToolPart(item)
    if (!part) return
    this.removePart(`${itemId}:progress`)
    this.progressByItem.delete(itemId)
    this.upsertPart(itemId, part)
    this.publishChunk({
      type: 'tool-output-available',
      toolCallId: itemId,
      output: projectAssistantRuntimeToolOutput(item),
      dynamic: true,
    })
    this.queueMessageSnapshot()
  }

  private completeTextPart(kind: PendingTextPart['kind'], itemId: string, value: string): void {
    const pending = this.pendingText.get(itemId)
    const segmentValue = pending && pending.completedPrefixLength > 0
      ? value.length >= pending.completedPrefixLength
        ? value.slice(pending.completedPrefixLength)
        : pending.value
      : value
    if (pending?.started) {
      this.publishChunk(kind === 'text'
        ? { type: 'text-end', id: itemId }
        : { type: 'reasoning-end', id: itemId })
    } else if (segmentValue) {
      this.publishChunk(kind === 'text'
        ? { type: 'text-start', id: itemId }
        : { type: 'reasoning-start', id: itemId })
      this.publishChunk(kind === 'text'
        ? { type: 'text-delta', id: itemId, delta: segmentValue }
        : { type: 'reasoning-delta', id: itemId, delta: segmentValue })
      this.publishChunk(kind === 'text'
        ? { type: 'text-end', id: itemId }
        : { type: 'reasoning-end', id: itemId })
    }
    this.pendingText.delete(itemId)
    if (!segmentValue) return
    this.upsertPart(itemId, kind === 'text'
      ? { type: 'text', text: segmentValue, state: 'done' }
      : { type: 'reasoning', text: segmentValue, state: 'done' })
  }

  private consumeTurnCompleted(params: RuntimeJsonObject): void {
    const turn = isRecord(params.turn) ? params.turn : null
    const status = turn ? readString(turn, 'status') : null
    if (status === 'completed') {
      this.finish({ status: 'completed', stopReason: 'completed' })
      return
    }
    if (status === 'interrupted') {
      this.finish({ status: 'interrupted', stopReason: 'runtime_interrupted' })
      return
    }
    const failure = normalizeAssistantRuntimeFailure(turn?.error) ?? this.latestRuntimeFailure
    this.finish({ status: 'failed', stopReason: 'runtime_failed', failure })
  }

  private consumeTokenUsage(params: RuntimeJsonObject): void {
    const usage = isRecord(params.tokenUsage) ? params.tokenUsage : null
    const total = usage && isRecord(usage.total) ? usage.total : null
    const last = usage && isRecord(usage.last) ? usage.last : null
    if (!total || !last) return
    const readTokenCount = (record: RuntimeJsonObject, key: string): number | null => {
      const value = record[key]
      return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
    }
    const totalInput = readTokenCount(total, 'inputTokens')
    const totalOutput = readTokenCount(total, 'outputTokens')
    const totalCached = readTokenCount(total, 'cachedInputTokens')
    const lastInput = readTokenCount(last, 'inputTokens')
    const lastOutput = readTokenCount(last, 'outputTokens')
    const lastCached = readTokenCount(last, 'cachedInputTokens')
    if (
      totalInput === null || totalOutput === null || totalCached === null
      || lastInput === null || lastOutput === null || lastCached === null
    ) return
    if (!this.usageBase) {
      this.usageBase = {
        inputTokens: Math.max(0, totalInput - lastInput),
        outputTokens: Math.max(0, totalOutput - lastOutput),
        cachedInputTokens: Math.max(0, totalCached - lastCached),
      }
    }
    const current = {
      inputTokens: Math.max(0, totalInput - this.usageBase.inputTokens),
      outputTokens: Math.max(0, totalOutput - this.usageBase.outputTokens),
      cachedInputTokens: Math.max(0, totalCached - this.usageBase.cachedInputTokens),
    }
    this.latestUsage = current
    this.usageSnapshots.add(`${String(totalInput)}:${String(totalOutput)}:${String(totalCached)}`)
  }

  private finish(input: {
    readonly status: AssistantRuntimeTerminalProjection['status']
    readonly stopReason: string
    readonly failure?: AssistantRuntimeFailure | null
  }): void {
    if (this.terminalProjection || this.finalizing) return
    if (this.terminalizeOpenToolParts(input.stopReason)) {
      this.queueMessageSnapshot(false)
    }
    this.finalizing = true
    void this.skillsRefreshTail.then(async () => await this.persistenceTail).then(() => {
      const stopReason = this.skillsRefreshFailed
        ? 'skills_list_failed'
        : this.persistenceFailureReason ?? input.stopReason
      const status = this.persistenceFailureReason || this.skillsRefreshFailed ? 'failed' : input.status
      this.finishAfterPersistence({ status, stopReason, failure: input.failure })
    })
  }

  private terminalizeOpenToolParts(stopReason: string): boolean {
    let changed = false
    for (const [itemId, part] of this.partsByItemId) {
      if (
        part.type !== 'dynamic-tool'
        || (part.state !== 'input-streaming' && part.state !== 'input-available')
      ) continue
      this.partsByItemId.set(itemId, {
        type: 'dynamic-tool',
        toolName: part.toolName,
        toolCallId: part.toolCallId,
        state: 'output-error',
        input: part.input,
        errorText: `ASSISTANT_RUNTIME_TOOL_INTERRUPTED:${stopReason}`,
      })
      this.publishChunk({
        type: 'tool-output-error',
        toolCallId: part.toolCallId,
        errorText: `ASSISTANT_RUNTIME_TOOL_INTERRUPTED:${stopReason}`,
        dynamic: true,
      })
      changed = true
    }
    return changed
  }

  private finishAfterPersistence(input: {
    readonly status: AssistantRuntimeTerminalProjection['status']
    readonly stopReason: string
    readonly failure?: AssistantRuntimeFailure | null
  }): void {
    if (this.terminalProjection) return
    const assistantMessage = this.buildAssistantMessage()
    const failure = input.status === 'failed'
      ? input.failure ?? assistantRuntimeFailureForStopReason(input.stopReason)
      : null
    const projection: AssistantRuntimeTerminalProjection = {
      status: input.status,
      stopReason: input.stopReason,
      errorCode: failure?.errorCode ?? null,
      errorMessage: failure?.errorMessage ?? null,
      assistantMessage,
      usage: this.latestUsage
        ? {
            phase: 'agent_model',
            modelKey: this.options.modelKey,
            inputTokens: this.latestUsage.inputTokens,
            outputTokens: this.latestUsage.outputTokens,
            cachedInputTokens: this.latestUsage.cachedInputTokens,
            requestCount: this.usageSnapshots.size,
            // The assistant model itself has no per-call server tool charge;
            // hosted Web Search accounts for its own calls in its own fact.
            toolCalls: 0,
          }
        : null,
    }
    this.terminalProjection = projection
    this.terminalResolve?.(projection)
    this.terminalResolve = null
  }

  private upsertPart(itemId: string, part: UIMessagePart): void {
    if (!this.partsByItemId.has(itemId)) this.partOrder.push(itemId)
    this.partsByItemId.set(itemId, part)
  }

  private upsertAndPublishDataPart(
    itemId: string,
    part: Extract<UIMessagePart, { type: `data-${string}` }>,
  ): void {
    this.upsertPart(itemId, part)
    this.publishChunk(part)
  }

  private removePart(itemId: string): void {
    this.partsByItemId.delete(itemId)
  }

  private buildAssistantMessage(): UIMessage | null {
    const parts = this.partOrder.flatMap((itemId): UIMessagePart[] => {
      const part = this.partsByItemId.get(itemId)
      return part ? [part] : []
    })
    if (parts.length === 0) return null
    return {
      id: this.buildAssistantMessageId(),
      role: 'assistant',
      parts,
      metadata: {
        custom: {
          waoAgentTurnStreamSeq: this.latestStreamSeq,
          waoAgentTurnId: this.options.identity.turnId,
          waoAgentTurnAttempt: this.options.identity.attempt,
          waoAgentTurnSegment: this.segmentIndex,
        },
      },
    }
  }

  private buildAssistantMessageId(): string {
    return buildAgentTurnAssistantMessageId({
      turnId: this.options.identity.turnId,
      attempt: this.options.identity.attempt,
      segment: this.segmentIndex,
    })
  }

  private publishChunk(chunk: UIMessageChunk): void {
    const seq = this.options.sink.reserveChunk(chunk)
    if (seq !== null) this.latestStreamSeq = seq
  }

  private queueMessageSnapshot(publishViewChanged = true): void {
    const message = this.buildAssistantMessage()
    if (!message) return
    const watermark = this.latestStreamSeq
    this.queueCriticalPersistence(async () => {
      await this.options.onMessageSnapshot(message)
      await this.options.sink.publishChunksThrough(watermark)
      if (publishViewChanged) {
        await this.options.sink.publishViewChanged('runtime_item_completed').catch(() => undefined)
      }
    }, 'message_snapshot_persistence_failed')
  }

  private queueCriticalPersistence(
    action: () => Promise<void>,
    failureReason: string,
  ): void {
    const operation = this.persistenceTail.then(action)
    this.persistenceTail = operation.catch(() => {
      this.persistenceFailureReason ??= failureReason
    })
    void operation.catch(() => {
      this.finish({ status: 'failed', stopReason: failureReason })
    })
  }

  private matchesNotification(params: RuntimeJsonObject): boolean {
    const threadId = readThreadId(params)
    const turnId = readTurnId(params)
    if (threadId && threadId !== this.options.identity.runtimeThreadId) return false
    if (turnId && turnId !== this.options.identity.runtimeTurnId) return false
    return Boolean(threadId || turnId)
  }

  private matchesRequest(request: RuntimeServerRequest): boolean {
    const threadId = readThreadId(request.params)
    const turnId = readTurnId(request.params)
    return threadId === this.options.identity.runtimeThreadId
      && (turnId === null || turnId === this.options.identity.runtimeTurnId)
  }

  private async persistInteraction(request: RuntimeServerRequest): Promise<void> {
    const runtimeRequestId = requestIdString(request)
    await this.options.onInteraction({
      interactionId: interactionId(this.options.identity.turnId, runtimeRequestId),
      threadId: this.options.identity.threadId,
      turnId: this.options.identity.turnId,
      runtimeRequestId,
      requestId: request.id,
      method: request.method,
      payload: request.params,
    })
    await this.options.sink.publishViewChanged('runtime_server_request')
  }
}
