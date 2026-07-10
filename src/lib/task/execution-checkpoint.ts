import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { TextUsageEntry } from '@/lib/billing/runtime-usage'
import type { WorkspaceMaterializedResourceEnvelope } from './types'
import {
  parseWorkspaceMaterializedResourceVersion,
  readWorkspaceMaterializedResourceVersionFromData,
} from '@/lib/workspace-resource/materialized-resource-version'

export const TASK_HANDLER_RESULT_STEP_KEY = '__handler_result__'

export type TaskHandlerCheckpointOutput = {
  result: Record<string, unknown> | null
  textUsage: TextUsageEntry[]
}

export type ReadyTaskHandlerCheckpointOutput = TaskHandlerCheckpointOutput & {
  materializedResources: WorkspaceMaterializedResourceEnvelope[]
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

function parseExecutedOutput(value: unknown): TaskHandlerCheckpointOutput {
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

export function parseReadyTaskHandlerCheckpointOutput(value: unknown): ReadyTaskHandlerCheckpointOutput {
  const base = parseExecutedOutput(value)
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.materializedResources)) {
    throw new Error('TASK_EXECUTION_CHECKPOINT_MATERIALIZED_RESOURCES_INVALID')
  }
  const resources = record.materializedResources.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('TASK_EXECUTION_CHECKPOINT_MATERIALIZED_RESOURCE_INVALID')
    }
    const resource = item as Record<string, unknown>
    if (
      (resource.kind !== 'editBible' && resource.kind !== 'episodeData')
      || typeof resource.projectId !== 'string'
      || typeof resource.episodeId !== 'string'
      || typeof resource.resourceKey !== 'string'
      || typeof resource.taskId !== 'string'
    ) throw new Error('TASK_EXECUTION_CHECKPOINT_MATERIALIZED_RESOURCE_INVALID')
    const version = parseWorkspaceMaterializedResourceVersion(resource.kind, resource.resourceVersion)
    const dataVersion = readWorkspaceMaterializedResourceVersionFromData(resource.kind, resource.data)
    if (!version || !dataVersion || canonicalJson(version) !== canonicalJson(dataVersion)) {
      throw new Error('TASK_EXECUTION_CHECKPOINT_MATERIALIZED_RESOURCE_VERSION_INVALID')
    }
    return resource as unknown as WorkspaceMaterializedResourceEnvelope
  })
  return { ...base, materializedResources: resources }
}

export async function loadTaskHandlerCheckpoint(params: {
  taskId: string
  inputFingerprint: string
}): Promise<{ id: string; state: 'executed' | 'ready'; output: TaskHandlerCheckpointOutput } | null> {
  const row = await prisma.taskExecutionCheckpoint.findUnique({
    where: { taskId_stepKey: { taskId: params.taskId, stepKey: TASK_HANDLER_RESULT_STEP_KEY } },
  })
  if (!row) return null
  if ((row.state !== 'executed' && row.state !== 'ready') || row.inputFingerprint !== params.inputFingerprint) {
    throw new Error(`TASK_EXECUTION_CHECKPOINT_CONFLICT:${params.taskId}`)
  }
  return { id: row.id, state: row.state, output: parseExecutedOutput(row.output) }
}

export async function saveTaskHandlerCheckpoint(params: {
  taskId: string
  inputFingerprint: string
  output: TaskHandlerCheckpointOutput
}): Promise<{ id: string; state: 'executed' | 'ready'; output: TaskHandlerCheckpointOutput }> {
  const serialized = JSON.parse(canonicalJson(params.output)) as Prisma.InputJsonValue
  try {
    const row = await prisma.taskExecutionCheckpoint.create({
      data: {
        id: randomUUID(),
        taskId: params.taskId,
        stepKey: TASK_HANDLER_RESULT_STEP_KEY,
        inputFingerprint: params.inputFingerprint,
        state: 'executed',
        output: serialized,
        completedAt: new Date(),
      },
    })
    return { id: row.id, state: 'executed', output: parseExecutedOutput(row.output) }
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error
    const existing = await loadTaskHandlerCheckpoint(params)
    if (!existing || canonicalJson(existing.output) !== canonicalJson(params.output)) {
      throw new Error(`TASK_EXECUTION_CHECKPOINT_COLLISION:${params.taskId}`)
    }
    return existing
  }
}

export async function finalizeTaskHandlerCheckpoint(params: {
  id: string
  taskId: string
  inputFingerprint: string
  materializedResources: readonly WorkspaceMaterializedResourceEnvelope[]
}): Promise<{ id: string; output: ReadyTaskHandlerCheckpointOutput }> {
  return await prisma.$transaction(async (tx) => {
    const row = await tx.taskExecutionCheckpoint.findUnique({ where: { id: params.id } })
    if (!row || row.taskId !== params.taskId || row.inputFingerprint !== params.inputFingerprint) {
      throw new Error(`TASK_EXECUTION_CHECKPOINT_CONFLICT:${params.taskId}`)
    }
    const output = {
      ...parseExecutedOutput(row.output),
      materializedResources: [...params.materializedResources],
    }
    if (row.state === 'ready') {
      const ready = parseReadyTaskHandlerCheckpointOutput(row.output)
      if (canonicalJson(ready) !== canonicalJson(output)) {
        throw new Error(`TASK_EXECUTION_CHECKPOINT_READY_COLLISION:${params.taskId}`)
      }
      return { id: row.id, output: ready }
    }
    if (row.state !== 'executed') throw new Error(`TASK_EXECUTION_CHECKPOINT_STATE_INVALID:${row.state}`)
    const updated = await tx.taskExecutionCheckpoint.update({
      where: { id: row.id },
      data: {
        state: 'ready',
        output: JSON.parse(canonicalJson(output)) as Prisma.InputJsonValue,
      },
    })
    return { id: updated.id, output: parseReadyTaskHandlerCheckpointOutput(updated.output) }
  })
}
