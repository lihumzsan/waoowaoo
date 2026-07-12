import type { EditFirstWorkflowStage } from '@/lib/project-workflow/edit-first'
import { GOLDEN_EDIT_FIRST_WORKFLOW_STAGES } from './stages'

export type GoldenTransitionTrigger = 'system' | 'choice' | 'task' | 'terminal'

export interface GoldenWorkflowTransitionContract {
  readonly from: EditFirstWorkflowStage
  readonly to: EditFirstWorkflowStage | null
  readonly trigger: GoldenTransitionTrigger
}

const CHOICE_STAGES = new Set<EditFirstWorkflowStage>([
  'not_started',
  'script_ready_for_review',
  'bible_ready_for_review',
  'needs_style_choice',
  'assets_ready_for_review',
])

const TASK_STAGES = new Set<EditFirstWorkflowStage>([
  'script_generating',
  'bible_generating',
  'style_preview_generating',
  'edit_script_generating',
  'assets_generating',
  'storyboard_generating',
  'storyboard_images_generating',
  'videos_generating',
  'chapters_rendering',
  'bgm_score_generating',
  'soundscape_planning',
  'audio_layers_generating',
  'final_rendering',
])

export const GOLDEN_WORKFLOW_TRANSITIONS: readonly GoldenWorkflowTransitionContract[] =
  GOLDEN_EDIT_FIRST_WORKFLOW_STAGES.map((stage, index) => {
    if (stage === 'completed' || stage === 'failed') {
      return { from: stage, to: null, trigger: 'terminal' }
    }
    const to = GOLDEN_EDIT_FIRST_WORKFLOW_STAGES[index + 1]
    if (!to) throw new Error(`GOLDEN_WORKFLOW_TRANSITION_TARGET_MISSING:${stage}`)
    return {
      from: stage,
      to,
      trigger: CHOICE_STAGES.has(stage) ? 'choice' : TASK_STAGES.has(stage) ? 'task' : 'system',
    }
  })

export function goldenNextWorkflowStage(stage: EditFirstWorkflowStage): EditFirstWorkflowStage | null {
  const transition = GOLDEN_WORKFLOW_TRANSITIONS.find((candidate) => candidate.from === stage)
  if (!transition) throw new Error(`GOLDEN_WORKFLOW_TRANSITION_UNDECLARED:${stage}`)
  return transition.to
}
