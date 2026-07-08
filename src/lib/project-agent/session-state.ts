import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ProjectAgentLocale } from './locale'
import { isEditFirstChoiceType, type EditFirstChoiceType } from './edit-first-choice-tools'
import { buildEditFirstAssistantChoiceCard } from './choice-card'
import { readPersistedScriptIntakeChoiceCard } from './script-intake'
import type {
  EditStylePreviewGenerationPartData,
  ProjectAgentChoiceCardPartData,
  ProjectAssistantId,
} from './types'
import {
  getPendingProjectAgentInterruptionForScope,
  type ProjectAgentInterruptionSnapshot,
} from './interruptions'
import {
  cancelStaleRunningProjectAgentRunsForScope,
  listRecentProjectAgentRunsForScope,
  type ProjectAgentRunRecord,
  type ProjectAgentRunStatus,
} from './runs'
import {
  listProjectAgentSessionWaits,
  type ProjectAgentSessionWait,
} from './waits'
import {
  getCurrentProjectAgentActivity,
  type ProjectAgentActivitySnapshot,
} from './event'
import {
  resolveEditFirstWorkflowState,
  type EditFirstWorkflowState,
} from '@/lib/project-workflow/edit-first'
import { TASK_STATUS, type TaskStatus } from '@/lib/task/types'
import type { OperationPlanView } from '@/lib/operations/planning'

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
}

export type ProjectAgentSessionActivity = ProjectAgentActivitySnapshot

export type ProjectAgentSessionPendingInteraction =
  | {
    kind: 'approval'
    runId: string
    interruptionId: string
    approvalId: string
    operationId: string
    toolCallId: string | null
    operationPlan?: OperationPlanView | null
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
  currentActivity: ProjectAgentSessionActivity | null
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

function readOperationPlanView(value: Prisma.JsonValue | undefined): OperationPlanView | null {
  const record = readRecord(value ?? null)
  if (record.kind !== 'task_submission') return null
  if (typeof record.operationId !== 'string') return null
  if (typeof record.taskCount !== 'number') return null
  if (!record.quote || typeof record.quote !== 'object' || Array.isArray(record.quote)) return null
  if (!Array.isArray(record.tasks)) return null
  return record as unknown as OperationPlanView
}

function readChoiceType(value: Prisma.JsonValue | undefined): EditFirstChoiceType {
  if (isEditFirstChoiceType(value)) return value
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
  const choiceCard = choiceType === 'script_intake'
    ? readPersistedScriptIntakeChoiceCard(payload.card)
    : await buildEditFirstAssistantChoiceCard({
        projectId: params.scope.projectId,
        userId: params.scope.userId,
        episodeId: params.scope.episodeId,
        locale: params.scope.locale,
        workflow: params.workflow,
        choiceType,
        toolCallId,
      })
  if (!choiceCard) throw new Error('PROJECT_AGENT_PENDING_SCRIPT_INTAKE_CARD_INVALID')
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
    const payload = readRecord(params.interruption.payload)
    return {
      kind: 'approval',
      runId: params.interruption.runId,
      interruptionId: params.interruption.id,
      approvalId: params.interruption.approvalId,
      operationId: params.interruption.operationId,
      toolCallId: params.interruption.toolCallId,
      operationPlan: readOperationPlanView(payload.operationPlan),
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
  return /^style_[abc](?:_[2-9]\d*)?$/.test(value)
}

function isAspectRatio(value: string | null): value is NonNullable<EditStylePreviewGenerationPartData['items'][number]['aspectRatio']> {
  return value === '9:16' || value === '16:9' || value === '21:9'
}

function resolveStylePreviewAgentRunId(params: {
  run: ProjectAgentSessionRun | null
  activity: ProjectAgentSessionActivity | null
}): string | null {
  if (!params.run) return null
  if (
    params.activity?.operationId === 'generate_edit_style_previews'
    || params.activity?.sourceOperationId === 'generate_edit_style_previews'
  ) return params.run.runId
  if (params.run.status === 'awaiting_choice' && params.run.controlKind === 'user_turn') return params.run.runId
  return null
}

async function buildActiveStylePreviewGeneration(params: {
  projectId: string
  userId: string
  episodeId?: string | null
  run: ProjectAgentSessionRun | null
  activity: ProjectAgentSessionActivity | null
}): Promise<ProjectAgentSessionStylePreviewGeneration | null> {
  if (!params.episodeId) return null
  const editBible = await prisma.projectEditBible.findFirst({
    where: {
      episodeId: params.episodeId,
      episode: {
        projectId: params.projectId,
        project: {
          userId: params.userId,
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      episodeId: true,
      episode: {
        select: {
          projectId: true,
        },
      },
      stylePreviews: {
        orderBy: [
          { createdAt: 'asc' },
          { styleKey: 'asc' },
        ],
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
  if (!editBible) return null
  if (editBible.stylePreviews.some((preview) => preview.status === 'confirmed')) return null
  const agentRunId = resolveStylePreviewAgentRunId({
    run: params.run,
    activity: params.activity,
  })
  const items = editBible.stylePreviews.flatMap((preview): EditStylePreviewGenerationPartData['items'] => {
    // taskId 缺失（追加候选刚建行、尚未回填）也要收录，否则停靠卡会停在旧的候选数、看不到新生成的。
    if (!isStylePreviewKey(preview.styleKey)) return []
    return [{
      id: preview.id,
      styleKey: preview.styleKey,
      title: preview.title,
      summary: preview.summary,
      ...(preview.taskId ? { taskId: preview.taskId } : {}),
      ...(isAspectRatio(preview.aspectRatio) ? { aspectRatio: preview.aspectRatio } : {}),
    }]
  })
  if (items.length === 0) return null
  return {
    key: `bible:${editBible.id}:style-previews`,
    data: {
      operationId: 'generate_edit_style_previews',
      ...(agentRunId ? { agentRunId } : {}),
      projectId: editBible.episode.projectId,
      episodeId: editBible.episodeId,
      bibleId: editBible.id,
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
  await cancelStaleRunningProjectAgentRunsForScope({
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
  const [pendingInteraction, currentActivity, activeTasks] = await Promise.all([
    buildPendingInteraction({
      scope,
      workflow,
      interruption: pendingInterruption,
    }),
    getCurrentProjectAgentActivity({
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId ?? null,
      assistantId,
      ...(run ? { runId: run.id } : {}),
    }),
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
    }
    : null
  const activeStylePreviewGeneration = pendingInteraction?.kind === 'choice' && pendingInteraction.choiceType === 'style'
    ? null
    : await buildActiveStylePreviewGeneration({
        projectId: input.projectId,
        userId: input.userId,
        episodeId: input.episodeId ?? null,
        run: currentRun,
        activity: currentActivity,
      })

  return {
    currentRun,
    currentActivity,
    pendingInteraction,
    activeWaits: waits,
    activeTasks,
    activeStylePreviewGeneration,
    editFirstWorkflow: workflow,
  }
}
