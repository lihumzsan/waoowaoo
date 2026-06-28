import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ProjectAgentLocale } from './locale'
import type { EditFirstChoiceType } from './choice-card'
import { buildEditFirstAssistantChoiceCard } from './choice-card'
import type {
  EditStylePreviewGenerationPartData,
  ProjectAgentChoiceCardPartData,
  ProjectAssistantId,
} from './types'
import {
  getLatestProjectAgentInterruptionForRun,
  getPendingProjectAgentInterruptionForScope,
  type ProjectAgentInterruptionSnapshot,
} from './interruptions'
import {
  listRecentProjectAgentRunsForScope,
  reconcileStaleRunningProjectAgentRunsForScope,
  type ProjectAgentRunRecord,
  type ProjectAgentRunStatus,
} from './runs'
import {
  listProjectAgentSessionWaits,
  type ProjectAgentSessionWait,
} from './waits'
import {
  resolveEditFirstWorkflowState,
  type EditFirstWorkflowState,
} from '@/lib/project-workflow/edit-first'
import { TASK_STATUS, type TaskStatus } from '@/lib/task/types'

interface ProjectAgentSessionScopeInput {
  projectId: string
  userId: string
  episodeId?: string | null
  assistantId?: ProjectAssistantId
  locale: ProjectAgentLocale
}

export interface ProjectAgentSessionRun {
  runId: string
  status: ProjectAgentRunStatus
  controlKind: ProjectAgentRunRecord['controlKind']
  operationId: string | null
}

export type ProjectAgentSessionPendingInteraction =
  | {
    kind: 'approval'
    runId: string
    interruptionId: string
    approvalId: string
    operationId: string
    toolCallId: string | null
  }
  | {
    kind: 'choice'
    runId: string
    interruptionId: string
    approvalId: string
    operationId: string
    toolCallId: string
    choiceType: EditFirstChoiceType
    choiceCard: ProjectAgentChoiceCardPartData
  }

export interface ProjectAgentSessionTask {
  taskId: string
  operationId: string | null
  taskType: string
  targetType: string
  targetId: string
  status: TaskStatus | string
}

export interface ProjectAgentSessionStylePreviewGeneration {
  key: string
  data: EditStylePreviewGenerationPartData
}

export interface ProjectAgentSessionState {
  currentRun: ProjectAgentSessionRun | null
  pendingInteraction: ProjectAgentSessionPendingInteraction | null
  activeWaits: ProjectAgentSessionWait[]
  activeTasks: ProjectAgentSessionTask[]
  activeStylePreviewGeneration: ProjectAgentSessionStylePreviewGeneration | null
  editFirstWorkflow: EditFirstWorkflowState
}

function isActiveRunStatus(status: ProjectAgentRunStatus): boolean {
  return status === 'running'
    || status === 'awaiting_approval'
    || status === 'awaiting_choice'
    || status === 'awaiting_task'
}

function resolveCurrentRun(runs: readonly ProjectAgentRunRecord[]): ProjectAgentRunRecord | null {
  return runs.find((run) => isActiveRunStatus(run.status)) ?? runs[0] ?? null
}

function readRecord(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, Prisma.JsonValue>
}

function readChoiceType(value: Prisma.JsonValue | undefined): EditFirstChoiceType {
  if (value === 'duration_and_aspect_ratio' || value === 'screenplay_review' || value === 'style') return value
  throw new Error('PROJECT_AGENT_PENDING_CHOICE_TYPE_INVALID')
}

async function buildPendingChoiceInteraction(params: {
  scope: ProjectAgentSessionScopeInput
  workflow: EditFirstWorkflowState
  interruption: ProjectAgentInterruptionSnapshot
}): Promise<Extract<ProjectAgentSessionPendingInteraction, { kind: 'choice' }>> {
  if (!params.interruption.runId) throw new Error('PROJECT_AGENT_PENDING_CHOICE_RUN_ID_MISSING')
  if (!params.scope.episodeId) throw new Error('PROJECT_AGENT_PENDING_CHOICE_EPISODE_ID_MISSING')
  const toolCallId = params.interruption.toolCallId?.trim()
  if (!toolCallId) throw new Error('PROJECT_AGENT_PENDING_CHOICE_TOOL_CALL_ID_MISSING')
  const payload = readRecord(params.interruption.payload)
  const choiceType = readChoiceType(payload.choiceType)
  const choiceCard = await buildEditFirstAssistantChoiceCard({
    projectId: params.scope.projectId,
    userId: params.scope.userId,
    episodeId: params.scope.episodeId,
    locale: params.scope.locale,
    workflow: params.workflow,
    choiceType,
    toolCallId,
  })
  return {
    kind: 'choice',
    runId: params.interruption.runId,
    interruptionId: params.interruption.id,
    approvalId: params.interruption.approvalId,
    operationId: params.interruption.operationId,
    toolCallId,
    choiceType,
    choiceCard: {
      ...choiceCard,
      runId: params.interruption.runId,
      interruptionId: params.interruption.id,
    },
  }
}

async function buildPendingInteraction(params: {
  scope: ProjectAgentSessionScopeInput
  workflow: EditFirstWorkflowState
  interruption: ProjectAgentInterruptionSnapshot | null
}): Promise<ProjectAgentSessionPendingInteraction | null> {
  if (!params.interruption) return null
  if (params.interruption.type === 'approval') {
    if (!params.interruption.runId) throw new Error('PROJECT_AGENT_PENDING_APPROVAL_RUN_ID_MISSING')
    return {
      kind: 'approval',
      runId: params.interruption.runId,
      interruptionId: params.interruption.id,
      approvalId: params.interruption.approvalId,
      operationId: params.interruption.operationId,
      toolCallId: params.interruption.toolCallId,
    }
  }
  if (params.interruption.type === 'choice') {
    return await buildPendingChoiceInteraction({
      scope: params.scope,
      workflow: params.workflow,
      interruption: params.interruption,
    })
  }
  return null
}

function inferRunOperationId(params: {
  run: ProjectAgentRunRecord | null
  pendingInteraction: ProjectAgentSessionPendingInteraction | null
  latestRunInterruption: ProjectAgentInterruptionSnapshot | null
  waits: readonly ProjectAgentSessionWait[]
}): string | null {
  const runId = params.run?.id ?? null
  if (!runId) return null
  if (params.pendingInteraction?.runId === runId) return params.pendingInteraction.operationId
  const activeWait = params.waits.find((wait) => wait.runId === runId)
  if (activeWait) return activeWait.operationId
  if (params.latestRunInterruption?.runId === runId) return params.latestRunInterruption.operationId
  return null
}

async function listActiveTasksForWaits(params: {
  projectId: string
  userId: string
  waits: readonly ProjectAgentSessionWait[]
}): Promise<ProjectAgentSessionTask[]> {
  const taskIds = Array.from(new Set(params.waits
    .filter((wait) => wait.status === 'pending')
    .flatMap((wait) => wait.taskIds)))
  if (taskIds.length === 0) return []
  const tasks = await prisma.task.findMany({
    where: {
      id: { in: taskIds },
      projectId: params.projectId,
      userId: params.userId,
      status: { in: [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] },
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      operationId: true,
      type: true,
      targetType: true,
      targetId: true,
      status: true,
    },
  })
  return tasks.map((task) => ({
    taskId: task.id,
    operationId: task.operationId,
    taskType: task.type,
    targetType: task.targetType,
    targetId: task.targetId,
    status: task.status,
  }))
}

function isStylePreviewKey(value: string): value is EditStylePreviewGenerationPartData['items'][number]['styleKey'] {
  return value === 'style_a' || value === 'style_b' || value === 'style_c'
}

function isAspectRatio(value: string | null): value is NonNullable<EditStylePreviewGenerationPartData['items'][number]['aspectRatio']> {
  return value === '9:16' || value === '16:9' || value === '21:9'
}

async function buildActiveStylePreviewGeneration(params: {
  projectId: string
  userId: string
  episodeId?: string | null
  run: ProjectAgentSessionRun | null
}): Promise<ProjectAgentSessionStylePreviewGeneration | null> {
  if (!params.episodeId) return null
  const screenplay = await prisma.projectEditScreenplay.findFirst({
    where: {
      projectId: params.projectId,
      episodeId: params.episodeId,
      project: {
        userId: params.userId,
      },
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      projectId: true,
      episodeId: true,
      stylePreviews: {
        orderBy: { styleKey: 'asc' },
        select: {
          id: true,
          styleKey: true,
          title: true,
          summary: true,
          taskId: true,
          aspectRatio: true,
          status: true,
        },
      },
    },
  })
  if (!screenplay) return null
  if (screenplay.stylePreviews.some((preview) => preview.status === 'confirmed')) return null
  const items = screenplay.stylePreviews.flatMap((preview): EditStylePreviewGenerationPartData['items'] => {
    if (!preview.taskId) return []
    if (!isStylePreviewKey(preview.styleKey)) return []
    return [{
      id: preview.id,
      styleKey: preview.styleKey,
      title: preview.title,
      summary: preview.summary,
      taskId: preview.taskId,
      ...(isAspectRatio(preview.aspectRatio) ? { aspectRatio: preview.aspectRatio } : {}),
    }]
  })
  if (items.length === 0) return null
  return {
    key: `screenplay:${screenplay.id}:style-previews`,
    data: {
      operationId: 'generate_edit_style_previews',
      ...(params.run?.operationId === 'generate_edit_style_previews' ? { agentRunId: params.run.runId } : {}),
      projectId: screenplay.projectId,
      episodeId: screenplay.episodeId,
      screenplayId: screenplay.id,
      items,
    },
  }
}

export async function getProjectAgentSessionState(
  input: ProjectAgentSessionScopeInput,
): Promise<ProjectAgentSessionState> {
  const assistantId = input.assistantId ?? 'workspace-command'
  const scope = {
    ...input,
    assistantId,
  }
  await reconcileStaleRunningProjectAgentRunsForScope({
    projectId: input.projectId,
    userId: input.userId,
    episodeId: input.episodeId ?? null,
    assistantId,
  })
  const [workflow, runs, waits, pendingInterruption] = await Promise.all([
    resolveEditFirstWorkflowState({
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId ?? null,
    }),
    listRecentProjectAgentRunsForScope({
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId ?? null,
      assistantId,
      limit: 10,
    }),
    listProjectAgentSessionWaits({
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId ?? null,
      assistantId,
      limit: 10,
    }),
    getPendingProjectAgentInterruptionForScope({
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId ?? null,
      assistantId,
    }),
  ])
  const run = resolveCurrentRun(runs)
  const [pendingInteraction, latestRunInterruption, activeTasks] = await Promise.all([
    buildPendingInteraction({
      scope,
      workflow,
      interruption: pendingInterruption,
    }),
    run
      ? getLatestProjectAgentInterruptionForRun({
          projectId: input.projectId,
          userId: input.userId,
          episodeId: input.episodeId ?? null,
          assistantId,
          runId: run.id,
        })
      : Promise.resolve(null),
    listActiveTasksForWaits({
      projectId: input.projectId,
      userId: input.userId,
      waits,
    }),
  ])
  const currentRun: ProjectAgentSessionRun | null = run
    ? {
      runId: run.id,
      status: run.status,
      controlKind: run.controlKind,
      operationId: inferRunOperationId({
        run,
        pendingInteraction,
        latestRunInterruption,
        waits,
      }),
    }
    : null
  const activeStylePreviewGeneration = pendingInteraction?.kind === 'choice' && pendingInteraction.choiceType === 'style'
    ? null
    : await buildActiveStylePreviewGeneration({
        projectId: input.projectId,
        userId: input.userId,
        episodeId: input.episodeId ?? null,
        run: currentRun,
      })

  return {
    currentRun,
    pendingInteraction,
    activeWaits: waits,
    activeTasks,
    activeStylePreviewGeneration,
    editFirstWorkflow: workflow,
  }
}
