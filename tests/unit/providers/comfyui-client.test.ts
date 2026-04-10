import { describe, expect, it } from 'vitest'
import { collectMediaRefsFromOutputs } from '@/lib/providers/comfyui/client'

describe('comfyui client media refs', () => {
  it('collects classic filename-array outputs', () => {
    const refs = collectMediaRefsFromOutputs({
      '15': {
        gifs: [{
          filename: 'AnimateDiff_00001.mp4',
          subfolder: 'video',
          type: 'output',
        }],
      },
    })

    expect(refs).toEqual([{
      filename: 'AnimateDiff_00001.mp4',
      subfolder: 'video',
      type: 'output',
    }])
  })

  it('collects SaveVideo view urls from history outputs', () => {
    const refs = collectMediaRefsFromOutputs({
      '211': {
        video_url: '/view?filename=LTX_2.3_i2v_00001.mp4&subfolder=video%2FLTX_2.3_i2v&type=output',
      },
    })

    expect(refs).toEqual([{
      filename: 'LTX_2.3_i2v_00001.mp4',
      subfolder: 'video/LTX_2.3_i2v',
      type: 'output',
    }])
  })

  it('collects relative media paths exposed as plain strings', () => {
    const refs = collectMediaRefsFromOutputs({
      '211': {
        value: 'output/video/LTX_2.3_i2v/LTX_2.3_i2v_00002.mp4',
      },
    })

    expect(refs).toEqual([{
      filename: 'LTX_2.3_i2v_00002.mp4',
      subfolder: 'video/LTX_2.3_i2v',
      type: 'output',
    }])
  })
})
