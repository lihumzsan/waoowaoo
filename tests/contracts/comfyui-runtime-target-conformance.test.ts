import { describe, expect, it } from 'vitest'
import {
  COMFYUI_API_CONFIG_CATALOG_MODELS,
  COMFYUI_ACE_STEP_1_5_MODEL_ID,
  COMFYUI_H3_MODEL_ID,
  COMFYUI_REGISTERED_MODEL_KEYS,
  resolveComfyUiRuntimeTargetIdForModelKey,
} from '@/lib/ai-providers/comfyui/models'
import { getPlatformDefaultModels } from '@/lib/platform-models/catalog'
import { getPlatformRuntimePlan } from '@/lib/platform-runtime/presets'

describe('ComfyUI runtime target registry', () => {
  it('covers every registered catalog model exactly once', () => {
    const catalogKeys = COMFYUI_API_CONFIG_CATALOG_MODELS
      .map((model) => `comfyui::${model.modelId}`)
      .sort()

    expect([...COMFYUI_REGISTERED_MODEL_KEYS].sort()).toEqual(catalogKeys)
    expect(COMFYUI_REGISTERED_MODEL_KEYS).toEqual([
      `comfyui::${COMFYUI_H3_MODEL_ID}`,
      `comfyui::${COMFYUI_ACE_STEP_1_5_MODEL_ID}`,
    ])
    expect(new Set(COMFYUI_REGISTERED_MODEL_KEYS).size).toBe(COMFYUI_REGISTERED_MODEL_KEYS.length)

    for (const modelKey of COMFYUI_REGISTERED_MODEL_KEYS) {
      expect(resolveComfyUiRuntimeTargetIdForModelKey(modelKey)).toMatch(/^(shared|h3-dual-stage-2mp)$/)
    }
  })

  it('isolates H3, keeps music on shared, and exposes no sound default', () => {
    expect(resolveComfyUiRuntimeTargetIdForModelKey(`comfyui::${COMFYUI_H3_MODEL_ID}`)).toBe('h3-dual-stage-2mp')
    expect(resolveComfyUiRuntimeTargetIdForModelKey(`comfyui::${COMFYUI_ACE_STEP_1_5_MODEL_ID}`)).toBe('shared')
    expect(getPlatformDefaultModels().soundModel).toBeUndefined()
    expect(() => getPlatformRuntimePlan('sound')).toThrow('PLATFORM_RUNTIME_MODEL_MISSING:sound')
  })
})
