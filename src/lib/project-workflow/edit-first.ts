import { prisma } from '@/lib/prisma'
import { readCompletedMusicScoreMix, readMusicScoreStatus } from '@/lib/music-score/project-data'
import {
  readCompletedSoundscapeMix,
  readSoundscapeDecision,
} from '@/lib/soundscape/project-data'
import { editScriptStructureSchema } from '@/lib/edit-script/types'
import { TASK_TYPE } from '@/lib/task/types'
import { getEditFirstChoiceDefinition } from '@/lib/project-agent/edit-first-choice-tools'
import {
  resolveLocationSpatialProfileReadiness,
  resolveStoryboardImageReadiness,
} from './edit-first-readiness'
import type { EditFirstWorkflowOperationId } from './edit-first-operation-ids'
export {
  EDIT_FIRST_WORKFLOW_OPERATION_IDS,
  type EditFirstWorkflowOperationId,
} from './edit-first-operation-ids'

export type EditFirstWorkflowStage =
  | 'not_started'
  | 'ready_to_ingest_script'
  | 'script_generating'
  | 'script_ready_for_review'
  | 'ready_to_generate_bible'
  | 'bible_generating'
  | 'bible_ready_for_review'
  | 'ready_to_generate_style_previews'
  | 'style_preview_generating'
  | 'needs_style_choice'
  | 'ready_to_generate_edit_script'
  | 'edit_script_generating'
  | 'ready_to_generate_assets'
  | 'assets_generating'
  | 'assets_ready_for_review'
  | 'ready_to_generate_shot_execution_plan'
  | 'ready_to_generate_storyboard'
  | 'storyboard_generating'
  | 'ready_to_generate_storyboard_images'
  | 'storyboard_images_generating'
  | 'ready_to_generate_videos'
  | 'videos_generating'
  | 'ready_to_render_chapters'
  | 'chapters_rendering'
  | 'ready_to_generate_bgm_score'
  | 'bgm_score_generating'
  | 'ready_to_generate_audio_layers'
  | 'soundscape_planning'
  | 'ready_to_generate_soundscape'
  | 'audio_layers_generating'
  | 'ready_to_render_final'
  | 'final_rendering'
  | 'completed'
  | 'failed'

export type EditFirstWorkflowBlockingKind =
  | 'none'
  | 'processing'
  | 'needs_user_choice'
  | 'needs_confirmation'
  | 'failed'

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

export type EditFirstWorkflowChoiceDecision =
  | { readonly choiceType: 'script_intake'; readonly decision: 'submit'; readonly normalizedBrief: string }
  | { readonly choiceType: 'script_review'; readonly decision: 'approve' | 'revise' }
  | { readonly choiceType: 'bible_review'; readonly decision: 'approve' | 'revise' }
  | { readonly choiceType: 'asset_review'; readonly decision: 'approve' | 'revise' }
  | { readonly choiceType: 'style'; readonly decision: 'select'; readonly stylePreviewId: string }

export interface EditFirstWorkflowState {
  active: boolean
  stage: EditFirstWorkflowStage
  blocking: {
    kind: EditFirstWorkflowBlockingKind
    reason: string | null
  }
  nextAction: EditFirstWorkflowAction | null
  allowedOperationIds: EditFirstWorkflowOperationId[]
  operationGroup: EditFirstWorkflowOperationGroup | null
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
  plannedAssetCount: number
  pendingPlannedAssetCount: number
  activePlannedAssetTaskCount: number
  hasEditScript: boolean
  activeEditScriptTaskCount: number
  editScriptStatus: string | null
  editScriptAssetReviewStatus: string | null
  editAssetRequirementCount: number
  pendingAssetRequirementCount: number
  generatingAssetRequirementCount: number
  requiredLocationSpatialProfileCount: number
  readyLocationSpatialProfileCount: number
  hasShotExecutionPlan: boolean
  activeShotExecutionPlanTaskCount: number
  shotExecutionPlanStatus: string | null
  storyboardCount: number
  storyboardPanelPromptFailed: boolean
  activeStoryboardPanelTaskCount: number
  panelCount: number
  storyboardPanelImagePromptMissingCount: number
  storyboardPanelVideoPromptMissingCount: number
  storyboardPanelImageReadyCount: number
  storyboardPanelImageMissingCount: number
  storyboardPanelImageFailedCount: number
  activeStoryboardImageTaskCount: number
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
  bgmScoreHasMix: boolean
  activeBgmScoreTaskCount: number
  soundscapeStatus: string | null
  soundscapeHasMix: boolean
  soundscapeDecision: 'soundscape' | 'none_needed' | null
  activeSoundscapePlanTaskCount: number
  activeSoundscapeGenerationTaskCount: number
  finalRenderStatus: string | null
  finalRenderHasOutput: boolean
  activeFinalRenderTaskCount: number
}

export const EDIT_FIRST_WORKFLOW_EMPTY_STATE: EditFirstWorkflowState = {
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

function state(params: {
  active?: boolean
  stage: EditFirstWorkflowStage
  blocking?: EditFirstWorkflowState['blocking']
  nextAction?: EditFirstWorkflowAction | null
  allowedOperationIds?: readonly EditFirstWorkflowOperationId[]
  operationGroup?: EditFirstWorkflowOperationGroup | null
}): EditFirstWorkflowState {
  const nextAction = params.nextAction ?? null
  return {
    active: params.active ?? true,
    stage: params.stage,
    blocking: params.blocking ?? {
      kind: 'none',
      reason: null,
    },
    nextAction,
    allowedOperationIds: params.allowedOperationIds ? [...params.allowedOperationIds] : nextAction ? [nextAction.operationId] : [],
    operationGroup: params.operationGroup ?? null,
  }
}

/**
 * Applies a consumed review decision to the current workflow view without
 * mutating domain resources. The returned nextAction is the only command the
 * continuation may execute; the registered Operation owns every write.
 */
export function resolveEditFirstWorkflowChoice(
  workflow: EditFirstWorkflowState,
  choice: EditFirstWorkflowChoiceDecision,
): EditFirstWorkflowState {
  const definition = getEditFirstChoiceDefinition(choice.choiceType)
  const transition = definition.resolveWorkflowAction(workflow, choice)
  if (!transition) {
    throw new Error(`EDIT_FIRST_REVIEW_CHOICE_STAGE_MISMATCH:${choice.choiceType}:${workflow.stage}`)
  }
  return {
    ...workflow,
    blocking: { kind: 'none', reason: null },
    nextAction: transition,
    allowedOperationIds: [transition.operationId],
  }
}

type StoryboardSpatialCandidate = {
  readonly id: string
  readonly editScriptId: string | null
  readonly lastError: string | null
}

type WorkflowVideoGroupCandidate = {
  readonly chapterId: string | null
  readonly shotIds: readonly string[]
  readonly status: string
  readonly videoUrl: string | null
  readonly videoMediaId: string | null
}

const ACTIVE_WORKFLOW_TASK_STATUSES = ['queued', 'processing'] as const

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function plannedBibleAssetNameKeys(value: unknown, key: 'characters' | 'locations'): ReadonlySet<string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return new Set()
  const collection = (value as Record<string, unknown>)[key]
  if (!Array.isArray(collection)) return new Set()
  return new Set(collection.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const name = (item as Record<string, unknown>).name
    return typeof name === 'string' && name.trim()
      ? [name.trim().replace(/\s+/g, ' ').toLocaleLowerCase()]
      : []
  }))
}

function isActiveWorkflowStatus(status: string | null | undefined): boolean {
  return status === 'queued' || status === 'processing'
}

function resolveEpisodeArtifactStatus(input: {
  readonly statuses: readonly string[]
  readonly expectedCount: number
  readonly activeTaskCount?: number
}): string | null {
  if (input.expectedCount <= 0 && input.statuses.length === 0) return null
  if (input.statuses.some((status) => status === 'failed')) return 'failed'
  if ((input.activeTaskCount ?? 0) > 0) return 'generating'
  if (input.statuses.length < input.expectedCount) return input.statuses.length > 0 ? 'pending' : null
  if (input.statuses.every((status) => status === 'ready' || status === 'completed')) return 'ready'
  const activeStatus = input.statuses.find((status) => status === 'pending' || status === 'generating')
  return activeStatus ?? input.statuses[0] ?? null
}

function resolveEpisodeAssetReviewStatus(statuses: readonly string[]): string | null {
  if (statuses.length === 0) return null
  if (statuses.some((status) => status === 'failed')) return 'failed'
  if (statuses.every((status) => status === 'approved')) return 'approved'
  return statuses.find((status) => status !== 'approved') ?? statuses[0] ?? null
}

function hasOutputReference(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function sameShotIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((shotId, index) => shotId === right[index])
}

function readShotIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
}

function readEditScriptGenerationSegments(corePlanJson: unknown): readonly { readonly shotIds: readonly string[] }[] {
  const parsed = editScriptStructureSchema.safeParse(corePlanJson)
  if (!parsed.success) return []
  return parsed.data.generationSegments
}

function findVideoGroupForShotIds(
  groups: readonly WorkflowVideoGroupCandidate[],
  chapterId: string | null,
  shotIds: readonly string[],
): WorkflowVideoGroupCandidate | null {
  return groups.find((group) => group.chapterId === chapterId && sameShotIds(group.shotIds, shotIds)) ?? null
}

function videoGroupHasOutput(group: WorkflowVideoGroupCandidate | null): boolean {
  return Boolean(group && (hasOutputReference(group.videoUrl) || hasOutputReference(group.videoMediaId)))
}

interface StoryboardPlanStageSummary {
  readonly matchingStoryboardIds: string[]
  readonly storyboardPanelPromptFailed: boolean
}

function resolveStoryboardPlanStageSummary(input: {
  readonly editScriptIds: ReadonlySet<string>
  readonly storyboards: readonly StoryboardSpatialCandidate[]
}): StoryboardPlanStageSummary {
  if (input.editScriptIds.size === 0) {
    return {
      matchingStoryboardIds: [],
      storyboardPanelPromptFailed: false,
    }
  }
  const matching = input.storyboards.flatMap((storyboard) => {
    if (!storyboard.editScriptId || !input.editScriptIds.has(storyboard.editScriptId)) return []
    return [{
      id: storyboard.id,
      hasError: hasText(storyboard.lastError),
    }]
  })
  return {
    matchingStoryboardIds: matching.map((storyboard) => storyboard.id),
    storyboardPanelPromptFailed: matching.some((storyboard) => storyboard.hasError),
  }
}

export function resolveEditFirstWorkflowStateFromSnapshot(
  snapshot: EditFirstWorkflowSnapshot,
): EditFirstWorkflowState {
  if (!snapshot.hasEpisode) return EDIT_FIRST_WORKFLOW_EMPTY_STATE

  const hasAnyEditFirstArtifact = snapshot.hasBible
    || snapshot.hasEditScript
    || snapshot.hasShotExecutionPlan

  if (!snapshot.hasBible) {
    return state({
      active: hasAnyEditFirstArtifact,
      stage: hasAnyEditFirstArtifact ? 'failed' : 'ready_to_ingest_script',
      blocking: hasAnyEditFirstArtifact
        ? { kind: 'failed', reason: 'edit-first artifacts exist but bible is missing' }
        : { kind: 'none', reason: null },
      nextAction: workflowAction('ingest_script', 'Generate bible'),
    })
  }

  if (snapshot.bibleStatus === 'failed') {
    return state({
      stage: 'failed',
      blocking: { kind: 'failed', reason: 'bible generation failed' },
      allowedOperationIds: [],
    })
  }

  if (snapshot.bibleStatus === 'pending' || snapshot.bibleStatus === 'generating') {
    if (snapshot.activeSourceScriptTaskCount > 0) {
      return state({
        stage: 'script_generating',
        blocking: { kind: 'processing', reason: 'source script expansion is still running' },
      })
    }
    if (snapshot.activeBibleTaskCount === 0 && snapshot.sourceDocumentKind === 'prompt_generated_outline') {
      return state({
        stage: 'script_generating',
        blocking: { kind: 'processing', reason: 'source script expansion is still running' },
      })
    }
    return state({
      stage: 'bible_generating',
      blocking: { kind: 'processing', reason: 'edit bible generation is still running' },
    })
  }

  if (snapshot.bibleStatus === 'script_ready_for_review') {
    return state({
      stage: 'script_ready_for_review',
      blocking: { kind: 'needs_user_choice', reason: 'review the generated script before episode planning' },
      allowedOperationIds: [],
    })
  }

  if (snapshot.bibleStatus === 'script_approved') {
    const nextAction = workflowAction('generate_bible_from_script', 'Generate episode plan')
    return state({
      stage: 'ready_to_generate_bible',
      nextAction,
      allowedOperationIds: [nextAction.operationId],
    })
  }

  if (snapshot.bibleStatus === 'ready_for_review') {
    return state({
      stage: 'bible_ready_for_review',
      blocking: { kind: 'needs_user_choice', reason: 'review the episode planning baseline and choose approval or revision before style preview generation' },
      allowedOperationIds: [],
    })
  }

  if (snapshot.bibleStatus !== 'confirmed') {
    return state({
      stage: 'failed',
      blocking: { kind: 'failed', reason: `edit bible status is unsupported: ${snapshot.bibleStatus ?? 'unknown'}` },
    })
  }

  const terminalStylePreviewCount = snapshot.completedStylePreviewCount
    + snapshot.confirmedStylePreviewCount
    + snapshot.failedStylePreviewCount
  if (snapshot.activeStylePreviewTaskCount > 0) {
    return state({
      stage: 'style_preview_generating',
      blocking: { kind: 'processing', reason: 'visual style generation is still running' },
    })
  }
  const allStylePreviewsFailed = snapshot.stylePreviewCount > 0
    && snapshot.failedStylePreviewCount === snapshot.stylePreviewCount
    && terminalStylePreviewCount === snapshot.stylePreviewCount

  if (allStylePreviewsFailed) {
    const nextAction = workflowAction('generate_edit_style_previews', 'Regenerate style previews')
    return state({
      stage: 'failed',
      blocking: { kind: 'failed', reason: 'all style preview generation tasks failed' },
      nextAction,
      allowedOperationIds: [nextAction.operationId],
    })
  }

  if (snapshot.confirmedStylePreviewCount === 0) {
    if (snapshot.stylePreviewCount > terminalStylePreviewCount) {
      const nextAction = workflowAction('generate_edit_style_preview_images', 'Generate style preview images')
      return state({
        stage: 'ready_to_generate_style_previews',
        nextAction,
        allowedOperationIds: [nextAction.operationId],
      })
    }

    if (snapshot.stylePreviewCount === 0) {
      const nextAction = workflowAction('generate_edit_style_previews', 'Generate style previews')
      return state({
        stage: 'ready_to_generate_style_previews',
        nextAction,
        allowedOperationIds: [nextAction.operationId],
      })
    }

    return state({
      stage: 'needs_style_choice',
      blocking: { kind: 'needs_user_choice', reason: 'choose and confirm one completed style preview' },
      allowedOperationIds: ['generate_edit_style_previews'],
    })
  }

  if (!snapshot.hasEditScript) {
    if (snapshot.activeEditScriptTaskCount > 0 || snapshot.activePlannedAssetTaskCount > 0) {
      return state({
        stage: 'edit_script_generating',
        blocking: { kind: 'processing', reason: 'chapter edit planning and planned asset tasks are still running' },
      })
    }
    if (snapshot.plannedAssetCount > 0 && snapshot.pendingPlannedAssetCount > 0) {
      const operationIds = ['generate_edit_script_assets', 'plan_chapters'] as const
      return state({
        stage: 'ready_to_generate_edit_script',
        nextAction: workflowAction('plan_chapters', 'Plan chapters and generate planned assets'),
        allowedOperationIds: operationIds,
        operationGroup: {
          id: 'edit_first_core_and_planned_assets',
          operationIds,
          approvalOperationIds: ['generate_edit_script_assets'],
        },
      })
    }
    return state({
      stage: 'ready_to_generate_edit_script',
      nextAction: workflowAction('plan_chapters', 'Plan chapters'),
    })
  }

  if (snapshot.editScriptStatus === 'failed') {
    const nextAction = workflowAction('replan_chapter', 'Regenerate chapter edit core table')
    return state({
      stage: 'failed',
      blocking: { kind: 'failed', reason: 'edit core table generation failed' },
      nextAction,
      allowedOperationIds: [nextAction.operationId, 'plan_chapters'],
    })
  }

  if (snapshot.editScriptStatus === 'pending' && snapshot.activeEditScriptTaskCount === 0) {
    const nextAction = workflowAction('plan_chapters', 'Plan missing chapters')
    return state({
      stage: 'ready_to_generate_edit_script',
      nextAction,
      allowedOperationIds: [nextAction.operationId],
    })
  }

  if (snapshot.editScriptStatus !== 'ready' || snapshot.activeEditScriptTaskCount > 0) {
    return state({
      stage: 'edit_script_generating',
      blocking: { kind: 'processing', reason: 'edit core table is still generating' },
    })
  }

  const missingSpatialProfileCount = Math.max(0, snapshot.requiredLocationSpatialProfileCount - snapshot.readyLocationSpatialProfileCount)
  if (snapshot.pendingAssetRequirementCount > 0 || missingSpatialProfileCount > 0) {
    if (snapshot.generatingAssetRequirementCount > 0) {
      return state({
        stage: 'assets_generating',
        blocking: { kind: 'processing', reason: 'required assets or spatial profiles are still generating' },
      })
    }
    return state({
      stage: 'ready_to_generate_assets',
      nextAction: workflowAction('generate_edit_script_assets', 'Generate required assets'),
    })
  }

  if (!snapshot.hasShotExecutionPlan) {
    if (snapshot.editAssetRequirementCount > 0 && snapshot.editScriptAssetReviewStatus !== 'approved') {
      return state({
        stage: 'assets_ready_for_review',
        blocking: { kind: 'needs_user_choice', reason: 'review and approve required edit-first assets before shot execution planning' },
      })
    }
    return state({
      stage: 'ready_to_generate_shot_execution_plan',
      nextAction: workflowAction('generate_edit_shot_execution_plan', 'Generate shot execution plan'),
    })
  }

  if (snapshot.shotExecutionPlanStatus === 'failed') {
    return state({
      stage: 'failed',
      blocking: { kind: 'failed', reason: 'shot execution plan generation failed' },
      nextAction: workflowAction('generate_edit_shot_execution_plan', 'Regenerate shot execution plan'),
    })
  }

  if (snapshot.shotExecutionPlanStatus === 'pending' && snapshot.activeShotExecutionPlanTaskCount === 0) {
    return state({
      stage: 'ready_to_generate_shot_execution_plan',
      nextAction: workflowAction('generate_edit_shot_execution_plan', 'Generate missing shot execution plan'),
    })
  }

  if (snapshot.shotExecutionPlanStatus !== 'ready') {
    return state({
      stage: 'ready_to_generate_shot_execution_plan',
      blocking: { kind: 'processing', reason: 'shot execution plan is not ready' },
    })
  }

  if (snapshot.activeStoryboardPanelTaskCount > 0) {
    return state({
      stage: 'storyboard_generating',
      blocking: { kind: 'processing', reason: 'storyboard panels are still generating' },
    })
  }

  if (snapshot.storyboardPanelPromptFailed) {
    const nextAction = workflowAction('generate_edit_script_storyboard', 'Regenerate storyboard panels')
    return state({
      stage: 'failed',
      blocking: { kind: 'failed', reason: 'storyboard panel prompt generation failed' },
      nextAction,
      allowedOperationIds: [nextAction.operationId],
    })
  }

  if (snapshot.panelCount === 0 || snapshot.storyboardCount < snapshot.chapterCount) {
    return state({
      stage: 'ready_to_generate_storyboard',
      nextAction: workflowAction('generate_edit_script_storyboard', 'Generate storyboard panels'),
    })
  }

  if (snapshot.storyboardPanelImagePromptMissingCount > 0 || snapshot.storyboardPanelVideoPromptMissingCount > 0) {
    const nextAction = workflowAction('generate_edit_script_storyboard', 'Regenerate storyboard panels')
    return state({
      stage: 'failed',
      blocking: { kind: 'failed', reason: 'storyboard panel prompt facts are incomplete' },
      nextAction,
      allowedOperationIds: [nextAction.operationId],
    })
  }

  if (snapshot.storyboardPanelImageMissingCount > 0) {
    const nextAction = workflowAction('generate_edit_script_storyboard_images', 'Generate storyboard images')
    if (snapshot.activeStoryboardImageTaskCount > 0) {
      return state({
        stage: 'storyboard_images_generating',
        blocking: { kind: 'processing', reason: 'storyboard panel images are still generating' },
      })
    }
    if (snapshot.storyboardPanelImageFailedCount > 0) {
      return state({
        stage: 'failed',
        blocking: { kind: 'failed', reason: 'storyboard panel image generation failed' },
        nextAction,
        allowedOperationIds: [nextAction.operationId],
      })
    }
    return state({
      stage: 'ready_to_generate_storyboard_images',
      nextAction,
    })
  }

  if (snapshot.videoPlanSegmentCount === 0) {
    return state({
      stage: 'failed',
      blocking: { kind: 'failed', reason: 'video generation segments are missing' },
    })
  }

  const videoReady = snapshot.completedVideoSegmentCount >= snapshot.videoPlanSegmentCount
  const chapterRenderReady = snapshot.chapterCount > 0 && snapshot.completedChapterRenderCount >= snapshot.chapterCount
  const chapterRenderRunning = snapshot.activeChapterRenderTaskCount > 0
  const bgmReady = snapshot.bgmScoreHasMix
  const bgmRunning = snapshot.activeBgmScoreTaskCount > 0 || snapshot.bgmScoreStatus === 'generating'
  const bgmFailed = snapshot.bgmScoreStatus === 'failed'
  const soundscapeSatisfied = snapshot.soundscapeDecision === 'none_needed' || snapshot.soundscapeHasMix
  const soundscapeReadyForGeneration = snapshot.soundscapeDecision === 'soundscape'
    && snapshot.soundscapeStatus !== 'planning'
    && snapshot.soundscapeStatus !== 'generating'
    && !snapshot.soundscapeHasMix
  const soundscapeOperationId: EditFirstWorkflowOperationId = soundscapeReadyForGeneration
    ? 'generate_episode_soundscape'
    : 'plan_episode_soundscape'
  const soundscapePlanning = snapshot.activeSoundscapePlanTaskCount > 0
    || snapshot.soundscapeStatus === 'planning'
  const soundscapeGenerating = snapshot.activeSoundscapeGenerationTaskCount > 0
    || snapshot.soundscapeStatus === 'generating'
  const soundscapeFailed = snapshot.soundscapeStatus === 'failed'
  const finalRendering = snapshot.activeFinalRenderTaskCount > 0 || isActiveWorkflowStatus(snapshot.finalRenderStatus)

  if (snapshot.finalRenderHasOutput && snapshot.finalRenderStatus === 'completed') {
    return state({
      stage: 'completed',
      blocking: { kind: 'none', reason: null },
    })
  }

  if (finalRendering) {
    return state({
      stage: 'final_rendering',
      blocking: { kind: 'processing', reason: 'final video render is still running' },
    })
  }

  if (snapshot.finalRenderStatus === 'failed') {
    const nextAction = workflowAction('render_final_video', 'Render final video')
    return state({
      stage: 'failed',
      blocking: { kind: 'failed', reason: 'final video render failed' },
      nextAction,
      allowedOperationIds: [nextAction.operationId],
    })
  }

  if (snapshot.failedVideoSegmentCount > 0) {
    const nextAction = workflowAction('generate_episode_videos', 'Regenerate videos')
    return state({
      stage: 'failed',
      blocking: { kind: 'failed', reason: 'one or more video segments failed' },
      nextAction,
      allowedOperationIds: [nextAction.operationId],
    })
  }

  if (snapshot.failedChapterRenderCount > 0) {
    const nextAction = workflowAction('render_chapters', 'Render chapter videos')
    return state({
      stage: 'failed',
      blocking: { kind: 'failed', reason: 'one or more chapter renders failed' },
      nextAction,
      allowedOperationIds: [nextAction.operationId],
    })
  }

  if (!videoReady) {
    const videoAction = workflowAction('generate_episode_videos', 'Generate videos')
    const chapterAction = workflowAction('render_chapters', 'Render chapter videos')
    const hasRenderableUnrenderedChapter = snapshot.renderableChapterCount > snapshot.completedChapterRenderCount
    const nextAction = hasRenderableUnrenderedChapter ? chapterAction : videoAction
    const allowedOperationIds: EditFirstWorkflowOperationId[] = hasRenderableUnrenderedChapter
      ? [chapterAction.operationId, videoAction.operationId]
      : [videoAction.operationId]
    if (snapshot.activeVideoTaskCount > 0) {
      return state({
        stage: 'videos_generating',
        blocking: { kind: 'processing', reason: 'video segments are still generating' },
        allowedOperationIds: [],
      })
    }
    return state({
      stage: 'ready_to_generate_videos',
      nextAction,
      allowedOperationIds,
    })
  }

  if (!chapterRenderReady) {
    if (chapterRenderRunning) {
      return state({
        stage: 'chapters_rendering',
        blocking: { kind: 'processing', reason: 'chapter renders are still running' },
      })
    }
    return state({
      stage: 'ready_to_render_chapters',
      nextAction: workflowAction('render_chapters', 'Render chapter videos'),
      allowedOperationIds: ['render_chapters'],
    })
  }

  if (bgmRunning) {
    return state({
      stage: 'bgm_score_generating',
      blocking: { kind: 'processing', reason: 'audio layer generation is still running' },
      allowedOperationIds: soundscapeSatisfied ? [] : [soundscapeOperationId],
    })
  }

  if (soundscapePlanning) {
    return state({
      stage: 'soundscape_planning',
      blocking: { kind: 'processing', reason: 'soundscape planning is still running' },
      allowedOperationIds: bgmReady ? [] : ['generate_episode_bgm_score'],
    })
  }

  if (soundscapeGenerating) {
    return state({
      stage: 'audio_layers_generating',
      blocking: { kind: 'processing', reason: 'soundscape generation is still running' },
      allowedOperationIds: bgmReady ? [] : ['generate_episode_bgm_score'],
    })
  }

  if (bgmFailed) {
    const nextAction = workflowAction('generate_episode_bgm_score', 'Regenerate BGM score')
    return state({
      stage: 'failed',
      blocking: { kind: 'failed', reason: 'BGM score generation failed' },
      nextAction,
      allowedOperationIds: [nextAction.operationId],
    })
  }

  if (soundscapeFailed) {
    const nextAction = workflowAction(
      soundscapeOperationId,
      soundscapeOperationId === 'generate_episode_soundscape'
        ? 'Regenerate soundscape audio'
        : 'Replan soundscape',
    )
    return state({
      stage: 'failed',
      blocking: { kind: 'failed', reason: 'soundscape generation failed' },
      nextAction,
      allowedOperationIds: [nextAction.operationId],
    })
  }

  if (bgmReady && soundscapeReadyForGeneration) {
    return state({
      stage: 'ready_to_generate_soundscape',
      nextAction: workflowAction('generate_episode_soundscape', 'Generate soundscape audio'),
      allowedOperationIds: ['generate_episode_soundscape'],
    })
  }

  if (!bgmReady || !soundscapeSatisfied) {
    const missingActions: EditFirstWorkflowOperationId[] = []
    if (!bgmReady) missingActions.push('generate_episode_bgm_score')
    if (!soundscapeSatisfied) missingActions.push(soundscapeOperationId)
    const nextOperationId = missingActions[0]
    if (!nextOperationId) {
      throw new Error('EDIT_FIRST_AUDIO_LAYER_ACTION_REQUIRED')
    }
    const nextAction = workflowAction(
      nextOperationId,
      nextOperationId === 'generate_episode_bgm_score'
        ? 'Generate BGM score'
        : nextOperationId === 'plan_episode_soundscape'
          ? 'Plan soundscape'
          : 'Generate soundscape audio',
    )
    return state({
      stage: 'ready_to_generate_audio_layers',
      nextAction,
      allowedOperationIds: missingActions,
    })
  }

  const finalRenderAction = workflowAction('render_final_video', 'Render final video')
  return state({
    stage: 'ready_to_render_final',
    nextAction: finalRenderAction,
    allowedOperationIds: [finalRenderAction.operationId],
  })
}

export async function resolveEditFirstWorkflowState(params: {
  projectId: string
  userId: string
  episodeId?: string | null
}): Promise<EditFirstWorkflowState> {
  if (!params.episodeId) return EDIT_FIRST_WORKFLOW_EMPTY_STATE

  const project = await prisma.project.findFirst({
    where: {
      id: params.projectId,
      userId: params.userId,
    },
    select: { id: true },
  })
  if (!project) return EDIT_FIRST_WORKFLOW_EMPTY_STATE

  const [
    editBible,
    editScripts,
    shotExecutionPlans,
    storyboards,
    panels,
    videoGroups,
    chapters,
    finalOutput,
    musicScore,
    soundscape,
    activeSourceScriptTaskCount,
    activeBibleTaskCount,
    activeEditScriptTaskCount,
    activeShotExecutionPlanTaskCount,
    activeBgmScoreTaskCount,
    activeSoundscapePlanTaskCount,
    activeSoundscapeGenerationTaskCount,
    activeChapterRenderTaskCount,
    activeFinalRenderTaskCount,
    plannedCharacters,
    plannedLocations,
    activePlannedAssetTaskCount,
  ] = await Promise.all([
    prisma.projectEditBible.findFirst({
      where: {
        episodeId: params.episodeId,
        episode: { projectId: params.projectId },
      },
      select: {
        id: true,
        status: true,
        bibleJson: true,
        sourceDocument: {
          select: {
            sourceKind: true,
          },
        },
        stylePreviews: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    }),
    prisma.projectEditScript.findMany({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        chapterId: true,
        status: true,
        assetReviewStatus: true,
        corePlanJson: true,
        requirements: {
          select: {
            kind: true,
            status: true,
            targetId: true,
          },
        },
      },
    }),
    prisma.projectEditShotExecutionPlan.findMany({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        chapterId: true,
        editScriptId: true,
        status: true,
      },
    }),
    prisma.projectStoryboard.findMany({
      where: {
        episodeId: params.episodeId,
        episode: {
          projectId: params.projectId,
        },
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        editScriptId: true,
        lastError: true,
      },
    }),
    prisma.projectPanel.findMany({
      where: {
        storyboard: {
          episodeId: params.episodeId,
          episode: {
            projectId: params.projectId,
          },
        },
      },
      select: {
        id: true,
        storyboardId: true,
        imageUrl: true,
        imageMediaId: true,
        imagePrompt: true,
        videoPrompt: true,
      },
    }),
    prisma.projectVideoGroup.findMany({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
      },
      select: {
        id: true,
        chapterId: true,
        shotIds: true,
        status: true,
        videoUrl: true,
        videoMediaId: true,
      },
    }),
    prisma.projectEditChapter.findMany({
      where: {
        episodeId: params.episodeId,
        episode: { projectId: params.projectId },
      },
      select: {
        id: true,
        renderStatus: true,
        outputMediaId: true,
      },
    }),
    prisma.projectEpisodeFinalOutput.findUnique({
      where: {
        episodeId: params.episodeId,
      },
      select: {
        renderStatus: true,
        outputUrl: true,
        outputMediaId: true,
      },
    }),
    prisma.projectEditMusicScore.findUnique({
      where: {
        episodeId: params.episodeId,
      },
      select: {
        status: true,
        mixJson: true,
      },
    }),
    prisma.projectEditSoundscape.findUnique({
      where: {
        episodeId: params.episodeId,
      },
      select: {
        status: true,
        planJson: true,
        mixJson: true,
      },
    }),
    prisma.task.count({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        type: TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE,
        status: { in: [...ACTIVE_WORKFLOW_TASK_STATUSES] },
      },
    }),
    prisma.task.count({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        type: TASK_TYPE.EDIT_BIBLE_GENERATE,
        status: { in: [...ACTIVE_WORKFLOW_TASK_STATUSES] },
      },
    }),
    prisma.task.count({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        type: TASK_TYPE.EDIT_SCRIPT_GENERATE,
        status: { in: [...ACTIVE_WORKFLOW_TASK_STATUSES] },
      },
    }),
    prisma.task.count({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        type: TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE,
        status: { in: [...ACTIVE_WORKFLOW_TASK_STATUSES] },
      },
    }),
    prisma.task.count({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        targetType: 'ProjectEpisode',
        targetId: params.episodeId,
        type: TASK_TYPE.MUSIC_SCORE_PLAN,
        status: { in: [...ACTIVE_WORKFLOW_TASK_STATUSES] },
      },
    }),
    prisma.task.count({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        targetType: 'ProjectEpisode',
        targetId: params.episodeId,
        type: TASK_TYPE.SOUNDSCAPE_PLAN,
        status: { in: [...ACTIVE_WORKFLOW_TASK_STATUSES] },
      },
    }),
    prisma.task.count({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        targetType: 'ProjectEpisode',
        targetId: params.episodeId,
        type: TASK_TYPE.SOUNDSCAPE_GENERATE,
        status: { in: [...ACTIVE_WORKFLOW_TASK_STATUSES] },
      },
    }),
    prisma.task.count({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        type: TASK_TYPE.CHAPTER_RENDER,
        status: { in: [...ACTIVE_WORKFLOW_TASK_STATUSES] },
      },
    }),
    prisma.task.count({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        targetType: 'ProjectEpisode',
        targetId: params.episodeId,
        type: TASK_TYPE.FINAL_VIDEO_RENDER,
        status: { in: [...ACTIVE_WORKFLOW_TASK_STATUSES] },
      },
    }),
    prisma.projectCharacter.findMany({
      where: { projectId: params.projectId },
      select: {
        name: true,
        appearances: {
          orderBy: { appearanceIndex: 'asc' },
          take: 1,
          select: { imageUrl: true, imageMediaId: true, imageUrls: true },
        },
      },
    }),
    prisma.projectLocation.findMany({
      where: { projectId: params.projectId, assetKind: 'location' },
      select: {
        name: true,
        images: {
          orderBy: { imageIndex: 'asc' },
          take: 1,
          select: { imageUrl: true, imageMediaId: true },
        },
      },
    }),
    prisma.task.count({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        type: { in: [TASK_TYPE.IMAGE_CHARACTER, TASK_TYPE.IMAGE_LOCATION] },
        status: { in: [...ACTIVE_WORKFLOW_TASK_STATUSES] },
      },
    }),
  ])

  const expectedChapterCount = chapters.length
  const plannedCharacterNames = plannedBibleAssetNameKeys(editBible?.bibleJson, 'characters')
  const plannedLocationNames = plannedBibleAssetNameKeys(editBible?.bibleJson, 'locations')
  const scopedPlannedCharacters = plannedCharacters.filter((character) => plannedCharacterNames.has(
    character.name.trim().replace(/\s+/g, ' ').toLocaleLowerCase(),
  ))
  const scopedPlannedLocations = plannedLocations.filter((location) => plannedLocationNames.has(
    location.name.trim().replace(/\s+/g, ' ').toLocaleLowerCase(),
  ))
  const plannedAssetCount = scopedPlannedCharacters.length + scopedPlannedLocations.length
  const pendingPlannedAssetCount = scopedPlannedCharacters.filter((character) => {
    const appearance = character.appearances[0]
    if (!appearance) return true
    const imageUrls = typeof appearance.imageUrls === 'string'
      ? appearance.imageUrls.trim()
      : JSON.stringify(appearance.imageUrls ?? null)
    return !appearance.imageMediaId && !appearance.imageUrl && (!imageUrls || imageUrls === '[]' || imageUrls === 'null')
  }).length + scopedPlannedLocations.filter((location) => {
    const image = location.images[0]
    return !image?.imageMediaId && !image?.imageUrl
  }).length
  const editScriptIds = new Set(editScripts.map((script) => script.id))
  const allEditScriptRequirements = editScripts.flatMap((script) => script.requirements)
  const editScriptStatus = resolveEpisodeArtifactStatus({
    statuses: editScripts.map((script) => script.status),
    expectedCount: expectedChapterCount,
    activeTaskCount: activeEditScriptTaskCount,
  })
  const shotExecutionPlanStatus = resolveEpisodeArtifactStatus({
    statuses: shotExecutionPlans.map((plan) => plan.status),
    expectedCount: expectedChapterCount,
    activeTaskCount: activeShotExecutionPlanTaskCount,
  })
  const editScriptAssetReviewStatus = resolveEpisodeAssetReviewStatus(
    editScripts.map((script) => script.assetReviewStatus),
  )
  const locationTargetIds = Array.from(new Set(allEditScriptRequirements
    .filter((requirement) => requirement.kind === 'location' && typeof requirement.targetId === 'string' && requirement.targetId.trim().length > 0)
    .map((requirement) => requirement.targetId!)
    .filter(Boolean)))
  const locationRows = locationTargetIds.length > 0
    ? await prisma.projectLocation.findMany({
      where: {
        id: { in: locationTargetIds },
        projectId: params.projectId,
      },
      select: {
        id: true,
        selectedImageId: true,
        images: {
          select: {
            id: true,
            isSelected: true,
            imageUrl: true,
            imageMediaId: true,
            spatialProfileStatus: true,
            spatialProfileJson: true,
          },
        },
      },
    })
    : []
  const locationById = new Map(locationRows.map((location) => [location.id, location]))
  const locationSpatialProfileReadiness = resolveLocationSpatialProfileReadiness(
    allEditScriptRequirements
      .filter((requirement) => requirement.kind === 'location')
      .map((requirement) => {
        const targetId = requirement.targetId ?? null
	        return {
	          targetId,
	          selectedImage: targetId
	            ? (() => {
	                const location = locationById.get(targetId)
	                return location?.images.find((image) => image.id === location.selectedImageId)
	                  ?? location?.images.find((image) => image.isSelected)
	                  ?? location?.images.find((image) => Boolean(image.imageUrl || image.imageMediaId))
	                  ?? null
	              })()
	            : null,
	        }
	      }),
  )
  const storyboardPlanStageSummary = resolveStoryboardPlanStageSummary({
    editScriptIds,
    storyboards,
  })
  const generationSegments = editScripts.flatMap((script) =>
    readEditScriptGenerationSegments(script.corePlanJson).map((segment) => ({
      ...segment,
      chapterId: script.chapterId ?? null,
    })))
  const videoGroupCandidates: WorkflowVideoGroupCandidate[] = videoGroups.map((group) => ({
    chapterId: group.chapterId,
    shotIds: readShotIds(group.shotIds),
    status: group.status,
    videoUrl: group.videoUrl,
    videoMediaId: group.videoMediaId,
  }))
  const plannedVideoGroups = generationSegments.map((segment) =>
    findVideoGroupForShotIds(videoGroupCandidates, segment.chapterId, segment.shotIds))
  const renderableChapterCount = chapters.filter((chapter) => {
    const chapterSegments = generationSegments.filter((segment) => segment.chapterId === chapter.id)
    return chapterSegments.length > 0 && chapterSegments.every((segment) =>
      videoGroupHasOutput(findVideoGroupForShotIds(videoGroupCandidates, segment.chapterId, segment.shotIds)))
  }).length
  const bgmScoreStatus = readMusicScoreStatus(musicScore)
  const soundscapeStatus = typeof soundscape?.status === 'string' ? soundscape.status : null
  const editScriptStoryboardIds = new Set(storyboardPlanStageSummary.matchingStoryboardIds)
  const editScriptPanels = panels.filter((panel) => editScriptStoryboardIds.has(panel.storyboardId))
  const storyboardImageReadiness = resolveStoryboardImageReadiness(editScriptPanels)
  const activeStoryboardPanelTaskCount = editScriptIds.size > 0
    ? await prisma.task.count({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        targetType: 'ProjectEditScript',
        targetId: { in: [...editScriptIds] },
        type: TASK_TYPE.EDIT_SCRIPT_STORYBOARD_CAMERA_PLAN,
        status: { in: ['queued', 'processing'] },
      },
    })
    : 0
  const activeStylePreviewTaskCount = editBible
    ? await prisma.task.count({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        status: { in: ['queued', 'processing'] },
        OR: [
          {
            targetType: 'ProjectEditBible',
            targetId: editBible.id,
            type: TASK_TYPE.EDIT_STYLE_PREVIEW_OPTIONS_GENERATE,
          },
          {
            targetType: 'ProjectEditStylePreview',
            targetId: { in: editBible.stylePreviews.map((preview) => preview.id) },
            type: TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
          },
        ],
      },
    })
    : 0
  const panelIds = editScriptPanels.map((panel) => panel.id)
  const activeStoryboardImageTaskCount = panelIds.length > 0
    ? await prisma.task.count({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        targetType: 'ProjectPanel',
        targetId: { in: panelIds },
        type: TASK_TYPE.IMAGE_PANEL,
        status: { in: ['queued', 'processing'] },
      },
    })
    : 0
  const storyboardPanelImageFailedCount = panelIds.length > 0
    ? await prisma.task.count({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        targetType: 'ProjectPanel',
        targetId: { in: panelIds },
        type: TASK_TYPE.IMAGE_PANEL,
        status: 'failed',
      },
    })
    : 0
  return resolveEditFirstWorkflowStateFromSnapshot({
    hasEpisode: true,
    hasBible: Boolean(editBible),
    bibleStatus: editBible?.status ?? null,
    sourceDocumentKind: editBible?.sourceDocument?.sourceKind ?? null,
    activeSourceScriptTaskCount,
    activeBibleTaskCount,
    stylePreviewCount: editBible?.stylePreviews.length ?? 0,
    completedStylePreviewCount: editBible?.stylePreviews.filter((preview) => preview.status === 'completed').length ?? 0,
    confirmedStylePreviewCount: editBible?.stylePreviews.filter((preview) => preview.status === 'confirmed').length ?? 0,
    failedStylePreviewCount: editBible?.stylePreviews.filter((preview) => preview.status === 'failed').length ?? 0,
    activeStylePreviewTaskCount,
    plannedAssetCount,
    pendingPlannedAssetCount,
    activePlannedAssetTaskCount,
    hasEditScript: editScripts.length > 0,
    activeEditScriptTaskCount,
    editScriptStatus,
    editScriptAssetReviewStatus,
    editAssetRequirementCount: allEditScriptRequirements.length,
    pendingAssetRequirementCount: allEditScriptRequirements.filter((requirement) => requirement.status !== 'completed').length,
    generatingAssetRequirementCount: allEditScriptRequirements.filter((requirement) => requirement.status === 'generating').length,
    requiredLocationSpatialProfileCount: locationSpatialProfileReadiness.requiredCount,
    readyLocationSpatialProfileCount: locationSpatialProfileReadiness.readyCount,
    hasShotExecutionPlan: shotExecutionPlans.length > 0,
    activeShotExecutionPlanTaskCount,
    shotExecutionPlanStatus,
    storyboardCount: editScriptStoryboardIds.size,
    storyboardPanelPromptFailed: storyboardPlanStageSummary.storyboardPanelPromptFailed,
    activeStoryboardPanelTaskCount,
    panelCount: storyboardImageReadiness.panelCount,
    storyboardPanelImagePromptMissingCount: editScriptPanels.filter((panel) => !hasText(panel.imagePrompt)).length,
    storyboardPanelVideoPromptMissingCount: editScriptPanels.filter((panel) => !hasText(panel.videoPrompt)).length,
    storyboardPanelImageReadyCount: storyboardImageReadiness.readyCount,
    storyboardPanelImageMissingCount: storyboardImageReadiness.missingCount,
    storyboardPanelImageFailedCount,
    activeStoryboardImageTaskCount,
    videoPlanSegmentCount: generationSegments.length,
    completedVideoSegmentCount: plannedVideoGroups.filter(videoGroupHasOutput).length,
    failedVideoSegmentCount: plannedVideoGroups.filter((group) => group?.status === 'failed').length,
    activeVideoTaskCount: plannedVideoGroups.filter((group) => isActiveWorkflowStatus(group?.status)).length,
    chapterCount: chapters.length,
    renderableChapterCount,
    completedChapterRenderCount: chapters.filter((item) => hasOutputReference(item.outputMediaId ?? null) && item.renderStatus === 'completed').length,
    failedChapterRenderCount: chapters.filter((item) => item.renderStatus === 'failed').length,
    activeChapterRenderTaskCount,
    bgmScoreStatus,
    bgmScoreHasMix: Boolean(readCompletedMusicScoreMix(musicScore)),
    activeBgmScoreTaskCount,
    soundscapeStatus,
    soundscapeHasMix: Boolean(readCompletedSoundscapeMix(soundscape)),
    soundscapeDecision: readSoundscapeDecision(soundscape),
    activeSoundscapePlanTaskCount,
    activeSoundscapeGenerationTaskCount,
    finalRenderStatus: finalOutput?.renderStatus ?? null,
    finalRenderHasOutput: Boolean(
      hasOutputReference(finalOutput?.outputUrl ?? null)
      || hasOutputReference(finalOutput?.outputMediaId ?? null),
    ),
    activeFinalRenderTaskCount,
  })
}
