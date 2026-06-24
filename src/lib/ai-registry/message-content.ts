export type PromptCacheControl = {
  type: 'ephemeral'
  ttl?: '1h'
}

export type TextContentPart = {
  type: 'text'
  text: string
  cacheControl?: PromptCacheControl
}

export type ChatMessageContent = string | TextContentPart[]

export type ChatMessage = {
  role: 'user' | 'assistant' | 'system'
  content: ChatMessageContent
}

export function flattenChatMessageContent(content: ChatMessageContent): string {
  if (typeof content === 'string') return content
  return content.map((part) => part.text).join('')
}

export function normalizeChatMessageContentParts(content: ChatMessageContent): TextContentPart[] {
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : []
  }
  return content.filter((part) => part.text.length > 0)
}

export function chatMessageHasCacheControl(message: ChatMessage): boolean {
  return normalizeChatMessageContentParts(message.content).some((part) => Boolean(part.cacheControl))
}
