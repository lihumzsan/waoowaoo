import { prisma } from '@/lib/prisma'
import { normalizeTaskError } from '@/lib/errors/normalize'
import { coerceTaskIntent, type TaskIntent } from './intent'

export type TaskTargetQuery = {
  targetType: string
  targetId: string
  types?: string[]
}

export type TaskTargetPhase = 'idle' | 'queued' | 'processing' | 'completed' | 'failed'

export type TaskBatchState = {
  id: string
  total: number
  queued: number
  processing: number
  completed: number
  failed: number
  failedIndexes: number[]
}

export type TaskTargetState = {
  targetType: string
  targetId: string
  phase: TaskTargetPhase
  runningTaskId: string | null
  runningTaskType: string | null
  intent: TaskIntent
  hasOutputAtStart: boolean | null
  progress: number | null
  stage: string | null
  stageLabel: string | null
  lastError: {
    code: string
    message: string
  } | null
  updatedAt: string | null
  batch: TaskBatchState | null
}

const ACTIVE_STATUS = new Set(['queued', 'processing'])

export function pairKey(targetType: string, targetId: string) {
  return `${targetType}:${targetId}`
}

export function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  return null
}

export function toProgress(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const rounded = Math.floor(value)
  if (rounded < 0) return 0
  if (rounded > 100) return 100
  return rounded
}

export function extractTaskStateFields(task: {
  type: string
  progress: number
  payload: unknown
}) {
  const payload = asObject(task.payload)
  const payloadUi = asObject(payload?.ui)
  return {
    stage: asNonEmptyString(payload?.stage),
    stageLabel: asNonEmptyString(payload?.stageLabel),
    hasOutputAtStart: asBoolean(payloadUi?.hasOutputAtStart),
    intent: coerceTaskIntent(payloadUi?.intent ?? payload?.intent, task.type),
    progress: toProgress(task.progress),
  }
}

export function normalizeFailedError(task: {
  errorCode: string | null
  errorMessage: string | null
}) {
  const normalized = normalizeTaskError(task.errorCode, task.errorMessage)
  if (!normalized) return null
  return {
    code: normalized.code,
    message: normalized.message,
  }
}

export function buildIdleState(target: TaskTargetQuery): TaskTargetState {
  return {
    targetType: target.targetType,
    targetId: target.targetId,
    phase: 'idle',
    runningTaskId: null,
    runningTaskType: null,
    intent: 'process',
    hasOutputAtStart: null,
    progress: null,
    stage: null,
    stageLabel: null,
    lastError: null,
    updatedAt: null,
    batch: null,
  }
}

function readBatchMeta(payload: unknown): { id: string; index: number; total: number } | null {
  const payloadObject = asObject(payload)
  const batch = asObject(payloadObject?.batch)
  const id = asNonEmptyString(batch?.id)
  const index = batch?.index
  const total = batch?.total
  if (
    !id
    || typeof index !== 'number'
    || !Number.isInteger(index)
    || index < 0
    || typeof total !== 'number'
    || !Number.isInteger(total)
    || total <= 0
    || index >= total
  ) {
    return null
  }
  return { id, index, total }
}

function resolveBatchTargetState(
  target: TaskTargetQuery,
  tasks: Array<{
    id: string
    type: string
    status: string
    progress: number
    payload: unknown
    errorCode: string | null
    errorMessage: string | null
    updatedAt: Date
  }>,
  newestBatch: { id: string; index: number; total: number },
): TaskTargetState {
  const sortedBatchTasks = tasks
    .map((task) => ({ task, batch: readBatchMeta(task.payload) }))
    .filter((entry) => entry.batch?.id === newestBatch.id)
    .sort((left, right) => right.task.updatedAt.getTime() - left.task.updatedAt.getTime())
  const latestByIndex = new Map<number, typeof sortedBatchTasks[number]>()
  for (const entry of sortedBatchTasks) {
    if (!entry.batch || latestByIndex.has(entry.batch.index)) continue
    latestByIndex.set(entry.batch.index, entry)
  }
  const batchTasks = Array.from(latestByIndex.values())

  let queued = 0
  let processing = 0
  let completed = 0
  let failed = 0
  let progressTotal = 0
  const failedIndexes: number[] = []

  for (const entry of batchTasks) {
    if (entry.task.status === 'queued') queued += 1
    else if (entry.task.status === 'processing') processing += 1
    else if (entry.task.status === 'completed') completed += 1
    else if (entry.task.status === 'failed' || entry.task.status === 'canceled') {
      failed += 1
      if (entry.batch) failedIndexes.push(entry.batch.index)
    }

    progressTotal += entry.task.status === 'completed'
      ? 100
      : (toProgress(entry.task.progress) || 0)
  }

  const observed = queued + processing + completed + failed
  const phase: TaskTargetPhase = processing > 0
    ? 'processing'
    : queued > 0
      ? 'queued'
      : observed < newestBatch.total
        ? 'queued'
        : failed > 0
          ? 'failed'
          : 'completed'
  const representative = phase === 'processing'
    ? batchTasks.find((entry) => entry.task.status === 'processing')?.task
    : phase === 'queued'
      ? batchTasks.find((entry) => entry.task.status === 'queued')?.task
      : batchTasks[0]?.task
  const latestFields = representative
    ? extractTaskStateFields(representative)
    : { stage: null, stageLabel: null, hasOutputAtStart: null, intent: 'process' as const, progress: null }
  const failedTask = batchTasks.find((entry) =>
    entry.task.status === 'failed' || entry.task.status === 'canceled'
  )?.task || null

  return {
    targetType: target.targetType,
    targetId: target.targetId,
    phase,
    runningTaskId: phase === 'processing' || phase === 'queued' ? representative?.id || null : null,
    runningTaskType: representative?.type || null,
    intent: latestFields.intent,
    hasOutputAtStart: latestFields.hasOutputAtStart,
    progress: Math.floor(progressTotal / newestBatch.total),
    stage: latestFields.stage,
    stageLabel: latestFields.stageLabel,
    lastError: phase === 'failed' && failedTask ? normalizeFailedError(failedTask) : null,
    updatedAt: batchTasks[0]?.task.updatedAt.toISOString() || null,
    batch: {
      id: newestBatch.id,
      total: newestBatch.total,
      queued,
      processing,
      completed,
      failed,
      failedIndexes: failedIndexes.sort((left, right) => left - right),
    },
  }
}

export function resolveTargetState(
  target: TaskTargetQuery,
  tasks: Array<{
    id: string
    type: string
    status: string
    progress: number
    payload: unknown
    errorCode: string | null
    errorMessage: string | null
    updatedAt: Date
  }>,
): TaskTargetState {
  const allowedTypes = target.types?.length ? new Set(target.types) : null
  const filtered = allowedTypes
    ? tasks.filter((task) => allowedTypes.has(task.type))
    : tasks

  if (filtered.length === 0) return buildIdleState(target)

  const newestBatch = readBatchMeta(filtered[0]?.payload)
  if (newestBatch) {
    return resolveBatchTargetState(target, filtered, newestBatch)
  }

  const running = filtered.find((task) => ACTIVE_STATUS.has(task.status)) || null
  const terminal = filtered.find((task) =>
    task.status === 'completed' || task.status === 'failed' || task.status === 'canceled'
  ) || null
  const latest = running || terminal

  if (!latest) return buildIdleState(target)

  const latestFields = extractTaskStateFields(latest)

  if (running) {
    const runningFields = extractTaskStateFields(running)
    return {
      targetType: target.targetType,
      targetId: target.targetId,
      phase: running.status === 'processing' ? 'processing' : 'queued',
      runningTaskId: running.id,
      runningTaskType: running.type,
      intent: runningFields.intent,
      hasOutputAtStart: runningFields.hasOutputAtStart,
      progress: runningFields.progress,
      stage: runningFields.stage,
      stageLabel: runningFields.stageLabel,
      lastError: null,
      updatedAt: running.updatedAt.toISOString(),
      batch: null,
    }
  }

  if (latest.status === 'completed') {
    return {
      targetType: target.targetType,
      targetId: target.targetId,
      phase: 'completed',
      runningTaskId: null,
      runningTaskType: latest.type,
      intent: latestFields.intent,
      hasOutputAtStart: latestFields.hasOutputAtStart,
      progress: 100,
      stage: latestFields.stage,
      stageLabel: latestFields.stageLabel,
      lastError: null,
      updatedAt: latest.updatedAt.toISOString(),
      batch: null,
    }
  }

  return {
    targetType: target.targetType,
    targetId: target.targetId,
    phase: 'failed',
    runningTaskId: null,
    runningTaskType: latest.type,
    intent: latestFields.intent,
    hasOutputAtStart: latestFields.hasOutputAtStart,
    progress: null,
    stage: latestFields.stage,
    stageLabel: latestFields.stageLabel,
    lastError: normalizeFailedError(latest),
    updatedAt: latest.updatedAt.toISOString(),
    batch: null,
  }
}

/**
 * 单次查询的 OR 条件上限。
 * 过大的 OR 列表 + ORDER BY 会导致 MySQL sort buffer 溢出（Error 1038）。
 */
const QUERY_BATCH_SIZE = 50

export async function queryTaskTargetStates(params: {
  projectId: string
  userId: string
  targets: TaskTargetQuery[]
}): Promise<TaskTargetState[]> {
  if (!params.targets.length) return []

  const pairEntries = new Map<string, { targetType: string; targetId: string }>()
  const typeUnion = new Set<string>()

  for (const target of params.targets) {
    pairEntries.set(pairKey(target.targetType, target.targetId), {
      targetType: target.targetType,
      targetId: target.targetId,
    })
    for (const type of target.types || []) {
      if (type) typeUnion.add(type)
    }
  }

  const pairs = Array.from(pairEntries.values())
  if (pairs.length === 0) return params.targets.map((target) => buildIdleState(target))

  const typeFilter = typeUnion.size > 0 ? { type: { in: Array.from(typeUnion) } } : {}

  // 分批查询，避免 MySQL sort buffer 溢出
  const allRows: Array<{
    id: string
    type: string
    status: string
    progress: number
    payload: unknown
    errorCode: string | null
    errorMessage: string | null
    targetType: string
    targetId: string
    updatedAt: Date
  }> = []

  for (let i = 0; i < pairs.length; i += QUERY_BATCH_SIZE) {
    const batch = pairs.slice(i, i + QUERY_BATCH_SIZE)
    const rows = await prisma.task.findMany({
      where: {
        projectId: params.projectId,
        userId: params.userId,
        OR: batch.map((item) => ({
          targetType: item.targetType,
          targetId: item.targetId,
        })),
        status: {
          in: ['queued', 'processing', 'completed', 'failed', 'canceled'],
        },
        ...typeFilter,
      },
      // 不在数据库层排序，改为应用层排序以避免 sort buffer 溢出
      select: {
        id: true,
        type: true,
        status: true,
        progress: true,
        payload: true,
        errorCode: true,
        errorMessage: true,
        targetType: true,
        targetId: true,
        updatedAt: true,
      },
    })
    allRows.push(...rows)
  }

  // 应用层按 updatedAt desc 排序（每个 target 组内排序即可）
  const grouped = new Map<string, typeof allRows>()
  for (const row of allRows) {
    const key = pairKey(row.targetType, row.targetId)
    const existing = grouped.get(key)
    if (existing) {
      existing.push(row)
    } else {
      grouped.set(key, [row])
    }
  }

  // 对每组按 updatedAt desc 排序
  for (const group of grouped.values()) {
    group.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  }

  return params.targets.map((target) =>
    resolveTargetState(
      target,
      grouped.get(pairKey(target.targetType, target.targetId)) || [],
    ),
  )
}
