import { describe, expect, it } from 'vitest'
import {
  calculateEstimatedTaskProgress,
  getEstimatedTaskProgressTiming,
  shouldShowEstimatedTaskProgress,
} from '@/lib/task/estimated-progress'
import { TASK_TYPE } from '@/lib/task/types'

describe('estimated task progress', () => {
  it('uses 150 seconds for image and video generation tasks', () => {
    expect(getEstimatedTaskProgressTiming(TASK_TYPE.IMAGE_PANEL)).toEqual({
      expectedSeconds: 150,
      tailSeconds: 75,
      totalSeconds: 225,
    })
    expect(getEstimatedTaskProgressTiming(TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE)).toEqual({
      expectedSeconds: 150,
      tailSeconds: 75,
      totalSeconds: 225,
    })
    expect(getEstimatedTaskProgressTiming(TASK_TYPE.VIDEO_PANEL)).toEqual({
      expectedSeconds: 150,
      tailSeconds: 75,
      totalSeconds: 225,
    })
  })

  it('uses 60 seconds for music and final render tasks', () => {
    expect(getEstimatedTaskProgressTiming(TASK_TYPE.MUSIC_SCORE_PLAN)).toEqual({
      expectedSeconds: 60,
      tailSeconds: 30,
      totalSeconds: 90,
    })
    expect(getEstimatedTaskProgressTiming(TASK_TYPE.FINAL_VIDEO_RENDER)).toEqual({
      expectedSeconds: 60,
      tailSeconds: 30,
      totalSeconds: 90,
    })
  })

  it('does not show estimated progress for modification tasks', () => {
    expect(shouldShowEstimatedTaskProgress(TASK_TYPE.MODIFY_ASSET_IMAGE)).toBe(false)
    expect(shouldShowEstimatedTaskProgress(TASK_TYPE.ASSET_HUB_MODIFY)).toBe(false)
    expect(shouldShowEstimatedTaskProgress(TASK_TYPE.AI_MODIFY_APPEARANCE)).toBe(false)
    expect(getEstimatedTaskProgressTiming(TASK_TYPE.MODIFY_ASSET_IMAGE)).toBeNull()
  })

  it('moves image generation from 0 to 90 percent during the expected window', () => {
    expect(calculateEstimatedTaskProgress({
      phase: 'processing',
      taskType: TASK_TYPE.IMAGE_PANEL,
      elapsedMs: 0,
    })?.percent).toBe(0)
    expect(calculateEstimatedTaskProgress({
      phase: 'processing',
      taskType: TASK_TYPE.IMAGE_PANEL,
      elapsedMs: 75_000,
    })?.percent).toBe(45)
    expect(calculateEstimatedTaskProgress({
      phase: 'processing',
      taskType: TASK_TYPE.IMAGE_PANEL,
      elapsedMs: 150_000,
    })?.percent).toBe(90)
  })

  it('slowly climbs after 90 percent and marks overtime after the tail window', () => {
    const tail = calculateEstimatedTaskProgress({
      phase: 'processing',
      taskType: TASK_TYPE.VIDEO_PANEL,
      elapsedMs: 180_000,
    })
    expect(tail?.percent).toBeGreaterThan(90)
    expect(tail?.percent).toBeLessThan(100)
    expect(tail?.isOvertime).toBe(false)

    const overtime = calculateEstimatedTaskProgress({
      phase: 'processing',
      taskType: TASK_TYPE.VIDEO_PANEL,
      elapsedMs: 226_000,
    })
    expect(overtime?.percent).toBe(99)
    expect(overtime?.isOvertime).toBe(true)
  })

  it('never reaches 100 percent while the task is still running', () => {
    const running = calculateEstimatedTaskProgress({
      phase: 'processing',
      taskType: TASK_TYPE.IMAGE_PANEL,
      elapsedMs: 1_000_000,
    })

    expect(running?.percent).toBe(99)
    expect(running?.isRunning).toBe(true)
    expect(running?.isCompleted).toBe(false)
    expect(running?.isOvertime).toBe(true)
  })

  it('marks terminal states without showing running progress', () => {
    const completed = calculateEstimatedTaskProgress({
      phase: 'completed',
      taskType: TASK_TYPE.MUSIC_GENERATE,
      elapsedMs: 80_000,
    })
    expect(completed?.percent).toBe(100)
    expect(completed?.isCompleted).toBe(true)
    expect(completed?.isRunning).toBe(false)

    const failed = calculateEstimatedTaskProgress({
      phase: 'failed',
      taskType: TASK_TYPE.MUSIC_GENERATE,
      elapsedMs: 20_000,
    })
    expect(failed?.percent).toBe(0)
    expect(failed?.isFailed).toBe(true)
    expect(failed?.isRunning).toBe(false)
  })
})
