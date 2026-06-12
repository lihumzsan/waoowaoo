import { assembleProjectProjectionLite } from '@/lib/project-projection/lite'
import { listPlanRuns } from '@/lib/plan-run-runtime/service'
import { prisma } from '@/lib/prisma'
import type { ProjectContextRunSummary } from '@/lib/project-context/types'
import { resolveEditFirstWorkflowState, type EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'

export const PROJECT_PHASE = {
  DRAFT: 'draft',
  SCRIPT_ANALYZING: 'script_analyzing',
  SCRIPT_READY: 'script_ready',
  STORYBOARD_GENERATING: 'storyboard_generating',
  STORYBOARD_READY: 'storyboard_ready',
} as const

export type ProjectPhase = (typeof PROJECT_PHASE)[keyof typeof PROJECT_PHASE]

export interface ProjectPhaseSnapshot {
  phase: ProjectPhase
  progress: {
    clipCount: number
    screenplayClipCount: number
    storyboardCount: number
    panelCount: number
  }
  activePlanRuns: ProjectContextRunSummary[]
  activePlanRunCount: number
  failedItems: string[]
  staleArtifacts: string[]
  availableActions: string[]
  editFirstWorkflow: EditFirstWorkflowState
}

function resolveAvailableActions(phase: ProjectPhase, hasEpisode: boolean): ProjectPhaseSnapshot['availableActions'] {
  if (!hasEpisode) {
    return []
  }

  switch (phase) {
    case PROJECT_PHASE.DRAFT:
      return ['screenwriting', 'story-structure']
    case PROJECT_PHASE.SCRIPT_READY:
      return ['storyboard-direction', 'visual-continuity']
    case PROJECT_PHASE.STORYBOARD_READY:
      return [
        'generate_character_image',
        'generate_location_image',
        'regenerate_panel_image',
        'generate_edit_script_storyboard_images',
        'generate_episode_videos',
      ]
    default:
      return []
  }
}

function truncateText(value: string, maxChars: number) {
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, Math.max(0, maxChars - 1))}…`
}

function maxDate(dates: Array<Date | null | undefined>): Date | null {
  let latest: Date | null = null
  for (const date of dates) {
    if (!date) continue
    if (!latest || date.getTime() > latest.getTime()) latest = date
  }
  return latest
}

async function resolveStaleArtifactsForEpisode(params: {
  episodeId: string
  progress: ProjectPhaseSnapshot['progress']
}): Promise<string[]> {
  const episodeId = params.episodeId
  const [episode, storyClipMax, screenplayClipMax, storyboardMax, panelMax] = await Promise.all([
    prisma.projectEpisode.findUnique({
      where: { id: episodeId },
      select: { updatedAt: true },
    }),
    prisma.projectClip.aggregate({
      where: { episodeId },
      _max: { updatedAt: true },
    }),
    prisma.projectClip.aggregate({
      where: {
        episodeId,
        screenplay: { not: null },
      },
      _max: { updatedAt: true },
    }),
    prisma.projectStoryboard.aggregate({
      where: {
        clip: { episodeId },
      },
      _max: { updatedAt: true },
    }),
    prisma.projectPanel.aggregate({
      where: {
        storyboard: {
          clip: { episodeId },
        },
      },
      _max: { updatedAt: true },
    }),
  ])

  const storyUpdatedAt = maxDate([episode?.updatedAt ?? null, storyClipMax._max.updatedAt])
  const scriptUpdatedAt = screenplayClipMax._max.updatedAt ?? null
  const storyboardUpdatedAt = maxDate([storyboardMax._max.updatedAt, panelMax._max.updatedAt])

  const stale: string[] = []
  if (params.progress.screenplayClipCount > 0 && storyUpdatedAt && scriptUpdatedAt && storyUpdatedAt > scriptUpdatedAt) {
    stale.push('screenplay')
  }
  if (
    (params.progress.storyboardCount > 0 || params.progress.panelCount > 0)
    && scriptUpdatedAt
    && storyboardUpdatedAt
    && scriptUpdatedAt > storyboardUpdatedAt
  ) {
    stale.push('storyboard')
  }
  return stale
}

export async function resolveProjectPhase(params: {
  projectId: string
  userId: string
  episodeId?: string | null
}): Promise<ProjectPhaseSnapshot> {
  const projection = await assembleProjectProjectionLite({
    projectId: params.projectId,
    userId: params.userId,
    episodeId: params.episodeId || null,
  })

  const progress = projection.progress

  let phase: ProjectPhase = PROJECT_PHASE.DRAFT

  if (progress.storyboardCount > 0 || progress.panelCount > 0) {
    phase = PROJECT_PHASE.STORYBOARD_READY
  } else if (progress.screenplayClipCount > 0) {
    phase = PROJECT_PHASE.SCRIPT_READY
  }

  const [recentFailedRuns, staleArtifacts, editFirstWorkflow] = await Promise.all([
    listPlanRuns({
      userId: params.userId,
      projectId: params.projectId,
      episodeId: projection.episodeId || undefined,
      statuses: ['failed'],
      limit: 5,
    }),
    projection.episodeId
      ? resolveStaleArtifactsForEpisode({
          episodeId: projection.episodeId,
          progress,
        })
      : Promise.resolve([] as string[]),
    resolveEditFirstWorkflowState({
      projectId: params.projectId,
      userId: params.userId,
      episodeId: projection.episodeId || null,
    }),
  ])

  const failedItems = recentFailedRuns
    .slice(0, 3)
    .map((run) => {
      const headline = run.errorMessage || run.errorCode || run.status || 'failed'
      const detail = truncateText(headline, 160)
      return `planRun:${run.id}: ${detail}`
    })

  return {
    phase,
    progress,
    activePlanRuns: projection.activePlanRuns,
    activePlanRunCount: projection.activePlanRuns.length,
    failedItems,
    staleArtifacts,
    availableActions: resolveAvailableActions(phase, !!projection.episodeId),
    editFirstWorkflow,
  }
}
