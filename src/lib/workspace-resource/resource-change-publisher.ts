import { randomUUID } from 'node:crypto'
import { createScopedLogger } from '@/lib/logging/core'
import type { OperationMutationReceipt } from '@/lib/operations/types'
import { redis } from '@/lib/redis'
import {
  WORKSPACE_SSE_EVENT_TYPE,
  type ResourceChangedSSEEvent,
} from '@/lib/sse/events'
import type { WorkspaceResourceRef } from '@/lib/task/types'
import { getProjectChannel } from '@/lib/task/publisher'

const logger = createScopedLogger({
  module: 'workspace-resource.change-publisher',
})

async function publishWorkspaceResourceChangeEvent(params: {
  projectId: string
  userId: string
  affectedResources: readonly WorkspaceResourceRef[]
  operationId?: string
}): Promise<void> {
  if (params.affectedResources.length === 0) return
  try {
    const event: ResourceChangedSSEEvent = {
      id: `resource:${randomUUID()}`,
      type: WORKSPACE_SSE_EVENT_TYPE.RESOURCE_CHANGED,
      projectId: params.projectId,
      userId: params.userId,
      ts: new Date().toISOString(),
      affectedResources: [...params.affectedResources],
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
      operationId: params.operationId,
      details: error instanceof Error
        ? { errorName: error.name, errorMessage: error.message }
        : { error: String(error) },
    })
  }
}

/**
 * Best-effort post-commit projection. The committed WorkspaceResource tree is
 * authoritative when Redis/SSE is unavailable; refresh reconstructs the same
 * View from that tree.
 */
export async function publishWorkspaceResourceChanges(params: {
  projectId: string
  userId: string
  affectedResources: readonly WorkspaceResourceRef[]
}): Promise<void> {
  await publishWorkspaceResourceChangeEvent(params)
}

export async function publishOperationMutationReceipt(params: {
  projectId: string
  userId: string
  receipt: OperationMutationReceipt | null
}): Promise<void> {
  if (!params.receipt) return
  await publishWorkspaceResourceChangeEvent({
    projectId: params.projectId,
    userId: params.userId,
    affectedResources: params.receipt.changedRefs,
    operationId: params.receipt.operationId,
  })
}
