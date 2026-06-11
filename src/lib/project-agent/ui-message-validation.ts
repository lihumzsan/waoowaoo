import type { UIMessage } from 'ai'

type UnknownObject = { [key: string]: unknown }

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isRecord(value: unknown): value is UnknownObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function isPersistableUIMessages(messages: unknown): messages is UIMessage[] {
  if (!Array.isArray(messages)) return false
  return messages.every((message) => {
    if (!isRecord(message)) return false
    if (!isNonEmptyString(message.id)) return false
    if (!isNonEmptyString(message.role)) return false
    if (!Array.isArray(message.parts)) return false
    if (message.parts.length === 0) return false
    return true
  })
}

export function ensureUniqueUIMessages(messages: UIMessage[]): UIMessage[] {
  const usedIds = new Set<string>()
  const duplicateCounts = new Map<string, number>()
  let changed = false

  const normalizedMessages = messages.map((message, index) => {
    const originalId = message.id
    if (!usedIds.has(originalId)) {
      usedIds.add(originalId)
      return message
    }

    changed = true
    const nextCount = (duplicateCounts.get(originalId) ?? 0) + 1
    duplicateCounts.set(originalId, nextCount)

    let candidateId = `${originalId}--dedup-${nextCount}`
    let collisionCount = nextCount
    while (usedIds.has(candidateId)) {
      collisionCount += 1
      candidateId = `${originalId}--dedup-${collisionCount}`
    }
    usedIds.add(candidateId)

    return {
      ...message,
      id: candidateId || `message-${index}`,
    }
  })

  return changed ? normalizedMessages : messages
}
