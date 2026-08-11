import { ARK_PLATFORM_MODEL_PRESETS } from '@/lib/ai-providers/ark/models'
import { ELEVENLABS_PLATFORM_MODEL_PRESETS } from '@/lib/ai-providers/elevenlabs/models'
import { FAL_PLATFORM_MODEL_PRESETS } from '@/lib/ai-providers/fal/models'
import {
  GOOGLE_PLATFORM_MODEL_PRESETS,
} from '@/lib/ai-providers/google/models'
import { OPENROUTER_PLATFORM_MODEL_PRESETS } from '@/lib/ai-providers/openrouter/models'
import {
  TOONFLOW_PLATFORM_MODEL_PRESETS,
} from '@/lib/ai-providers/toonflow/models'
import type { DefaultModelsPayload } from '@/lib/user-api/api-config-types'
import type { PlatformModelPreset } from '@/lib/platform-models/types'

export type PlatformDefaultModelField = keyof Required<DefaultModelsPayload>

export const PLATFORM_MODEL_INPUTS: readonly PlatformModelPreset[] = [
  ...GOOGLE_PLATFORM_MODEL_PRESETS,
  ...FAL_PLATFORM_MODEL_PRESETS,
  ...ARK_PLATFORM_MODEL_PRESETS,
  ...ELEVENLABS_PLATFORM_MODEL_PRESETS,
  ...OPENROUTER_PLATFORM_MODEL_PRESETS,
  ...TOONFLOW_PLATFORM_MODEL_PRESETS,
]
