import { AiOptionValidationError, normalizeAiOptions } from '@/lib/ai-exec/normalize'
import { resolveAiProviderAdapter } from '@/lib/ai-providers'
import type { MediaModality } from '@/lib/ai-providers/shared/option-schema'
import type {
  AiResolvedSelection,
  AiUnknownObject,
  MusicGenerationMode,
} from '@/lib/ai-registry/types'
import {
  getProviderConfig,
  resolveModelSelection,
} from '@/lib/user-api/runtime-config'
import { resolveProviderRouteSet } from '@/lib/ai-registry/provider-route-set'

export function normalizeMediaOptionsForSelection(input: {
  readonly selection: AiResolvedSelection
  readonly modality: MediaModality
  readonly options: unknown
  readonly prompt?: string
  readonly musicGenerationMode?: MusicGenerationMode
}): AiUnknownObject | undefined {
  const adapter = resolveAiProviderAdapter(input.selection.provider)
  const modalityAdapter = adapter[input.modality]
  if (!modalityAdapter) {
    throw new Error(`AI_PROVIDER_MODALITY_UNSUPPORTED:${input.selection.provider}:${input.modality}`)
  }
  const descriptor = modalityAdapter.describe(input.selection)
  if (input.modality === 'music') {
    if (!input.musicGenerationMode) {
      throw new AiOptionValidationError({
        failure: 'invalid_option',
        context: `${input.modality}:${input.selection.modelKey}`,
        field: 'generationMode',
        reason: 'required',
      })
    }
    if (!descriptor.capabilities.music?.generationModes?.includes(input.musicGenerationMode)) {
      throw new AiOptionValidationError({
        failure: 'invalid_option',
        context: `${input.modality}:${input.selection.modelKey}`,
        field: 'generationMode',
        reason: `unsupported_value=${input.musicGenerationMode}`,
      })
    }
  }
  const options = normalizeAiOptions({
    schema: descriptor.optionSchema,
    options: input.options,
    context: `${input.modality}:${input.selection.modelKey}`,
  })
  const promptMaxChars = input.modality === 'music'
    ? descriptor.capabilities.music?.promptMaxChars
    : input.modality === 'sound'
      ? descriptor.capabilities.sound?.promptMaxChars
      : undefined
  if (
    promptMaxChars !== undefined
    && typeof input.prompt === 'string'
    && input.prompt.length > promptMaxChars
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
  readonly musicGenerationMode?: MusicGenerationMode
}): Promise<{
  readonly selection: AiResolvedSelection
  readonly options: AiUnknownObject | undefined
}> {
  const selection = await resolveModelSelection(input.userId, input.modelKey, input.modality)
  // Provider credential/config availability is local and deterministic. Do
  // not create a Task that can only fail before HTTP.
  await getProviderConfig(input.userId, selection.provider, selection.modelKey)
  return {
    selection,
    options: normalizeMediaOptionsForSelection({
      selection,
      modality: input.modality,
      options: input.options,
      prompt: input.prompt,
      musicGenerationMode: input.musicGenerationMode,
    }),
  }
}

/**
 * Validate the exact options a Worker will receive against every declared
 * pre-accept route. A route is an execution possibility, so a deterministic
 * schema mismatch must fail before a Task is created rather than only
 * after the primary provider rejects and failover is attempted.
 */
export function preflightMediaProviderRoutes(input: {
  readonly selection: AiResolvedSelection
  readonly modality: MediaModality
  readonly options: unknown
  readonly prompt?: string
  readonly musicGenerationMode?: MusicGenerationMode
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
      musicGenerationMode: input.musicGenerationMode,
    })
  }
}
