export const EDIT_FIRST_WORKFLOW_OPERATION_IDS = [
  'ingest_script',
  'revise_bible',
  'generate_edit_style_previews',
  'plan_chapters',
  'generate_edit_script',
  'replan_chapter',
  'generate_edit_script_assets',
  'revise_edit_script_assets',
  'generate_edit_shot_execution_plan',
  'generate_edit_script_storyboard',
  'generate_edit_script_storyboard_images',
  'generate_episode_videos',
  'render_chapters',
  'generate_episode_bgm_score',
  'render_final_video',
] as const

export type EditFirstWorkflowOperationId = (typeof EDIT_FIRST_WORKFLOW_OPERATION_IDS)[number]

export const EDIT_FIRST_AUTO_APPROVED_OPERATION_IDS = [
  'generate_edit_style_previews',
  'plan_chapters',
  'generate_edit_script',
  'replan_chapter',
  'generate_edit_script_assets',
  'revise_edit_script_assets',
  'generate_edit_shot_execution_plan',
  'generate_edit_script_storyboard',
  'generate_episode_bgm_score',
  'render_chapters',
] as const satisfies readonly EditFirstWorkflowOperationId[]

const EDIT_FIRST_AUTO_APPROVED_OPERATION_ID_SET: ReadonlySet<string> = new Set(EDIT_FIRST_AUTO_APPROVED_OPERATION_IDS)

export function isEditFirstAutoApprovedOperationId(operationId: string): boolean {
  return EDIT_FIRST_AUTO_APPROVED_OPERATION_ID_SET.has(operationId)
}
