import type { CapabilityValue } from '@/lib/model-config-contract'
import type { EffectiveVideoCapabilityDefinition } from '@/lib/model-capabilities/video-effective'
import { isSeedance2BerniniWorkflowKey } from '@/lib/providers/comfyui/seedance2-bernini-workflow'
import { isComfyUiLtx23KjPromptRelayWorkflow } from '@/lib/providers/comfyui/ltx23-workflow-profiles'

interface RecommendedVideoDurationInput {
  modelKey: string
  recommendedDuration: unknown
}

export function normalizeRecommendedVideoDuration(value: unknown): number | null {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed <= 0) return null
  return Number(parsed.toFixed(2))
}

export function supportsRecommendedVideoDuration(modelKey: string): boolean {
  return isSeedance2BerniniWorkflowKey(modelKey)
    || isComfyUiLtx23KjPromptRelayWorkflow(modelKey)
}

export function resolveBerniniCapabilityValidationDuration(
  modelKey: string,
  requestedDuration: number,
  durationOptions: readonly unknown[] | null | undefined,
): number {
  if (!isSeedance2BerniniWorkflowKey(modelKey)) return requestedDuration

  const sortedOptions = Array.isArray(durationOptions)
    ? durationOptions
      .filter((option): option is number => typeof option === 'number' && Number.isFinite(option) && option > 0)
      .sort((left, right) => left - right)
    : []
  if (sortedOptions.length === 0) return requestedDuration

  return sortedOptions.find((option) => option + 0.001 >= requestedDuration)
    ?? sortedOptions[sortedOptions.length - 1]
}

export function withRecommendedVideoDuration(
  definitions: EffectiveVideoCapabilityDefinition[],
  input: RecommendedVideoDurationInput,
): EffectiveVideoCapabilityDefinition[] {
  const recommended = normalizeRecommendedVideoDuration(input.recommendedDuration)
  if (recommended === null || !supportsRecommendedVideoDuration(input.modelKey)) return definitions

  return definitions.map((definition) => definition.field === 'duration'
    ? {
        ...definition,
        options: [recommended, ...definition.options.filter((value) => value !== recommended)],
      }
    : definition)
}

export function applyRecommendedVideoDurationSelection(
  selection: Record<string, CapabilityValue>,
  input: RecommendedVideoDurationInput,
): Record<string, CapabilityValue> {
  const recommended = normalizeRecommendedVideoDuration(input.recommendedDuration)
  if (recommended === null || !supportsRecommendedVideoDuration(input.modelKey)) return selection
  return { ...selection, duration: recommended }
}
