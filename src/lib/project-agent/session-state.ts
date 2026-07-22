import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ProjectAgentLocale } from './locale'
import { parseProjectAgentChoiceOffer } from './choice-offer'
import type {
  ProjectAgentChoiceCardPartData,
  ProjectAssistantId,
} from './types'
import {
  getPendingProjectAgentInterruptionForScope,
  type ProjectAgentInterruptionSnapshot,
} from './interruptions'
import {
  listRecentProjectAgentRunsForScope,
  type ProjectAgentRunRecord,
  type ProjectAgentRunStatus,
} from './runs'
import { normalizeProjectAgentRunStatus } from './run-state-machine'
import {
  listProjectAgentSessionWaits,
  type ProjectAgentSessionWait,
} from './waits'
import {
  getCurrentProjectAgentActivity,
  type ProjectAgentActivitySnapshot,
} from './event'
import { TASK_STATUS, TASK_TYPE, type TaskStatus } from '@/lib/task/types'
import {
  CREATIVE_WORK_TASK_PROTOCOL,
  creativeWorkTaskPayloadSchema,
  creativeWorkTaskResultSchema,
} from '@/lib/creative-worker'
import type { OperationPlanView } from '@/lib/operations/planning'
import { buildProjectAssistantScopeRef } from './persistence'
import { readProjectAgentSessionEventWatermark } from './session-event'
import {
  readProjectAgentPlan,
  type ProjectAgentPlanSnapshot,
} from './plan'
import {
  parseProjectAgentSubagentEventPartData,
  resolveProjectAgentSubagentViews,
  type ProjectAgentSubagentView,
} from './subagent-events'

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
  errorCode: string | null
  errorMessage: string | null
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

export interface ProjectAgentSessionState {
  currentRun: ProjectAgentSessionRun | null
  currentActivity: ProjectAgentSessionActivity | null
  pendingInteraction: ProjectAgentSessionPendingInteraction | null
  activeWaits: ProjectAgentSessionWait[]
  activeTasks: ProjectAgentSessionTask[]
  subagents: ProjectAgentSubagentView[]
  plan: ProjectAgentPlanSnapshot | null
}

export interface ProjectAgentSessionSnapshot {
  sessionState: ProjectAgentSessionState
  eventWatermark: string
}

type ProjectAgentSessionRunCandidate = Pick<
  ProjectAgentRunRecord,
  'id' | 'status' | 'controlKind' | 'errorCode' | 'errorMessage'
>

function resolveCurrentRun(params: {
  activeRuns: readonly ProjectAgentSessionRunCandidate[]
  recentRuns: readonly ProjectAgentSessionRunCandidate[]
}): ProjectAgentSessionRunCandidate | null {
  if (params.activeRuns.length > 1) {
    throw new Error(`PROJECT_AGENT_SESSION_ACTIVE_RUN_CONFLICT:${params.activeRuns.map((run) => run.id).join(',')}`)
  }
  return params.activeRuns[0] ?? params.recentRuns[0] ?? null
}

function normalizeSessionRunControlKind(value: string): ProjectAgentRunRecord['controlKind'] {
  if (
    value === 'user_turn'
    || value === 'approval_response'
    || value === 'choice_response'
    || value === 'task_follow_up'
  ) return value
  throw new Error(`PROJECT_AGENT_SESSION_RUN_CONTROL_KIND_INVALID:${value}`)
}

async function readUniqueActiveProjectAgentRun(
  input: ProjectAgentSessionScopeInput & { assistantId: ProjectAssistantId },
): Promise<ProjectAgentSessionRunCandidate | null> {
  const scopeRef = buildProjectAssistantScopeRef({
    projectId: input.projectId,
    episodeId: input.episodeId ?? null,
  })
  const rows = await prisma.projectAgentRun.findMany({
    where: {
      projectId: input.projectId,
      userId: input.userId,
      assistantId: input.assistantId,
      scopeRef,
      status: { in: ['running', 'awaiting_approval', 'awaiting_choice'] },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      controlKind: true,
      errorCode: true,
      errorMessage: true,
    },
  })
  if (rows.length > 1) {
    throw new Error(`PROJECT_AGENT_SESSION_ACTIVE_RUN_CONFLICT:${rows.map((row) => row.id).join(',')}`)
  }
  const run = rows[0]
  if (!run) return null
  return {
    id: run.id,
    status: normalizeProjectAgentRunStatus(run.status),
    controlKind: normalizeSessionRunControlKind(run.controlKind),
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
  }
}

function isOpenSessionWait(wait: ProjectAgentSessionWait): boolean {
  return wait.status === 'collecting' || wait.status === 'pending' || wait.status === 'claimed'
}

const SESSION_FACT_RUN_MISMATCH_CODES = {
  WAIT: 'PROJECT_AGENT_SESSION_WAIT_RUN_MISMATCH',
  INTERRUPTION: 'PROJECT_AGENT_SESSION_INTERRUPTION_RUN_MISMATCH',
  ACTIVITY: 'PROJECT_AGENT_SESSION_ACTIVITY_RUN_MISMATCH',
} as const

type ProjectAgentSessionOpenFact = {
  kind: keyof typeof SESSION_FACT_RUN_MISMATCH_CODES
  id: string
  runId: string | null
}

async function readOpenProjectAgentSessionFacts(
  input: ProjectAgentSessionScopeInput & { assistantId: ProjectAssistantId },
): Promise<ProjectAgentSessionOpenFact[]> {
  const scopeRef = buildProjectAssistantScopeRef({
    projectId: input.projectId,
    episodeId: input.episodeId ?? null,
  })
  return await prisma.$queryRaw<ProjectAgentSessionOpenFact[]>(Prisma.sql`
    SELECT 'WAIT' AS kind, agent_wait.id, agent_wait.runId
    FROM project_agent_waits agent_wait
    INNER JOIN project_agent_runs agent_run ON agent_run.id = agent_wait.runId
    WHERE agent_wait.projectId = ${input.projectId}
      AND agent_wait.userId = ${input.userId}
      AND agent_wait.assistantId = ${input.assistantId}
      AND agent_wait.scopeRef = ${scopeRef}
      AND agent_wait.status IN ('collecting', 'pending', 'claimed')
      AND agent_run.status <> 'awaiting_task'
    UNION ALL
    SELECT 'INTERRUPTION' AS kind, id, runId
    FROM project_agent_interruptions
    WHERE projectId = ${input.projectId}
      AND userId = ${input.userId}
      AND assistantId = ${input.assistantId}
      AND scopeRef = ${scopeRef}
      AND status = 'pending'
    UNION ALL
    SELECT 'ACTIVITY' AS kind, activity.id, activity.runId
    FROM project_agent_activities activity
    INNER JOIN project_agent_runs agent_run ON agent_run.id = activity.runId
    WHERE activity.projectId = ${input.projectId}
      AND activity.userId = ${input.userId}
      AND activity.assistantId = ${input.assistantId}
      AND activity.scopeRef = ${scopeRef}
      AND activity.status IN ('running', 'waiting')
      AND agent_run.status <> 'awaiting_task'
  `)
}

function resolveRunOwnedSessionFacts(params: {
  run: ProjectAgentSessionRunCandidate | null
  waits: readonly ProjectAgentSessionWait[]
  interruption: ProjectAgentInterruptionSnapshot | null
  activity: ProjectAgentActivitySnapshot | null
  openFacts: readonly ProjectAgentSessionOpenFact[]
}): {
  waits: ProjectAgentSessionWait[]
  interruption: ProjectAgentInterruptionSnapshot | null
  activity: ProjectAgentActivitySnapshot | null
} {
  const openWaits = params.waits.filter(isOpenSessionWait)
  const projectedFacts: ProjectAgentSessionOpenFact[] = openWaits.map((wait) => ({
    kind: 'WAIT',
    id: wait.waitId,
    runId: wait.runId,
  }))
  if (params.interruption) {
    projectedFacts.push({
      kind: 'INTERRUPTION',
      id: params.interruption.id,
      runId: params.interruption.runId,
    })
  }
  if (params.activity) {
    projectedFacts.push({
      kind: 'ACTIVITY',
      id: params.activity.activityId,
      runId: params.activity.runId,
    })
  }
  const factRunIds: ProjectAgentSessionOpenFact[] = [
    ...params.openFacts,
    ...projectedFacts,
  ]
  if (!params.run) {
    if (factRunIds.length > 0) {
      const fact = factRunIds[0]
      throw new Error(`PROJECT_AGENT_SESSION_${fact.kind}_WITHOUT_RUN:${fact.id}`)
    }
    return { waits: [], interruption: null, activity: null }
  }
  for (const fact of factRunIds) {
    if (fact.runId !== params.run.id) {
      throw new Error(
        `${SESSION_FACT_RUN_MISMATCH_CODES[fact.kind]}:${fact.id}:${fact.runId ?? 'null'}:${params.run.id}`,
      )
    }
  }
  if (
    params.run.status === 'completed'
    || params.run.status === 'failed'
    || params.run.status === 'cancelled'
  ) {
    if (factRunIds.length > 0) {
      const fact = factRunIds[0]
      throw new Error(`PROJECT_AGENT_SESSION_TERMINAL_RUN_HAS_OPEN_${fact.kind}:${params.run.id}:${fact.id}`)
    }
    return { waits: [], interruption: null, activity: null }
  }
  return {
    waits: openWaits,
    interruption: params.interruption,
    activity: params.activity,
  }
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

async function buildPendingChoiceInteraction(params: {
  interruption: ProjectAgentInterruptionSnapshot
}): Promise<Extract<ProjectAgentSessionPendingInteraction, { kind: 'choice' }>> {
  if (!params.interruption.runId) throw new Error('PROJECT_AGENT_PENDING_CHOICE_RUN_ID_MISSING')
  const toolCallId = params.interruption.toolCallId?.trim()
  if (!toolCallId) throw new Error('PROJECT_AGENT_PENDING_CHOICE_TOOL_CALL_ID_MISSING')
  const offer = parseProjectAgentChoiceOffer(params.interruption.payload)
  const choiceCard = offer.card
  if (
    choiceCard.runId !== params.interruption.runId
    || choiceCard.interruptionId !== params.interruption.id
    || choiceCard.toolCallId !== toolCallId
  ) {
    throw new Error('PROJECT_AGENT_PENDING_CHOICE_OFFER_IDENTITY_MISMATCH')
  }
  return {
    kind: 'choice',
    runId: params.interruption.runId,
    interruptionId: params.interruption.id,
    approvalId: params.interruption.approvalId,
    operationId: params.interruption.operationId,
    toolCallId,
    choiceCard,
  }
}

async function buildPendingInteraction(params: {
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
    .filter((wait) => wait.status === 'collecting' || wait.status === 'pending')
    .flatMap((wait) => wait.taskIds)))
  if (taskIds.length === 0) return []
  const tasks = await prisma.task.findMany({
    where: {
      id: { in: taskIds },
      projectId: params.projectId,
      userId: params.userId,
      type: { not: TASK_TYPE.CREATIVE_WORK },
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

async function listCreativeSubagents(params: {
  projectId: string
  userId: string
  episodeId?: string | null
}): Promise<ProjectAgentSubagentView[]> {
  const tasks = await prisma.task.findMany({
    where: {
      projectId: params.projectId,
      userId: params.userId,
      episodeId: params.episodeId ?? null,
      type: TASK_TYPE.CREATIVE_WORK,
      payload: { path: '$.protocol', equals: CREATIVE_WORK_TASK_PROTOCOL },
      status: {
        in: [
          TASK_STATUS.QUEUED,
          TASK_STATUS.PROCESSING,
          TASK_STATUS.COMPLETED,
          TASK_STATUS.FAILED,
          TASK_STATUS.CANCELED,
        ],
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 24,
    select: {
      id: true,
      status: true,
      payload: true,
      result: true,
      errorCode: true,
      finishedAt: true,
    },
  })
  const parsedTasks = tasks.map((task) => {
    const payload = creativeWorkTaskPayloadSchema.parse(task.payload)
    const result = creativeWorkTaskResultSchema.safeParse(task.result)
    if (task.status === TASK_STATUS.COMPLETED && !result.success) {
      throw new Error(`PROJECT_AGENT_SUBAGENT_COMPLETED_RESULT_INVALID:${task.id}`)
    }
    return { task, payload, result }
  })
  const events = parsedTasks.flatMap(({ task, payload, result }) => {
    const lifecycle = result.success
      ? result.data.lifecycleProjection
      : payload.lifecycleProjection
    return lifecycle.events.map((progressEvent) => (
      parseProjectAgentSubagentEventPartData({
        subagentId: task.id,
        taskId: task.id,
        runId: payload.origin.runId,
        toolCallId: payload.origin.toolCallId,
        sequence: progressEvent.sequence,
        occurredAt: progressEvent.occurredAt,
        event: progressEvent.event,
      })
    ))
  })
  return resolveProjectAgentSubagentViews(events, parsedTasks.map(({ task, result }) => {
    const status = task.status
    if (
      status !== TASK_STATUS.QUEUED
      && status !== TASK_STATUS.PROCESSING
      && status !== TASK_STATUS.COMPLETED
      && status !== TASK_STATUS.FAILED
      && status !== TASK_STATUS.CANCELED
    ) throw new Error(`PROJECT_AGENT_SUBAGENT_TASK_STATUS_INVALID:${task.id}:${status}`)
    return {
      taskId: task.id,
      status,
      summary: result.success ? result.data.summary : null,
      errorCode: task.errorCode,
      finishedAt: task.finishedAt?.toISOString() ?? null,
    }
  }))
}

async function buildProjectAgentSessionState(
  input: ProjectAgentSessionScopeInput,
): Promise<ProjectAgentSessionState> {
  const assistantId = input.assistantId ?? 'workspace-command'
  const scope = {
    ...input,
    assistantId,
  }
  const [activeRun, recentRuns, waits, pendingInterruption, openFacts, plan] = await Promise.all([
    readUniqueActiveProjectAgentRun({
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId ?? null,
      assistantId,
      locale: input.locale,
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
    }),
    getPendingProjectAgentInterruptionForScope({
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId ?? null,
      assistantId,
    }),
    readOpenProjectAgentSessionFacts({
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId ?? null,
      assistantId,
      locale: input.locale,
    }),
    readProjectAgentPlan({
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId ?? null,
      assistantId,
    }),
  ])
  const run = resolveCurrentRun({
    activeRuns: activeRun ? [activeRun] : [],
    recentRuns: recentRuns.filter((candidate) => candidate.status !== 'awaiting_task'),
  })
  const currentActivity = await getCurrentProjectAgentActivity({
    projectId: input.projectId,
    userId: input.userId,
    episodeId: input.episodeId ?? null,
    assistantId,
    ...(run ? { runId: run.id } : {}),
  })
  const foregroundWaits = run ? waits.filter((wait) => wait.runId === run.id) : []
  const facts = resolveRunOwnedSessionFacts({
    run,
    waits: foregroundWaits,
    interruption: pendingInterruption,
    activity: currentActivity,
    openFacts,
  })
  const [pendingInteraction, activeTasks, subagents] = await Promise.all([
    buildPendingInteraction({
      interruption: facts.interruption,
    }),
    listActiveTasksForWaits({
      projectId: input.projectId,
      userId: input.userId,
      waits,
    }),
    listCreativeSubagents({
      projectId: input.projectId,
      userId: input.userId,
      episodeId: input.episodeId ?? null,
    }),
  ])
  const currentRun: ProjectAgentSessionRun | null = run
    ? {
      runId: run.id,
      status: run.status,
      controlKind: run.controlKind,
      errorCode: run.errorCode ?? null,
      errorMessage: run.errorMessage ?? null,
    }
    : null
  return {
    currentRun,
    currentActivity: facts.activity,
    pendingInteraction,
    activeWaits: waits,
    activeTasks,
    subagents,
    plan,
  }
}

export async function getProjectAgentSessionSnapshot(
  input: ProjectAgentSessionScopeInput,
): Promise<ProjectAgentSessionSnapshot> {
  const scope = {
    ...input,
    assistantId: input.assistantId ?? 'workspace-command',
  }
  const before = await readProjectAgentSessionEventWatermark(scope)
  const sessionState = await buildProjectAgentSessionState(input)
  const after = await readProjectAgentSessionEventWatermark(scope)
  return {
    sessionState,
    /*
     * Every state read starts after `before`, so it includes all projections
     * committed through that event. If later events raced the read, publish
     * the conservative lower watermark; SSE replay from that cursor is the
     * level-triggered convergence path. Normal event traffic must not require
     * an artificial quiet window or turn a valid snapshot into HTTP 500.
     */
    eventWatermark: before === after ? after : before,
  }
}

export async function getProjectAgentSessionState(
  input: ProjectAgentSessionScopeInput,
): Promise<ProjectAgentSessionState> {
  return await buildProjectAgentSessionState(input)
}
