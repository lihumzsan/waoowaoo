import type { UIMessage } from 'ai'
import type { ProjectAgentChoiceCardPartData } from '@/lib/project-agent/types'

interface ActiveChoiceCard {
  key: string
  data: ProjectAgentChoiceCardPartData
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isProjectAgentChoiceCardPartData(value: unknown): value is ProjectAgentChoiceCardPartData {
  if (!isRecord(value)) return false
  return typeof value.cardId === 'string'
    && typeof value.title === 'string'
    && Array.isArray(value.groups)
    && typeof value.submitLabel === 'string'
    && isRecord(value.submit)
    && typeof value.submit.kind === 'string'
}

function readChoiceCardPart(part: unknown): ProjectAgentChoiceCardPartData | null {
  if (!isRecord(part)) return null
  if (part.type !== 'data-assistant-choice-card') return null
  return isProjectAgentChoiceCardPartData(part.data) ? part.data : null
}

export function findActiveChoiceCard(
  messages: readonly UIMessage[],
  dismissedChoiceCardKeys: ReadonlySet<string>,
): ActiveChoiceCard | null {
  let latestUserMessageIndex = -1
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    if (messages[messageIndex]?.role === 'user') {
      latestUserMessageIndex = messageIndex
      break
    }
  }

  for (let messageIndex = messages.length - 1; messageIndex > latestUserMessageIndex; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (!message || message.role !== 'assistant') continue
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const card = readChoiceCardPart(message.parts[partIndex])
      const key = `${message.id}:part:${String(partIndex)}:${card?.cardId ?? 'unknown'}`
      if (!card || dismissedChoiceCardKeys.has(key)) continue
      return {
        key,
        data: card,
      }
    }
  }

  return null
}
