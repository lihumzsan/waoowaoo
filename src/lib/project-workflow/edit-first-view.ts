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

export interface EditFirstWorkflowOperationGroup {
  readonly id: string
  readonly operationIds: readonly EditFirstWorkflowOperationId[]
  readonly approvalOperationIds: readonly EditFirstWorkflowOperationId[]
}

export interface EditFirstWorkflowOperationPolicy {
  readonly recommendedAction: EditFirstWorkflowAction | null
  readonly allowedOperationIds: readonly EditFirstWorkflowOperationId[]
  readonly group: EditFirstWorkflowOperationGroup | null
}

export interface EditFirstWorkflowCapabilities {
  readonly editSourceScript: boolean
  readonly editBible: boolean
  readonly editScript: boolean
  readonly editAssetGroup: boolean
  readonly editShotExecutionPlan: boolean
  readonly videoPlan: boolean
  readonly bgmScore: boolean
  readonly ambientSound: boolean
  readonly finalTimeline: boolean
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
  readonly operationPolicy: EditFirstWorkflowOperationPolicy
  readonly capabilities: EditFirstWorkflowCapabilities
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
  bgmScoreStatus: string | null
  bgmScoreHasPlan: boolean
  bgmScoreHasMix: boolean
  activeBgmScorePlanTaskCount: number
  activeBgmScoreGenerationTaskCount: number
  ambientSoundStatus: string | null
  ambientSoundHasMix: boolean
  ambientSoundDecision: 'ambient_sound' | 'none_needed' | null
  activeAmbientSoundPlanTaskCount: number
  activeAmbientSoundGenerationTaskCount: number
  finalRenderStatus: string | null
  finalRenderHasOutput: boolean
  activeFinalRenderTaskCount: number
}

const EDIT_FIRST_WORKFLOW_STEP_ORDER = new Map(
  EDIT_FIRST_WORKFLOW_STEPS.map((step, index) => [step, index] as const),
)

const EDIT_FIRST_WORKFLOW_CAPABILITY_UNLOCK_STEP = {
  editSourceScript: 'source_script',
  editBible: 'episode_plan',
  editScript: 'chapter_plan',
  editAssetGroup: 'visual_style',
  editShotExecutionPlan: 'shot_execution',
  videoPlan: 'video_segments',
  bgmScore: 'audio_plan',
  ambientSound: 'audio_plan',
  finalTimeline: 'final_render',
} as const satisfies Record<keyof EditFirstWorkflowCapabilities, EditFirstWorkflowStep>

function resolveEditFirstWorkflowCapabilities(
  step: EditFirstWorkflowStep,
): EditFirstWorkflowCapabilities {
  const current = EDIT_FIRST_WORKFLOW_STEP_ORDER.get(step)
  if (current === undefined) throw new Error(`EDIT_FIRST_WORKFLOW_STEP_UNKNOWN:${step}`)
  return Object.fromEntries(Object.entries(EDIT_FIRST_WORKFLOW_CAPABILITY_UNLOCK_STEP).map(
    ([capability, unlockStep]) => {
      const unlock = EDIT_FIRST_WORKFLOW_STEP_ORDER.get(unlockStep)
      if (unlock === undefined) throw new Error(`EDIT_FIRST_WORKFLOW_UNLOCK_STEP_UNKNOWN:${unlockStep}`)
      return [capability, current >= unlock]
    },
  )) as unknown as EditFirstWorkflowCapabilities
}

const EMPTY_OPERATION_POLICY: EditFirstWorkflowOperationPolicy = {
  recommendedAction: null,
  allowedOperationIds: [],
  group: null,
}

export const EDIT_FIRST_WORKFLOW_EMPTY_VIEW: EditFirstWorkflowView = {
  step: 'unavailable',
  status: { kind: 'inactive', reason: null },
  operationPolicy: EMPTY_OPERATION_POLICY,
  capabilities: resolveEditFirstWorkflowCapabilities('unavailable'),
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

export function createEditFirstWorkflowOperationPolicy(params: {
  recommendedAction?: EditFirstWorkflowAction | null
  allowedOperationIds?: readonly EditFirstWorkflowOperationId[]
  group?: EditFirstWorkflowOperationGroup | null
} = {}): EditFirstWorkflowOperationPolicy {
  const recommendedAction = params.recommendedAction ?? null
  const allowedOperationIds = params.allowedOperationIds
    ? [...params.allowedOperationIds]
    : recommendedAction
      ? [recommendedAction.operationId]
      : []
  if (new Set(allowedOperationIds).size !== allowedOperationIds.length) {
    throw new Error('EDIT_FIRST_WORKFLOW_ALLOWED_OPERATION_DUPLICATE')
  }
  if (recommendedAction && !allowedOperationIds.includes(recommendedAction.operationId)) {
    throw new Error(`EDIT_FIRST_WORKFLOW_RECOMMENDED_OPERATION_NOT_ALLOWED:${recommendedAction.operationId}`)
  }
  const group = params.group ?? null
  if (group) {
    if (group.operationIds.length !== allowedOperationIds.length
      || group.operationIds.some((operationId, index) => operationId !== allowedOperationIds[index])) {
      throw new Error(`EDIT_FIRST_WORKFLOW_GROUP_OPERATION_MISMATCH:${group.id}`)
    }
    if (group.approvalOperationIds.some((operationId) => !allowedOperationIds.includes(operationId))) {
      throw new Error(`EDIT_FIRST_WORKFLOW_GROUP_APPROVAL_NOT_ALLOWED:${group.id}`)
    }
  }
  return {
    recommendedAction,
    allowedOperationIds,
    group,
  }
}

export function createEditFirstWorkflowView(params: {
  readonly step: EditFirstWorkflowStep
  readonly status: EditFirstWorkflowStatus
  readonly operationPolicy?: EditFirstWorkflowOperationPolicy
}): EditFirstWorkflowView {
  const policy = params.operationPolicy ?? EMPTY_OPERATION_POLICY
  if (
    (params.status.kind === 'inactive'
      || params.status.kind === 'processing'
      || params.status.kind === 'completed')
    && policy.allowedOperationIds.length > 0
  ) {
    throw new Error(`EDIT_FIRST_WORKFLOW_STATUS_FORBIDS_OPERATIONS:${params.step}:${params.status.kind}`)
  }
  return {
    step: params.step,
    status: params.status,
    operationPolicy: policy,
    capabilities: resolveEditFirstWorkflowCapabilities(params.step),
  }
}

function readyWorkflowView(params: {
  readonly step: EditFirstWorkflowStep
  readonly recommendedAction: EditFirstWorkflowAction
  readonly allowedOperationIds?: readonly EditFirstWorkflowOperationId[]
  readonly group?: EditFirstWorkflowOperationGroup | null
}): EditFirstWorkflowView {
  return createEditFirstWorkflowView({
    step: params.step,
    status: { kind: 'ready', reason: null },
    operationPolicy: createEditFirstWorkflowOperationPolicy(params),
  })
}

function processingWorkflowView(step: EditFirstWorkflowStep, reason: string): EditFirstWorkflowView {
  return createEditFirstWorkflowView({ step, status: { kind: 'processing', reason } })
}

function reviewWorkflowView(params: {
  readonly step: EditFirstWorkflowStep
  readonly reason: string
  readonly allowedOperationIds?: readonly EditFirstWorkflowOperationId[]
}): EditFirstWorkflowView {
  return createEditFirstWorkflowView({
    step: params.step,
    status: { kind: 'needs_user_choice', reason: params.reason },
    operationPolicy: createEditFirstWorkflowOperationPolicy({ allowedOperationIds: params.allowedOperationIds }),
  })
}

function failedWorkflowView(params: {
  readonly step: EditFirstWorkflowStep
  readonly reason: string
  readonly recommendedAction?: EditFirstWorkflowAction | null
  readonly allowedOperationIds?: readonly EditFirstWorkflowOperationId[]
}): EditFirstWorkflowView {
  return createEditFirstWorkflowView({
    step: params.step,
    status: { kind: 'failed', reason: params.reason },
    operationPolicy: createEditFirstWorkflowOperationPolicy(params),
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
      allowedOperationIds: ['generate_edit_style_previews'],
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
      allowedOperationIds: [recommendedAction.operationId, 'plan_chapters'],
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
  const bgmPlanReady = snapshot.bgmScoreHasPlan
  const bgmReady = snapshot.bgmScoreHasMix
  const bgmPlanning = snapshot.activeBgmScorePlanTaskCount > 0 || snapshot.bgmScoreStatus === 'planning'
  const bgmGenerating = snapshot.activeBgmScoreGenerationTaskCount > 0 || snapshot.bgmScoreStatus === 'generating'
  const bgmFailed = snapshot.bgmScoreStatus === 'failed'
  const ambientSoundPlanReady = snapshot.ambientSoundDecision !== null
  const ambientSoundSatisfied = snapshot.ambientSoundDecision === 'none_needed' || snapshot.ambientSoundHasMix
  const ambientSoundPlanning = snapshot.activeAmbientSoundPlanTaskCount > 0
    || snapshot.ambientSoundStatus === 'planning'
  const ambientSoundGenerating = snapshot.activeAmbientSoundGenerationTaskCount > 0
    || snapshot.ambientSoundStatus === 'generating'
  const ambientSoundFailed = snapshot.ambientSoundStatus === 'failed'
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
    const allowedOperationIds: EditFirstWorkflowOperationId[] = hasRenderableUnrenderedChapter
      ? [chapterAction.operationId, videoAction.operationId]
      : [videoAction.operationId]
    if (snapshot.activeVideoTaskCount > 0) {
      return processingWorkflowView('video_segments', 'video segments are still generating')
    }
    return readyWorkflowView({
      step: 'video_segments',
      recommendedAction,
      allowedOperationIds,
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

  if (bgmFailed) {
    const operationId: EditFirstWorkflowOperationId = bgmPlanReady
      ? 'generate_episode_bgm_score'
      : 'plan_episode_bgm_score'
    return failedWorkflowView({
      step: bgmPlanReady ? 'audio_generation' : 'audio_plan',
      reason: bgmPlanReady ? 'BGM score generation failed' : 'BGM score planning failed',
      recommendedAction: workflowAction(
        operationId,
        bgmPlanReady ? 'Regenerate BGM score' : 'Replan BGM score',
      ),
    })
  }

  if (ambientSoundFailed) {
    const operationId: EditFirstWorkflowOperationId = ambientSoundPlanReady
      ? 'generate_episode_ambient_sound'
      : 'plan_episode_ambient_sound'
    return failedWorkflowView({
      step: ambientSoundPlanReady ? 'audio_generation' : 'audio_plan',
      reason: 'ambient sound generation failed',
      recommendedAction: workflowAction(
        operationId,
        operationId === 'generate_episode_ambient_sound'
          ? 'Regenerate ambient sound audio'
          : 'Replan ambient sound',
      ),
    })
  }

  if (!bgmPlanReady || !ambientSoundPlanReady) {
    const missingPlanActions: EditFirstWorkflowOperationId[] = []
    if (!bgmPlanReady) missingPlanActions.push('plan_episode_bgm_score')
    if (!ambientSoundPlanReady) missingPlanActions.push('plan_episode_ambient_sound')
    if (bgmPlanning || ambientSoundPlanning) {
      return processingWorkflowView('audio_plan', 'audio layer planning is still running')
    }
    const nextOperationId = missingPlanActions[0]
    if (!nextOperationId) throw new Error('EDIT_FIRST_AUDIO_LAYER_PLAN_ACTION_REQUIRED')
    return readyWorkflowView({
      step: 'audio_plan',
      recommendedAction: workflowAction(
        nextOperationId,
        nextOperationId === 'plan_episode_bgm_score' ? 'Plan BGM score' : 'Plan ambient sound',
      ),
      allowedOperationIds: missingPlanActions,
      group: missingPlanActions.length > 1
        ? {
            id: 'edit_first_audio_layer_planning',
            operationIds: missingPlanActions,
            approvalOperationIds: [],
          }
        : null,
    })
  }

  if (bgmGenerating || ambientSoundGenerating) {
    return processingWorkflowView('audio_generation', 'audio layer generation is still running')
  }

  if (!bgmReady || !ambientSoundSatisfied) {
    const missingGenerationActions: EditFirstWorkflowOperationId[] = []
    if (!bgmReady) missingGenerationActions.push('generate_episode_bgm_score')
    if (!ambientSoundSatisfied) missingGenerationActions.push('generate_episode_ambient_sound')
    const nextOperationId = missingGenerationActions[0]
    if (!nextOperationId) {
      throw new Error('EDIT_FIRST_AUDIO_LAYER_GENERATION_ACTION_REQUIRED')
    }
    const recommendedAction = workflowAction(
      nextOperationId,
      nextOperationId === 'generate_episode_bgm_score'
        ? 'Generate BGM score'
        : nextOperationId === 'plan_episode_ambient_sound'
          ? 'Plan ambient sound'
          : 'Generate ambient sound audio',
    )
    return readyWorkflowView({
      step: 'audio_generation',
      recommendedAction,
      allowedOperationIds: missingGenerationActions,
      group: missingGenerationActions.length > 1
        ? {
            id: 'edit_first_audio_layer_generation',
            operationIds: missingGenerationActions,
            approvalOperationIds: missingGenerationActions,
          }
        : null,
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
