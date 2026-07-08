import { resolveEditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import { prisma } from '@/lib/prisma'
import type { E2eDiagnostics, E2eTaskDiagnostic } from './diagnostics-types'

export function buildDiagnosticsSignature(diagnostics: E2eDiagnostics): string {
  const activeTaskState = diagnostics.tasks
    .filter((task) => task.status === 'queued' || task.status === 'processing')
    .map((task) => `${task.id}:${task.status}:${String(task.progress)}`)
    .join('|')
  const pendingInteractions = diagnostics.interruptions
    .filter((interruption) => interruption.status === 'pending')
    .map((interruption) => `${interruption.id}:${interruption.type}:${interruption.operationId}`)
    .join('|')
  const waits = diagnostics.waits
    .filter((wait) => wait.status !== 'followed')
    .map((wait) => `${wait.id}:${wait.status}:${wait.terminalStatus ?? '-'}`)
    .join('|')
  return [
    diagnostics.workflow.stage,
    diagnostics.workflow.blocking.kind,
    diagnostics.event.latestId ?? 'none',
    activeTaskState,
    pendingInteractions,
    waits,
    diagnostics.chapters.map((chapter) => [
      chapter.id,
      chapter.status,
      chapter.renderStatus ?? '-',
      chapter.editScript?.status ?? '-',
      chapter.editScript?.assetReviewStatus ?? '-',
      chapter.shotExecutionPlanStatus ?? '-',
    ].join(':')).join('|'),
  ].join('\n')
}

export function classifyTaskFailure(task: E2eTaskDiagnostic): 'provider' | 'system' {
  const source = `${task.errorCode ?? ''}\n${task.errorMessage ?? ''}`.toUpperCase()
  if (
    source.includes('FAL')
    || source.includes('OPENROUTER')
    || source.includes('PROVIDER')
    || source.includes('UPSTREAM')
    || source.includes('NETWORK')
    || source.includes('TIMEOUT')
    || source.includes('EXTERNAL')
  ) {
    return 'provider'
  }
  return 'system'
}

export async function readE2eDiagnostics(input: {
  readonly projectId: string
  readonly episodeId: string
}): Promise<E2eDiagnostics> {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      userId: true,
      name: true,
      videoRatio: true,
    },
  })
  if (!project) throw new Error(`E2E_PROJECT_NOT_FOUND:${input.projectId}`)

  const [
    episode,
    sourceDocuments,
    bible,
    stylePreviews,
    chapters,
    finalOutput,
    musicScore,
    tasks,
    runs,
    waits,
    interruptions,
    eventCount,
    latestEvent,
    workflow,
  ] = await Promise.all([
    prisma.projectEpisode.findFirst({
      where: {
        id: input.episodeId,
        projectId: input.projectId,
      },
      select: {
        id: true,
        name: true,
        episodeNumber: true,
      },
    }),
    prisma.projectEpisodeSourceDocument.findMany({
      where: { episodeId: input.episodeId },
      orderBy: { version: 'asc' },
      select: {
        id: true,
        sourceKind: true,
        version: true,
        normalizedText: true,
      },
    }),
    prisma.projectEditBible.findUnique({
      where: { episodeId: input.episodeId },
      select: {
        id: true,
        status: true,
        version: true,
        lockedAt: true,
      },
    }),
    prisma.projectEditStylePreview.findMany({
      where: {
        projectId: input.projectId,
        episodeId: input.episodeId,
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        status: true,
        aspectRatio: true,
      },
    }),
    prisma.projectEditChapter.findMany({
      where: {
        episodeId: input.episodeId,
        episode: { projectId: input.projectId },
      },
      orderBy: { chapterIndex: 'asc' },
      select: {
        id: true,
        chapterIndex: true,
        status: true,
        renderStatus: true,
        editScript: {
          select: {
            id: true,
            status: true,
            assetReviewStatus: true,
            shotCount: true,
            requirements: {
              select: { status: true },
            },
          },
        },
        shotExecutionPlan: {
          select: { status: true },
        },
      },
    }),
    prisma.projectEpisodeFinalOutput.findUnique({
      where: { episodeId: input.episodeId },
      select: {
        renderStatus: true,
        outputUrl: true,
        outputMediaId: true,
      },
    }),
    prisma.projectEditMusicScore.findUnique({
      where: { episodeId: input.episodeId },
      select: {
        status: true,
        mixJson: true,
      },
    }),
    prisma.task.findMany({
      where: {
        projectId: input.projectId,
        episodeId: input.episodeId,
      },
      orderBy: { updatedAt: 'desc' },
      take: 80,
      select: {
        id: true,
        type: true,
        targetType: true,
        targetId: true,
        status: true,
        progress: true,
        operationId: true,
        batchKey: true,
        errorCode: true,
        errorMessage: true,
        updatedAt: true,
      },
    }),
    prisma.projectAgentRun.findMany({
      where: {
        projectId: input.projectId,
        episodeId: input.episodeId,
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        status: true,
        controlKind: true,
        errorCode: true,
        updatedAt: true,
      },
    }),
    prisma.projectAgentWait.findMany({
      where: {
        projectId: input.projectId,
        episodeId: input.episodeId,
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        status: true,
        operationId: true,
        terminalStatus: true,
        updatedAt: true,
      },
    }),
    prisma.projectAgentInterruption.findMany({
      where: {
        projectId: input.projectId,
        episodeId: input.episodeId,
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        runId: true,
        status: true,
        type: true,
        operationId: true,
        toolCallId: true,
        updatedAt: true,
      },
    }),
    prisma.projectAgentEvent.count({
      where: {
        projectId: input.projectId,
        episodeId: input.episodeId,
      },
    }),
    prisma.projectAgentEvent.findFirst({
      where: {
        projectId: input.projectId,
        episodeId: input.episodeId,
      },
      orderBy: { id: 'desc' },
      select: { id: true },
    }),
    resolveEditFirstWorkflowState({
      projectId: input.projectId,
      userId: project.userId,
      episodeId: input.episodeId,
    }),
  ])

  if (!episode) throw new Error(`E2E_EPISODE_NOT_FOUND:${input.episodeId}`)

  return {
    project,
    episode,
    workflow,
    sourceDocuments: sourceDocuments.map((document) => ({
      id: document.id,
      sourceKind: document.sourceKind,
      version: document.version,
      textLength: document.normalizedText.length,
    })),
    bible: bible
      ? {
        id: bible.id,
        status: bible.status,
        version: bible.version,
        lockedAt: bible.lockedAt?.toISOString() ?? null,
      }
      : null,
    stylePreviews,
    chapters: chapters.map((chapter) => ({
      id: chapter.id,
      chapterIndex: chapter.chapterIndex,
      status: chapter.status,
      renderStatus: chapter.renderStatus,
      editScript: chapter.editScript
        ? {
          id: chapter.editScript.id,
          status: chapter.editScript.status,
          assetReviewStatus: chapter.editScript.assetReviewStatus,
          shotCount: chapter.editScript.shotCount,
          requirementCount: chapter.editScript.requirements.length,
          pendingRequirementCount: chapter.editScript.requirements.filter((requirement) => requirement.status !== 'completed').length,
        }
        : null,
      shotExecutionPlanStatus: chapter.shotExecutionPlan?.status ?? null,
    })),
    finalOutput: finalOutput
      ? {
        renderStatus: finalOutput.renderStatus,
        hasOutput: Boolean(finalOutput.outputUrl || finalOutput.outputMediaId),
      }
      : null,
    musicScore: musicScore
      ? {
        status: musicScore.status,
        hasMix: Boolean(musicScore.mixJson),
      }
      : null,
    tasks: tasks.map((task) => ({
      ...task,
      updatedAt: task.updatedAt.toISOString(),
    })),
    runs: runs.map((run) => ({
      id: run.id,
      status: run.status,
      controlKind: run.controlKind,
      errorCode: run.errorCode,
      updatedAt: run.updatedAt.toISOString(),
    })),
    waits: waits.map((wait) => ({
      id: wait.id,
      status: wait.status,
      operationId: wait.operationId,
      terminalStatus: wait.terminalStatus,
      updatedAt: wait.updatedAt.toISOString(),
    })),
    interruptions: interruptions.map((interruption) => ({
      id: interruption.id,
      runId: interruption.runId,
      status: interruption.status,
      type: interruption.type,
      operationId: interruption.operationId,
      toolCallId: interruption.toolCallId,
      updatedAt: interruption.updatedAt.toISOString(),
    })),
    event: {
      count: eventCount,
      latestId: latestEvent ? latestEvent.id.toString() : null,
    },
  }
}
