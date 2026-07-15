import { describe, expect, it } from 'vitest'
import { isBillableTaskType } from '@/lib/billing/task-policy'
import { TASK_DEFINITIONS } from '@/lib/task/definition'
import { TASK_TYPE } from '@/lib/task/types'
import { getQueueTypeByTaskType } from '@/lib/task/queues'
import { getTaskMaxAttempts } from '@/lib/task/retry-policy'

describe('TaskDefinition conformance', () => {
  it('registers every TaskType exactly once and drives queue/retry policy', () => {
    const taskTypes = Object.values(TASK_TYPE).sort()
    expect(Object.keys(TASK_DEFINITIONS).sort()).toEqual(taskTypes)
    for (const taskType of taskTypes) {
      const definition = TASK_DEFINITIONS[taskType]
      expect(getQueueTypeByTaskType(taskType)).toBe(definition.queue)
      expect(getTaskMaxAttempts(taskType)).toBe(definition.maxAttempts)
      expect(definition.workerHandler.length).toBeGreaterThan(0)
      expect(['none', 'text', 'image', 'video', 'music']).toContain(definition.billingPolicy)
      expect(isBillableTaskType(taskType)).toBe(definition.billingPolicy !== 'none')
      expect(definition.executionProtocol).toBe('handler_result_checkpoint')
      expect(definition.terminalSuccessHandoff).toBe('handler_result_checkpoint')
      expect(['none', 'chapter_render', 'final_video_render']).toContain(definition.submissionTargetOwnership)
      expect(['none', 'edit_pipeline', 'edit_style_preview', 'project_assets', 'global_assets', 'video_segments', 'episode']).toContain(definition.terminalResourceImpact)
      expect(['none', 'edit_bible', 'edit_style_preview', 'video_segment', 'chapter_render', 'final_video_render', 'music_score', 'bgm_design', 'edit_script', 'edit_shot_execution_plan']).toContain(definition.terminalFailureProjector)
      expect(['none', 'edit_bible', 'edit_style_preview', 'video_segment', 'chapter_render', 'final_video_render', 'music_score', 'bgm_design', 'edit_script', 'edit_shot_execution_plan']).toContain(definition.terminalCancelProjector)
    }
  })

  it('declares every current terminal failure projector without a default branch', () => {
    expect(TASK_DEFINITIONS.edit_source_script_generate.terminalFailureProjector).toBe('edit_bible')
    expect(TASK_DEFINITIONS.edit_bible_generate.terminalFailureProjector).toBe('edit_bible')
    expect(TASK_DEFINITIONS.edit_style_preview_image.terminalFailureProjector).toBe('edit_style_preview')
    expect(TASK_DEFINITIONS.video_segment.terminalFailureProjector).toBe('video_segment')
    expect(TASK_DEFINITIONS.edit_source_script_generate.terminalCancelProjector).toBe('edit_bible')
    expect(TASK_DEFINITIONS.edit_bible_generate.terminalCancelProjector).toBe('edit_bible')
    expect(TASK_DEFINITIONS.edit_style_preview_image.terminalCancelProjector).toBe('edit_style_preview')
    expect(TASK_DEFINITIONS.video_segment.terminalCancelProjector).toBe('video_segment')
    expect(TASK_DEFINITIONS.chapter_render.terminalCancelProjector).toBe('chapter_render')
    expect(TASK_DEFINITIONS.final_video_render.terminalCancelProjector).toBe('final_video_render')
    expect(TASK_DEFINITIONS.chapter_render.submissionTargetOwnership).toBe('chapter_render')
    expect(TASK_DEFINITIONS.final_video_render.submissionTargetOwnership).toBe('final_video_render')
    expect(TASK_DEFINITIONS.bgm_design_plan.terminalFailureProjector).toBe('bgm_design')
    expect(TASK_DEFINITIONS.bgm_design_plan.terminalCancelProjector).toBe('bgm_design')
    expect(TASK_DEFINITIONS.music_score_generate.terminalFailureProjector).toBe('music_score')
    expect(TASK_DEFINITIONS.music_score_generate.terminalCancelProjector).toBe('music_score')
    expect(TASK_DEFINITIONS.edit_script_generate.terminalFailureProjector).toBe('edit_script')
    expect(TASK_DEFINITIONS.edit_script_generate.terminalCancelProjector).toBe('edit_script')
    expect(TASK_DEFINITIONS.edit_shot_execution_plan_generate.terminalFailureProjector).toBe('edit_shot_execution_plan')
    expect(TASK_DEFINITIONS.edit_shot_execution_plan_generate.terminalCancelProjector).toBe('edit_shot_execution_plan')
  })

  it('declares terminal resource impact for write-producing and extraction-only Tasks', () => {
    expect(TASK_DEFINITIONS.video_segment.terminalResourceImpact).toBe('video_segments')
    expect(TASK_DEFINITIONS.image_character.terminalResourceImpact).toBe('project_assets')
    expect(TASK_DEFINITIONS.asset_hub_image.terminalResourceImpact).toBe('global_assets')
    expect(TASK_DEFINITIONS.edit_script_generate.terminalResourceImpact).toBe('edit_pipeline')
    expect(TASK_DEFINITIONS.final_video_render.terminalResourceImpact).toBe('video_segments')
    expect(TASK_DEFINITIONS.reference_character_description_extract.terminalResourceImpact).toBe('none')
    expect(TASK_DEFINITIONS.asset_hub_reference_character_description_extract.terminalResourceImpact).toBe('none')
  })
})
