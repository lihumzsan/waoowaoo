import { prisma } from '@/lib/prisma'
import { TASK_TYPE } from '@/lib/task/types'
import {
  isStoryboardSpatialProfileStageReady,
  resolveLocationSpatialProfileReadiness,
  resolveStoryboardImageReadiness,
} from './edit-first-readiness'

export type EditFirstWorkflowStage =
  | 'not_started'
  | 'ready_to_generate_screenplay'
  | 'screenplay_ready_for_review'
  | 'style_preview_generating'
  | 'needs_style_choice'
  | 'ready_to_generate_director_decoupage'
  | 'ready_to_generate_edit_script'
  | 'edit_script_generating'
  | 'ready_to_generate_assets'
  | 'assets_generating'
  | 'ready_to_generate_cinematography'
  | 'ready_to_generate_storyboard_spatial_blocking'
  | 'storyboard_spatial_blocking_generating'
  | 'ready_to_generate_storyboard'
  | 'storyboard_generating'
  | 'ready_to_generate_storyboard_images'
  | 'storyboard_images_generating'
  | 'ready_to_generate_videos'
  | 'videos_generating'
  | 'ready_to_render_final'
  | 'completed'
  | 'failed'

export type EditFirstWorkflowBlockingKind =
  | 'none'
  | 'processing'
  | 'needs_user_choice'
  | 'needs_confirmation'
  | 'failed'

/**
 * Canonical surface of every operation the edit-first workflow can ever
 * require. The project agent registers all of them up front and gates
 * availability live per turn, so this list must stay in sync with the stages
 * above — the derived union type enforces that any stage referencing a new
 * operation also adds it here.
 */
export const EDIT_FIRST_WORKFLOW_OPERATION_IDS = [
  'generate_edit_screenplay',
  'revise_edit_screenplay',
  'generate_edit_style_previews',
  'generate_edit_director_decoupage',
  'generate_edit_script',
  'generate_edit_script_assets',
  'generate_edit_cinematography_shot_plan',
  'generate_edit_script_storyboard_spatial_blocking',
  'generate_edit_script_storyboard',
  'generate_edit_script_storyboard_images',
  'generate_episode_videos',
  'render_final_video',
] as const

export type EditFirstWorkflowOperationId = (typeof EDIT_FIRST_WORKFLOW_OPERATION_IDS)[number]

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
  hasDirectorDecoupage: boolean
  directorDecoupageStatus: string | null
  hasEditScript: boolean
  editScriptStatus: string | null
  pendingAssetRequirementCount: number
  generatingAssetRequirementCount: number
  requiredLocationSpatialProfileCount: number
  readyLocationSpatialProfileCount: number
  hasCinematographyShotPlan: boolean
  cinematographyShotPlanStatus: string | null
  storyboardCount: number
  spatialBlockingReady: boolean
  activeSpatialBlockingTaskCount: number
  panelCount: number
  storyboardPanelImageReadyCount: number
  storyboardPanelImageMissingCount: number
  storyboardPanelImageFailedCount: number
  activeStoryboardImageTaskCount: number
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

function confirmationAction(
  operationId: EditFirstWorkflowOperationId,
  title: string,
): EditFirstWorkflowAction {
  return {
    id: operationId,
    operationId,
    title,
    requiresUserConfirmation: true,
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
      kind: nextAction ? 'needs_confirmation' : 'none',
      reason: null,
    },
    nextAction,
    allowedOperationIds: params.allowedOperationIds ? [...params.allowedOperationIds] : nextAction ? [nextAction.operationId] : [],
  }
}

type StoryboardSpatialCandidate = {
  readonly photographyPlan: string | null
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function parseJsonRecord(value: string | null): Record<string, unknown> {
  if (!value) return {}
  try {
    return readRecord(JSON.parse(value))
  } catch {
    return {}
  }
}

function resolveStoryboardSpatialBlockingReady(input: {
  readonly editScriptId: string | null
  readonly storyboards: readonly StoryboardSpatialCandidate[]
}): boolean {
  if (!input.editScriptId) return false
  return input.storyboards.some((storyboard) => {
    const plan = parseJsonRecord(storyboard.photographyPlan)
    return readString(plan.sourceEditScriptId) === input.editScriptId
      && isStoryboardSpatialProfileStageReady(readString(plan.currentStage))
  })
}

export function resolveEditFirstWorkflowStateFromSnapshot(
  snapshot: EditFirstWorkflowSnapshot,
): EditFirstWorkflowState {
  if (!snapshot.hasEpisode) return EDIT_FIRST_WORKFLOW_EMPTY_STATE

  const hasAnyEditFirstArtifact = snapshot.hasScreenplay
    || snapshot.hasDirectorDecoupage
    || snapshot.hasEditScript
    || snapshot.hasCinematographyShotPlan

  if (!snapshot.hasScreenplay) {
    return state({
      active: hasAnyEditFirstArtifact,
      stage: hasAnyEditFirstArtifact ? 'failed' : 'ready_to_generate_screenplay',
      blocking: hasAnyEditFirstArtifact
        ? { kind: 'failed', reason: 'edit-first artifacts exist but screenplay is missing' }
        : { kind: 'needs_confirmation', reason: 'screenplay is the first required edit-first artifact' },
      nextAction: confirmationAction('generate_edit_screenplay', 'Generate screenplay'),
    })
  }

  if (snapshot.screenplayStatus === 'failed') {
    return state({
      stage: 'failed',
      blocking: { kind: 'failed', reason: 'screenplay generation failed' },
      nextAction: confirmationAction('generate_edit_screenplay', 'Regenerate screenplay'),
    })
  }

  if (snapshot.failedStylePreviewCount > 0 && snapshot.confirmedStylePreviewCount === 0 && snapshot.completedStylePreviewCount === 0) {
    const nextAction = confirmationAction('generate_edit_style_previews', 'Regenerate style previews')
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
    const nextAction = confirmationAction('generate_edit_style_previews', 'Generate style previews')
    return state({
      stage: 'screenplay_ready_for_review',
      blocking: { kind: 'needs_confirmation', reason: 'review and approve screenplay before style preview generation' },
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

  if (!snapshot.hasDirectorDecoupage) {
    return state({
      stage: 'ready_to_generate_director_decoupage',
      nextAction: confirmationAction('generate_edit_director_decoupage', 'Generate director decoupage'),
    })
  }

  if (snapshot.directorDecoupageStatus === 'failed') {
    return state({
      stage: 'failed',
      blocking: { kind: 'failed', reason: 'director decoupage generation failed' },
      nextAction: confirmationAction('generate_edit_director_decoupage', 'Regenerate director decoupage'),
    })
  }

  if (snapshot.directorDecoupageStatus !== 'ready') {
    return state({
      stage: 'ready_to_generate_director_decoupage',
      blocking: { kind: 'processing', reason: 'director decoupage is not ready' },
    })
  }

  if (!snapshot.hasEditScript) {
    return state({
      stage: 'ready_to_generate_edit_script',
      nextAction: confirmationAction('generate_edit_script', 'Generate edit core table'),
    })
  }

  if (snapshot.editScriptStatus === 'failed') {
    return state({
      stage: 'failed',
      blocking: { kind: 'failed', reason: 'edit core table generation failed' },
      nextAction: confirmationAction('generate_edit_script', 'Regenerate edit core table'),
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
      nextAction: confirmationAction('generate_edit_script_assets', 'Generate required assets'),
    })
  }

  if (!snapshot.hasCinematographyShotPlan) {
    return state({
      stage: 'ready_to_generate_cinematography',
      nextAction: confirmationAction('generate_edit_cinematography_shot_plan', 'Generate cinematography shot plan'),
    })
  }

  if (snapshot.cinematographyShotPlanStatus === 'failed') {
    return state({
      stage: 'failed',
      blocking: { kind: 'failed', reason: 'cinematography shot plan generation failed' },
      nextAction: confirmationAction('generate_edit_cinematography_shot_plan', 'Regenerate cinematography shot plan'),
    })
  }

  if (snapshot.cinematographyShotPlanStatus !== 'ready') {
    return state({
      stage: 'ready_to_generate_cinematography',
      blocking: { kind: 'processing', reason: 'cinematography shot plan is not ready' },
    })
  }

  if (!snapshot.spatialBlockingReady) {
    if (snapshot.activeSpatialBlockingTaskCount > 0) {
      return state({
        stage: 'storyboard_spatial_blocking_generating',
        blocking: { kind: 'processing', reason: 'storyboard spatial blocking is still generating' },
      })
    }
    return state({
      stage: 'ready_to_generate_storyboard_spatial_blocking',
      nextAction: confirmationAction('generate_edit_script_storyboard_spatial_blocking', 'Generate spatial blocking'),
    })
  }

  if (snapshot.panelCount === 0) {
    return state({
      stage: 'ready_to_generate_storyboard',
      nextAction: confirmationAction('generate_edit_script_storyboard', 'Generate storyboard panels'),
    })
  }

  if (snapshot.storyboardPanelImageMissingCount > 0) {
    const nextAction = confirmationAction('generate_edit_script_storyboard_images', 'Generate storyboard images')
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

  return {
    active: true,
    stage: 'ready_to_generate_videos',
    blocking: {
      kind: 'needs_confirmation',
      reason: null,
    },
    nextAction: confirmationAction('generate_episode_videos', 'Generate videos'),
    allowedOperationIds: ['generate_episode_videos'],
  }
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
    case 'ready_to_generate_director_decoupage':
      return ['generate_edit_director_decoupage']
    case 'ready_to_generate_edit_script':
      return ['generate_edit_script']
    case 'edit_script_generating':
      return []
    case 'ready_to_generate_assets':
      return ['generate_edit_script_assets']
    case 'assets_generating':
      return []
    case 'ready_to_generate_cinematography':
      return ['generate_edit_cinematography_shot_plan']
    case 'ready_to_generate_storyboard_spatial_blocking':
      return ['generate_edit_script_storyboard_spatial_blocking']
    case 'storyboard_spatial_blocking_generating':
      return []
    case 'ready_to_generate_storyboard':
      return ['generate_edit_script_storyboard']
    case 'storyboard_generating':
      return []
    case 'ready_to_generate_storyboard_images':
      return ['generate_edit_script_storyboard_images']
    case 'storyboard_images_generating':
      return []
    case 'ready_to_generate_videos':
      return ['generate_episode_videos']
    case 'videos_generating':
      return []
    case 'ready_to_render_final':
      return ['render_final_video']
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
    directorDecoupage,
    editScript,
    cinematographyShotPlan,
    storyboards,
    panels,
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
    prisma.projectEditDirectorDecoupage.findFirst({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
      },
      select: {
        id: true,
        status: true,
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
        requirements: {
          select: {
            kind: true,
            status: true,
            targetId: true,
          },
        },
      },
    }),
    prisma.projectEditCinematographyShotPlan.findFirst({
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
        photographyPlan: true,
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
        imageUrl: true,
        imageMediaId: true,
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
  const storyboardImageReadiness = resolveStoryboardImageReadiness(panels)
  const spatialBlockingReady = resolveStoryboardSpatialBlockingReady({
    editScriptId: editScript?.id ?? null,
    storyboards,
  })
  const activeSpatialBlockingTaskCount = editScript?.id
    ? await prisma.task.count({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        targetType: 'ProjectEditScript',
        targetId: editScript.id,
        type: TASK_TYPE.EDIT_SCRIPT_STORYBOARD_PREPARE,
        status: { in: ['queued', 'processing'] },
      },
    })
    : 0
  const panelIds = panels.map((panel) => panel.id)
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
    hasDirectorDecoupage: Boolean(directorDecoupage),
    directorDecoupageStatus: directorDecoupage?.status ?? null,
    hasEditScript: Boolean(editScript),
    editScriptStatus: editScript?.status ?? null,
    pendingAssetRequirementCount: editScript?.requirements.filter((requirement) => requirement.status !== 'completed').length ?? 0,
    generatingAssetRequirementCount: editScript?.requirements.filter((requirement) => requirement.status === 'generating').length ?? 0,
    requiredLocationSpatialProfileCount: locationSpatialProfileReadiness.requiredCount,
    readyLocationSpatialProfileCount: locationSpatialProfileReadiness.readyCount,
    hasCinematographyShotPlan: Boolean(cinematographyShotPlan),
    cinematographyShotPlanStatus: cinematographyShotPlan?.status ?? null,
    storyboardCount: storyboards.length,
    spatialBlockingReady,
    activeSpatialBlockingTaskCount,
    panelCount: storyboardImageReadiness.panelCount,
    storyboardPanelImageReadyCount: storyboardImageReadiness.readyCount,
    storyboardPanelImageMissingCount: storyboardImageReadiness.missingCount,
    storyboardPanelImageFailedCount,
    activeStoryboardImageTaskCount,
  })
}
