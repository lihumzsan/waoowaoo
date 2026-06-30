import type {
  EditFirstWorkflowOperationId,
  EditFirstWorkflowState,
  EditFirstWorkflowStage,
} from './edit-first'

export interface EditFirstCanvasVisibility {
  readonly editScript: boolean
  readonly editAssetGroup: boolean
  readonly editShotExecutionPlan: boolean
  readonly storyboardPanelGeneration: boolean
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

  const storyboardPanelGeneration = stageAtLeast(workflow.stage, 'ready_to_generate_storyboard')
    || canRunAnyOperation(operations, [
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
    storyboardPanelGeneration,
    storyboardPanels,
    videoPlan,
    bgmScore,
    finalTimeline,
  }
}
