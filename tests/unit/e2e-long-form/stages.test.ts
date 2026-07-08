import { describe, expect, it } from 'vitest'
import { isTargetStageReached, listE2eTargetStageIds } from '../../../scripts/e2e-long-form/stages'

describe('long-form E2E target stages', () => {
  it('keeps final video as the terminal selectable target', () => {
    expect(listE2eTargetStageIds()).toContain('final_video_ready')
  })

  it('treats later workflow stages as satisfying earlier targets', () => {
    expect(isTargetStageReached({
      currentWorkflowStage: 'ready_to_generate_videos',
      target: 'video_plan_ready',
    })).toBe(true)
    expect(isTargetStageReached({
      currentWorkflowStage: 'ready_to_generate_videos',
      target: 'final_video_ready',
    })).toBe(false)
  })

  it('never treats failed workflow as a reached target', () => {
    expect(isTargetStageReached({
      currentWorkflowStage: 'failed',
      target: 'bible_ready',
    })).toBe(false)
  })
})
