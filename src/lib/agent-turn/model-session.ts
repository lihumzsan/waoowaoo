import type { AgentInputItem, Session } from '@openai/agents'
import { canonicalizeProjectAssistantModelInputMedia } from '@/lib/project-agent/media-attachments/model-input-protocol'

function cloneItems(items: readonly AgentInputItem[]): AgentInputItem[] {
  return items.map((item) => structuredClone(item))
}

function readSystemText(item: AgentInputItem): string | null {
  const record = item as unknown as Record<string, unknown>
  if (record.role !== 'system') return null
  return typeof record.content === 'string' ? record.content : null
}

/**
 * Current project/plan snapshots are Turn-local model inputs, not conversation
 * facts. Persisting them would let stale snapshots compete with the next Turn.
 */
function isTransientTurnInput(item: AgentInputItem): boolean {
  const text = readSystemText(item)
  return text?.startsWith('[project_state_snapshot]') === true
    || text?.startsWith('[agent_plan]') === true
}

/**
 * B+ model Session: SDK mutations remain process-local for the whole Turn.
 * Only the terminal Turn transaction receives snapshot(); there is no pending
 * segment, per-step checkpoint, or transparent model replay protocol.
 */
export class AgentTurnModelSession implements Session {
  private items: AgentInputItem[]

  constructor(
    private readonly turnId: string,
    initialItems: readonly AgentInputItem[],
  ) {
    if (!turnId.trim()) throw new Error('AGENT_TURN_SESSION_ID_REQUIRED')
    this.items = cloneItems(initialItems)
  }

  async getSessionId(): Promise<string> {
    return this.turnId
  }

  async getItems(limit?: number): Promise<AgentInputItem[]> {
    const items = limit === undefined
      ? this.items
      : this.items.slice(Math.max(0, this.items.length - Math.max(0, limit)))
    return cloneItems(items)
  }

  async addItems(items: AgentInputItem[]): Promise<void> {
    const durableItems = canonicalizeProjectAssistantModelInputMedia(
      items.filter((item) => !isTransientTurnInput(item)),
    )
    this.items.push(...cloneItems(durableItems))
  }

  async popItem(): Promise<AgentInputItem | undefined> {
    const item = this.items.pop()
    return item ? structuredClone(item) : undefined
  }

  async clearSession(): Promise<void> {
    this.items = []
  }

  async replaceItems(items: readonly AgentInputItem[]): Promise<void> {
    this.items = cloneItems(canonicalizeProjectAssistantModelInputMedia(
      items.filter((item) => !isTransientTurnInput(item)),
    ))
  }

  snapshot(): AgentInputItem[] {
    return cloneItems(this.items)
  }
}
