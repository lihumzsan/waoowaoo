import {
  TASK_TYPE,
  buildDefaultTaskBillingInfo,
  describe,
  expect,
  expectBillableInfo,
  getTaskDefinition,
  isBillableTaskType,
  it,
  type TaskType,
} from './task-policy.fixture'

describe('billing/task-policy', () => {
  const billingPayload = {
    analysisModel: 'anthropic/claude-sonnet-4',
    imageModel: 'fal::gpt-image-2',
    videoModel: 'openrouter::bytedance/seedance-2.0-fast',
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
      if (
        taskType === TASK_TYPE.MUSIC_GENERATE
        || taskType === TASK_TYPE.MUSIC_SCORE_GENERATE
        || taskType === TASK_TYPE.AMBIENT_SOUND_GENERATE
      ) {
        continue
      }
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
    expect(isBillableTaskType(TASK_TYPE.FINAL_VIDEO_RENDER)).toBe(false)
    expect(buildDefaultTaskBillingInfo(TASK_TYPE.FINAL_VIDEO_RENDER, {})).toBeNull()
    expect(isBillableTaskType(TASK_TYPE.CHAPTER_RENDER)).toBe(false)
    expect(buildDefaultTaskBillingInfo(TASK_TYPE.CHAPTER_RENDER, {})).toBeNull()

    const fake = 'not_billable' as unknown as (typeof TASK_TYPE)[keyof typeof TASK_TYPE]
    expect(() => isBillableTaskType(fake)).toThrow('TASK_DEFINITION_MISSING:not_billable')
    expect(() => buildDefaultTaskBillingInfo(fake, {})).toThrow('TASK_DEFINITION_MISSING:not_billable')
  })

  it('builds text billing info from explicit model payload', () => {
    const info = expectBillableInfo(buildDefaultTaskBillingInfo(TASK_TYPE.EDIT_BIBLE_GENERATE, {
      analysisModel: 'anthropic/claude-sonnet-4',
    }))
    expect(info.apiType).toBe('text')
    expect(info.model).toBe('anthropic/claude-sonnet-4')
    expect(info.quantity).toBe(3000)
  })

  it('builds backend text billing info for edit script generation without making it a fixed-price media quote', () => {
    const info = expectBillableInfo(buildDefaultTaskBillingInfo(TASK_TYPE.EDIT_SCRIPT_GENERATE, {
      analysisModel: 'anthropic/claude-sonnet-4',
    }))
    expect(info.apiType).toBe('text')
    expect(info.taskType).toBe(TASK_TYPE.EDIT_SCRIPT_GENERATE)
    expect(info.model).toBe('anthropic/claude-sonnet-4')
    expect(info.unit).toBe('token')
  })

  it('returns null for missing required models in text/image/video tasks', () => {
    expect(buildDefaultTaskBillingInfo(TASK_TYPE.EDIT_BIBLE_GENERATE, {})).toBeNull()
    expect(buildDefaultTaskBillingInfo(TASK_TYPE.EDIT_SCRIPT_GENERATE, {})).toBeNull()
    expect(buildDefaultTaskBillingInfo(TASK_TYPE.IMAGE_CHARACTER, {})).toBeNull()
    expect(buildDefaultTaskBillingInfo(TASK_TYPE.VIDEO_SEGMENT, {})).toBeNull()
    expect(buildDefaultTaskBillingInfo(TASK_TYPE.MUSIC_GENERATE, {})).toBeNull()
    expect(buildDefaultTaskBillingInfo(TASK_TYPE.AUDIO_DESIGN_PLAN, {})).toBeNull()
    expect(buildDefaultTaskBillingInfo(TASK_TYPE.MUSIC_SCORE_GENERATE, {})).toBeNull()
    expect(buildDefaultTaskBillingInfo(TASK_TYPE.AMBIENT_SOUND_GENERATE, {})).toBeNull()
  })

  it('builds music billing info for built-in Lyria models', () => {
    const googleProInfo = expectBillableInfo(buildDefaultTaskBillingInfo(TASK_TYPE.MUSIC_GENERATE, {
      musicModel: 'google::lyria-3-pro-preview',
      durationSeconds: 30,
    }))
    expect(googleProInfo.apiType).toBe('music')
    expect(googleProInfo.model).toBe('google::lyria-3-pro-preview')
    expect(googleProInfo.quantity).toBe(1)
    expect(googleProInfo.unit).toBe('call')
    expect(googleProInfo.maxFrozenCost).toBeGreaterThan(0)

    const proInfo = expectBillableInfo(buildDefaultTaskBillingInfo(TASK_TYPE.MUSIC_SCORE_GENERATE, {
      musicModel: 'google::lyria-3-pro-preview',
      durationSeconds: 60,
      count: 3,
    }))
    expect(proInfo.apiType).toBe('music')
    expect(proInfo.model).toBe('google::lyria-3-pro-preview')
    expect(proInfo.quantity).toBe(3)
    expect(proInfo.unit).toBe('call')
    expect(proInfo.maxFrozenCost).toBeGreaterThan(0)

    const falInfo = expectBillableInfo(buildDefaultTaskBillingInfo(TASK_TYPE.MUSIC_GENERATE, {
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
