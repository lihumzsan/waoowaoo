import type { CapabilityValue } from '@/lib/model-config-contract'
import type { EffectiveVideoCapabilityDefinition } from '@/lib/model-capabilities/video-effective'
import { isSeedance2BerniniWorkflowKey } from '@/lib/providers/comfyui/seedance2-bernini-workflow'

interface RecommendedVideoDurationInput {
  modelKey: string
  recommendedDuration: unknown
}

export function normalizeRecommendedVideoDuration(value: unknown): number | null {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed <= 0) return null
  return Number(parsed.toFixed(2))
}

export function withRecommendedVideoDuration(
  definitions: EffectiveVideoCapabilityDefinition[],
  input: RecommendedVideoDurationInput,
): EffectiveVideoCapabilityDefinition[] {
  const recommended = normalizeRecommendedVideoDuration(input.recommendedDuration)
  if (recommended === null || !isSeedance2BerniniWorkflowKey(input.modelKey)) return definitions

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
  if (recommended === null || !isSeedance2BerniniWorkflowKey(input.modelKey)) return selection
  return { ...selection, duration: recommended }
}
