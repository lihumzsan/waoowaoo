import { prisma } from '@/lib/prisma'
import { readCompletedMusicScoreMix, readMusicScoreStatus } from '@/lib/music-score/project-data'
import { editScriptStructureSchema } from '@/lib/edit-script/types'
import { TASK_TYPE } from '@/lib/task/types'
import {
  resolveLocationSpatialProfileReadiness,
  resolveStoryboardImageReadiness,
} from './edit-first-readiness'
import {
  isEditFirstAutoApprovedOperationId,
  type EditFirstWorkflowOperationId,
} from './edit-first-operation-policy'
export {
  EDIT_FIRST_AUTO_APPROVED_OPERATION_IDS,
  EDIT_FIRST_WORKFLOW_OPERATION_IDS,
  type EditFirstWorkflowOperationId,
} from './edit-first-operation-policy'

export type EditFirstWorkflowStage =
  | 'not_started'
  | 'ready_to_ingest_script'
  | 'bible_generating'
  | 'bible_ready_for_review'
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
  requiresUserConfirmation: boolean
}

export interface EditFirstWorkflowState {
  active: boolean
  stage: EditFirstWorkflowStage
  blocking: {
    kind: EditFirstWorkflowBlockingKind
    reason: string | null
  }
  nextAction: EditFirstWorkflowAction | null
  allowedOperationIds: EditFirstWorkflowOperationId[]
}

export interface EditFirstWorkflowSnapshot {
  hasEpisode: boolean
  hasBible: boolean
  bibleStatus: string | null
  stylePreviewCount: number
  completedStylePreviewCount: number
  confirmedStylePreviewCount: number
  failedStylePreviewCount: number
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
  completedChapterRenderCount: number
  failedChapterRenderCount: number
  activeChapterRenderTaskCount: number
  bgmScoreStatus: string | null
  bgmScoreHasMix: boolean
  activeBgmScoreTaskCount: number
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
}

function workflowAction(
  operationId: EditFirstWorkflowOperationId,
  title: string,
): EditFirstWorkflowAction {
  return {
    id: operationId,
    operationId,
    title,
    requiresUserConfirmation: !isEditFirstAutoApprovedOperationId(operationId),
  }
}

function state(params: {
  active?: boolean
  stage: EditFirstWorkflowStage
  blocking?: EditFirstWorkflowState['blocking']
  nextAction?: EditFirstWorkflowAction | null
  allowedOperationIds?: readonly EditFirstWorkflowOperationId[]
}): EditFirstWorkflowState {
  const nextAction = params.nextAction ?? null
  return {
    active: params.active ?? true,
    stage: params.stage,
    blocking: params.blocking ?? {
      kind: nextAction && nextAction.requiresUserConfirmation ? 'needs_confirmation' : 'none',
      reason: null,
    },
    nextAction,
    allowedOperationIds: params.allowedOperationIds ? [...params.allowedOperationIds] : nextAction ? [nextAction.operationId] : [],
  }
}

type StoryboardSpatialCandidate = {
  readonly id: string
  readonly editScriptId: string | null
  readonly lastError: string | null
}

type WorkflowVideoGroupCandidate = {
  readonly shotIds: readonly string[]
  readonly status: string
  readonly videoUrl: string | null
  readonly videoMediaId: string | null
}

const ACTIVE_WORKFLOW_TASK_STATUSES = ['queued', 'processing'] as const

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
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
  shotIds: readonly string[],
): WorkflowVideoGroupCandidate | null {
  return groups.find((group) => sameShotIds(group.shotIds, shotIds)) ?? null
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
      nextAction: workflowAction('ingest_script', 'Regenerate bible'),
    })
  }

  if (snapshot.bibleStatus === 'pending' || snapshot.bibleStatus === 'generating') {
    return state({
      stage: 'bible_generating',
      blocking: { kind: 'processing', reason: 'edit bible generation is still running' },
    })
  }

  if (snapshot.bibleStatus === 'ready_for_review') {
    const nextAction = workflowAction('confirm_bible', 'Confirm bible')
    return state({
      stage: 'bible_ready_for_review',
      blocking: { kind: 'needs_user_choice', reason: 'review bible and choose approval or revision before style preview generation' },
      nextAction,
      allowedOperationIds: [nextAction.operationId, 'revise_bible'],
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
      const hasCompletedAndFailedPreviews = snapshot.completedStylePreviewCount > 0 && snapshot.failedStylePreviewCount > 0
      return state({
        stage: hasCompletedAndFailedPreviews ? 'needs_style_choice' : 'style_preview_generating',
        blocking: hasCompletedAndFailedPreviews
          ? { kind: 'needs_user_choice', reason: 'choose and confirm one completed style preview' }
          : { kind: 'processing', reason: 'style preview images are still generating' },
        allowedOperationIds: hasCompletedAndFailedPreviews ? ['generate_edit_style_previews'] : [],
      })
    }

    if (snapshot.stylePreviewCount === 0) {
      const nextAction = workflowAction('generate_edit_style_previews', 'Generate style previews')
      return state({
        stage: 'needs_style_choice',
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
    if (snapshot.activeEditScriptTaskCount > 0) {
      return state({
        stage: 'edit_script_generating',
        blocking: { kind: 'processing', reason: 'chapter edit planning tasks are still running' },
      })
    }
    return state({
      stage: 'ready_to_generate_edit_script',
      nextAction: workflowAction('plan_chapters', 'Plan chapters'),
    })
  }

  if (snapshot.editScriptStatus === 'failed') {
    return state({
      stage: 'failed',
      blocking: { kind: 'failed', reason: 'edit core table generation failed' },
      nextAction: workflowAction('replan_chapter', 'Regenerate chapter edit core table'),
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

  if (snapshot.panelCount === 0) {
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
    if (snapshot.activeVideoTaskCount > 0) {
      return state({
        stage: 'videos_generating',
        blocking: { kind: 'processing', reason: 'video segments are still generating' },
        allowedOperationIds: [],
      })
    }
    return state({
      stage: 'ready_to_generate_videos',
      nextAction: videoAction,
      allowedOperationIds: [videoAction.operationId],
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

  const finalRenderAction = workflowAction('render_final_video', 'Render final video')
  const optionalBgmOperationIds: readonly EditFirstWorkflowOperationId[] = !bgmReady && !bgmRunning
    ? ['generate_episode_bgm_score']
    : []
  return state({
    stage: 'ready_to_render_final',
    nextAction: finalRenderAction,
    allowedOperationIds: [finalRenderAction.operationId, ...optionalBgmOperationIds],
  })
}

export function resolveEditFirstWorkflowCapabilityOperationIds(
  workflow: EditFirstWorkflowState,
): EditFirstWorkflowOperationId[] {
  if (!workflow.active && workflow.stage === 'not_started') return ['ingest_script']
  switch (workflow.stage) {
    case 'ready_to_ingest_script':
      return ['ingest_script']
    case 'bible_generating':
      return []
    case 'bible_ready_for_review':
      return ['confirm_bible', 'revise_bible']
    case 'style_preview_generating':
      return []
    case 'needs_style_choice':
      return ['generate_edit_style_previews']
    case 'ready_to_generate_edit_script':
      return ['plan_chapters']
    case 'edit_script_generating':
      return []
    case 'ready_to_generate_assets':
      return ['generate_edit_script_assets']
    case 'assets_generating':
      return []
    case 'assets_ready_for_review':
      return ['revise_edit_script_assets']
    case 'ready_to_generate_shot_execution_plan':
      return ['generate_edit_shot_execution_plan']
    case 'ready_to_generate_storyboard':
      return ['generate_edit_script_storyboard']
    case 'storyboard_generating':
      return []
    case 'ready_to_generate_storyboard_images':
      return ['generate_edit_script_storyboard_images']
    case 'storyboard_images_generating':
      return []
    case 'ready_to_generate_videos':
      return [...workflow.allowedOperationIds]
    case 'videos_generating':
      return [...workflow.allowedOperationIds]
    case 'ready_to_render_chapters':
      return ['render_chapters']
    case 'chapters_rendering':
      return []
    case 'ready_to_generate_bgm_score':
      return ['generate_episode_bgm_score']
    case 'bgm_score_generating':
      return [...workflow.allowedOperationIds]
    case 'ready_to_render_final':
      return [...workflow.allowedOperationIds]
    case 'final_rendering':
      return []
    case 'completed':
      return []
    case 'failed':
      return [...workflow.allowedOperationIds]
    case 'not_started':
      return ['ingest_script']
    default:
      return [...workflow.allowedOperationIds]
  }
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
    activeEditScriptTaskCount,
    activeBgmScoreTaskCount,
    activeChapterRenderTaskCount,
    activeFinalRenderTaskCount,
  ] = await Promise.all([
    prisma.projectEditBible.findFirst({
      where: {
        episodeId: params.episodeId,
        episode: { projectId: params.projectId },
      },
      select: {
        id: true,
        status: true,
        stylePreviews: {
          select: {
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
  ])

  const expectedChapterCount = chapters.length
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
    readEditScriptGenerationSegments(script.corePlanJson))
  const videoGroupCandidates: WorkflowVideoGroupCandidate[] = videoGroups.map((group) => ({
    shotIds: readShotIds(group.shotIds),
    status: group.status,
    videoUrl: group.videoUrl,
    videoMediaId: group.videoMediaId,
  }))
  const plannedVideoGroups = generationSegments.map((segment) =>
    findVideoGroupForShotIds(videoGroupCandidates, segment.shotIds))
  const bgmScoreStatus = readMusicScoreStatus(musicScore)
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
    stylePreviewCount: editBible?.stylePreviews.length ?? 0,
    completedStylePreviewCount: editBible?.stylePreviews.filter((preview) => preview.status === 'completed').length ?? 0,
    confirmedStylePreviewCount: editBible?.stylePreviews.filter((preview) => preview.status === 'confirmed').length ?? 0,
    failedStylePreviewCount: editBible?.stylePreviews.filter((preview) => preview.status === 'failed').length ?? 0,
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
    completedChapterRenderCount: chapters.filter((item) => hasOutputReference(item.outputMediaId ?? null) && item.renderStatus === 'completed').length,
    failedChapterRenderCount: chapters.filter((item) => item.renderStatus === 'failed').length,
    activeChapterRenderTaskCount,
    bgmScoreStatus,
    bgmScoreHasMix: Boolean(readCompletedMusicScoreMix(musicScore)),
    activeBgmScoreTaskCount,
    finalRenderStatus: finalOutput?.renderStatus ?? null,
    finalRenderHasOutput: Boolean(
      hasOutputReference(finalOutput?.outputUrl ?? null)
      || hasOutputReference(finalOutput?.outputMediaId ?? null),
    ),
    activeFinalRenderTaskCount,
  })
}
