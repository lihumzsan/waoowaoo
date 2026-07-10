import type { UIMessage } from 'ai'
import type { EditStylePreviewGenerationPartData } from '@/lib/project-agent/types'

interface ActiveStylePreviewGenerationCard {
  key: string
  data: EditStylePreviewGenerationPartData
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isStyleKey(value: unknown): value is EditStylePreviewGenerationPartData['items'][number]['styleKey'] {
  return typeof value === 'string' && /^style_[abc](?:_[2-9]\d*)?$/.test(value)
}

function isAspectRatio(value: unknown): value is NonNullable<EditStylePreviewGenerationPartData['items'][number]['aspectRatio']> {
  return value === '9:16' || value === '16:9' || value === '21:9'
}

function readStylePreviewGenerationPart(part: unknown): EditStylePreviewGenerationPartData | null {
  if (!isRecord(part) || part.type !== 'data-edit-style-preview-generation') return null
  const data = isRecord(part.data) ? part.data : null
  if (!data || data.operationId !== 'generate_edit_style_previews') return null
  if (typeof data.projectId !== 'string' || typeof data.episodeId !== 'string' || typeof data.bibleId !== 'string') return null
  const agentRunId = typeof data.agentRunId === 'string' ? data.agentRunId.trim() : ''
  if (!agentRunId) return null
  if (!Array.isArray(data.items)) return null
  const items = data.items.flatMap((item): EditStylePreviewGenerationPartData['items'] => {
    if (!isRecord(item)) return []
    if (typeof item.id !== 'string' || typeof item.title !== 'string' || typeof item.summary !== 'string') return []
    if (!isStyleKey(item.styleKey)) return []
    return [{
      id: item.id,
      styleKey: item.styleKey,
      title: item.title,
      summary: item.summary,
      ...(typeof item.taskId === 'string' && item.taskId ? { taskId: item.taskId } : {}),
      ...(isAspectRatio(item.aspectRatio) ? { aspectRatio: item.aspectRatio } : {}),
    }]
  })
  if (items.length === 0) return null
  return {
    operationId: 'generate_edit_style_previews',
    agentRunId,
    projectId: data.projectId,
    episodeId: data.episodeId,
    bibleId: data.bibleId,
    items,
  }
}

export function findActiveStylePreviewGenerationCard(
  messages: readonly UIMessage[],
): ActiveStylePreviewGenerationCard | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (!message || message.role !== 'assistant') continue
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const data = readStylePreviewGenerationPart(message.parts[partIndex])
      if (!data) continue
      return {
        key: `${message.id}:part:${String(partIndex)}:${data.bibleId}`,
        data,
      }
    }
  }
  return null
}
