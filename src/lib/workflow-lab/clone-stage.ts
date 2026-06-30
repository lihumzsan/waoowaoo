import type { EditFirstWorkflowStage } from '@/lib/project-workflow/edit-first'

const WORKFLOW_LAB_STAGE_ORDER: Record<EditFirstWorkflowStage, number> = {
  not_started: 0,
  ready_to_generate_screenplay: 1,
  screenplay_ready_for_review: 2,
  style_preview_generating: 3,
  needs_style_choice: 4,
  ready_to_generate_edit_script: 5,
  edit_script_generating: 6,
  ready_to_generate_assets: 7,
  assets_generating: 8,
  assets_ready_for_review: 9,
  ready_to_generate_shot_execution_plan: 10,
  ready_to_generate_storyboard: 11,
  storyboard_generating: 12,
  ready_to_generate_storyboard_images: 13,
  storyboard_images_generating: 14,
  ready_to_generate_videos: 15,
  videos_generating: 16,
  ready_to_generate_bgm_score: 17,
  bgm_score_generating: 18,
  ready_to_render_final: 19,
  final_rendering: 20,
  completed: 21,
  failed: 22,
}

export function workflowLabStageAtLeast(stage: EditFirstWorkflowStage, threshold: EditFirstWorkflowStage): boolean {
  return WORKFLOW_LAB_STAGE_ORDER[stage] >= WORKFLOW_LAB_STAGE_ORDER[threshold]
}

export function shouldWorkflowLabCloneScreenplay(stage: EditFirstWorkflowStage): boolean {
  return workflowLabStageAtLeast(stage, 'screenplay_ready_for_review')
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

export function resolveWorkflowLabScreenplayStatus(stage: EditFirstWorkflowStage, sourceStatus: string): string {
  if (!shouldWorkflowLabCloneScreenplay(stage)) return sourceStatus
  if (!shouldWorkflowLabCloneStylePreviews(stage)) return 'screenplay_ready'
  if (!workflowLabStageAtLeast(stage, 'ready_to_generate_edit_script')) return 'style_preview_ready'
  return 'ready'
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
