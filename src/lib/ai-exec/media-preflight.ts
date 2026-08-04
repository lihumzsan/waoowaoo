import { AiOptionValidationError, normalizeAiOptions } from '@/lib/ai-exec/normalize'
import { resolveAiProviderAdapter } from '@/lib/ai-providers'
import type { MediaModality } from '@/lib/ai-providers/shared/option-schema'
import type { AiResolvedSelection, AiUnknownObject } from '@/lib/ai-registry/types'
import {
  getProviderConfig,
  resolveModelSelection,
} from '@/lib/user-api/runtime-config'
import { compileMusicPrompt } from '@/lib/ai-providers/shared/music-prompt'
import { resolveProviderRouteSet } from '@/lib/ai-registry/provider-route-set'

export function normalizeMediaOptionsForSelection(input: {
  readonly selection: AiResolvedSelection
  readonly modality: MediaModality
  readonly options: unknown
  readonly prompt?: string
}): AiUnknownObject | undefined {
  const adapter = resolveAiProviderAdapter(input.selection.provider)
  const modalityAdapter = adapter[input.modality]
  if (!modalityAdapter) {
    throw new Error(`AI_PROVIDER_MODALITY_UNSUPPORTED:${input.selection.provider}:${input.modality}`)
  }
  const descriptor = modalityAdapter.describe(input.selection)
  const options = normalizeAiOptions({
    schema: descriptor.optionSchema,
    options: input.options,
    context: `${input.modality}:${input.selection.modelKey}`,
  })
  const promptMaxChars = input.modality === 'music'
    ? descriptor.capabilities.music?.promptMaxChars
    : undefined
  const effectivePrompt = input.modality === 'music' && typeof input.prompt === 'string'
    ? compileMusicPrompt(input.prompt, options ?? {})
    : input.prompt
  if (
    promptMaxChars !== undefined
    && typeof effectivePrompt === 'string'
    && effectivePrompt.length > promptMaxChars
  ) {
    throw new AiOptionValidationError({
      failure: 'invalid_option',
      context: `${input.modality}:${input.selection.modelKey}`,
      field: 'prompt',
      reason: `max_chars_${String(promptMaxChars)}`,
    })
  }
  return options
}

export async function preflightMediaGenerationOptions(input: {
  readonly userId: string
  readonly modelKey: string
  readonly modality: MediaModality
  readonly options: unknown
  readonly prompt?: string
}): Promise<{
  readonly selection: AiResolvedSelection
  readonly options: AiUnknownObject | undefined
}> {
  const selection = await resolveModelSelection(input.userId, input.modelKey, input.modality)
  // Provider credential/config availability is local and deterministic. Do
  // not reserve credits or create a Task that can only fail before HTTP.
  await getProviderConfig(input.userId, selection.provider)
  return {
    selection,
    options: normalizeMediaOptionsForSelection({
      selection,
      modality: input.modality,
      options: input.options,
      prompt: input.prompt,
    }),
  }
}

/**
 * Validate the exact options a Worker will receive against every declared
 * pre-accept route. A route is an execution possibility, so a deterministic
 * schema mismatch must fail before a billable Task is created rather than only
 * after the primary provider rejects and failover is attempted.
 */
export function preflightMediaProviderRoutes(input: {
  readonly selection: AiResolvedSelection
  readonly modality: MediaModality
  readonly options: unknown
  readonly prompt?: string
}): void {
  const routeSet = resolveProviderRouteSet(input.modality, input.selection.modelKey)
  for (const route of routeSet.routes) {
    normalizeMediaOptionsForSelection({
      selection: {
        provider: route.provider,
        modelId: route.modelId,
        modelKey: route.modelKey,
        variantSubKind: 'official',
      },
      modality: input.modality,
      options: input.options,
      prompt: input.prompt,
    })
  }
}
