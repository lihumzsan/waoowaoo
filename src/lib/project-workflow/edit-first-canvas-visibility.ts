import type {
  EditFirstWorkflowOperationId,
  EditFirstWorkflowState,
  EditFirstWorkflowStage,
} from './edit-first'

export interface EditFirstCanvasVisibility {
  readonly editScript: boolean
  readonly editAssetGroup: boolean
  readonly editShotExecutionPlan: boolean
  readonly storyboardPanels: boolean
  readonly videoPlan: boolean
  readonly bgmScore: boolean
  readonly finalTimeline: boolean
}

export const EDIT_FIRST_CANVAS_PENDING_WORKFLOW: EditFirstWorkflowState = {
  active: false,
  stage: 'not_started',
  blocking: {
    kind: 'none',
    reason: null,
  },
  nextAction: null,
  allowedOperationIds: [],
}

type OrderedEditFirstWorkflowStage = Exclude<EditFirstWorkflowStage, 'failed'>

const EDIT_FIRST_STAGE_RANK = {
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
} as const satisfies Record<OrderedEditFirstWorkflowStage, number>

function stageRank(stage: EditFirstWorkflowStage): number {
  if (stage === 'failed') return -1
  return EDIT_FIRST_STAGE_RANK[stage]
}

function stageAtLeast(stage: EditFirstWorkflowStage, threshold: OrderedEditFirstWorkflowStage): boolean {
  const currentRank = stageRank(stage)
  const thresholdRank = stageRank(threshold)
  return currentRank >= thresholdRank
}

function operationSet(workflow: EditFirstWorkflowState): ReadonlySet<EditFirstWorkflowOperationId> {
  return new Set(workflow.allowedOperationIds)
}

function canRunAnyOperation(
  operations: ReadonlySet<EditFirstWorkflowOperationId>,
  candidates: readonly EditFirstWorkflowOperationId[],
): boolean {
  return candidates.some((candidate) => operations.has(candidate))
}

export function resolveEditFirstCanvasVisibility(
  workflow: EditFirstWorkflowState,
): EditFirstCanvasVisibility {
  const operations = operationSet(workflow)
  const editScript = stageAtLeast(workflow.stage, 'ready_to_generate_edit_script')
    || canRunAnyOperation(operations, ['generate_edit_script'])

  const editAssetGroup = stageAtLeast(workflow.stage, 'ready_to_generate_assets')
    || canRunAnyOperation(operations, [
      'generate_edit_script_assets',
      'revise_edit_script_assets',
      'generate_edit_shot_execution_plan',
      'generate_edit_script_storyboard',
      'generate_edit_script_storyboard_images',
      'generate_episode_videos',
      'generate_episode_bgm_score',
      'render_final_video',
    ])

  const editShotExecutionPlan = stageAtLeast(workflow.stage, 'ready_to_generate_shot_execution_plan')
    || canRunAnyOperation(operations, [
      'generate_edit_shot_execution_plan',
      'generate_edit_script_storyboard',
      'generate_edit_script_storyboard_images',
      'generate_episode_videos',
      'generate_episode_bgm_score',
      'render_final_video',
    ])

  const storyboardPanels = stageAtLeast(workflow.stage, 'ready_to_generate_storyboard_images')
    || canRunAnyOperation(operations, [
      'generate_edit_script_storyboard_images',
      'generate_episode_videos',
      'generate_episode_bgm_score',
      'render_final_video',
    ])

  const videoPlan = stageAtLeast(workflow.stage, 'ready_to_generate_videos')
    || canRunAnyOperation(operations, [
      'generate_episode_videos',
      'generate_episode_bgm_score',
      'render_final_video',
    ])

  const bgmScore = stageAtLeast(workflow.stage, 'ready_to_generate_videos')
    || canRunAnyOperation(operations, [
      'generate_episode_bgm_score',
      'render_final_video',
    ])

  const finalTimeline = stageAtLeast(workflow.stage, 'ready_to_render_final')
    || canRunAnyOperation(operations, [
      'render_final_video',
    ])

  return {
    editScript,
    editAssetGroup,
    editShotExecutionPlan,
    storyboardPanels,
    videoPlan,
    bgmScore,
    finalTimeline,
  }
}
