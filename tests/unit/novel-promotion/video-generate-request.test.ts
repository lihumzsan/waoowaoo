import { describe, expect, it } from 'vitest'
import { buildGenerateVideoRequestBody } from '@/lib/novel-promotion/video-generate-request'

describe('video generate request body', () => {
  it('includes the visible panel prompt as a root custom prompt when provided', () => {
    expect(buildGenerateVideoRequestBody({
      storyboardId: 'storyboard-1',
      panelIndex: 2,
      videoModel: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
      customPrompt: '  visible card video prompt  ',
    })).toEqual({
      storyboardId: 'storyboard-1',
      panelIndex: 2,
      videoModel: 'comfyui::basevideo/seedance2/bernini-480p-i2v',
      customPrompt: 'visible card video prompt',
    })
  })

  it('normalizes removed LTX2.3 video model keys to Bernini before submit', () => {
    expect(buildGenerateVideoRequestBody({
      storyboardId: 'storyboard-1',
      panelIndex: 2,
      videoModel: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
    }).videoModel).toBe('comfyui::basevideo/seedance2/bernini-480p-i2v')
  })

  it('submits the Bernini audio lipsync workflow through the base Bernini model key', () => {
    expect(buildGenerateVideoRequestBody({
      storyboardId: 'storyboard-1',
      panelIndex: 2,
      videoModel: 'comfyui::basevideo/seedance2/bernini-480p-i2v-audio-lipsync',
    }).videoModel).toBe('comfyui::basevideo/seedance2/bernini-480p-i2v')
  })
})
