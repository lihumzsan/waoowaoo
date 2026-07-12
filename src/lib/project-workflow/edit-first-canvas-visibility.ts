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
  readonly soundscape: boolean
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
  operationGroup: null,
}

type OrderedEditFirstWorkflowStage = Exclude<EditFirstWorkflowStage, 'failed'>

const EDIT_FIRST_STAGE_RANK = {
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
  bgm_score_generating: 25,
  ready_to_generate_audio_layers: 26,
  soundscape_planning: 27,
  ready_to_generate_soundscape: 28,
  audio_layers_generating: 29,
  ready_to_render_final: 30,
  final_rendering: 31,
  completed: 32,
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

  const editAssetGroup = stageAtLeast(workflow.stage, 'ready_to_generate_style_previews')
    || canRunAnyOperation(operations, [
      'generate_edit_script_assets',
      'revise_edit_script_assets',
      'generate_edit_shot_execution_plan',
      'generate_edit_script_storyboard',
      'generate_edit_script_storyboard_images',
      'generate_episode_videos',
      'render_chapters',
      'generate_episode_bgm_score',
      'plan_episode_soundscape',
      'generate_episode_soundscape',
      'render_final_video',
    ])

  const editShotExecutionPlan = stageAtLeast(workflow.stage, 'ready_to_generate_shot_execution_plan')
    || canRunAnyOperation(operations, [
      'generate_edit_shot_execution_plan',
      'generate_edit_script_storyboard',
      'generate_edit_script_storyboard_images',
      'generate_episode_videos',
      'render_chapters',
      'generate_episode_bgm_score',
      'plan_episode_soundscape',
      'generate_episode_soundscape',
      'render_final_video',
    ])

  const storyboardPanels = stageAtLeast(workflow.stage, 'ready_to_generate_storyboard_images')
    || canRunAnyOperation(operations, [
      'generate_edit_script_storyboard_images',
      'generate_episode_videos',
      'render_chapters',
      'generate_episode_bgm_score',
      'plan_episode_soundscape',
      'generate_episode_soundscape',
      'render_final_video',
    ])

  const videoPlan = stageAtLeast(workflow.stage, 'ready_to_generate_videos')
    || canRunAnyOperation(operations, [
      'generate_episode_videos',
      'render_chapters',
      'generate_episode_bgm_score',
      'plan_episode_soundscape',
      'generate_episode_soundscape',
      'render_final_video',
    ])

  const bgmScore = stageAtLeast(workflow.stage, 'ready_to_generate_videos')
    || canRunAnyOperation(operations, [
      'generate_episode_bgm_score',
      'plan_episode_soundscape',
      'generate_episode_soundscape',
      'render_final_video',
    ])

  const soundscape = stageAtLeast(workflow.stage, 'ready_to_generate_videos')
    || canRunAnyOperation(operations, [
      'generate_episode_bgm_score',
      'plan_episode_soundscape',
      'generate_episode_soundscape',
      'render_final_video',
    ])

  const finalTimeline = stageAtLeast(workflow.stage, 'ready_to_render_final')
    || canRunAnyOperation(operations, [
      'render_chapters',
      'render_final_video',
    ])

  return {
    editScript,
    editAssetGroup,
    editShotExecutionPlan,
    storyboardPanels,
    videoPlan,
    bgmScore,
    soundscape,
    finalTimeline,
  }
}
