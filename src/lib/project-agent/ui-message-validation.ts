import type { UIMessage } from 'ai'

type UnknownObject = { [key: string]: unknown }

export type UIMessagesPersistabilityErrorCode =
  | 'messages_not_array'
  | 'message_not_object'
  | 'message_id_missing'
  | 'message_role_missing'
  | 'message_parts_not_array'
  | 'message_parts_empty'

export interface UIMessagesPersistabilityError {
  code: UIMessagesPersistabilityErrorCode
  messageIndex: number | null
}

export type UIMessagesPersistabilityResult =
  | {
    ok: true
    messages: UIMessage[]
  }
  | {
    ok: false
    error: UIMessagesPersistabilityError
  }

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isRecord(value: unknown): value is UnknownObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function isPersistableUIMessages(messages: unknown): messages is UIMessage[] {
  return validatePersistableUIMessages(messages).ok
}

export function validatePersistableUIMessages(messages: unknown): UIMessagesPersistabilityResult {
  if (!Array.isArray(messages)) {
    return {
      ok: false,
      error: {
        code: 'messages_not_array',
        messageIndex: null,
      },
    }
  }

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex]
    if (!isRecord(message)) {
      return {
        ok: false,
        error: {
          code: 'message_not_object',
          messageIndex,
        },
      }
    }
    if (!isNonEmptyString(message.id)) {
      return {
        ok: false,
        error: {
          code: 'message_id_missing',
          messageIndex,
        },
      }
    }
    if (!isNonEmptyString(message.role)) {
      return {
        ok: false,
        error: {
          code: 'message_role_missing',
          messageIndex,
        },
      }
    }
    if (!Array.isArray(message.parts)) {
      return {
        ok: false,
        error: {
          code: 'message_parts_not_array',
          messageIndex,
        },
      }
    }
    if (message.parts.length === 0) {
      return {
        ok: false,
        error: {
          code: 'message_parts_empty',
          messageIndex,
        },
      }
    }
  }

  const persistableMessages = messages as UIMessage[]
  return {
    ok: true,
    messages: persistableMessages,
  }
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
