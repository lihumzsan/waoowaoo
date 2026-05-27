import { describe, expect, it } from 'vitest'
import {
  collectLegacyPanelIdsToClear,
  isLegacyPayload,
  removeLegacyCapabilitySelections,
  removeLegacyCustomModels,
} from '../../../scripts/clear-legacy-ltx23-video-data-core'

const LEGACY_MODEL = 'comfyui::basevideo/demo/LTX2.3-fast'
const NEW_PROFILE_MODEL = 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2'

describe('legacy LTX2.3 cleanup helpers', () => {
  it('finds legacy workflow keys in nested task payloads', () => {
    expect(isLegacyPayload({
      payload: {
        videoModel: LEGACY_MODEL,
      },
    })).toBe(true)
    expect(isLegacyPayload({
      payload: {
        videoModel: NEW_PROFILE_MODEL,
      },
    })).toBe(false)
  })

  it('removes legacy custom video models and keeps current profile models', () => {
    const result = removeLegacyCustomModels(JSON.stringify([
      {
        modelId: 'basevideo/demo/LTX2.3-fast',
        modelKey: LEGACY_MODEL,
        type: 'video',
        provider: 'comfyui',
      },
      {
        modelId: 'basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
        modelKey: NEW_PROFILE_MODEL,
        type: 'video',
        provider: 'comfyui',
      },
      {
        modelId: 'baseaudio/demo',
        modelKey: 'comfyui::baseaudio/demo',
        type: 'audio',
        provider: 'comfyui',
      },
    ]))

    expect(result.changed).toBe(true)
    expect(result.removed).toBe(1)
    expect(JSON.parse(result.value || '[]')).toEqual([
      expect.objectContaining({ modelKey: NEW_PROFILE_MODEL }),
      expect.objectContaining({ modelKey: 'comfyui::baseaudio/demo' }),
    ])
  })

  it('removes legacy capability selections by model key', () => {
    const result = removeLegacyCapabilitySelections(JSON.stringify({
      [LEGACY_MODEL]: { duration: 12 },
      [NEW_PROFILE_MODEL]: { duration: 6 },
      'fal::seedance/video': { resolution: '720p' },
    }))

    expect(result.changed).toBe(true)
    expect(result.removed).toBe(1)
    expect(JSON.parse(result.value || '{}')).toEqual({
      [NEW_PROFILE_MODEL]: { duration: 6 },
      'fal::seedance/video': { resolution: '720p' },
    })
  })

  it('clears panels referenced by legacy video tasks even after the project model was migrated', () => {
    const result = collectLegacyPanelIdsToClear(
      ['panel-from-current-legacy-project'],
      [
        {
          targetId: 'panel-from-old-task',
          payload: { videoModel: LEGACY_MODEL },
        },
        {
          targetId: 'panel-current-profile',
          payload: { videoModel: NEW_PROFILE_MODEL },
        },
        {
          targetId: '',
          payload: { videoModel: LEGACY_MODEL },
        },
      ],
    )

    expect(result).toEqual([
      'panel-from-current-legacy-project',
      'panel-from-old-task',
    ])
  })
})
