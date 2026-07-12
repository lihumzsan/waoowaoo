import type { EditFirstWorkflowStage } from '@/lib/project-workflow/edit-first'

export const GOLDEN_EDIT_FIRST_WORKFLOW_STAGES = [
  'not_started',
  'ready_to_ingest_script',
  'script_generating',
  'script_ready_for_review',
  'ready_to_generate_bible',
  'bible_generating',
  'bible_ready_for_review',
  'ready_to_generate_style_previews',
  'style_preview_generating',
  'needs_style_choice',
  'ready_to_generate_edit_script',
  'edit_script_generating',
  'ready_to_generate_assets',
  'assets_generating',
  'assets_ready_for_review',
  'ready_to_generate_shot_execution_plan',
  'ready_to_generate_storyboard',
  'storyboard_generating',
  'ready_to_generate_storyboard_images',
  'storyboard_images_generating',
  'ready_to_generate_videos',
  'videos_generating',
  'ready_to_render_chapters',
  'chapters_rendering',
  'ready_to_generate_bgm_score',
  'bgm_score_generating',
  'ready_to_generate_audio_layers',
  'soundscape_planning',
  'ready_to_generate_soundscape',
  'audio_layers_generating',
  'ready_to_render_final',
  'final_rendering',
  'completed',
  'failed',
] as const satisfies readonly EditFirstWorkflowStage[]

type MissingProductionStage = Exclude<
  EditFirstWorkflowStage,
  (typeof GOLDEN_EDIT_FIRST_WORKFLOW_STAGES)[number]
>
type UnknownGoldenStage = Exclude<
  (typeof GOLDEN_EDIT_FIRST_WORKFLOW_STAGES)[number],
  EditFirstWorkflowStage
>
const GOLDEN_STAGE_LIST_IS_EXHAUSTIVE: [MissingProductionStage, UnknownGoldenStage] extends [never, never]
  ? true
  : never = true
void GOLDEN_STAGE_LIST_IS_EXHAUSTIVE

export const GOLDEN_CHECKPOINTABLE_STAGES = [
  'ready_to_ingest_script',
  'script_ready_for_review',
  'ready_to_generate_bible',
  'bible_ready_for_review',
  'needs_style_choice',
  'ready_to_generate_edit_script',
  'ready_to_generate_assets',
  'assets_ready_for_review',
  'ready_to_generate_shot_execution_plan',
  'ready_to_generate_storyboard',
  'ready_to_generate_storyboard_images',
  'ready_to_generate_videos',
] as const satisfies readonly EditFirstWorkflowStage[]
