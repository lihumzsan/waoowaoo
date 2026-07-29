import type { AgentInputItem, Session } from '@openai/agents'
import { isDeepStrictEqual } from 'node:util'
import {
  loadProjectAssistantModelHistory,
  stageProjectAssistantModelHistory,
  type ProjectAssistantModelHistoryCommit,
  type ProjectAssistantThreadIdentity,
} from './persistence'

function cloneItems(items: readonly AgentInputItem[]): AgentInputItem[] {
  return items.map((item) => structuredClone(item))
}

function readMessageText(item: AgentInputItem): string | null {
  const record = item as unknown as Record<string, unknown>
  if (record.role !== 'system') return null
  return typeof record.content === 'string' ? record.content : null
}

/**
 * Project state and Plan are current-run facts, not conversation facts. They
 * must be visible to every model step in this run but must never accumulate in
 * Session history and compete with their next authoritative snapshot.
 */
function isTransientRuntimeInput(item: AgentInputItem): boolean {
  const text = readMessageText(item)
  return text?.startsWith('[project_state_snapshot]') === true
    || text?.startsWith('[agent_plan]') === true
}

function isGeneratedModelItem(item: AgentInputItem): boolean {
  const record = item as unknown as Record<string, unknown>
  return record.role === 'assistant'
    || (typeof record.type === 'string' && record.type.trim().length > 0)
}

function readToolItemIdentity(item: AgentInputItem): {
  type: 'function_call' | 'function_call_result'
  callId: string
  name: string
  arguments?: string
} | null {
  const record = item as unknown as Record<string, unknown>
  if (record.type !== 'function_call' && record.type !== 'function_call_result') return null
  const callId = typeof record.callId === 'string' ? record.callId.trim() : ''
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  if (!callId || !name) return null
  return {
    type: record.type,
    callId,
    name,
    ...(record.type === 'function_call' && typeof record.arguments === 'string'
      ? { arguments: record.arguments }
      : {}),
  }
}

function parseJson(value: string | undefined): unknown {
  if (value === undefined) return undefined
  try {
    return JSON.parse(value)
  } catch {
    throw new Error('PROJECT_ASSISTANT_MODEL_SESSION_TOOL_ARGUMENTS_INVALID')
  }
}

/**
 * SDK Session implementation whose writes are buffered until the existing
 * thread/run/handoff transaction commits. The SDK remains the sole transcript
 * interpreter while the product's settlement boundary remains the sole
 * durable writer.
 */
export class ProjectAgentModelSession implements Session {
  private loaded = false
  private expectedVersion = 0
  private pendingReady = false
  private items: AgentInputItem[] = []

  constructor(
    private readonly identity: ProjectAssistantThreadIdentity,
    private readonly executionSegmentId: string,
  ) {
    if (!executionSegmentId.trim()) {
      throw new Error('PROJECT_ASSISTANT_MODEL_SESSION_SEGMENT_ID_REQUIRED')
    }
  }

  async getSessionId(): Promise<string> {
    return [
      this.identity.projectId,
      this.identity.userId,
      this.identity.assistantId,
      this.identity.episodeId ? `episode:${this.identity.episodeId}` : 'project',
    ].join(':')
  }

  async getItems(limit?: number): Promise<AgentInputItem[]> {
    await this.ensureLoaded()
    const items = limit === undefined
      ? this.items
      : this.items.slice(Math.max(0, this.items.length - Math.max(0, limit)))
    return cloneItems(items)
  }

  async addItems(items: AgentInputItem[]): Promise<void> {
    await this.ensureLoaded()
    const persistedItems = items.filter((item) => !isTransientRuntimeInput(item))
    this.items.push(...cloneItems(persistedItems))
    await this.stage(persistedItems.some(isGeneratedModelItem))
  }

  async popItem(): Promise<AgentInputItem | undefined> {
    await this.ensureLoaded()
    const item = this.items.pop()
    await this.stage(false)
    return item ? structuredClone(item) : undefined
  }

  async clearSession(): Promise<void> {
    await this.ensureLoaded()
    this.items = []
    await this.stage(false)
  }

  async replaceItems(items: readonly AgentInputItem[]): Promise<void> {
    await this.ensureLoaded()
    this.items = cloneItems(items.filter((item) => !isTransientRuntimeInput(item)))
    await this.stage(false)
  }

  async buildCommit(): Promise<ProjectAssistantModelHistoryCommit> {
    await this.ensureLoaded()
    await this.stage(true)
    return this.createCommit()
  }

  /**
   * A prepared handoff can outlive the process that was consuming the SDK
   * stream. SDK input persistence has already staged the user turn, but its
   * generated call/result pair may not have reached Session yet. The handoff
   * owns the exact durable recovery items for that one boundary.
   */
  async buildPreparedHandoffRecoveryCommit(
    recoveryItems: readonly AgentInputItem[],
  ): Promise<ProjectAssistantModelHistoryCommit> {
    await this.ensureLoaded()
    if (recoveryItems.length === 0) {
      if (!this.pendingReady) {
        throw new Error(`PROJECT_ASSISTANT_MODEL_SESSION_NOT_READY:${this.executionSegmentId}`)
      }
      return this.createCommit()
    }
    if (!recoveryItems.every(isGeneratedModelItem)) {
      throw new Error('PROJECT_ASSISTANT_MODEL_SESSION_RECOVERY_ITEMS_INVALID')
    }

    const missing: AgentInputItem[] = []
    for (const recoveryItem of recoveryItems) {
      const expected = readToolItemIdentity(recoveryItem)
      if (!expected) throw new Error('PROJECT_ASSISTANT_MODEL_SESSION_RECOVERY_TOOL_ITEM_INVALID')
      const existing = this.items.find((item) => {
        const identity = readToolItemIdentity(item)
        return identity?.type === expected.type && identity.callId === expected.callId
      })
      if (!existing) {
        if (
          expected.type === 'function_call'
          && this.items.some((item) => {
            const identity = readToolItemIdentity(item)
            return identity?.type === 'function_call_result' && identity.callId === expected.callId
          })
        ) {
          throw new Error(
            `PROJECT_ASSISTANT_MODEL_SESSION_RECOVERY_TOOL_ORDER_INVALID:${expected.callId}`,
          )
        }
        missing.push(recoveryItem)
        continue
      }
      const actual = readToolItemIdentity(existing)
      if (
        !actual
        || actual.name !== expected.name
        || (
          expected.type === 'function_call'
          && !isDeepStrictEqual(parseJson(actual.arguments), parseJson(expected.arguments))
        )
      ) {
        throw new Error(
          `PROJECT_ASSISTANT_MODEL_SESSION_RECOVERY_TOOL_ITEM_CONFLICT:${expected.callId}:${expected.type}`,
        )
      }
    }
    if (missing.length > 0) {
      this.items.push(...cloneItems(missing))
      await this.stage(true)
    }
    return this.createCommit()
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    const snapshot = await loadProjectAssistantModelHistory(this.identity)
    this.expectedVersion = snapshot.version
    if (snapshot.pending) {
      if (
        snapshot.pending.executionSegmentId !== this.executionSegmentId
        || snapshot.pending.baseVersion !== snapshot.version
      ) {
        throw new Error(
          `PROJECT_ASSISTANT_PENDING_MODEL_HISTORY_CONFLICT:${snapshot.pending.executionSegmentId}:${this.executionSegmentId}`,
        )
      }
      this.items = cloneItems(snapshot.pending.items)
      this.pendingReady = snapshot.pending.ready
    } else {
      this.items = cloneItems(snapshot.items)
    }
    this.loaded = true
  }

  private async stage(ready: boolean): Promise<void> {
    await stageProjectAssistantModelHistory({
      ...this.identity,
      executionSegmentId: this.executionSegmentId,
      expectedVersion: this.expectedVersion,
      items: this.items,
      ready,
    })
    this.pendingReady = this.pendingReady || ready
  }

  private createCommit(): ProjectAssistantModelHistoryCommit {
    if (!this.pendingReady) {
      throw new Error(`PROJECT_ASSISTANT_MODEL_SESSION_NOT_READY:${this.executionSegmentId}`)
    }
    return {
      executionSegmentId: this.executionSegmentId,
      expectedVersion: this.expectedVersion,
      items: cloneItems(this.items),
    }
  }
}
