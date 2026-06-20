import type { EditFirstWorkflowStage } from '@/lib/project-workflow/edit-first'

const WORKFLOW_LAB_STAGE_ORDER: Record<EditFirstWorkflowStage, number> = {
  not_started: 0,
  ready_to_generate_screenplay: 1,
  screenplay_ready_for_review: 2,
  style_preview_generating: 3,
  needs_style_choice: 4,
  ready_to_generate_director_decoupage: 5,
  ready_to_generate_edit_script: 6,
  edit_script_generating: 7,
  ready_to_generate_assets: 8,
  assets_generating: 9,
  assets_ready_for_review: 10,
  ready_to_generate_cinematography: 11,
  ready_to_generate_storyboard_spatial_blocking: 12,
  storyboard_spatial_blocking_generating: 13,
  ready_to_generate_storyboard: 14,
  storyboard_generating: 15,
  ready_to_generate_storyboard_images: 16,
  storyboard_images_generating: 17,
  ready_to_generate_videos: 18,
  videos_generating: 19,
  ready_to_render_final: 20,
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

export function shouldWorkflowLabCloneDirectorDecoupage(stage: EditFirstWorkflowStage): boolean {
  return workflowLabStageAtLeast(stage, 'ready_to_generate_edit_script')
}

export function shouldWorkflowLabCloneEditScript(stage: EditFirstWorkflowStage): boolean {
  return workflowLabStageAtLeast(stage, 'ready_to_generate_assets')
}

export function shouldWorkflowLabCloneCinematography(stage: EditFirstWorkflowStage): boolean {
  return workflowLabStageAtLeast(stage, 'ready_to_generate_storyboard_spatial_blocking')
}

export function shouldWorkflowLabCloneStoryboards(stage: EditFirstWorkflowStage): boolean {
  return workflowLabStageAtLeast(stage, 'ready_to_generate_storyboard_images')
}

export function shouldWorkflowLabCloneVideos(stage: EditFirstWorkflowStage): boolean {
  return workflowLabStageAtLeast(stage, 'ready_to_render_final')
}

export function resolveWorkflowLabScreenplayStatus(stage: EditFirstWorkflowStage, sourceStatus: string): string {
  if (!shouldWorkflowLabCloneScreenplay(stage)) return sourceStatus
  if (!shouldWorkflowLabCloneStylePreviews(stage)) return 'screenplay_ready'
  if (!workflowLabStageAtLeast(stage, 'ready_to_generate_director_decoupage')) return 'style_preview_ready'
  return 'ready'
}

export function resolveWorkflowLabStylePreviewStatus(stage: EditFirstWorkflowStage, sourceStatus: string): string {
  if (stage === 'needs_style_choice' && sourceStatus === 'confirmed') return 'completed'
  return sourceStatus
}

export function resolveWorkflowLabEditAssetReviewStatus(stage: EditFirstWorkflowStage, sourceStatus: string): string {
  if (!workflowLabStageAtLeast(stage, 'ready_to_generate_cinematography')) return 'pending'
  return sourceStatus === 'approved' ? sourceStatus : 'approved'
}

export function shouldWorkflowLabKeepAssetRequirementTarget(stage: EditFirstWorkflowStage): boolean {
  return workflowLabStageAtLeast(stage, 'assets_ready_for_review')
}
