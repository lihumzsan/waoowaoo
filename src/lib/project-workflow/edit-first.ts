import { prisma } from '@/lib/prisma'

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
  | 'ready_to_generate_storyboard'
  | 'storyboard_generating'
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

export type EditFirstWorkflowOperationId =
  | 'generate_edit_screenplay'
  | 'revise_edit_screenplay'
  | 'generate_edit_style_previews'
  | 'generate_edit_director_decoupage'
  | 'generate_edit_script'
  | 'generate_edit_script_assets'
  | 'generate_edit_cinematography_shot_plan'
  | 'generate_edit_script_storyboard'
  | 'generate_episode_videos'
  | 'render_final_video'

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
  hasCinematographyShotPlan: boolean
  cinematographyShotPlanStatus: string | null
  storyboardCount: number
  panelCount: number
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

  if (snapshot.screenplayStatus === 'failed' || snapshot.failedStylePreviewCount > 0) {
    return state({
      stage: 'failed',
      blocking: { kind: 'failed', reason: 'screenplay or style preview generation failed' },
      nextAction: confirmationAction('generate_edit_screenplay', 'Regenerate screenplay'),
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

  if (snapshot.pendingAssetRequirementCount > 0) {
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

  if (snapshot.panelCount === 0) {
    return state({
      stage: 'ready_to_generate_storyboard',
      nextAction: confirmationAction('generate_edit_script_storyboard', 'Generate storyboard'),
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
    storyboardCount,
    panelCount,
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
            status: true,
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
    prisma.projectStoryboard.count({
      where: {
        episodeId: params.episodeId,
      },
    }),
    prisma.projectPanel.count({
      where: {
        storyboard: {
          episodeId: params.episodeId,
        },
      },
    }),
  ])

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
    hasCinematographyShotPlan: Boolean(cinematographyShotPlan),
    cinematographyShotPlanStatus: cinematographyShotPlan?.status ?? null,
    storyboardCount,
    panelCount,
  })
}
