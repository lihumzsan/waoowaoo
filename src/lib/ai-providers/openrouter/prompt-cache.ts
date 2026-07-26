import {
  normalizeProviderContentParts,
  type ProviderChatMessage,
  type ProviderPromptCacheControl,
} from '@/lib/ai-providers/shared/llm-support'

export type OpenRouterPromptCacheFamily = 'anthropic' | 'google' | 'openai' | 'none'

export type OpenRouterPromptCacheExecutionMode = 'sync' | 'stream' | 'vision' | 'agent'

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

/**
 * A 1h cache write costs 2x base input against 1.25x for 5m, while every hit
 * costs 0.1x either way, so the longer TTL only pays off when the same prefix
 * is read again after the 5m window has lapsed. Hits refresh the TTL, so an
 * Agents loop never expires mid-run; the gap that matters is between user
 * turns, which routinely exceeds 5m in an authoring session.
 *
 * Execution mode cannot decide this. The Primary Agent and the Creative Worker
 * are both `agent`, yet a Worker Task ends when it ends and the next Task
 * carries a different prefix, so it never collects that later read and the 2x
 * write would be a pure loss. Only a caller that can promise the read declares
 * the long TTL; everything else stays on the provider default.
 */
const DEFAULT_ANTHROPIC_CACHE_CONTROL: OpenRouterCacheControl = {
  type: 'ephemeral',
}

const LONG_TTL_ANTHROPIC_CACHE_CONTROL: OpenRouterCacheControl = {
  type: 'ephemeral',
  ttl: '1h',
}

/** Gemini has no 1h option; `ttl` is Anthropic-only on this wire. */
const DEFAULT_GEMINI_CACHE_CONTROL: OpenRouterCacheControl = {
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

/**
 * Gemini has no automatic top-level cache form: without an explicit breakpoint
 * an Agents loop resends the whole prefix uncached on every step. Claude keeps
 * using the top-level automatic form, which advances its own breakpoint as the
 * conversation grows and is the provider's recommendation for multi-turn.
 *
 * The breakpoint is derived from this request's wire body — never from a
 * caller-held snapshot, which is the 2026-07-19 defect — and lands on the
 * system message, the one block that is byte-identical on every step. Anything
 * that moves per step would invalidate the prefix it is meant to preserve.
 */
function applyGeminiSystemPrefixBreakpoint(wireMessages: unknown): unknown {
  if (!Array.isArray(wireMessages)) return wireMessages
  const systemIndex = wireMessages.findIndex((message) => {
    const record = asRecord(message)
    return !!record && record.role === 'system'
  })
  if (systemIndex < 0) return wireMessages
  const systemMessage = asRecord(wireMessages[systemIndex])
  if (!systemMessage) return wireMessages

  const parts = typeof systemMessage.content === 'string'
    ? [{ type: 'text', text: systemMessage.content }]
    : Array.isArray(systemMessage.content)
      ? systemMessage.content
      : null
  if (!parts || parts.length === 0) return wireMessages
  const lastIndex = parts.length - 1
  const lastPart = asRecord(parts[lastIndex])
  if (!lastPart || lastPart.type !== 'text') return wireMessages

  const nextParts = parts.map((part, index) => (
    index === lastIndex ? { ...lastPart, cache_control: DEFAULT_GEMINI_CACHE_CONTROL } : part
  ))
  return wireMessages.map((message, index) => (
    index === systemIndex ? { ...systemMessage, content: nextParts } : message
  ))
}

export function applyOpenRouterPromptCaching(input: {
  modelId: string
  body: Record<string, unknown>
  executionMode: OpenRouterPromptCacheExecutionMode
  promptCacheTtl?: '1h'
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
  // Gemini has no top-level automatic form at all, so the breakpoint is worth
  // placing for any Agents loop regardless of TTL: without it those steps are
  // uncached outright, not merely short-lived.
  const shouldAddGeminiPrefixBreakpoint = family === 'google'
    && input.executionMode === 'agent'
    && !hasOwnCacheControl(input.body)
    && !hasExplicitCacheControl
  const cachedMessages = shouldAddGeminiPrefixBreakpoint
    ? applyGeminiSystemPrefixBreakpoint(messages)
    : messages

  return {
    ...input.body,
    ...(cachedMessages !== input.body.messages ? { messages: cachedMessages } : {}),
    ...(shouldUseClaudeAutomaticCache
      ? {
        cache_control: input.promptCacheTtl === '1h'
          ? LONG_TTL_ANTHROPIC_CACHE_CONTROL
          : DEFAULT_ANTHROPIC_CACHE_CONTROL,
      }
      : {}),
  }
}
