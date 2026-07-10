import {
  TASK_TYPE,
  buildDefaultTaskBillingInfo,
  describe,
  expect,
  expectBillableInfo,
  isBillableTaskType,
  it,
  type TaskType,
} from './task-policy.fixture'

describe('billing/task-policy', () => {
  const imageTaskTypes = new Set<TaskType>([
    TASK_TYPE.IMAGE_PANEL,
    TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
    TASK_TYPE.IMAGE_CHARACTER,
    TASK_TYPE.IMAGE_LOCATION,
    TASK_TYPE.MODIFY_ASSET_IMAGE,
    TASK_TYPE.REGENERATE_GROUP,
    TASK_TYPE.ASSET_HUB_IMAGE,
    TASK_TYPE.ASSET_HUB_MODIFY,
  ])

  const videoTaskTypes = new Set<TaskType>([
    TASK_TYPE.VIDEO_PANEL,
    TASK_TYPE.VIDEO_GROUP,
  ])

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
        || taskType === TASK_TYPE.MUSIC_SCORE_PLAN
        || taskType === TASK_TYPE.SOUNDSCAPE_GENERATE
      ) {
        continue
      }
      const payload = imageTaskTypes.has(taskType)
        ? imageBillingPayload
        : videoTaskTypes.has(taskType)
          ? videoBillingPayload
          : billingPayload
      const info = expectBillableInfo(buildDefaultTaskBillingInfo(taskType, payload))
      expect(info.taskType).toBe(taskType)
      expect(info.maxFrozenCost).toBeGreaterThanOrEqual(0)
    }
  })

  it('returns null for a non-billable task type', () => {
    const fake = 'not_billable' as unknown as (typeof TASK_TYPE)[keyof typeof TASK_TYPE]
    expect(isBillableTaskType(fake)).toBe(false)
    expect(buildDefaultTaskBillingInfo(fake, {})).toBeNull()
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
    expect(buildDefaultTaskBillingInfo(TASK_TYPE.IMAGE_PANEL, {})).toBeNull()
    expect(buildDefaultTaskBillingInfo(TASK_TYPE.VIDEO_PANEL, {})).toBeNull()
    expect(buildDefaultTaskBillingInfo(TASK_TYPE.MUSIC_GENERATE, {})).toBeNull()
    expect(buildDefaultTaskBillingInfo(TASK_TYPE.MUSIC_SCORE_PLAN, {})).toBeNull()
    expect(buildDefaultTaskBillingInfo(TASK_TYPE.SOUNDSCAPE_GENERATE, {})).toBeNull()
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

    const proInfo = expectBillableInfo(buildDefaultTaskBillingInfo(TASK_TYPE.MUSIC_SCORE_PLAN, {
      musicModel: 'google::lyria-3-pro-preview',
      durationSeconds: 60,
    }))
    expect(proInfo.apiType).toBe('music')
    expect(proInfo.model).toBe('google::lyria-3-pro-preview')
    expect(proInfo.quantity).toBe(1)
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
