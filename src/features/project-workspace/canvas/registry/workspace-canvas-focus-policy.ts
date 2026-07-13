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
  generate_edit_script_storyboard_images: ['shot'],
  generate_episode_videos: ['videoPlan'],
  generate_episode_videos_auto: ['videoPlan'],
  generate_panel_video: ['videoPlan'],
  generate_video_group: ['videoPlan'],
  plan_episode_bgm_score: ['bgmScore'],
  generate_episode_bgm_score: ['bgmScore'],
  generate_episode_soundscape: ['soundscape'],
  plan_episode_soundscape: ['soundscape'],
  generate_project_music: ['bgmScore'],
  render_chapters: ['finalTimeline', 'videoPlan'],
  render_final_video: ['finalTimeline'],
}

export const WORKSPACE_CANVAS_RUNNING_FOCUS_KIND_PRIORITY = [
  'editSourceScript',
  'editBible',
  'editScript',
  'editAssetGroup',
  'editShotExecutionPlan',
  'editPipelineStep',
  'shot',
  'videoPlan',
  'bgmScore',
  'soundscape',
  'finalTimeline',
] as const satisfies readonly WorkspaceCanvasNodeKind[]

export function getWorkspaceCanvasOperationFocusKindPriority(operationId: string | null | undefined): readonly WorkspaceCanvasNodeKind[] | null {
  return operationId ? (WORKSPACE_CANVAS_OPERATION_FOCUS_KIND_PRIORITY[operationId] ?? null) : null
}
