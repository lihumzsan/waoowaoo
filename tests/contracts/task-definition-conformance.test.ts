import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isBillableTaskType } from '@/lib/billing/task-policy'
import { TASK_DEFINITIONS } from '@/lib/task/definition'
import { TASK_TYPE } from '@/lib/task/types'
import { getQueueTypeByTaskType } from '@/lib/task/queues'
import { getTaskMaxAttempts } from '@/lib/task/retry-policy'

describe('TaskDefinition conformance', () => {
  it('declares one complete Task contract without spread-based hidden defaults', () => {
    const source = readFileSync(new URL('../../src/lib/task/definition.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/\.\.\.(?:NONE|target)/)
    expect(source).not.toContain('const NONE =')
    expect(source).not.toContain('const target =')
  })

  it('registers every TaskType exactly once and drives queue/retry policy', () => {
    const taskTypes = Object.values(TASK_TYPE).sort()
    expect(Object.keys(TASK_DEFINITIONS).sort()).toEqual(taskTypes)
    for (const taskType of taskTypes) {
      const definition = TASK_DEFINITIONS[taskType]
      expect(getQueueTypeByTaskType(taskType)).toBe(definition.queue)
      expect(getTaskMaxAttempts(taskType)).toBe(definition.maxAttempts)
      expect(definition.workerHandler.length).toBeGreaterThan(0)
      expect(['none', 'text', 'image', 'video', 'music', 'sound_effect']).toContain(definition.billingPolicy)
      expect(isBillableTaskType(taskType)).toBe(definition.billingPolicy !== 'none')
      expect(['edit_bible', 'episode_data']).toContain(definition.materializer)
      expect(definition.executionProtocol).toBe('handler_result_checkpoint')
      expect(definition.terminalSuccessHandoff).toBe('handler_result_checkpoint')
      expect(['none', 'chapter_render', 'final_video_render']).toContain(definition.submissionTargetOwnership)
      expect(['none', 'edit_bible', 'edit_style_preview', 'video_group', 'chapter_render', 'final_video_render', 'music_score', 'soundscape', 'edit_script', 'edit_shot_execution_plan']).toContain(definition.terminalFailureProjector)
      expect(['none', 'edit_bible', 'edit_style_preview', 'video_group', 'chapter_render', 'final_video_render', 'music_score', 'soundscape', 'edit_script', 'edit_shot_execution_plan']).toContain(definition.terminalCancelProjector)
    }
  })

  it('removes TaskType routing switches from workers, billing, and materialization', () => {
    for (const file of [
      '../../src/lib/workers/image.worker.ts',
      '../../src/lib/workers/video.worker.ts',
      '../../src/lib/workers/music.worker.ts',
      '../../src/lib/workers/text.worker.ts',
      '../../src/lib/billing/task-policy.ts',
      '../../src/lib/workspace-resource/materialized-resource.ts',
    ]) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(source).not.toMatch(/switch \(job\.data\.type\)/)
      expect(source).not.toMatch(/switch \(taskType\)/)
    }
  })

  it('declares every current terminal failure projector without a default branch', () => {
    expect(TASK_DEFINITIONS.edit_source_script_generate.terminalFailureProjector).toBe('edit_bible')
    expect(TASK_DEFINITIONS.edit_bible_generate.terminalFailureProjector).toBe('edit_bible')
    expect(TASK_DEFINITIONS.edit_style_preview_image.terminalFailureProjector).toBe('edit_style_preview')
    expect(TASK_DEFINITIONS.video_group.terminalFailureProjector).toBe('video_group')
    expect(TASK_DEFINITIONS.edit_source_script_generate.terminalCancelProjector).toBe('edit_bible')
    expect(TASK_DEFINITIONS.edit_bible_generate.terminalCancelProjector).toBe('edit_bible')
    expect(TASK_DEFINITIONS.edit_style_preview_image.terminalCancelProjector).toBe('edit_style_preview')
    expect(TASK_DEFINITIONS.video_group.terminalCancelProjector).toBe('video_group')
    expect(TASK_DEFINITIONS.chapter_render.terminalCancelProjector).toBe('chapter_render')
    expect(TASK_DEFINITIONS.final_video_render.terminalCancelProjector).toBe('final_video_render')
    expect(TASK_DEFINITIONS.chapter_render.submissionTargetOwnership).toBe('chapter_render')
    expect(TASK_DEFINITIONS.final_video_render.submissionTargetOwnership).toBe('final_video_render')
    expect(TASK_DEFINITIONS.music_score_plan.terminalFailureProjector).toBe('music_score')
    expect(TASK_DEFINITIONS.music_score_plan.terminalCancelProjector).toBe('music_score')
    expect(TASK_DEFINITIONS.soundscape_plan.terminalFailureProjector).toBe('soundscape')
    expect(TASK_DEFINITIONS.soundscape_plan.terminalCancelProjector).toBe('soundscape')
    expect(TASK_DEFINITIONS.soundscape_generate.terminalFailureProjector).toBe('soundscape')
    expect(TASK_DEFINITIONS.soundscape_generate.terminalCancelProjector).toBe('soundscape')
    expect(TASK_DEFINITIONS.edit_script_generate.terminalFailureProjector).toBe('edit_script')
    expect(TASK_DEFINITIONS.edit_script_generate.terminalCancelProjector).toBe('edit_script')
    expect(TASK_DEFINITIONS.edit_shot_execution_plan_generate.terminalFailureProjector).toBe('edit_shot_execution_plan')
    expect(TASK_DEFINITIONS.edit_shot_execution_plan_generate.terminalCancelProjector).toBe('edit_shot_execution_plan')
  })
})
