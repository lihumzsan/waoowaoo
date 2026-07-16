import type { EditFirstWorkflowOperationId } from './edit-first-operation-ids'
export {
  EDIT_FIRST_WORKFLOW_OPERATION_IDS,
  type EditFirstWorkflowOperationId,
} from './edit-first-operation-ids'

export const EDIT_FIRST_WORKFLOW_STEPS = [
  'unavailable',
  'script_intake',
  'source_script',
  'episode_plan',
  'visual_style',
  'chapter_plan',
  'planned_assets',
  'shot_execution',
  'video_segments',
  'chapter_render',
  'audio_plan',
  'audio_generation',
  'final_render',
] as const

export type EditFirstWorkflowStep = typeof EDIT_FIRST_WORKFLOW_STEPS[number]

export const EDIT_FIRST_WORKFLOW_STATUSES = [
  'inactive',
  'ready',
  'processing',
  'needs_user_choice',
  'failed',
  'completed',
] as const

export type EditFirstWorkflowStatusKind = typeof EDIT_FIRST_WORKFLOW_STATUSES[number]

export type EditFirstWorkflowStatus =
  | {
      readonly kind: 'inactive' | 'ready' | 'completed'
      readonly reason: null
    }
  | {
      readonly kind: 'processing' | 'needs_user_choice' | 'failed'
      readonly reason: string
    }

export interface EditFirstWorkflowAction {
  id: string
  operationId: EditFirstWorkflowOperationId
  title: string
}

export interface EditFirstWorkflowRecommendation {
  readonly recommendedAction: EditFirstWorkflowAction | null
}

export type EditFirstWorkflowChoiceDecision =
  | { readonly choiceType: 'script_intake'; readonly decision: 'submit'; readonly normalizedBrief: string }
  | { readonly choiceType: 'script_review'; readonly decision: 'approve' | 'revise' }
  | { readonly choiceType: 'bible_review'; readonly decision: 'approve' | 'revise' }
  | { readonly choiceType: 'asset_review'; readonly decision: 'approve' | 'revise' }
  | { readonly choiceType: 'style'; readonly decision: 'select'; readonly stylePreviewId: string }

export interface EditFirstWorkflowView {
  readonly step: EditFirstWorkflowStep
  readonly status: EditFirstWorkflowStatus
  /** Advisory mainline projection only. It never controls tool availability or Canvas materialization. */
  readonly recommendation: EditFirstWorkflowRecommendation
}

export interface EditFirstWorkflowSnapshot {
  hasEpisode: boolean
  hasBible: boolean
  bibleStatus: string | null
  sourceDocumentKind: string | null
  activeSourceScriptTaskCount: number
  activeBibleTaskCount: number
  stylePreviewCount: number
  completedStylePreviewCount: number
  confirmedStylePreviewCount: number
  failedStylePreviewCount: number
  activeStylePreviewTaskCount: number
  hasEditScript: boolean
  activeEditScriptTaskCount: number
  editScriptStatus: string | null
  editScriptAssetReviewStatus: string | null
  editAssetRequirementCount: number
  pendingAssetRequirementCount: number
  generatingAssetRequirementCount: number
  hasShotExecutionPlan: boolean
  activeShotExecutionPlanTaskCount: number
  shotExecutionPlanStatus: string | null
  videoPlanSegmentCount: number
  completedVideoSegmentCount: number
  failedVideoSegmentCount: number
  activeVideoTaskCount: number
  chapterCount: number
  renderableChapterCount: number
  completedChapterRenderCount: number
  failedChapterRenderCount: number
  activeChapterRenderTaskCount: number
  bgmDesignStatus: string | null
  bgmDesignHasPlan: boolean
  activeBgmDesignPlanTaskCount: number
  bgmScoreStatus: string | null
  bgmScoreHasMix: boolean
  activeBgmScoreGenerationTaskCount: number
  finalRenderStatus: string | null
  finalRenderHasOutput: boolean
  activeFinalRenderTaskCount: number
}

const EMPTY_RECOMMENDATION: EditFirstWorkflowRecommendation = {
  recommendedAction: null,
}

export const EDIT_FIRST_WORKFLOW_EMPTY_VIEW: EditFirstWorkflowView = {
  step: 'unavailable',
  status: { kind: 'inactive', reason: null },
  recommendation: EMPTY_RECOMMENDATION,
}

function workflowAction(
  operationId: EditFirstWorkflowOperationId,
  title: string,
): EditFirstWorkflowAction {
  return {
    id: operationId,
    operationId,
    title,
  }
}

export function createEditFirstWorkflowRecommendation(params: {
  recommendedAction?: EditFirstWorkflowAction | null
} = {}): EditFirstWorkflowRecommendation {
  return {
    recommendedAction: params.recommendedAction ?? null,
  }
}

export function createEditFirstWorkflowView(params: {
  readonly step: EditFirstWorkflowStep
  readonly status: EditFirstWorkflowStatus
  readonly recommendation?: EditFirstWorkflowRecommendation
}): EditFirstWorkflowView {
  return {
    step: params.step,
    status: params.status,
    recommendation: params.recommendation ?? EMPTY_RECOMMENDATION,
  }
}

function readyWorkflowView(params: {
  readonly step: EditFirstWorkflowStep
  readonly recommendedAction: EditFirstWorkflowAction
}): EditFirstWorkflowView {
  return createEditFirstWorkflowView({
    step: params.step,
    status: { kind: 'ready', reason: null },
    recommendation: createEditFirstWorkflowRecommendation(params),
  })
}

function processingWorkflowView(step: EditFirstWorkflowStep, reason: string): EditFirstWorkflowView {
  return createEditFirstWorkflowView({ step, status: { kind: 'processing', reason } })
}

function reviewWorkflowView(params: {
  readonly step: EditFirstWorkflowStep
  readonly reason: string
}): EditFirstWorkflowView {
  return createEditFirstWorkflowView({
    step: params.step,
    status: { kind: 'needs_user_choice', reason: params.reason },
  })
}

function failedWorkflowView(params: {
  readonly step: EditFirstWorkflowStep
  readonly reason: string
  readonly recommendedAction?: EditFirstWorkflowAction | null
}): EditFirstWorkflowView {
  return createEditFirstWorkflowView({
    step: params.step,
    status: { kind: 'failed', reason: params.reason },
    recommendation: createEditFirstWorkflowRecommendation(params),
  })
}

export function isEditFirstWorkflowPosition(
  workflow: EditFirstWorkflowView,
  step: EditFirstWorkflowStep,
  status?: EditFirstWorkflowStatusKind,
): boolean {
  return workflow.step === step && (status === undefined || workflow.status.kind === status)
}

function isActiveWorkflowStatus(status: string | null | undefined): boolean {
  return status === 'queued' || status === 'processing'
}

export function resolveEditFirstWorkflowViewFromSnapshot(
  snapshot: EditFirstWorkflowSnapshot,
): EditFirstWorkflowView {
  if (!snapshot.hasEpisode) return EDIT_FIRST_WORKFLOW_EMPTY_VIEW

  const hasAnyEditFirstArtifact = snapshot.hasBible
    || snapshot.hasEditScript
    || snapshot.hasShotExecutionPlan

  if (!snapshot.hasBible) {
    const action = workflowAction('ingest_script', 'Generate bible')
    if (!hasAnyEditFirstArtifact) {
      return readyWorkflowView({ step: 'script_intake', recommendedAction: action })
    }
    return failedWorkflowView({
      step: snapshot.hasShotExecutionPlan
        ? 'shot_execution'
        : snapshot.hasEditScript
          ? 'chapter_plan'
          : 'script_intake',
      reason: 'edit-first artifacts exist but bible is missing',
      recommendedAction: action,
    })
  }

  if (snapshot.bibleStatus === 'failed') {
    return failedWorkflowView({
      step: 'episode_plan',
      reason: 'bible generation failed',
    })
  }

  if (snapshot.bibleStatus === 'pending' || snapshot.bibleStatus === 'generating') {
    if (snapshot.activeSourceScriptTaskCount > 0) {
      return processingWorkflowView('source_script', 'source script expansion is still running')
    }
    if (snapshot.activeBibleTaskCount === 0 && snapshot.sourceDocumentKind === 'prompt_generated_outline') {
      return processingWorkflowView('source_script', 'source script expansion is still running')
    }
    return processingWorkflowView('episode_plan', 'edit bible generation is still running')
  }

  if (snapshot.bibleStatus === 'script_ready_for_review') {
    return reviewWorkflowView({
      step: 'source_script',
      reason: 'review the generated script before episode planning',
    })
  }

  if (snapshot.bibleStatus === 'script_approved') {
    return readyWorkflowView({
      step: 'episode_plan',
      recommendedAction: workflowAction('generate_bible_from_script', 'Generate episode plan'),
    })
  }

  if (snapshot.bibleStatus === 'ready_for_review') {
    return reviewWorkflowView({
      step: 'episode_plan',
      reason: 'review the episode planning baseline and choose approval or revision before style preview generation',
    })
  }

  if (snapshot.bibleStatus !== 'confirmed') {
    return failedWorkflowView({
      step: 'episode_plan',
      reason: `edit bible status is unsupported: ${snapshot.bibleStatus ?? 'unknown'}`,
    })
  }

  const terminalStylePreviewCount = snapshot.completedStylePreviewCount
    + snapshot.confirmedStylePreviewCount
    + snapshot.failedStylePreviewCount
  if (snapshot.activeStylePreviewTaskCount > 0) {
    return processingWorkflowView('visual_style', 'visual style generation is still running')
  }
  const allStylePreviewsFailed = snapshot.stylePreviewCount > 0
    && snapshot.failedStylePreviewCount === snapshot.stylePreviewCount
    && terminalStylePreviewCount === snapshot.stylePreviewCount

  if (allStylePreviewsFailed) {
    return failedWorkflowView({
      step: 'visual_style',
      reason: 'all style preview generation tasks failed',
      recommendedAction: workflowAction('generate_edit_style_previews', 'Regenerate style previews'),
    })
  }

  if (snapshot.confirmedStylePreviewCount === 0) {
    if (snapshot.stylePreviewCount > terminalStylePreviewCount) {
      return readyWorkflowView({
        step: 'visual_style',
        recommendedAction: workflowAction('generate_edit_style_preview_images', 'Generate style preview images'),
      })
    }

    if (snapshot.stylePreviewCount === 0) {
      return readyWorkflowView({
        step: 'visual_style',
        recommendedAction: workflowAction('generate_edit_style_previews', 'Generate style previews'),
      })
    }

    return reviewWorkflowView({
      step: 'visual_style',
      reason: 'choose and confirm one completed style preview',
    })
  }

  if (!snapshot.hasEditScript) {
    if (snapshot.activeEditScriptTaskCount > 0) {
      return processingWorkflowView('chapter_plan', 'chapter edit planning is still running')
    }
    return readyWorkflowView({
      step: 'chapter_plan',
      recommendedAction: workflowAction('plan_chapters', 'Plan chapters'),
    })
  }

  if (snapshot.editScriptStatus === 'failed') {
    const recommendedAction = workflowAction('replan_chapter', 'Regenerate chapter edit core table')
    return failedWorkflowView({
      step: 'chapter_plan',
      reason: 'edit core table generation failed',
      recommendedAction,
    })
  }

  if (snapshot.editScriptStatus === 'pending' && snapshot.activeEditScriptTaskCount === 0) {
    return readyWorkflowView({
      step: 'chapter_plan',
      recommendedAction: workflowAction('plan_chapters', 'Plan missing chapters'),
    })
  }

  if (snapshot.editScriptStatus !== 'ready' || snapshot.activeEditScriptTaskCount > 0) {
    return processingWorkflowView('chapter_plan', 'edit core table is still generating')
  }

  if (snapshot.pendingAssetRequirementCount > 0) {
    if (snapshot.generatingAssetRequirementCount > 0) {
      return processingWorkflowView('planned_assets', 'required assets are still generating')
    }
    return readyWorkflowView({
      step: 'planned_assets',
      recommendedAction: workflowAction('generate_edit_script_assets', 'Generate required assets'),
    })
  }

  if (!snapshot.hasShotExecutionPlan) {
    if (snapshot.editAssetRequirementCount > 0 && snapshot.editScriptAssetReviewStatus !== 'approved') {
      return reviewWorkflowView({
        step: 'planned_assets',
        reason: 'review and approve required edit-first assets before shot execution planning',
      })
    }
    return readyWorkflowView({
      step: 'shot_execution',
      recommendedAction: workflowAction('generate_edit_shot_execution_plan', 'Generate shot execution plan'),
    })
  }

  if (snapshot.shotExecutionPlanStatus === 'failed') {
    return failedWorkflowView({
      step: 'shot_execution',
      reason: 'shot execution plan generation failed',
      recommendedAction: workflowAction('generate_edit_shot_execution_plan', 'Regenerate shot execution plan'),
    })
  }

  if (snapshot.shotExecutionPlanStatus === 'pending' && snapshot.activeShotExecutionPlanTaskCount === 0) {
    return readyWorkflowView({
      step: 'shot_execution',
      recommendedAction: workflowAction('generate_edit_shot_execution_plan', 'Generate missing shot execution plan'),
    })
  }

  if (snapshot.shotExecutionPlanStatus !== 'ready') {
    return processingWorkflowView('shot_execution', 'shot execution plan is not ready')
  }

  if (snapshot.videoPlanSegmentCount === 0) {
    return failedWorkflowView({
      step: 'video_segments',
      reason: 'video generation segments are missing',
    })
  }

  const videoReady = snapshot.completedVideoSegmentCount >= snapshot.videoPlanSegmentCount
  const chapterRenderReady = snapshot.chapterCount > 0 && snapshot.completedChapterRenderCount >= snapshot.chapterCount
  const chapterRenderRunning = snapshot.activeChapterRenderTaskCount > 0
  const bgmDesignPlanning = snapshot.activeBgmDesignPlanTaskCount > 0 || snapshot.bgmDesignStatus === 'planning'
  const bgmDesignFailed = snapshot.bgmDesignStatus === 'failed'
  const bgmSatisfied = snapshot.bgmScoreHasMix
  const bgmGenerating = snapshot.activeBgmScoreGenerationTaskCount > 0 || snapshot.bgmScoreStatus === 'generating'
  const bgmFailed = snapshot.bgmScoreStatus === 'failed'
  const finalRendering = snapshot.activeFinalRenderTaskCount > 0 || isActiveWorkflowStatus(snapshot.finalRenderStatus)

  if (snapshot.finalRenderHasOutput && snapshot.finalRenderStatus === 'completed') {
    return createEditFirstWorkflowView({
      step: 'final_render',
      status: { kind: 'completed', reason: null },
    })
  }

  if (finalRendering) {
    return processingWorkflowView('final_render', 'final video render is still running')
  }

  if (snapshot.failedVideoSegmentCount > 0) {
    return failedWorkflowView({
      step: 'video_segments',
      reason: 'one or more video segments failed',
      recommendedAction: workflowAction('generate_video_segments', 'Regenerate videos'),
    })
  }

  if (snapshot.failedChapterRenderCount > 0) {
    return failedWorkflowView({
      step: 'chapter_render',
      reason: 'one or more chapter renders failed',
      recommendedAction: workflowAction('render_chapters', 'Render chapter videos'),
    })
  }

  if (!videoReady) {
    const videoAction = workflowAction('generate_video_segments', 'Generate videos')
    const chapterAction = workflowAction('render_chapters', 'Render chapter videos')
    const hasRenderableUnrenderedChapter = snapshot.renderableChapterCount > snapshot.completedChapterRenderCount
    const recommendedAction = hasRenderableUnrenderedChapter ? chapterAction : videoAction
    if (snapshot.activeVideoTaskCount > 0) {
      return processingWorkflowView('video_segments', 'video segments are still generating')
    }
    return readyWorkflowView({
      step: 'video_segments',
      recommendedAction,
    })
  }

  if (!chapterRenderReady) {
    if (chapterRenderRunning) {
      return processingWorkflowView('chapter_render', 'chapter renders are still running')
    }
    return readyWorkflowView({
      step: 'chapter_render',
      recommendedAction: workflowAction('render_chapters', 'Render chapter videos'),
    })
  }

  if (bgmDesignFailed) {
    return failedWorkflowView({
      step: 'audio_plan',
      reason: 'episode BGM design planning failed',
      recommendedAction: workflowAction('plan_episode_bgm_design', 'Replan episode BGM design'),
    })
  }

  if (!snapshot.bgmDesignHasPlan) {
    if (bgmDesignPlanning) return processingWorkflowView('audio_plan', 'episode BGM design is still planning')
    return readyWorkflowView({
      step: 'audio_plan',
      recommendedAction: workflowAction('plan_episode_bgm_design', 'Plan episode BGM design'),
    })
  }

  if (bgmFailed) {
    return failedWorkflowView({
      step: 'audio_generation',
      reason: 'BGM score generation failed',
      recommendedAction: workflowAction('generate_episode_bgm_score', 'Regenerate BGM score'),
    })
  }

  if (bgmGenerating) {
    return processingWorkflowView('audio_generation', 'BGM generation is still running')
  }

  if (!bgmSatisfied) {
    return readyWorkflowView({
      step: 'audio_generation',
      recommendedAction: workflowAction('generate_episode_bgm_score', 'Generate BGM score'),
    })
  }

  // A stale downstream failure never outranks missing upstream render or audio facts.
  if (snapshot.finalRenderStatus === 'failed') {
    return failedWorkflowView({
      step: 'final_render',
      reason: 'final video render failed',
      recommendedAction: workflowAction('render_final_video', 'Render final video'),
    })
  }

  return readyWorkflowView({
    step: 'final_render',
    recommendedAction: workflowAction('render_final_video', 'Render final video'),
  })
}
