import {
  flattenProviderMessageContent,
  normalizeProviderContentParts,
  providerMessageHasCacheControl,
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

export type OpenRouterPromptCacheRequest = {
  messages: OpenRouterChatMessage[]
  cacheControl?: OpenRouterCacheControl
}

const DEFAULT_CACHE_CONTROL: OpenRouterCacheControl = {
  type: 'ephemeral',
  ttl: '1h',
}

const CLAUDE_AUTOMATIC_CACHE_MIN_CHARS = 1024
const ANTHROPIC_EXPLICIT_CACHE_BREAKPOINT_LIMIT = 4

function normalizeModelId(modelId: string): string {
  return modelId.trim().toLowerCase().replace(/^openrouter::/, '')
}

function toOpenRouterCacheControl(cacheControl: ProviderPromptCacheControl): OpenRouterCacheControl {
  return {
    type: cacheControl.type,
    ...(cacheControl.ttl ? { ttl: cacheControl.ttl } : {}),
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

function totalPromptChars(messages: readonly ProviderChatMessage[]): number {
  return messages.reduce((sum, message) => sum + flattenProviderMessageContent(message.content).length, 0)
}

function hasExplicitCacheControl(messages: readonly ProviderChatMessage[]): boolean {
  return messages.some((message) => providerMessageHasCacheControl(message))
}

function shouldUseClaudeAutomaticCache(input: {
  family: OpenRouterPromptCacheFamily
  messages: readonly ProviderChatMessage[]
}): boolean {
  return input.family === 'anthropic'
    && !hasExplicitCacheControl(input.messages)
    && totalPromptChars(input.messages) >= CLAUDE_AUTOMATIC_CACHE_MIN_CHARS
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
      ? { cache_control: toOpenRouterCacheControl(part.cacheControl) }
      : {}),
  }))
}

export function buildOpenRouterPromptCacheRequest(input: {
  modelId: string
  messages: readonly ProviderChatMessage[]
}): OpenRouterPromptCacheRequest {
  const family = resolveOpenRouterPromptCacheFamily(input.modelId)
  const messages = input.messages.map((message) => ({
    role: message.role,
    content: toOpenRouterContent(message, family),
  }))
  return {
    messages,
    ...(shouldUseClaudeAutomaticCache({ family, messages: input.messages })
      ? { cacheControl: DEFAULT_CACHE_CONTROL }
      : {}),
  }
}
