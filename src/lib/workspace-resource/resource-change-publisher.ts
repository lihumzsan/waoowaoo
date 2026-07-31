import { randomUUID } from 'node:crypto'
import { createScopedLogger } from '@/lib/logging/core'
import type { OperationMutationReceipt } from '@/lib/operations/types'
import { redis } from '@/lib/redis'
import {
  WORKSPACE_SSE_EVENT_TYPE,
  type ResourceChangedSSEEvent,
} from '@/lib/sse/events'
import { getProjectChannel } from '@/lib/task/publisher'

const logger = createScopedLogger({
  module: 'workspace-resource.change-publisher',
})

/**
 * Best-effort post-commit projection. The receipt, business transaction and
 * normal mutation response remain authoritative when Redis/SSE is unavailable.
 */
export async function publishOperationMutationReceipt(params: {
  projectId: string
  userId: string
  receipt: OperationMutationReceipt | null
}): Promise<void> {
  if (!params.receipt || params.receipt.changedRefs.length === 0) return
  try {
    const event: ResourceChangedSSEEvent = {
      id: `resource:${randomUUID()}`,
      type: WORKSPACE_SSE_EVENT_TYPE.RESOURCE_CHANGED,
      projectId: params.projectId,
      userId: params.userId,
      ts: new Date().toISOString(),
      affectedResources: [...params.receipt.changedRefs],
    }
    await redis.publish(
      getProjectChannel(params.projectId),
      JSON.stringify(event),
    )
  } catch (error) {
    logger.warn({
      action: 'workspace_resource.change_publish_failed',
      message: 'workspace resource post-commit projection failed',
      projectId: params.projectId,
      userId: params.userId,
      operationId: params.receipt.operationId,
      details: error instanceof Error
        ? { errorName: error.name, errorMessage: error.message }
        : { error: String(error) },
    })
  }
}
