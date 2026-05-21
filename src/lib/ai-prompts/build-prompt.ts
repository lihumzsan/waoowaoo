import { AI_PROMPT_CATALOG } from './registry'
import { getAiPromptTemplate } from './template-store'
import type { BuildAiPromptInput } from './types'

const SINGLE_PLACEHOLDER_PATTERN = /\{([A-Za-z0-9_]+)\}/g
const DOUBLE_PLACEHOLDER_PATTERN = /\{\{([A-Za-z0-9_]+)\}\}/g

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

  let rendered = template
  for (const key of entry.variableKeys) {
    rendered = replaceAllPlaceholders(rendered, key, variables[key] || '')
  }
  return rendered
}
