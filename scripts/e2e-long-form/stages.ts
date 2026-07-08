import type { EditFirstWorkflowStage } from '@/lib/project-workflow/edit-first'
import type { E2eTargetStageDefinition, E2eTargetStageId } from './types'

export const EDIT_FIRST_WORKFLOW_STAGE_ORDER: readonly EditFirstWorkflowStage[] = [
  'not_started',
  'ready_to_ingest_script',
  'bible_generating',
  'bible_ready_for_review',
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
  'ready_to_render_final',
  'final_rendering',
  'completed',
  'failed',
] as const

const STAGE_RANK = new Map<EditFirstWorkflowStage, number>(
  EDIT_FIRST_WORKFLOW_STAGE_ORDER.map((stage, index) => [stage, index]),
)

export const E2E_TARGET_STAGES: readonly E2eTargetStageDefinition[] = [
  { id: 'source_ingested', label: 'source document submitted', minimumWorkflowStage: 'bible_generating' },
  { id: 'bible_ready', label: 'episode bible ready for review', minimumWorkflowStage: 'bible_ready_for_review' },
  { id: 'bible_confirmed', label: 'episode bible confirmed', minimumWorkflowStage: 'style_preview_generating' },
  { id: 'style_previews_ready', label: 'style previews ready for choice', minimumWorkflowStage: 'needs_style_choice' },
  { id: 'style_selected', label: 'style preview selected', minimumWorkflowStage: 'ready_to_generate_edit_script' },
  { id: 'core_edit_ready', label: 'chapter core edit plans ready', minimumWorkflowStage: 'ready_to_generate_assets' },
  { id: 'assets_ready', label: 'required assets ready for review', minimumWorkflowStage: 'assets_ready_for_review' },
  { id: 'assets_approved', label: 'required assets approved', minimumWorkflowStage: 'ready_to_generate_shot_execution_plan' },
  { id: 'shot_plan_ready', label: 'shot execution plans ready', minimumWorkflowStage: 'ready_to_generate_storyboard' },
  { id: 'storyboard_ready', label: 'storyboard camera plans ready', minimumWorkflowStage: 'ready_to_generate_storyboard_images' },
  { id: 'storyboard_images_ready', label: 'storyboard images ready', minimumWorkflowStage: 'ready_to_generate_videos', requiresRealGeneration: true },
  { id: 'video_plan_ready', label: 'video generation plan ready', minimumWorkflowStage: 'ready_to_generate_videos' },
  { id: 'videos_ready', label: 'shot videos ready', minimumWorkflowStage: 'ready_to_render_chapters', requiresRealGeneration: true },
  { id: 'chapters_rendered', label: 'chapter renders ready', minimumWorkflowStage: 'ready_to_generate_bgm_score', requiresRealGeneration: true },
  { id: 'music_ready', label: 'episode music score ready', minimumWorkflowStage: 'ready_to_render_final', requiresRealGeneration: true },
  { id: 'final_video_ready', label: 'final episode video ready', minimumWorkflowStage: 'completed', requiresRealGeneration: true },
] as const

const TARGET_STAGE_BY_ID = new Map(E2E_TARGET_STAGES.map((stage) => [stage.id, stage]))

export function getE2eTargetStage(id: E2eTargetStageId): E2eTargetStageDefinition {
  const stage = TARGET_STAGE_BY_ID.get(id)
  if (!stage) throw new Error(`E2E_TARGET_STAGE_UNKNOWN:${id}`)
  return stage
}

export function isWorkflowStageAtLeast(current: EditFirstWorkflowStage, minimum: EditFirstWorkflowStage): boolean {
  if (current === 'failed') return false
  const currentRank = STAGE_RANK.get(current)
  const minimumRank = STAGE_RANK.get(minimum)
  if (currentRank === undefined || minimumRank === undefined) {
    throw new Error(`E2E_WORKFLOW_STAGE_RANK_MISSING:${current}:${minimum}`)
  }
  return currentRank >= minimumRank
}

export function isTargetStageReached(input: {
  readonly currentWorkflowStage: EditFirstWorkflowStage
  readonly target: E2eTargetStageId
}): boolean {
  const target = getE2eTargetStage(input.target)
  return isWorkflowStageAtLeast(input.currentWorkflowStage, target.minimumWorkflowStage)
}

export function listE2eTargetStageIds(): E2eTargetStageId[] {
  return E2E_TARGET_STAGES.map((stage) => stage.id)
}
