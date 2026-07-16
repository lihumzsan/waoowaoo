import type { WorkspaceCanvasNodeKind } from '../node-canvas-types'

export const WORKSPACE_CANVAS_OPERATION_FOCUS_KIND_PRIORITY: Readonly<Record<string, readonly WorkspaceCanvasNodeKind[]>> = {
  ingest_script: ['editSourceScript'],
  revise_script: ['editSourceScript'],
  generate_bible_from_script: ['editBible'],
  revise_bible: ['editBible'],
  generate_edit_style_previews: ['editStyleBible', 'editBible'],
  generate_edit_style_preview_images: ['editStyleBible'],
  plan_chapters: ['editScript'],
  generate_edit_script: ['editScript'],
  generate_edit_script_assets: ['editAssetGroup'],
  generate_edit_shot_execution_plan: ['editShotExecutionPlan'],
  generate_video_segments: ['videoPlan'],
  plan_episode_bgm_design: ['bgmScore'],
  generate_episode_bgm_score: ['bgmScore'],
  generate_project_music: ['bgmScore'],
  render_chapters: ['resourceCard', 'videoPlan'],
  render_final_video: ['resourceCard'],
}

export const WORKSPACE_CANVAS_RUNNING_FOCUS_KIND_PRIORITY = [
  'editSourceScript',
  'editBible',
  'editScript',
  'editAssetGroup',
  'editShotExecutionPlan',
  'editPipelineStep',
  'videoPlan',
  'bgmScore',
  'resourceCard',
] as const satisfies readonly WorkspaceCanvasNodeKind[]

export function getWorkspaceCanvasOperationFocusKindPriority(operationId: string | null | undefined): readonly WorkspaceCanvasNodeKind[] | null {
  return operationId ? (WORKSPACE_CANVAS_OPERATION_FOCUS_KIND_PRIORITY[operationId] ?? null) : null
}
