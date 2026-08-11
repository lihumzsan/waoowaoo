import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export const TASK_HANDLER_RESULT_STEP_KEY = '__handler_result__'

export type TaskHandlerCheckpointOutput = {
  result: Record<string, unknown> | null
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
