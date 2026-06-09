import { ARK_DEFAULT_GROUP_VIDEO_MODEL, ARK_PLATFORM_MODEL_PRESETS } from '@/lib/ai-providers/ark/models'
import { FAL_PLATFORM_DEFAULT_IMAGE_MODEL_KEY, FAL_PLATFORM_MODEL_PRESETS } from '@/lib/ai-providers/fal/models'
import {
  GOOGLE_PLATFORM_DEFAULT_ANALYSIS_MODEL_KEY,
  GOOGLE_PLATFORM_DEFAULT_MUSIC_MODEL_KEY,
  GOOGLE_PLATFORM_MODEL_PRESETS,
} from '@/lib/ai-providers/google/models'
import type { DefaultModelsPayload } from '@/lib/user-api/api-config-types'
import type { PlatformModelPreset } from '@/lib/platform-models/types'

export type PlatformDefaultModelField = keyof Required<DefaultModelsPayload>

export const PLATFORM_MODEL_INPUTS: readonly PlatformModelPreset[] = [
  ...GOOGLE_PLATFORM_MODEL_PRESETS,
  ...FAL_PLATFORM_MODEL_PRESETS,
  ...ARK_PLATFORM_MODEL_PRESETS,
]

export const PLATFORM_DEFAULT_MODEL_KEYS: Record<PlatformDefaultModelField, string> = {
  analysisModel: GOOGLE_PLATFORM_DEFAULT_ANALYSIS_MODEL_KEY,
  characterModel: FAL_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
  locationModel: FAL_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
  storyboardModel: FAL_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
  editModel: FAL_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
  videoModel: ARK_DEFAULT_GROUP_VIDEO_MODEL,
  musicModel: GOOGLE_PLATFORM_DEFAULT_MUSIC_MODEL_KEY,
}
