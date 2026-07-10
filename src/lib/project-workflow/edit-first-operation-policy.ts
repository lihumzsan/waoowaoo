export const EDIT_FIRST_WORKFLOW_OPERATION_IDS = [
  'ingest_script',
  'revise_script',
  'generate_bible_from_script',
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
  'generate_episode_soundscape',
  'render_final_video',
] as const

export type EditFirstWorkflowOperationId = (typeof EDIT_FIRST_WORKFLOW_OPERATION_IDS)[number]

export type EditFirstOperationApprovalKind = 'none' | 'billable_media'

export const EDIT_FIRST_OPERATION_APPROVAL_KINDS = {
  ingest_script: 'none',
  revise_script: 'none',
  generate_bible_from_script: 'none',
  revise_bible: 'none',
  generate_edit_style_previews: 'billable_media',
  plan_chapters: 'none',
  generate_edit_script: 'none',
  replan_chapter: 'none',
  generate_edit_script_assets: 'billable_media',
  revise_edit_script_assets: 'billable_media',
  generate_edit_shot_execution_plan: 'none',
  generate_edit_script_storyboard: 'none',
  generate_edit_script_storyboard_images: 'billable_media',
  generate_episode_videos: 'billable_media',
  render_chapters: 'none',
  generate_episode_bgm_score: 'billable_media',
  generate_episode_soundscape: 'billable_media',
  render_final_video: 'none',
} as const satisfies Record<EditFirstWorkflowOperationId, EditFirstOperationApprovalKind>

export function getEditFirstOperationApprovalKind(
  operationId: EditFirstWorkflowOperationId,
): EditFirstOperationApprovalKind {
  return EDIT_FIRST_OPERATION_APPROVAL_KINDS[operationId]
}
