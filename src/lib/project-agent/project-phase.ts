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
  planning: {
    editBibleStatus: string | null
    chapterCount: number
  }
  progress: {
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

async function resolveEpisodePlanningState(episodeId: string | null): Promise<ProjectPhaseSnapshot['planning']> {
  if (!episodeId) {
    return {
      editBibleStatus: null,
      chapterCount: 0,
    }
  }

  const [editBible, chapterCount] = await Promise.all([
    prisma.projectEditBible.findUnique({
      where: { episodeId },
      select: { status: true },
    }),
    prisma.projectEditChapter.count({
      where: { episodeId },
    }),
  ])

  return {
    editBibleStatus: editBible?.status ?? null,
    chapterCount,
  }
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
  const [episode, editBibleMax, editScriptMax, storyboardMax, panelMax] = await Promise.all([
    prisma.projectEpisode.findUnique({
      where: { id: episodeId },
      select: { updatedAt: true },
    }),
    prisma.projectEditBible.aggregate({
      where: { episodeId },
      _max: { updatedAt: true },
    }),
    prisma.projectEditScript.aggregate({
      where: { episodeId },
      _max: { updatedAt: true },
    }),
    prisma.projectStoryboard.aggregate({
      where: {
        episodeId,
      },
      _max: { updatedAt: true },
    }),
    prisma.projectPanel.aggregate({
      where: {
        storyboard: {
          episodeId,
        },
      },
      _max: { updatedAt: true },
    }),
  ])

  const storyUpdatedAt = maxDate([episode?.updatedAt ?? null])
  const scriptUpdatedAt = maxDate([editBibleMax._max.updatedAt, editScriptMax._max.updatedAt])
  const storyboardUpdatedAt = maxDate([storyboardMax._max.updatedAt, panelMax._max.updatedAt])

  const stale: string[] = []
  if (scriptUpdatedAt && storyUpdatedAt && storyUpdatedAt > scriptUpdatedAt) {
    stale.push('bible')
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

  const [recentFailedRuns, staleArtifacts, editFirstWorkflow, planning] = await Promise.all([
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
    resolveEpisodePlanningState(projection.episodeId || null),
  ])

  let phase: ProjectPhase = PROJECT_PHASE.DRAFT
  if (progress.storyboardCount > 0 || progress.panelCount > 0) {
    phase = PROJECT_PHASE.STORYBOARD_READY
  } else if (
    editFirstWorkflow.stage !== 'not_started'
    && editFirstWorkflow.stage !== 'ready_to_ingest_script'
    && editFirstWorkflow.stage !== 'bible_ready_for_review'
  ) {
    phase = PROJECT_PHASE.SCRIPT_READY
  }

  const failedItems = recentFailedRuns
    .slice(0, 3)
    .map((run) => {
      const headline = run.errorMessage || run.errorCode || run.status || 'failed'
      const detail = truncateText(headline, 160)
      return `planRun:${run.id}: ${detail}`
    })

  return {
    phase,
    planning,
    progress,
    activePlanRuns: projection.activePlanRuns,
    activePlanRunCount: projection.activePlanRuns.length,
    failedItems,
    staleArtifacts,
    availableActions: resolveAvailableActions(phase, !!projection.episodeId),
    editFirstWorkflow,
  }
}
