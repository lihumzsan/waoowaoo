import type { EditFirstWorkflowStage } from '@/lib/project-workflow/edit-first'

const WORKFLOW_LAB_STAGE_ORDER: Record<EditFirstWorkflowStage, number> = {
  not_started: 0,
  ready_to_ingest_script: 1,
  script_generating: 2,
  script_ready_for_review: 3,
  ready_to_generate_bible: 4,
  bible_generating: 5,
  bible_ready_for_review: 6,
  ready_to_generate_style_previews: 7,
  style_preview_generating: 8,
  needs_style_choice: 9,
  ready_to_generate_edit_script: 10,
  edit_script_generating: 11,
  ready_to_generate_assets: 12,
  assets_generating: 13,
  assets_ready_for_review: 14,
  ready_to_generate_shot_execution_plan: 15,
  ready_to_generate_storyboard: 16,
  storyboard_generating: 17,
  ready_to_generate_storyboard_images: 18,
  storyboard_images_generating: 19,
  ready_to_generate_videos: 20,
  videos_generating: 21,
  ready_to_render_chapters: 22,
  chapters_rendering: 23,
  ready_to_generate_bgm_score: 24,
  ready_to_generate_audio_layers: 25,
  bgm_score_generating: 26,
  audio_layers_generating: 27,
  ready_to_render_final: 28,
  final_rendering: 29,
  completed: 30,
  failed: 31,
}

export function workflowLabStageAtLeast(stage: EditFirstWorkflowStage, threshold: EditFirstWorkflowStage): boolean {
  return WORKFLOW_LAB_STAGE_ORDER[stage] >= WORKFLOW_LAB_STAGE_ORDER[threshold]
}

export function shouldWorkflowLabCloneBible(stage: EditFirstWorkflowStage): boolean {
  return workflowLabStageAtLeast(stage, 'bible_ready_for_review')
}

export function shouldWorkflowLabCloneStylePreviews(stage: EditFirstWorkflowStage): boolean {
  return workflowLabStageAtLeast(stage, 'needs_style_choice')
}

export function shouldWorkflowLabCloneEditScript(stage: EditFirstWorkflowStage): boolean {
  return workflowLabStageAtLeast(stage, 'ready_to_generate_assets')
}

export function shouldWorkflowLabCloneShotExecutionPlan(stage: EditFirstWorkflowStage): boolean {
  return workflowLabStageAtLeast(stage, 'ready_to_generate_storyboard')
}

export function shouldWorkflowLabCloneStoryboards(stage: EditFirstWorkflowStage): boolean {
  return workflowLabStageAtLeast(stage, 'ready_to_generate_storyboard_images')
}

export function shouldWorkflowLabCloneVideos(stage: EditFirstWorkflowStage): boolean {
  return workflowLabStageAtLeast(stage, 'ready_to_generate_bgm_score')
}

export function resolveWorkflowLabBibleStatus(stage: EditFirstWorkflowStage, sourceStatus: string): string {
  if (!shouldWorkflowLabCloneBible(stage)) return sourceStatus
  if (!workflowLabStageAtLeast(stage, 'ready_to_generate_style_previews')) return 'ready_for_review'
  return 'confirmed'
}

export function resolveWorkflowLabStylePreviewStatus(stage: EditFirstWorkflowStage, sourceStatus: string): string {
  if (stage === 'needs_style_choice' && sourceStatus === 'confirmed') return 'completed'
  return sourceStatus
}

export function resolveWorkflowLabEditAssetReviewStatus(stage: EditFirstWorkflowStage, sourceStatus: string): string {
  if (!workflowLabStageAtLeast(stage, 'ready_to_generate_shot_execution_plan')) return 'pending'
  return sourceStatus === 'approved' ? sourceStatus : 'approved'
}

export function shouldWorkflowLabKeepAssetRequirementTarget(stage: EditFirstWorkflowStage): boolean {
  return workflowLabStageAtLeast(stage, 'assets_ready_for_review')
}
