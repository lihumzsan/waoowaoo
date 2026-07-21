import { describe, expect, it } from 'vitest'
import { buildGenerateVideoRequestBody } from '@/lib/novel-promotion/video-generate-request'

describe('video generate request body', () => {
  const SMART_VBVR_MODEL_KEY = 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2'
  const LEGACY_LTX23_MODEL_KEY = 'comfyui::basevideo/ltx23-profiles/t8-sulphur2-promptrelay-micro'
  const BERNINI_MODEL_KEY = 'comfyui::basevideo/seedance2/bernini-480p-i2v'

  it('includes the visible panel prompt as a root custom prompt when provided', () => {
    expect(buildGenerateVideoRequestBody({
      storyboardId: 'storyboard-1',
      panelIndex: 2,
      videoModel: SMART_VBVR_MODEL_KEY,
      customPrompt: '  visible card video prompt  ',
    })).toEqual({
      storyboardId: 'storyboard-1',
      panelIndex: 2,
      videoModel: SMART_VBVR_MODEL_KEY,
      customPrompt: 'visible card video prompt',
    })
  })

  it('normalizes removed LTX2.3 video model keys to Bernini before submit', () => {
    expect(buildGenerateVideoRequestBody({
      storyboardId: 'storyboard-1',
      panelIndex: 2,
      videoModel: LEGACY_LTX23_MODEL_KEY,
    }).videoModel).toBe(BERNINI_MODEL_KEY)
  })

  it('submits the Bernini audio lipsync workflow through the base Bernini model key', () => {
    expect(buildGenerateVideoRequestBody({
      storyboardId: 'storyboard-1',
      panelIndex: 2,
      videoModel: 'comfyui::basevideo/seedance2/bernini-480p-i2v-audio-lipsync',
    }).videoModel).toBe(BERNINI_MODEL_KEY)
  })

  it('includes a preceding-output continuity relay when provided', () => {
    expect(buildGenerateVideoRequestBody({
      storyboardId: 'storyboard-1',
      panelIndex: 2,
      videoModel: SMART_VBVR_MODEL_KEY,
      continuityRelay: {
        mode: 'previous_output_end_frame',
        sourceVideoTaskId: 'video-task-1',
        sourceFrameMediaId: 'media-1',
      },
    })).toMatchObject({
      continuityRelay: {
        mode: 'previous_output_end_frame',
        sourceVideoTaskId: 'video-task-1',
        sourceFrameMediaId: 'media-1',
      },
    })
  })
})
