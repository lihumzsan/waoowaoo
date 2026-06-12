import type { UIMessage } from 'ai'
import type { ProjectAgentChoiceCardPartData } from '@/lib/project-agent/types'

interface ActiveChoiceCard {
  key: string
  data: ProjectAgentChoiceCardPartData
}

interface ResolvedChoiceKeys {
  interruptionIds: ReadonlySet<string>
  toolCallIds: ReadonlySet<string>
  cardIds: ReadonlySet<string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
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

function collectResolvedChoiceKeys(messages: readonly UIMessage[]): ResolvedChoiceKeys {
  const interruptionIds = new Set<string>()
  const toolCallIds = new Set<string>()
  const cardIds = new Set<string>()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const part of message.parts as readonly unknown[]) {
      if (!isRecord(part) || part.type !== 'data-assistant-choice-resolved') continue
      const data = isRecord(part.data) ? part.data : null
      const interruptionId = readNonEmptyString(data?.interruptionId)
      const toolCallId = readNonEmptyString(data?.toolCallId)
      const cardId = readNonEmptyString(data?.cardId)
      if (interruptionId) interruptionIds.add(interruptionId)
      if (toolCallId) toolCallIds.add(toolCallId)
      if (cardId) cardIds.add(cardId)
    }
  }
  return { interruptionIds, toolCallIds, cardIds }
}

function isResolvedChoiceCard(card: ProjectAgentChoiceCardPartData, resolved: ResolvedChoiceKeys): boolean {
  const interruptionId = readNonEmptyString(card.interruptionId)
  if (interruptionId && resolved.interruptionIds.has(interruptionId)) return true
  const toolCallId = readNonEmptyString(card.toolCallId)
  if (toolCallId && resolved.toolCallIds.has(toolCallId)) return true
  return resolved.cardIds.has(card.cardId)
}

export function findActiveChoiceCard(
  messages: readonly UIMessage[],
  dismissedChoiceCardKeys: ReadonlySet<string>,
): ActiveChoiceCard | null {
  const resolvedChoiceKeys = collectResolvedChoiceKeys(messages)
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
      if (!card || dismissedChoiceCardKeys.has(key) || isResolvedChoiceCard(card, resolvedChoiceKeys)) continue
      return {
        key,
        data: card,
      }
    }
  }

  return null
}
