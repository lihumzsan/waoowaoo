import { safeValidateUIMessages, type UIMessage } from 'ai'

export const MAX_ASSISTANT_MESSAGE_BYTES = 1 * 1_024 * 1_024

export type SerializedAssistantRuntimeMessage = {
  readonly message: UIMessage
  readonly json: unknown
  readonly serialized: string
  readonly byteLength: number
}

export class AssistantRuntimeMessageTooLargeError extends Error {
  readonly code = 'ASSISTANT_RUNTIME_MESSAGE_TOO_LARGE' as const
  readonly byteLength: number

  constructor(byteLength: number) {
    super(`ASSISTANT_RUNTIME_MESSAGE_TOO_LARGE:${String(byteLength)}`)
    this.name = 'AssistantRuntimeMessageTooLargeError'
    this.byteLength = byteLength
  }
}

function requireMessageId(value: string): string {
  if (!value || value !== value.trim() || value.length > 191) {
    throw new Error('ASSISTANT_RUNTIME_MESSAGE_ID_INVALID')
  }
  return value
}

export async function parseAssistantRuntimeMessage(value: unknown): Promise<UIMessage> {
  const validation = await safeValidateUIMessages({ messages: [value] })
  const message = validation.success ? validation.data[0] : null
  if (!message || (message.role !== 'user' && message.role !== 'assistant')) {
    throw new Error('ASSISTANT_RUNTIME_MESSAGE_INVALID')
  }
  requireMessageId(message.id)
  return message
}

export async function serializeAssistantRuntimeMessage(
  value: unknown,
): Promise<SerializedAssistantRuntimeMessage> {
  const message = await parseAssistantRuntimeMessage(value)
  const serialized = JSON.stringify(message)
  if (serialized === undefined) throw new Error('ASSISTANT_RUNTIME_JSON_INVALID')
  const byteLength = Buffer.byteLength(serialized, 'utf8')
  if (byteLength > MAX_ASSISTANT_MESSAGE_BYTES) {
    throw new AssistantRuntimeMessageTooLargeError(byteLength)
  }
  return {
    message,
    json: JSON.parse(serialized) as unknown,
    serialized,
    byteLength,
  }
}
