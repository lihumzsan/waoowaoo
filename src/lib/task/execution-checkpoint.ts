import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { TextUsageEntry } from '@/lib/billing/runtime-usage'

export const TASK_HANDLER_RESULT_STEP_KEY = '__handler_result__'

export type TaskHandlerCheckpointOutput = {
  result: Record<string, unknown> | null
  textUsage: TextUsageEntry[]
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]))
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export async function loadTaskExecutionFingerprint(taskId: string): Promise<string> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { executionFingerprint: true },
  })
  if (!task) throw new Error(`TASK_NOT_FOUND:${taskId}`)
  if (!task.executionFingerprint) throw new Error(`TASK_EXECUTION_FINGERPRINT_MISSING:${taskId}`)
  return task.executionFingerprint
}

function parseTextUsage(value: unknown): TextUsageEntry[] {
  if (!Array.isArray(value)) throw new Error('TASK_EXECUTION_CHECKPOINT_USAGE_INVALID')
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('TASK_EXECUTION_CHECKPOINT_USAGE_ENTRY_INVALID')
    }
    const record = item as Record<string, unknown>
    const valid = typeof record.model === 'string' && record.model.trim().length > 0
      && typeof record.inputTokens === 'number' && Number.isSafeInteger(record.inputTokens) && record.inputTokens >= 0
      && typeof record.outputTokens === 'number' && Number.isSafeInteger(record.outputTokens) && record.outputTokens >= 0
      && (record.cachedInputTokens === undefined || (typeof record.cachedInputTokens === 'number' && Number.isSafeInteger(record.cachedInputTokens) && record.cachedInputTokens >= 0))
      && (record.cacheWriteTokens === undefined || (typeof record.cacheWriteTokens === 'number' && Number.isSafeInteger(record.cacheWriteTokens) && record.cacheWriteTokens >= 0))
      && (record.cacheHitRate === undefined || (typeof record.cacheHitRate === 'number' && Number.isFinite(record.cacheHitRate) && record.cacheHitRate >= 0 && record.cacheHitRate <= 1))
      && (record.providerCostCredits === undefined || (typeof record.providerCostCredits === 'number' && Number.isFinite(record.providerCostCredits) && record.providerCostCredits >= 0))
    if (!valid) throw new Error('TASK_EXECUTION_CHECKPOINT_USAGE_ENTRY_INVALID')
    return record as unknown as TextUsageEntry
  })
}

export function parseTaskHandlerCheckpointOutput(value: unknown): TaskHandlerCheckpointOutput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('TASK_EXECUTION_CHECKPOINT_OUTPUT_INVALID')
  }
  const record = value as Record<string, unknown>
  if (record.result !== null && (typeof record.result !== 'object' || Array.isArray(record.result))) {
    throw new Error('TASK_EXECUTION_CHECKPOINT_RESULT_INVALID')
  }
  return {
    result: record.result as Record<string, unknown> | null,
    textUsage: parseTextUsage(record.textUsage),
  }
}

export async function loadTaskHandlerCheckpoint(params: {
  taskId: string
  inputFingerprint: string
}): Promise<{ id: string; state: 'ready'; output: TaskHandlerCheckpointOutput } | null> {
  const row = await prisma.taskExecutionCheckpoint.findUnique({
    where: { taskId_stepKey: { taskId: params.taskId, stepKey: TASK_HANDLER_RESULT_STEP_KEY } },
  })
  if (!row) return null
  if (row.state !== 'ready' || row.inputFingerprint !== params.inputFingerprint) {
    throw new Error(`TASK_EXECUTION_CHECKPOINT_CONFLICT:${params.taskId}`)
  }
  return { id: row.id, state: 'ready', output: parseTaskHandlerCheckpointOutput(row.output) }
}

export async function saveTaskHandlerCheckpoint(params: {
  taskId: string
  inputFingerprint: string
  output: TaskHandlerCheckpointOutput
}): Promise<{ id: string; state: 'ready'; output: TaskHandlerCheckpointOutput }> {
  const serialized = JSON.parse(canonicalJson(params.output)) as Prisma.InputJsonValue
  try {
    const row = await prisma.taskExecutionCheckpoint.create({
      data: {
        id: randomUUID(),
        taskId: params.taskId,
        stepKey: TASK_HANDLER_RESULT_STEP_KEY,
        inputFingerprint: params.inputFingerprint,
        state: 'ready',
        output: serialized,
        completedAt: new Date(),
      },
    })
    return { id: row.id, state: 'ready', output: parseTaskHandlerCheckpointOutput(row.output) }
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error
    const existing = await loadTaskHandlerCheckpoint(params)
    if (!existing || canonicalJson(existing.output) !== canonicalJson(params.output)) {
      throw new Error(`TASK_EXECUTION_CHECKPOINT_COLLISION:${params.taskId}`, { cause: error })
    }
    return existing
  }
}
