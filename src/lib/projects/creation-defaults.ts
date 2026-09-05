import type { CapabilitySelections } from '@/lib/ai-registry/types'
import {
  parseStoredCapabilitySelections,
  validateCapabilitySelectionsAgainstModels,
} from '@/lib/user-api/api-config-capability-defaults'
import { parseStoredModels } from '@/lib/user-api/api-config-model-normalization'
import {
  COMFYUI_PLATFORM_DEFAULT_MUSIC_MODEL_KEY,
  COMFYUI_PLATFORM_DEFAULT_VIDEO_MODEL_KEY,
} from '@/lib/ai-providers/comfyui/models'
import { CODEX_PLATFORM_DEFAULT_IMAGE_MODEL_KEY } from '@/lib/ai-providers/codex/models'
import type { ProjectVideoRatio } from '@/lib/projects/video-ratio'

export const LOCAL_PROJECT_DEFAULT_VIDEO_RATIO: ProjectVideoRatio = '9:16'

export const LOCAL_PROJECT_DEFAULT_MODELS = Object.freeze({
  characterModel: CODEX_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
  locationModel: CODEX_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
  editModel: CODEX_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
  videoModel: COMFYUI_PLATFORM_DEFAULT_VIDEO_MODEL_KEY,
  musicModel: COMFYUI_PLATFORM_DEFAULT_MUSIC_MODEL_KEY,
})

export const LOCAL_PROJECT_DEFAULT_CAPABILITY_SELECTIONS: CapabilitySelections = Object.freeze({
  [CODEX_PLATFORM_DEFAULT_IMAGE_MODEL_KEY]: Object.freeze({
    resolution: '2K',
    quality: 'medium',
  }),
})

export function validateStoredProjectCapabilityDefaults(input: {
  readonly storedUserDefaults: string | null | undefined
  readonly storedCustomModels: string | null | undefined
}): CapabilitySelections {
  const selections = parseStoredCapabilitySelections(
    input.storedUserDefaults,
    'capabilityDefaults',
  )
  if (Object.keys(selections).length === 0) return selections

  validateCapabilitySelectionsAgainstModels(
    selections,
    parseStoredModels(input.storedCustomModels),
  )
  return selections
}

export function buildLocalProjectCapabilityOverrides(
  storedDefaults: CapabilitySelections,
): string {
  return JSON.stringify(buildLocalProjectCapabilitySelections(storedDefaults))
}

export function buildLocalProjectCapabilitySelections(
  storedDefaults: CapabilitySelections,
): CapabilitySelections {
  const codexImageDefaults = storedDefaults[CODEX_PLATFORM_DEFAULT_IMAGE_MODEL_KEY] ?? null
  return {
    ...LOCAL_PROJECT_DEFAULT_CAPABILITY_SELECTIONS,
    ...(codexImageDefaults
      ? {
          [CODEX_PLATFORM_DEFAULT_IMAGE_MODEL_KEY]: {
            ...LOCAL_PROJECT_DEFAULT_CAPABILITY_SELECTIONS[CODEX_PLATFORM_DEFAULT_IMAGE_MODEL_KEY],
            ...codexImageDefaults,
          },
        }
      : {}),
  }
}
