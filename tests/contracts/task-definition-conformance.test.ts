import { describe, expect, it } from 'vitest'
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
      expect(definition.executionProtocol).toBe('handler_result_checkpoint')
      expect(definition.terminalSuccessHandoff).toBe('handler_result_checkpoint')
      expect(['none', 'edit_bible', 'edit_style_preview', 'video_group', 'chapter_render', 'final_video_render']).toContain(definition.terminalFailureProjector)
      expect(['none', 'edit_bible', 'edit_style_preview', 'video_group', 'chapter_render', 'final_video_render']).toContain(definition.terminalCancelProjector)
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
  })
})
