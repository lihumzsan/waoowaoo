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
  for (const message of messages) {
    const messageId = message.id.trim()
    if (!messageId) throw new Error('PROJECT_ASSISTANT_MESSAGE_ID_EMPTY')
    if (messageId !== message.id) throw new Error(`PROJECT_ASSISTANT_MESSAGE_ID_NOT_CANONICAL:${message.id}`)
    if (usedIds.has(messageId)) throw new Error(`PROJECT_ASSISTANT_DUPLICATE_MESSAGE_ID:${messageId}`)
    usedIds.add(messageId)
  }
  return messages
}
