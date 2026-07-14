import {
  TASK_TYPE,
  buildDefaultTaskBillingInfo,
  describe,
  expect,
  expectBillableInfo,
  it,
} from './task-policy.fixture'

describe('billing/task-policy', () => {

  it('fails uncatalogued music models instead of falling back to product credits', () => {
    expect(() => buildDefaultTaskBillingInfo(TASK_TYPE.MUSIC_GENERATE, {
      musicModel: 'google::unknown-music',
      durationSeconds: 30,
    })).toThrow(/BILLING_UNKNOWN_MODEL/)
  })

  it('honors candidateCount/count for image tasks', () => {
    const info = expectBillableInfo(buildDefaultTaskBillingInfo(TASK_TYPE.IMAGE_CHARACTER, {
      candidateCount: 4,
      imageModel: 'fal::gpt-image-2',
      generationOptions: {
        resolution: '1K',
        aspectRatio: '16:9',
        quality: 'medium',
      },
    }))
    expect(info.apiType).toBe('image')
    expect(info.quantity).toBe(4)
    expect(info.model).toBe('fal::gpt-image-2')
    expect(info.maxFrozenCost).toBeCloseTo(1.152, 8)
    expect(info.metadata).toEqual({
      resolution: '1K',
      quality: 'medium',
      aspectRatio: '16:9',
    })
  })

  it('does not use top-level image sizing fields as billing metadata', () => {
    expect(() => buildDefaultTaskBillingInfo(TASK_TYPE.IMAGE_CHARACTER, {
      candidateCount: 1,
      imageModel: 'fal::gpt-image-2',
      resolution: '1K',
      aspectRatio: '16:9',
      quality: 'medium',
    })).toThrow(/BILLING_CAPABILITY_PRICE_NOT_FOUND/)
  })

  it('builds video billing info from the explicit video model', () => {
    const info = expectBillableInfo(buildDefaultTaskBillingInfo(TASK_TYPE.VIDEO_SEGMENT, {
      videoModel: 'openrouter::bytedance/seedance-2.0-fast',
      duration: 8,
    }))
    expect(info.apiType).toBe('video')
    expect(info.model).toBe('openrouter::bytedance/seedance-2.0-fast')
    expect(info.quantity).toBe(1)
  })

  it('uses explicit music model from payload', () => {
    const info = expectBillableInfo(buildDefaultTaskBillingInfo(TASK_TYPE.MUSIC_GENERATE, {
      musicModel: 'google::lyria-3-pro-preview',
      durationSeconds: 30,
    }))
    expect(info.apiType).toBe('music')
    expect(info.model).toBe('google::lyria-3-pro-preview')
    expect(info.quantity).toBe(1)
    expect(info.unit).toBe('call')
  })

  it('builds sound effect billing info from explicit sound effect model and source count', () => {
    const info = expectBillableInfo(buildDefaultTaskBillingInfo(TASK_TYPE.AMBIENT_SOUND_GENERATE, {
      soundEffectModel: 'elevenlabs::eleven_text_to_sound_v2',
      durationSeconds: 30,
      sourceCount: 3,
      loop: true,
      outputFormat: 'mp3_44100_128',
      promptInfluence: 0.55,
    }))

    expect(info.apiType).toBe('sound_effect')
    expect(info.model).toBe('elevenlabs::eleven_text_to_sound_v2')
    expect(info.quantity).toBe(3)
    expect(info.unit).toBe('call')
    expect(info.maxFrozenCost).toBeCloseTo(0.36, 8)
    expect(info.metadata).toEqual({
      durationSeconds: 30,
      outputFormat: 'mp3_44100_128',
      promptInfluence: 0.55,
      loop: true,
      sourceCount: 3,
    })
  })
})
