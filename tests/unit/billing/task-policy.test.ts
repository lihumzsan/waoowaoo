import { describe, expect, it } from 'vitest'
import '@/lib/ai-providers'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo, isBillableTaskType } from '@/lib/billing/task-policy'
import type { TaskBillingInfo, TaskType } from '@/lib/task/types'

function expectBillableInfo(info: TaskBillingInfo | null): Extract<TaskBillingInfo, { billable: true }> {
  expect(info).toBeTruthy()
  expect(info?.billable).toBe(true)
  if (!info || !info.billable) {
    throw new Error('Expected billable task billing info')
  }
  return info
}

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
      if (taskType === TASK_TYPE.MUSIC_GENERATE || taskType === TASK_TYPE.MUSIC_SCORE_PLAN) continue
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
  })

  it('builds music billing info for built-in Lyria models', () => {
    const clipInfo = expectBillableInfo(buildDefaultTaskBillingInfo(TASK_TYPE.MUSIC_GENERATE, {
      musicModel: 'google::lyria-3-clip-preview',
      durationSeconds: 30,
    }))
    expect(clipInfo.apiType).toBe('music')
    expect(clipInfo.model).toBe('google::lyria-3-clip-preview')
    expect(clipInfo.quantity).toBe(1)
    expect(clipInfo.unit).toBe('call')
    expect(clipInfo.maxFrozenCost).toBeGreaterThan(0)

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

  it('fails uncatalogued music models instead of falling back to product credits', () => {
    expect(() => buildDefaultTaskBillingInfo(TASK_TYPE.MUSIC_GENERATE, {
      musicModel: 'google::unknown-music',
      durationSeconds: 30,
    })).toThrow(/BILLING_UNKNOWN_MODEL/)
  })

  it('honors candidateCount/count for image tasks', () => {
    const info = expectBillableInfo(buildDefaultTaskBillingInfo(TASK_TYPE.IMAGE_PANEL, {
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
    expect(() => buildDefaultTaskBillingInfo(TASK_TYPE.IMAGE_PANEL, {
      candidateCount: 1,
      imageModel: 'fal::gpt-image-2',
      resolution: '1K',
      aspectRatio: '16:9',
      quality: 'medium',
    })).toThrow(/BILLING_CAPABILITY_PRICE_NOT_FOUND/)
  })

  it('builds video billing info from the explicit video model', () => {
    const info = expectBillableInfo(buildDefaultTaskBillingInfo(TASK_TYPE.VIDEO_PANEL, {
      videoModel: 'openrouter::bytedance/seedance-2.0-fast',
      duration: 8,
    }))
    expect(info.apiType).toBe('video')
    expect(info.model).toBe('openrouter::bytedance/seedance-2.0-fast')
    expect(info.quantity).toBe(1)
  })

  it('uses explicit music model from payload', () => {
    const info = expectBillableInfo(buildDefaultTaskBillingInfo(TASK_TYPE.MUSIC_GENERATE, {
      musicModel: 'google::lyria-3-clip-preview',
      durationSeconds: 30,
    }))
    expect(info.apiType).toBe('music')
    expect(info.model).toBe('google::lyria-3-clip-preview')
    expect(info.quantity).toBe(1)
    expect(info.unit).toBe('call')
  })
})
