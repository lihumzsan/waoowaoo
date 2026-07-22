import {
  TASK_TYPE,
  buildDefaultTaskBillingInfo,
  describe,
  expect,
  expectBillableInfo,
  getTaskDefinition,
  isBillableTaskType,
  it,
} from './task-policy.fixture'

describe('billing/task-policy', () => {
  const billingPayload = {
    analysisModel: 'anthropic/claude-sonnet-4',
    imageModel: 'fal::gpt-image-2',
    videoModel: 'openrouter::bytedance/seedance-2.0-fast',
    musicModel: 'google::lyria-3-pro-preview',
    voiceModel: 'fal::fal-ai/qwen-3-tts/voice-design/1.7b',
    previewText: 'Hello, world.',
    durationSeconds: 30,
    duration: 4,
    resolution: '720p',
  } as const

  const imageBillingPayload = {
    ...billingPayload,
    generationOptions: {
      resolution: '1K',
      aspectRatio: '16:9',
      quality: 'medium',
    },
  } as const

  const videoBillingPayload = {
    ...billingPayload,
    generationOptions: {
      resolution: '720p',
      aspectRatio: '16:9',
      duration: 4,
    },
  } as const

  it('builds TaskBillingInfo for every billable task type', () => {
    for (const taskType of Object.values(TASK_TYPE)) {
      if (!isBillableTaskType(taskType)) continue
      const billingPolicy = getTaskDefinition(taskType).billingPolicy
      const payload = billingPolicy === 'image'
        ? imageBillingPayload
        : billingPolicy === 'video'
          ? videoBillingPayload
          : billingPayload
      const info = expectBillableInfo(buildDefaultTaskBillingInfo(taskType, payload))
      expect(info.taskType).toBe(taskType)
      expect(info.maxFrozenCost).toBeGreaterThanOrEqual(0)
    }
  })

  it('returns null for a non-billable task type', () => {
    expect(isBillableTaskType(TASK_TYPE.CREATIVE_WORK)).toBe(false)
    expect(buildDefaultTaskBillingInfo(TASK_TYPE.CREATIVE_WORK, {})).toBeNull()
    expect(isBillableTaskType(TASK_TYPE.CREATIVE_RESOURCE_VIDEO_MERGE)).toBe(false)
    expect(buildDefaultTaskBillingInfo(TASK_TYPE.CREATIVE_RESOURCE_VIDEO_MERGE, {})).toBeNull()

    const fake = 'not_billable' as unknown as (typeof TASK_TYPE)[keyof typeof TASK_TYPE]
    expect(() => isBillableTaskType(fake)).toThrow('TASK_DEFINITION_MISSING:not_billable')
    expect(() => buildDefaultTaskBillingInfo(fake, {})).toThrow('TASK_DEFINITION_MISSING:not_billable')
  })

  it('returns null when a billable CreativeResource task lacks required pricing input', () => {
    expect(buildDefaultTaskBillingInfo(TASK_TYPE.CREATIVE_RESOURCE_IMAGE, {})).toBeNull()
    expect(buildDefaultTaskBillingInfo(TASK_TYPE.CREATIVE_RESOURCE_VIDEO, {})).toBeNull()
    expect(buildDefaultTaskBillingInfo(TASK_TYPE.CREATIVE_RESOURCE_AUDIO, {})).toBeNull()
    expect(buildDefaultTaskBillingInfo(TASK_TYPE.CREATIVE_RESOURCE_VOICE, {})).toBeNull()
  })

  it('builds audio-resource billing info for built-in music models', () => {
    const googleProInfo = expectBillableInfo(buildDefaultTaskBillingInfo(TASK_TYPE.CREATIVE_RESOURCE_AUDIO, {
      musicModel: 'google::lyria-3-pro-preview',
      durationSeconds: 30,
    }))
    expect(googleProInfo.apiType).toBe('music')
    expect(googleProInfo.model).toBe('google::lyria-3-pro-preview')
    expect(googleProInfo.quantity).toBe(1)
    expect(googleProInfo.unit).toBe('call')
    expect(googleProInfo.maxFrozenCost).toBeGreaterThan(0)

    const proInfo = expectBillableInfo(buildDefaultTaskBillingInfo(TASK_TYPE.CREATIVE_RESOURCE_AUDIO, {
      musicModel: 'google::lyria-3-pro-preview',
      durationSeconds: 60,
      count: 3,
    }))
    expect(proInfo.apiType).toBe('music')
    expect(proInfo.model).toBe('google::lyria-3-pro-preview')
    expect(proInfo.quantity).toBe(3)
    expect(proInfo.unit).toBe('call')
    expect(proInfo.maxFrozenCost).toBeGreaterThan(0)

    const falInfo = expectBillableInfo(buildDefaultTaskBillingInfo(TASK_TYPE.CREATIVE_RESOURCE_AUDIO, {
      musicModel: 'fal::fal-ai/lyria3/pro',
      durationSeconds: 60,
    }))
    expect(falInfo.apiType).toBe('music')
    expect(falInfo.model).toBe('fal::fal-ai/lyria3/pro')
    expect(falInfo.quantity).toBe(1)
    expect(falInfo.unit).toBe('call')
    expect(falInfo.maxFrozenCost).toBeCloseTo(0.576, 8)
  })
})
