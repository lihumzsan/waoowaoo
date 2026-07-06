import type { EditFirstWorkflowStage } from '@/lib/project-workflow/edit-first'

const WORKFLOW_LAB_STAGE_ORDER: Record<EditFirstWorkflowStage, number> = {
  not_started: 0,
  ready_to_ingest_script: 1,
  bible_generating: 2,
  bible_ready_for_review: 3,
  style_preview_generating: 4,
  needs_style_choice: 5,
  ready_to_generate_edit_script: 6,
  edit_script_generating: 7,
  ready_to_generate_assets: 8,
  assets_generating: 9,
  assets_ready_for_review: 10,
  ready_to_generate_shot_execution_plan: 11,
  ready_to_generate_storyboard: 12,
  storyboard_generating: 13,
  ready_to_generate_storyboard_images: 14,
  storyboard_images_generating: 15,
  ready_to_generate_videos: 16,
  videos_generating: 17,
  ready_to_render_chapters: 18,
  chapters_rendering: 19,
  ready_to_generate_bgm_score: 20,
  bgm_score_generating: 21,
  ready_to_render_final: 22,
  final_rendering: 23,
  completed: 24,
  failed: 25,
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
  if (!shouldWorkflowLabCloneStylePreviews(stage)) return 'ready_for_review'
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
