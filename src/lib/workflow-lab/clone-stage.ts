import type { EditFirstWorkflowStage } from '@/lib/project-workflow/edit-first'

const WORKFLOW_LAB_STAGE_ORDER: Record<EditFirstWorkflowStage, number> = {
  not_started: 0,
  ready_to_ingest_script: 1,
  script_generating: 2,
  script_ready_for_review: 3,
  ready_to_generate_bible: 4,
  bible_generating: 5,
  bible_ready_for_review: 6,
  style_preview_generating: 7,
  needs_style_choice: 8,
  ready_to_generate_edit_script: 9,
  edit_script_generating: 10,
  ready_to_generate_assets: 11,
  assets_generating: 12,
  assets_ready_for_review: 13,
  ready_to_generate_shot_execution_plan: 14,
  ready_to_generate_storyboard: 15,
  storyboard_generating: 16,
  ready_to_generate_storyboard_images: 17,
  storyboard_images_generating: 18,
  ready_to_generate_videos: 19,
  videos_generating: 20,
  ready_to_render_chapters: 21,
  chapters_rendering: 22,
  ready_to_generate_bgm_score: 23,
  ready_to_generate_audio_layers: 24,
  bgm_score_generating: 25,
  audio_layers_generating: 26,
  ready_to_render_final: 27,
  final_rendering: 28,
  completed: 29,
  failed: 30,
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
