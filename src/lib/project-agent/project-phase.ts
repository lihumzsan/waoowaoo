import { assembleProjectProjectionLite } from '@/lib/project-projection/lite'
import { prisma } from '@/lib/prisma'
import type { EditFirstWorkflowView } from '@/lib/project-workflow/edit-first-view'
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
  const [editFirstWorkflow, planning] = await Promise.all([
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
  } else if (planning.editBibleStatus !== null) {
    phase = PROJECT_PHASE.SCRIPT_READY
  }

  return {
    phase,
    planning,
    progress,
    editFirstWorkflow,
  }
}
