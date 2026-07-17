import type { ProjectAgentContext } from '@/lib/project-agent/types'
import type { OperationPrerequisites } from './types'
import type { Locale } from '@/i18n/routing'

export const OPERATION_ENVIRONMENT_INPUT_KEYS = [
  'projectId',
  'userId',
  'assistantId',
  'scopeRef',
  'episodeId',
  'locale',
  'selectedScopeRef',
  'selectedAssetId',
] as const

const OPERATION_ENVIRONMENT_INPUT_KEY_SET = new Set<string>(OPERATION_ENVIRONMENT_INPUT_KEYS)

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function isOperationEnvironmentInputKey(key: string): boolean {
  return OPERATION_ENVIRONMENT_INPUT_KEY_SET.has(key)
}

export function resolveOperationLocale(context: ProjectAgentContext): Locale {
  return context.locale === 'en' ? 'en' : 'zh'
}

export function stripOperationEnvironmentInputFields(input: unknown): unknown {
  if (!isRecord(input)) return input
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (isOperationEnvironmentInputKey(key)) continue
    output[key] = value
  }
  return output
}

export function resolveOperationScopeInput(params: {
  readonly input: unknown
  readonly context: ProjectAgentContext
  readonly prerequisites: OperationPrerequisites
}): unknown {
  // Environment scope belongs to ProjectAgentOperationContext. Never inject it
  // into the model-authored business payload: strict tool schemas must validate
  // exactly the fields advertised to the model.
  return stripOperationEnvironmentInputFields(params.input)
}

export function resolveOperationEffectiveEpisodeId(params: {
  readonly input: unknown
  readonly context: ProjectAgentContext
}): {
  readonly episodeId: string
  readonly source: 'context' | 'input' | null
} {
  const contextEpisodeId = readTrimmedString(params.context.episodeId)
  if (contextEpisodeId) return { episodeId: contextEpisodeId, source: 'context' }
  if (!isRecord(params.input)) return { episodeId: '', source: null }
  const inputEpisodeId = readTrimmedString(params.input.episodeId)
  return inputEpisodeId ? { episodeId: inputEpisodeId, source: 'input' } : { episodeId: '', source: null }
}
