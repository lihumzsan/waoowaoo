import type { AgentInputItem } from '@openai/agents'
import { z } from 'zod'

export const PROJECT_AGENT_CONTEXT_CHECKPOINT_VERSION = 1

export const projectAgentContextCheckpointSchema = z.object({
  version: z.literal(PROJECT_AGENT_CONTEXT_CHECKPOINT_VERSION),
  replacedItemCount: z.number().int().positive(),
  checkpointText: z.string().trim().min(1),
}).strict()

export type ProjectAgentContextCheckpoint = z.infer<typeof projectAgentContextCheckpointSchema>

const CHECKPOINT_HEADER = /^\[context_checkpoint version=1 replaced_items=(\d+)\]\n([\s\S]+)\n\[\/context_checkpoint\]$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readSystemMessageContent(item: AgentInputItem): string | null {
  const record = item as unknown
  if (!isRecord(record) || record.role !== 'system') return null
  return typeof record.content === 'string' ? record.content : null
}

export function parseProjectAgentContextCheckpointItem(
  item: AgentInputItem | undefined,
): ProjectAgentContextCheckpoint | null {
  if (!item) return null
  const content = readSystemMessageContent(item)
  const match = content?.match(CHECKPOINT_HEADER)
  if (!match) return null
  const replacedItemCount = Number(match[1])
  const checkpointText = match[2]?.trim() ?? ''
  const parsed = projectAgentContextCheckpointSchema.safeParse({
    version: PROJECT_AGENT_CONTEXT_CHECKPOINT_VERSION,
    replacedItemCount,
    checkpointText,
  })
  return parsed.success ? parsed.data : null
}

export function buildProjectAgentContextCheckpointItem(
  checkpoint: ProjectAgentContextCheckpoint,
): AgentInputItem {
  return {
    role: 'system',
    content: [
      `[context_checkpoint version=${String(checkpoint.version)} replaced_items=${String(checkpoint.replacedItemCount)}]`,
      checkpoint.checkpointText,
      '[/context_checkpoint]',
    ].join('\n'),
  } satisfies AgentInputItem
}

/**
 * Raw Session history remains durable. Only the latest completed checkpoint
 * and the items written after it are projected into the active model context.
 */
export function projectProjectAgentActiveContext(
  items: readonly AgentInputItem[],
): AgentInputItem[] {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (parseProjectAgentContextCheckpointItem(items[index])) {
      return [...items.slice(index)]
    }
  }
  return [...items]
}

export function buildProjectAgentCheckpointTranscript(items: readonly AgentInputItem[]): string {
  return items.map((item) => JSON.stringify(item)).join('\n')
}
