import { AI_PROMPT_CATALOG } from './registry'
import { getAiPromptTemplate } from './template-store'
import type { BuildAiPromptContentInput, BuildAiPromptInput } from './types'
import type { ProviderChatMessageContent, ProviderTextContentPart } from '@/lib/ai-providers/shared/llm-support'

const SINGLE_PLACEHOLDER_PATTERN = /\{([A-Za-z0-9_]+)\}/g
const DOUBLE_PLACEHOLDER_PATTERN = /\{\{([A-Za-z0-9_]+)\}\}/g
const PLACEHOLDER_TOKEN_PATTERN = /\{\{([A-Za-z0-9_]+)\}\}|\{([A-Za-z0-9_]+)\}/g
const DEFAULT_CACHE_CONTROL = { type: 'ephemeral', ttl: '1h' } as const
const DEFAULT_MIN_CACHE_CHARS = 1024

function extractPlaceholders(template: string): string[] {
  const keys = new Set<string>()
  for (const match of template.matchAll(SINGLE_PLACEHOLDER_PATTERN)) {
    const key = match[1]
    if (key) keys.add(key)
  }
  for (const match of template.matchAll(DOUBLE_PLACEHOLDER_PATTERN)) {
    const key = match[1]
    if (key) keys.add(key)
  }
  return Array.from(keys)
}

function escapeRegex(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceAllPlaceholders(template: string, key: string, value: string): string {
  const escaped = escapeRegex(key)
  const pattern = new RegExp(`\\{\\{${escaped}\\}\\}|\\{${escaped}\\}`, 'g')
  return template.replace(pattern, value)
}

export function buildAiPrompt(input: BuildAiPromptInput): string {
  const { template, variables, entry } = resolvePromptTemplate(input)

  let rendered = template
  for (const key of entry.variableKeys) {
    rendered = replaceAllPlaceholders(rendered, key, variables[key] || '')
  }
  return rendered
}

function resolvePromptTemplate(input: BuildAiPromptInput) {
  const variables = {
    ...(input.variables ?? {}),
  }
  const entry = AI_PROMPT_CATALOG[input.promptId]
  if (!entry) {
    throw new Error(`AI_PROMPT_ID_UNREGISTERED:${input.promptId}`)
  }

  const template = getAiPromptTemplate(input.promptId, input.locale)
  const templatePlaceholders = extractPlaceholders(template)
  const declared = new Set(entry.variableKeys)

  for (const key of templatePlaceholders) {
    if (!declared.has(key)) {
      throw new Error(`AI_PROMPT_PLACEHOLDER_MISMATCH:${input.promptId}:${key}`)
    }
  }

  for (const [key, value] of Object.entries(variables)) {
    if (!declared.has(key)) {
      throw new Error(`AI_PROMPT_VARIABLE_UNEXPECTED:${input.promptId}:${key}`)
    }
    if (typeof value !== 'string') {
      throw new Error(`AI_PROMPT_VARIABLE_VALUE_INVALID:${input.promptId}:${key}`)
    }
  }

  for (const key of entry.variableKeys) {
    if (!(key in variables)) {
      throw new Error(`AI_PROMPT_VARIABLE_MISSING:${input.promptId}:${key}`)
    }
  }

  return { template, variables, entry }
}

function pushPromptPart(parts: ProviderTextContentPart[], next: ProviderTextContentPart) {
  if (!next.text) return
  const previous = parts[parts.length - 1]
  if (!next.cacheControl && previous && !previous.cacheControl) {
    previous.text += next.text
    return
  }
  parts.push(next)
}

export function buildAiPromptContent(input: BuildAiPromptContentInput): ProviderChatMessageContent {
  const { template, variables } = resolvePromptTemplate(input)
  const cacheVariableKeys = new Set(input.cacheVariableKeys ?? [])
  if (cacheVariableKeys.size === 0) return buildAiPrompt(input)

  const minCacheChars = Math.max(1, Math.floor(input.minCacheChars ?? DEFAULT_MIN_CACHE_CHARS))
  const cacheControl = input.cacheControl ?? DEFAULT_CACHE_CONTROL
  const parts: ProviderTextContentPart[] = []
  let cursor = 0

  for (const match of template.matchAll(PLACEHOLDER_TOKEN_PATTERN)) {
    const index = match.index ?? 0
    if (index > cursor) {
      pushPromptPart(parts, { type: 'text', text: template.slice(cursor, index) })
    }

    const key = match[1] || match[2] || ''
    const value = variables[key] || ''
    pushPromptPart(parts, {
      type: 'text',
      text: value,
      ...(cacheVariableKeys.has(key) && value.length >= minCacheChars ? { cacheControl } : {}),
    })
    cursor = index + match[0].length
  }

  if (cursor < template.length) {
    pushPromptPart(parts, { type: 'text', text: template.slice(cursor) })
  }

  const hasCacheBlock = parts.some((part) => Boolean(part.cacheControl))
  return hasCacheBlock ? parts : buildAiPrompt(input)
}
