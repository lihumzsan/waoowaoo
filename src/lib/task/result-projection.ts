import { getTaskDefinition } from './definition'
import type { TaskType } from './types'

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function requireProjectionRecord(
  value: unknown,
  errorCode: string,
): Record<string, unknown> {
  const record = readRecord(value)
  if (!record) throw new Error(errorCode)
  return record
}

const LIFECYCLE_FLOW_FIELDS = [
  'progress',
  'stage',
  'stageLabel',
  'displayMode',
  'message',
  'trace',
  'billing',
  'parentTaskId',
  'terminalSource',
  'errorCode',
] as const

export function projectTaskLifecyclePayload(
  taskType: TaskType,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const definition = getTaskDefinition(taskType)
  if (definition.lifecyclePayloadProjection === 'full') return payload
  const lifecycleProjection = requireProjectionRecord(
    payload.lifecycleProjection,
    `TASK_LIFECYCLE_REFERENCE_PROJECTION_MISSING:${taskType}`,
  )
  const projected: Record<string, unknown> = { lifecycleProjection }
  for (const key of LIFECYCLE_FLOW_FIELDS) {
    if (payload[key] !== undefined) projected[key] = payload[key]
  }
  return projected
}

export function projectTaskContinuationResult(
  taskType: TaskType,
  result: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!result) return null
  const definition = getTaskDefinition(taskType)
  if (definition.continuationResultProjection === 'full') return result
  return requireProjectionRecord(
    result.continuationProjection,
    `TASK_CONTINUATION_REFERENCE_PROJECTION_MISSING:${taskType}`,
  )
}
