import { describe, expect, it } from 'vitest'
import { TASK_TYPE } from '@/lib/task/types'
import { getWorkflowDefinition, resolveWorkflowRetryInvalidationStepKeys } from '@/lib/workflow-engine/registry'

describe('workflow registry', () => {
  it('returns stable workflow definitions for run-centric flows', () => {
    const storyToScript = getWorkflowDefinition(TASK_TYPE.STORY_TO_SCRIPT_RUN)
    const scriptToStoryboard = getWorkflowDefinition(TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN)

    expect(storyToScript?.orderedSteps.map((step) => step.key)).toEqual([
      'analyze_characters',
      'analyze_locations',
      'analyze_props',
      'split_clips',
      'screenplay_convert',
      'persist_script_artifacts',
    ])
    expect(scriptToStoryboard?.orderedSteps.map((step) => step.key)).toEqual([
      'plan_panels',
      'detail_panels',
      'voice_analyze',
      'persist_storyboard_artifacts',
    ])
  })

  it('invalidates downstream story-to-script screenplay steps when split inputs change', () => {
    expect(resolveWorkflowRetryInvalidationStepKeys({
      workflowType: TASK_TYPE.STORY_TO_SCRIPT_RUN,
      stepKey: 'analyze_props',
      existingStepKeys: ['analyze_props', 'split_clips', 'screenplay_clip-a', 'screenplay_clip-b'],
    }).sort()).toEqual([
      'analyze_props',
      'screenplay_clip-a',
      'screenplay_clip-b',
      'split_clips',
    ])
  })

  it('invalidates only the affected storyboard branch plus voice analyze', () => {
    expect(resolveWorkflowRetryInvalidationStepKeys({
      workflowType: TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN,
      stepKey: 'clip_clip-1_phase2_cinematography',
      existingStepKeys: [
        'clip_clip-1_phase1',
        'clip_clip-1_phase2_cinematography',
        'clip_clip-1_phase2_acting',
        'clip_clip-1_phase3_detail',
        'clip_clip-2_phase3_detail',
        'voice_analyze',
      ],
    }).sort()).toEqual([
      'clip_clip-1_phase2_cinematography',
      'clip_clip-1_phase3_detail',
      'voice_analyze',
    ])
  })
})
