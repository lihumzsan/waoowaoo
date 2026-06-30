import { prisma } from '@/lib/prisma'
import { parseBgmScoreJson, readCompletedBgmScoreMix } from '@/lib/bgm-score/project-data'
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
  | 'ready_to_generate_screenplay'
  | 'screenplay_ready_for_review'
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
  hasScreenplay: boolean
  screenplayStatus: string | null
  stylePreviewCount: number
  completedStylePreviewCount: number
  confirmedStylePreviewCount: number
  failedStylePreviewCount: number
  hasEditScript: boolean
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
  readonly shotNumbers: readonly number[]
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

function hasOutputReference(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function sameShotNumbers(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false
  return left.every((shotNumber, index) => shotNumber === right[index])
}

function readShotNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'number' ? item : Number(item)))
    .filter((item) => Number.isInteger(item) && item > 0)
}

function readEditScriptGenerationSegments(corePlanJson: unknown): readonly { readonly shotNumbers: readonly number[] }[] {
  const parsed = editScriptStructureSchema.safeParse(corePlanJson)
  if (!parsed.success) return []
  return parsed.data.generationSegments
}

function findVideoGroupForShotNumbers(
  groups: readonly WorkflowVideoGroupCandidate[],
  shotNumbers: readonly number[],
): WorkflowVideoGroupCandidate | null {
  return groups.find((group) => sameShotNumbers(group.shotNumbers, shotNumbers)) ?? null
}

function videoGroupHasOutput(group: WorkflowVideoGroupCandidate | null): boolean {
  return Boolean(group && (hasOutputReference(group.videoUrl) || hasOutputReference(group.videoMediaId)))
}

function readBgmScoreStatus(bgmScoreJson: unknown): string | null {
  const bgmScore = parseBgmScoreJson(bgmScoreJson)
  const status = bgmScore?.status
  return typeof status === 'string' && status.trim().length > 0 ? status.trim() : null
}

interface StoryboardPlanStageSummary {
  readonly matchingStoryboardIds: string[]
  readonly storyboardPanelPromptFailed: boolean
}

function resolveStoryboardPlanStageSummary(input: {
  readonly editScriptId: string | null
  readonly storyboards: readonly StoryboardSpatialCandidate[]
}): StoryboardPlanStageSummary {
  if (!input.editScriptId) {
    return {
      matchingStoryboardIds: [],
      storyboardPanelPromptFailed: false,
    }
  }
  const matching = input.storyboards.flatMap((storyboard) => {
    if (storyboard.editScriptId !== input.editScriptId) return []
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

  const hasAnyEditFirstArtifact = snapshot.hasScreenplay
    || snapshot.hasEditScript
    || snapshot.hasShotExecutionPlan

  if (!snapshot.hasScreenplay) {
    return state({
      active: hasAnyEditFirstArtifact,
      stage: hasAnyEditFirstArtifact ? 'failed' : 'ready_to_generate_screenplay',
      blocking: hasAnyEditFirstArtifact
        ? { kind: 'failed', reason: 'edit-first artifacts exist but screenplay is missing' }
        : { kind: 'none', reason: null },
      nextAction: workflowAction('generate_edit_screenplay', 'Generate screenplay'),
    })
  }

  if (snapshot.screenplayStatus === 'failed') {
    return state({
      stage: 'failed',
      blocking: { kind: 'failed', reason: 'screenplay generation failed' },
      nextAction: workflowAction('generate_edit_screenplay', 'Regenerate screenplay'),
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

  if (snapshot.screenplayStatus === 'style_preview_generating' && snapshot.completedStylePreviewCount > 0 && snapshot.failedStylePreviewCount > 0) {
    return state({
      stage: 'needs_style_choice',
      blocking: { kind: 'needs_user_choice', reason: 'choose and confirm one completed style preview' },
      allowedOperationIds: ['generate_edit_style_previews'],
    })
  }

  if (snapshot.screenplayStatus === 'style_preview_generating') {
    return state({
      stage: 'style_preview_generating',
      blocking: { kind: 'processing', reason: 'style preview images are still generating' },
    })
  }

  if (snapshot.screenplayStatus === 'screenplay_ready') {
    const nextAction = workflowAction('generate_edit_style_previews', 'Generate style previews')
    return state({
      stage: 'screenplay_ready_for_review',
      blocking: { kind: 'needs_user_choice', reason: 'review screenplay and choose approval or revision before style preview generation' },
      nextAction,
      allowedOperationIds: [nextAction.operationId, 'revise_edit_screenplay'],
    })
  }

  if (snapshot.screenplayStatus === 'style_preview_ready') {
    return state({
      stage: 'needs_style_choice',
      blocking: { kind: 'needs_user_choice', reason: 'choose and confirm one completed style preview' },
      allowedOperationIds: ['generate_edit_style_previews'],
    })
  }

  if (snapshot.screenplayStatus !== 'ready') {
    return state({
      stage: 'style_preview_generating',
      blocking: { kind: 'processing', reason: `screenplay status is ${snapshot.screenplayStatus ?? 'unknown'}` },
    })
  }

  if (!snapshot.hasEditScript) {
    return state({
      stage: 'ready_to_generate_edit_script',
      nextAction: workflowAction('generate_edit_script', 'Generate edit core table'),
    })
  }

  if (snapshot.editScriptStatus === 'failed') {
    return state({
      stage: 'failed',
      blocking: { kind: 'failed', reason: 'edit core table generation failed' },
      nextAction: workflowAction('generate_edit_script', 'Regenerate edit core table'),
    })
  }

  if (snapshot.editScriptStatus !== 'ready') {
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
      allowedOperationIds: bgmReady || bgmRunning
        ? [nextAction.operationId]
        : [nextAction.operationId, 'generate_episode_bgm_score'],
    })
  }

  if (snapshot.bgmScoreStatus === 'failed') {
    const nextAction = workflowAction('generate_episode_bgm_score', 'Regenerate BGM score')
    return state({
      stage: 'failed',
      blocking: { kind: 'failed', reason: 'BGM score generation failed' },
      nextAction,
      allowedOperationIds: videoReady
        ? [nextAction.operationId]
        : ['generate_episode_videos', nextAction.operationId],
    })
  }

  if (!videoReady) {
    const canGenerateBgm = !bgmReady && !bgmRunning
    const videoAction = workflowAction('generate_episode_videos', 'Generate videos')
    if (snapshot.activeVideoTaskCount > 0) {
      return state({
        stage: 'videos_generating',
        blocking: { kind: 'processing', reason: 'video segments are still generating' },
        allowedOperationIds: canGenerateBgm ? ['generate_episode_bgm_score'] : [],
      })
    }
    return state({
      stage: 'ready_to_generate_videos',
      nextAction: videoAction,
      allowedOperationIds: canGenerateBgm
        ? [videoAction.operationId, 'generate_episode_bgm_score']
        : [videoAction.operationId],
    })
  }

  if (!bgmReady) {
    if (bgmRunning) {
      return state({
        stage: 'bgm_score_generating',
        blocking: { kind: 'processing', reason: 'BGM score is still generating' },
      })
    }
    return state({
      stage: 'ready_to_generate_bgm_score',
      nextAction: workflowAction('generate_episode_bgm_score', 'Generate BGM score'),
    })
  }

  return state({
    stage: 'ready_to_render_final',
    nextAction: workflowAction('render_final_video', 'Render final video'),
  })
}

export function resolveEditFirstWorkflowCapabilityOperationIds(
  workflow: EditFirstWorkflowState,
): EditFirstWorkflowOperationId[] {
  if (!workflow.active && workflow.stage === 'not_started') return ['generate_edit_screenplay']
  switch (workflow.stage) {
    case 'ready_to_generate_screenplay':
      return ['generate_edit_screenplay']
    case 'screenplay_ready_for_review':
      return ['revise_edit_screenplay', 'generate_edit_style_previews']
    case 'style_preview_generating':
      return []
    case 'needs_style_choice':
      return ['generate_edit_style_previews']
    case 'ready_to_generate_edit_script':
      return ['generate_edit_script']
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
    case 'ready_to_generate_bgm_score':
      return ['generate_episode_bgm_score']
    case 'bgm_score_generating':
      return [...workflow.allowedOperationIds]
    case 'ready_to_render_final':
      return ['render_final_video']
    case 'final_rendering':
      return []
    case 'completed':
      return []
    case 'failed':
      return [...workflow.allowedOperationIds]
    case 'not_started':
      return ['generate_edit_screenplay']
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
    screenplay,
    editScript,
    shotExecutionPlan,
    storyboards,
    panels,
    videoGroups,
    finalOutput,
    activeBgmScoreTaskCount,
    activeFinalRenderTaskCount,
  ] = await Promise.all([
    prisma.projectEditScreenplay.findFirst({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
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
    prisma.projectEditScript.findFirst({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
      },
      select: {
        id: true,
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
    prisma.projectEditShotExecutionPlan.findFirst({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
      },
      select: {
        id: true,
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
        shotNumbers: true,
        status: true,
        videoUrl: true,
        videoMediaId: true,
      },
    }),
    prisma.projectEpisodeFinalOutput.findUnique({
      where: {
        episodeId: params.episodeId,
      },
      select: {
        bgmScoreJson: true,
        renderStatus: true,
        outputUrl: true,
        outputMediaId: true,
      },
    }),
    prisma.task.count({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        targetType: 'ProjectEpisode',
        targetId: params.episodeId,
        type: TASK_TYPE.BGM_SCORE_GENERATE,
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

  const locationTargetIds = Array.from(new Set((editScript?.requirements ?? [])
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
        selectedImage: {
          select: {
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
    (editScript?.requirements ?? [])
      .filter((requirement) => requirement.kind === 'location')
      .map((requirement) => {
        const targetId = requirement.targetId ?? null
        return {
          targetId,
          selectedImage: targetId ? locationById.get(targetId)?.selectedImage ?? null : null,
        }
      }),
  )
  const storyboardPlanStageSummary = resolveStoryboardPlanStageSummary({
    editScriptId: editScript?.id ?? null,
    storyboards,
  })
  const generationSegments = editScript
    ? readEditScriptGenerationSegments(editScript.corePlanJson)
    : []
  const videoGroupCandidates: WorkflowVideoGroupCandidate[] = videoGroups.map((group) => ({
    shotNumbers: readShotNumbers(group.shotNumbers),
    status: group.status,
    videoUrl: group.videoUrl,
    videoMediaId: group.videoMediaId,
  }))
  const plannedVideoGroups = generationSegments.map((segment) =>
    findVideoGroupForShotNumbers(videoGroupCandidates, segment.shotNumbers))
  const bgmScoreStatus = readBgmScoreStatus(finalOutput?.bgmScoreJson ?? null)
  const editScriptStoryboardIds = new Set(storyboardPlanStageSummary.matchingStoryboardIds)
  const editScriptPanels = panels.filter((panel) => editScriptStoryboardIds.has(panel.storyboardId))
  const storyboardImageReadiness = resolveStoryboardImageReadiness(editScriptPanels)
  const activeStoryboardPanelTaskCount = editScript?.id
    ? await prisma.task.count({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        targetType: 'ProjectEditScript',
        targetId: editScript.id,
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
    hasScreenplay: Boolean(screenplay),
    screenplayStatus: screenplay?.status ?? null,
    stylePreviewCount: screenplay?.stylePreviews.length ?? 0,
    completedStylePreviewCount: screenplay?.stylePreviews.filter((preview) => preview.status === 'completed').length ?? 0,
    confirmedStylePreviewCount: screenplay?.stylePreviews.filter((preview) => preview.status === 'confirmed').length ?? 0,
    failedStylePreviewCount: screenplay?.stylePreviews.filter((preview) => preview.status === 'failed').length ?? 0,
    hasEditScript: Boolean(editScript),
    editScriptStatus: editScript?.status ?? null,
    editScriptAssetReviewStatus: editScript?.assetReviewStatus ?? null,
    editAssetRequirementCount: editScript?.requirements.length ?? 0,
    pendingAssetRequirementCount: editScript?.requirements.filter((requirement) => requirement.status !== 'completed').length ?? 0,
    generatingAssetRequirementCount: editScript?.requirements.filter((requirement) => requirement.status === 'generating').length ?? 0,
    requiredLocationSpatialProfileCount: locationSpatialProfileReadiness.requiredCount,
    readyLocationSpatialProfileCount: locationSpatialProfileReadiness.readyCount,
    hasShotExecutionPlan: Boolean(shotExecutionPlan),
    shotExecutionPlanStatus: shotExecutionPlan?.status ?? null,
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
    bgmScoreStatus,
    bgmScoreHasMix: Boolean(readCompletedBgmScoreMix(finalOutput?.bgmScoreJson ?? null)),
    activeBgmScoreTaskCount,
    finalRenderStatus: finalOutput?.renderStatus ?? null,
    finalRenderHasOutput: Boolean(
      hasOutputReference(finalOutput?.outputUrl ?? null)
      || hasOutputReference(finalOutput?.outputMediaId ?? null),
    ),
    activeFinalRenderTaskCount,
  })
}
