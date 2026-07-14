import { assembleProjectProjectionLite } from '@/lib/project-projection/lite'
import { prisma } from '@/lib/prisma'
import {
  isEditFirstWorkflowPosition,
  type EditFirstWorkflowView,
} from '@/lib/project-workflow/edit-first-view'
import { resolveEditFirstWorkflowView } from '@/lib/project-workflow/edit-first'
import type { ProjectProjectionProgress } from '@/lib/project-projection/types'

export const PROJECT_PHASE = {
  DRAFT: 'draft',
  SCRIPT_READY: 'script_ready',
  VIDEO_GENERATING: 'video_generating',
  VIDEO_READY: 'video_ready',
} as const

export type ProjectPhase = (typeof PROJECT_PHASE)[keyof typeof PROJECT_PHASE]

export interface ProjectPhaseSnapshot {
  phase: ProjectPhase
  planning: {
    editBibleStatus: string | null
    chapterCount: number
  }
  progress: ProjectProjectionProgress
  staleArtifacts: string[]
  availableActions: string[]
  editFirstWorkflow: EditFirstWorkflowView
}

async function resolveEpisodePlanningState(episodeId: string | null): Promise<ProjectPhaseSnapshot['planning']> {
  if (!episodeId) return { editBibleStatus: null, chapterCount: 0 }
  const [editBible, chapterCount] = await Promise.all([
    prisma.projectEditBible.findUnique({
      where: { episodeId },
      select: { status: true },
    }),
    prisma.projectEditChapter.count({ where: { episodeId } }),
  ])
  return { editBibleStatus: editBible?.status ?? null, chapterCount }
}

function resolveAvailableActions(phase: ProjectPhase, hasEpisode: boolean): ProjectPhaseSnapshot['availableActions'] {
  if (!hasEpisode) return []
  switch (phase) {
    case PROJECT_PHASE.DRAFT:
      return ['ingest_script']
    case PROJECT_PHASE.SCRIPT_READY:
      return ['generate_edit_script_assets', 'generate_edit_shot_execution_plan', 'generate_video_segments']
    case PROJECT_PHASE.VIDEO_GENERATING:
      return ['generate_video_segments']
    case PROJECT_PHASE.VIDEO_READY:
      return ['render_chapters', 'render_final_video']
  }
}

async function resolveStaleArtifactsForEpisode(params: {
  episodeId: string
  progress: ProjectProjectionProgress
}): Promise<string[]> {
  const [episode, editBibleMax, editScriptMax, videoSegmentMax] = await Promise.all([
    prisma.projectEpisode.findUnique({
      where: { id: params.episodeId },
      select: { updatedAt: true },
    }),
    prisma.projectEditBible.aggregate({
      where: { episodeId: params.episodeId },
      _max: { updatedAt: true },
    }),
    prisma.projectEditScript.aggregate({
      where: { episodeId: params.episodeId },
      _max: { updatedAt: true },
    }),
    prisma.projectVideoSegment.aggregate({
      where: { episodeId: params.episodeId },
      _max: { updatedAt: true },
    }),
  ])

  const storyUpdatedAt = episode?.updatedAt ?? null
  const scriptUpdatedAt = [editBibleMax._max.updatedAt, editScriptMax._max.updatedAt]
    .filter((value): value is Date => value instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null
  const videoUpdatedAt = videoSegmentMax._max.updatedAt
  const stale: string[] = []
  if (scriptUpdatedAt && storyUpdatedAt && storyUpdatedAt > scriptUpdatedAt) stale.push('bible')
  if (
    params.progress.plannedVideoSegmentCount > 0
    && scriptUpdatedAt
    && videoUpdatedAt
    && scriptUpdatedAt > videoUpdatedAt
  ) {
    stale.push('video_segments')
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
  const [staleArtifacts, editFirstWorkflow, planning] = await Promise.all([
    projection.episodeId
      ? resolveStaleArtifactsForEpisode({ episodeId: projection.episodeId, progress })
      : Promise.resolve([] as string[]),
    resolveEditFirstWorkflowView({
      projectId: params.projectId,
      userId: params.userId,
      episodeId: projection.episodeId || null,
    }),
    resolveEpisodePlanningState(projection.episodeId || null),
  ])

  let phase: ProjectPhase = PROJECT_PHASE.DRAFT
  if (progress.plannedVideoSegmentCount > 0) {
    phase = progress.completedVideoSegmentCount === progress.plannedVideoSegmentCount
      ? PROJECT_PHASE.VIDEO_READY
      : PROJECT_PHASE.VIDEO_GENERATING
  } else if (
    editFirstWorkflow.step !== 'unavailable'
    && editFirstWorkflow.step !== 'script_intake'
    && !isEditFirstWorkflowPosition(editFirstWorkflow, 'episode_plan', 'needs_user_choice')
  ) {
    phase = PROJECT_PHASE.SCRIPT_READY
  }

  return {
    phase,
    planning,
    progress,
    staleArtifacts,
    availableActions: resolveAvailableActions(phase, Boolean(projection.episodeId)),
    editFirstWorkflow,
  }
}
