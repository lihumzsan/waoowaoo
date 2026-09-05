import { CODEX_PLATFORM_DEFAULT_IMAGE_MODEL_KEY, CODEX_PLATFORM_MODEL_PRESETS } from '@/lib/ai-providers/codex/models'
import type { DefaultModelsPayload } from '@/lib/user-api/api-config-types'
import type { PlatformModelPreset } from '@/lib/platform-models/types'
import {
  COMFYUI_PLATFORM_DEFAULT_SOUND_MODEL_KEY,
  COMFYUI_PLATFORM_DEFAULT_MUSIC_MODEL_KEY,
  COMFYUI_PLATFORM_DEFAULT_VIDEO_MODEL_KEY,
  COMFYUI_PLATFORM_MODEL_PRESETS,
} from '@/lib/ai-providers/comfyui/models'

export type PlatformDefaultModelField = Exclude<keyof Required<DefaultModelsPayload>, 'analysisModel'>

export const PLATFORM_MODEL_INPUTS: readonly PlatformModelPreset[] = [
  ...CODEX_PLATFORM_MODEL_PRESETS,
  ...COMFYUI_PLATFORM_MODEL_PRESETS,
]
export const PLATFORM_DEFAULT_MODEL_KEYS: Record<PlatformDefaultModelField, string> = {
  characterModel: CODEX_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
  locationModel: CODEX_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
  editModel: CODEX_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
  videoModel: COMFYUI_PLATFORM_DEFAULT_VIDEO_MODEL_KEY,
  musicModel: COMFYUI_PLATFORM_DEFAULT_MUSIC_MODEL_KEY,
  soundModel: COMFYUI_PLATFORM_DEFAULT_SOUND_MODEL_KEY,
}
