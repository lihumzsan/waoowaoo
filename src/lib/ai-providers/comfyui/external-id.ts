import type { ParsedAsyncExternalId } from '@/lib/ai-providers/async-task-types'
import {
  COMFYUI_RUNTIME_TARGET_IDS,
  type ComfyUiRuntimeTargetId,
} from './config'

export type ComfyUiAsyncType = 'VIDEO' | 'MUSIC'

const COMFYUI_ASYNC_TYPES: readonly ComfyUiAsyncType[] = ['VIDEO', 'MUSIC']
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function isRuntimeTargetId(value: string): value is ComfyUiRuntimeTargetId {
  return (COMFYUI_RUNTIME_TARGET_IDS as readonly string[]).includes(value)
}

function invalidExternalId(externalId: string): Error {
  return new Error(`Invalid COMFYUI externalId: ${externalId}`)
}

export function formatComfyUiExternalId(input: {
  readonly targetId: ComfyUiRuntimeTargetId
  readonly type: ComfyUiAsyncType
  readonly requestId: string
}): string {
  if (!isRuntimeTargetId(input.targetId) || !COMFYUI_ASYNC_TYPES.includes(input.type) || !UUID_PATTERN.test(input.requestId)) {
    throw invalidExternalId(`${input.targetId}:${input.type}:${input.requestId}`)
  }
  return `COMFYUI:${input.targetId}:${input.type}:${input.requestId}`
}

export function parseComfyUiExternalId(externalId: string): ParsedAsyncExternalId {
  const parts = externalId.split(':')
  const targetId = parts[1]
  const type = parts[2]
  const requestId = parts[3]
  if (
    parts.length !== 4
    || parts[0] !== 'COMFYUI'
    || !targetId
    || !isRuntimeTargetId(targetId)
    || !type
    || !(COMFYUI_ASYNC_TYPES as readonly string[]).includes(type)
    || !requestId
    || !UUID_PATTERN.test(requestId)
  ) {
    throw invalidExternalId(externalId)
  }
  return { provider: 'COMFYUI', endpoint: targetId, type: type as ComfyUiAsyncType, requestId }
}
