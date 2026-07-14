import type {
  EditFirstWorkflowStatusKind,
  EditFirstWorkflowStep,
} from '@/lib/project-workflow/edit-first-view'

export const GOLDEN_EDIT_FIRST_WORKFLOW_STEPS = [
  'unavailable',
  'script_intake',
  'source_script',
  'episode_plan',
  'visual_style',
  'chapter_plan',
  'planned_assets',
  'shot_execution',
  'video_segments',
  'chapter_render',
  'audio_plan',
  'audio_generation',
  'final_render',
] as const satisfies readonly EditFirstWorkflowStep[]

export const GOLDEN_EDIT_FIRST_WORKFLOW_STATUSES = [
  'inactive',
  'ready',
  'processing',
  'needs_user_choice',
  'failed',
  'completed',
] as const satisfies readonly EditFirstWorkflowStatusKind[]

type MissingProductionStep = Exclude<
  EditFirstWorkflowStep,
  (typeof GOLDEN_EDIT_FIRST_WORKFLOW_STEPS)[number]
>
type UnknownGoldenStep = Exclude<
  (typeof GOLDEN_EDIT_FIRST_WORKFLOW_STEPS)[number],
  EditFirstWorkflowStep
>
type MissingProductionStatus = Exclude<
  EditFirstWorkflowStatusKind,
  (typeof GOLDEN_EDIT_FIRST_WORKFLOW_STATUSES)[number]
>
type UnknownGoldenStatus = Exclude<
  (typeof GOLDEN_EDIT_FIRST_WORKFLOW_STATUSES)[number],
  EditFirstWorkflowStatusKind
>
const GOLDEN_WORKFLOW_LISTS_ARE_EXHAUSTIVE: [
  MissingProductionStep,
  UnknownGoldenStep,
  MissingProductionStatus,
  UnknownGoldenStatus,
] extends [never, never, never, never] ? true : never = true
void GOLDEN_WORKFLOW_LISTS_ARE_EXHAUSTIVE
