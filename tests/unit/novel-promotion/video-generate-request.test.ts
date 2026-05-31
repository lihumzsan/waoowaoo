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
      videoModel: 'comfyui::basevideo/ltx23-profiles/t8-smart-vbvr-390k-v2',
      customPrompt: 'visible card video prompt',
    })
  })
})
