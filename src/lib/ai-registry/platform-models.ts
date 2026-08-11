import { ARK_PLATFORM_MODEL_PRESETS } from '@/lib/ai-providers/ark/models'
import {
  CODEX_PLATFORM_DEFAULT_ASSISTANT_MODEL_KEY,
  CODEX_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
  CODEX_PLATFORM_MODEL_PRESETS,
} from '@/lib/ai-providers/codex/models'
import {
  FAL_PLATFORM_DEFAULT_MUSIC_MODEL_KEY,
  FAL_PLATFORM_MODEL_PRESETS,
} from '@/lib/ai-providers/fal/models'
import { GOOGLE_PLATFORM_MODEL_PRESETS } from '@/lib/ai-providers/google/models'
import { MUREKA_PLATFORM_MODEL_PRESETS } from '@/lib/ai-providers/mureka/models'
import {
  OPENROUTER_PLATFORM_DEFAULT_ANALYSIS_MODEL_KEY,
  OPENROUTER_PLATFORM_DEFAULT_ASSISTANT_MODEL_KEY,
  OPENROUTER_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
  OPENROUTER_PLATFORM_MODEL_PRESETS,
} from '@/lib/ai-providers/openrouter/models'
import {
  TOONFLOW_PLATFORM_DEFAULT_VIDEO_MODEL_KEY,
  TOONFLOW_PLATFORM_MODEL_PRESETS,
} from '@/lib/ai-providers/toonflow/models'
import type { DefaultModelsPayload } from '@/lib/user-api/api-config-types'
import type { PlatformModelPreset } from '@/lib/platform-models/types'
import {
  COMFYUI_PLATFORM_DEFAULT_SOUND_MODEL_KEY,
  COMFYUI_PLATFORM_MODEL_PRESETS,
} from '@/lib/ai-providers/comfyui/models'

export type PlatformDefaultModelField = keyof Required<DefaultModelsPayload>
export const PLATFORM_DEFAULT_ASSISTANT_MODEL_KEY = OPENROUTER_PLATFORM_DEFAULT_ASSISTANT_MODEL_KEY

export const PLATFORM_MODEL_INPUTS: readonly PlatformModelPreset[] = [
  ...CODEX_PLATFORM_MODEL_PRESETS,
  ...GOOGLE_PLATFORM_MODEL_PRESETS,
  ...FAL_PLATFORM_MODEL_PRESETS,
  ...ARK_PLATFORM_MODEL_PRESETS,
  ...MUREKA_PLATFORM_MODEL_PRESETS,
  ...OPENROUTER_PLATFORM_MODEL_PRESETS,
  ...TOONFLOW_PLATFORM_MODEL_PRESETS,
  ...COMFYUI_PLATFORM_MODEL_PRESETS,
]

export const PLATFORM_DEFAULT_MODEL_KEYS: Record<PlatformDefaultModelField, string> = {
  assistantModel: CODEX_PLATFORM_DEFAULT_ASSISTANT_MODEL_KEY,
  analysisModel: CODEX_PLATFORM_DEFAULT_ASSISTANT_MODEL_KEY,
  characterModel: CODEX_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
  locationModel: CODEX_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
  editModel: CODEX_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
  videoModel: TOONFLOW_PLATFORM_DEFAULT_VIDEO_MODEL_KEY,
  musicModel: FAL_PLATFORM_DEFAULT_MUSIC_MODEL_KEY,
  soundModel: COMFYUI_PLATFORM_DEFAULT_SOUND_MODEL_KEY,
}
