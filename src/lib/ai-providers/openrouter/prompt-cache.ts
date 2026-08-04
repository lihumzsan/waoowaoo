import {
  normalizeProviderContentParts,
  type ProviderChatMessage,
  type ProviderPromptCacheControl,
} from '@/lib/ai-providers/shared/llm-support'

export type OpenRouterPromptCacheFamily = 'anthropic' | 'google' | 'openai' | 'none'

export type OpenRouterCacheControl = {
  type: 'ephemeral'
  ttl?: '1h'
}

export type OpenRouterTextContentPart = {
  type: 'text'
  text: string
  cache_control?: OpenRouterCacheControl
}

export type OpenRouterChatMessage = {
  role: 'user' | 'assistant' | 'system'
  content: string | OpenRouterTextContentPart[]
}

const DEFAULT_ANTHROPIC_CACHE_CONTROL: OpenRouterCacheControl = {
  type: 'ephemeral',
}

const ANTHROPIC_EXPLICIT_CACHE_BREAKPOINT_LIMIT = 4

function normalizeModelId(modelId: string): string {
  return modelId.trim().toLowerCase().replace(/^openrouter::/, '')
}

function toOpenRouterCacheControl(
  cacheControl: ProviderPromptCacheControl,
  family: OpenRouterPromptCacheFamily,
): OpenRouterCacheControl {
  return {
    type: cacheControl.type,
    ...(family === 'anthropic' && cacheControl.ttl ? { ttl: cacheControl.ttl } : {}),
  }
}

export function resolveOpenRouterPromptCacheFamily(modelId: string): OpenRouterPromptCacheFamily {
  const normalized = normalizeModelId(modelId)
  if (normalized.startsWith('anthropic/claude')) return 'anthropic'
  if (normalized.startsWith('google/gemini')) return 'google'
  if (normalized.startsWith('openai/')) return 'openai'
  return 'none'
}

function supportsExplicitCacheControl(family: OpenRouterPromptCacheFamily): boolean {
  return family === 'anthropic' || family === 'google'
}

function toOpenRouterContent(
  message: ProviderChatMessage,
  family: OpenRouterPromptCacheFamily,
): string | OpenRouterTextContentPart[] {
  if (typeof message.content === 'string') return message.content
  const allowCacheControl = supportsExplicitCacheControl(family)
  const parts = normalizeProviderContentParts(message.content)
  const cacheableIndexes = parts
    .map((part, index) => ({ index, length: part.text.length, enabled: Boolean(part.cacheControl) }))
    .filter((part) => part.enabled)
  const allowedCacheIndexes = new Set(
    family === 'anthropic'
      ? cacheableIndexes
        .sort((left, right) => right.length - left.length)
        .slice(0, ANTHROPIC_EXPLICIT_CACHE_BREAKPOINT_LIMIT)
        .map((part) => part.index)
      : cacheableIndexes.map((part) => part.index),
  )
  return parts.map((part, index) => ({
    type: 'text',
    text: part.text,
    ...(allowCacheControl && part.cacheControl && allowedCacheIndexes.has(index)
      ? { cache_control: toOpenRouterCacheControl(part.cacheControl, family) }
      : {}),
  }))
}

function buildOpenRouterExplicitCacheMessages(input: {
  modelId: string
  messages: readonly ProviderChatMessage[]
}): OpenRouterChatMessage[] {
  const family = resolveOpenRouterPromptCacheFamily(input.modelId)
  return input.messages.map((message) => ({
    role: message.role,
    content: toOpenRouterContent(message, family),
  }))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function hasOwnCacheControl(value: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(value, 'cache_control')
}

function containsWireCacheControl(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => containsWireCacheControl(item))
  const record = asRecord(value)
  if (!record) return false
  if (hasOwnCacheControl(record)) return true
  return Object.values(record).some((item) => containsWireCacheControl(item))
}

function sourceMessagesHaveExplicitCacheControl(messages: readonly OpenRouterChatMessage[]): boolean {
  return messages.some((message) => (
    Array.isArray(message.content)
    && message.content.some((part) => Boolean(part.cache_control))
  ))
}

function applyExplicitCacheControlToContent(input: {
  wireContent: unknown
  sourceContent: OpenRouterChatMessage['content']
}): unknown {
  if (!Array.isArray(input.sourceContent)) return input.wireContent
  const sourceParts = input.sourceContent
  if (!sourceParts.some((part) => Boolean(part.cache_control))) return input.wireContent

  const sourceText = sourceParts.map((part) => part.text).join('')
  if (typeof input.wireContent === 'string') {
    if (input.wireContent !== sourceText) {
      throw new Error('OPENROUTER_PROMPT_CACHE_MESSAGE_CONTENT_MISMATCH')
    }
    return input.sourceContent
  }
  if (!Array.isArray(input.wireContent) || input.wireContent.length !== sourceParts.length) {
    throw new Error('OPENROUTER_PROMPT_CACHE_MESSAGE_CONTENT_MISMATCH')
  }
  return input.wireContent.map((wirePart, index) => {
    const record = asRecord(wirePart)
    const sourcePart = sourceParts[index]
    if (!record || record.type !== 'text' || record.text !== sourcePart.text) {
      throw new Error('OPENROUTER_PROMPT_CACHE_MESSAGE_CONTENT_MISMATCH')
    }
    return {
      ...record,
      ...(sourcePart.cache_control ? { cache_control: sourcePart.cache_control } : {}),
    }
  })
}

function applyExplicitSourceMessages(input: {
  wireMessages: unknown
  sourceMessages: readonly OpenRouterChatMessage[]
}): unknown {
  if (!sourceMessagesHaveExplicitCacheControl(input.sourceMessages)) return input.wireMessages
  if (!Array.isArray(input.wireMessages) || input.wireMessages.length !== input.sourceMessages.length) {
    throw new Error('OPENROUTER_PROMPT_CACHE_MESSAGE_COUNT_MISMATCH')
  }
  return input.wireMessages.map((wireMessage, index) => {
    const record = asRecord(wireMessage)
    const sourceMessage = input.sourceMessages[index]
    if (!record || record.role !== sourceMessage.role) {
      throw new Error('OPENROUTER_PROMPT_CACHE_MESSAGE_ROLE_MISMATCH')
    }
    return {
      ...record,
      content: applyExplicitCacheControlToContent({
        wireContent: record.content,
        sourceContent: sourceMessage.content,
      }),
    }
  })
}

export function applyOpenRouterPromptCaching(input: {
  modelId: string
  body: Record<string, unknown>
  sourceMessages?: readonly ProviderChatMessage[]
}): Record<string, unknown> {
  const family = resolveOpenRouterPromptCacheFamily(input.modelId)
  const sourceMessages = input.sourceMessages
    ? buildOpenRouterExplicitCacheMessages({
      modelId: input.modelId,
      messages: input.sourceMessages,
    })
    : null
  const messages = sourceMessages
    ? applyExplicitSourceMessages({
      wireMessages: input.body.messages,
      sourceMessages,
    })
    : input.body.messages
  const hasExplicitCacheControl = containsWireCacheControl([
    messages,
    input.body.tools,
  ])
  const shouldUseClaudeAutomaticCache = family === 'anthropic'
    && !hasOwnCacheControl(input.body)
    && !hasExplicitCacheControl
  return {
    ...input.body,
    ...(messages !== input.body.messages ? { messages } : {}),
    ...(shouldUseClaudeAutomaticCache
      ? {
        cache_control: DEFAULT_ANTHROPIC_CACHE_CONTROL,
      }
      : {}),
  }
}
