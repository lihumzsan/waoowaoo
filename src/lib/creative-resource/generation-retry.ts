import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import type { TaskType } from '@/lib/task/types'
import type { CreativeResourceMediaType } from './contracts'
import {
  parseCreativeResourceGenerationTaskPayload,
  type CreativeResourceGenerationTaskPayload,
} from './generation-contract'

const originalGenerationInputIdentitySchema = z.object({
  request: z.object({
    kind: z.literal('new'),
  }).passthrough(),
}).passthrough()

export interface CreativeResourceRetryCandidate {
  readonly resourceId: string
  readonly name: string
  readonly schemaId: string
  readonly candidateIndex: number
  readonly candidateSetId: string | null
  readonly sourceTaskId: string
  readonly payload: CreativeResourceGenerationTaskPayload
}

export function buildCreativeResourceRetryTaskPayload(params: {
  readonly frozenPayload: CreativeResourceGenerationTaskPayload
  readonly toolCallId: string | null
}): CreativeResourceGenerationTaskPayload {
  return parseCreativeResourceGenerationTaskPayload({
    ...params.frozenPayload,
    resource: {
      ...params.frozenPayload.resource,
      executionSegmentId: null,
      toolCallId: params.toolCallId,
    },
  })
}

function retryError(code: string, resourceId: string): ApiError {
  return new ApiError('INVALID_PARAMS', {
    code,
    field: 'request.resourceIds',
    resourceId,
    agentRetryableAfterCorrection: false,
  })
}

/**
 * Resolves the immutable execution input for an explicit Resource retry.
 *
 * The original Task is selected by semantic identity (same target and a
 * persisted OperationPlan input with `request.kind=new`), never by row order.
 * A retry cannot provide or reinterpret any creative/provider fields.
 */
export async function loadCreativeResourceRetryCandidates(params: {
  readonly userId: string
  readonly projectId: string
  readonly episodeId: string | null
  readonly operationId: string
  readonly taskType: TaskType
  readonly mediaType: Exclude<CreativeResourceMediaType, 'text'>
  readonly resourceIds: readonly string[]
}): Promise<CreativeResourceRetryCandidate[]> {
  if (new Set(params.resourceIds).size !== params.resourceIds.length) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'CREATIVE_RESOURCE_RETRY_TARGET_DUPLICATE',
      field: 'request.resourceIds',
      requestedValue: params.resourceIds,
      agentRetryableAfterCorrection: true,
    })
  }
  const resources = await prisma.creativeResource.findMany({
    where: {
      id: { in: [...params.resourceIds] },
      userId: params.userId,
      projectId: params.projectId,
    },
    select: {
      id: true,
      name: true,
      mediaType: true,
      schemaId: true,
      status: true,
      episodeId: true,
      candidateIndex: true,
      candidateSetId: true,
    },
  })
  const resourceById = new Map(resources.map((resource) => [resource.id, resource]))
  for (const resourceId of params.resourceIds) {
    const resource = resourceById.get(resourceId)
    if (!resource) throw retryError('CREATIVE_RESOURCE_RETRY_TARGET_NOT_FOUND', resourceId)
    if (
      resource.status !== 'failed'
      || resource.mediaType !== params.mediaType
      || resource.episodeId !== params.episodeId
    ) {
      throw retryError('CREATIVE_RESOURCE_RETRY_TARGET_INVALID', resourceId)
    }
  }

  const candidateTasks = await prisma.task.findMany({
    where: {
      userId: params.userId,
      projectId: params.projectId,
      episodeId: params.episodeId,
      type: params.taskType,
      targetType: 'CreativeResource',
      targetId: { in: [...params.resourceIds] },
      operationId: params.operationId,
    },
    select: {
      id: true,
      targetId: true,
      status: true,
      payload: true,
      operationExecution: {
        select: {
          planSnapshot: {
            select: {
              normalizedInput: true,
            },
          },
        },
      },
    },
  })
  const originalTasksByResource = new Map<string, typeof candidateTasks>()
  for (const task of candidateTasks) {
    if (
      task.status !== 'failed'
      || !originalGenerationInputIdentitySchema.safeParse(
        task.operationExecution?.planSnapshot.normalizedInput,
      ).success
    ) {
      continue
    }
    originalTasksByResource.set(task.targetId, [
      ...(originalTasksByResource.get(task.targetId) ?? []),
      task,
    ])
  }

  return params.resourceIds.map((resourceId, position) => {
    const resource = resourceById.get(resourceId)
    if (!resource) throw retryError('CREATIVE_RESOURCE_RETRY_TARGET_NOT_FOUND', resourceId)
    const roots = originalTasksByResource.get(resourceId) ?? []
    if (roots.length === 0) {
      throw retryError('CREATIVE_RESOURCE_RETRY_FROZEN_INPUT_MISSING', resourceId)
    }
    if (roots.length !== 1) {
      throw retryError('CREATIVE_RESOURCE_RETRY_FROZEN_INPUT_AMBIGUOUS', resourceId)
    }
    const root = roots[0]
    if (!root) throw retryError('CREATIVE_RESOURCE_RETRY_FROZEN_INPUT_MISSING', resourceId)
    let payload: CreativeResourceGenerationTaskPayload
    try {
      payload = parseCreativeResourceGenerationTaskPayload(root.payload ?? {})
    } catch {
      throw retryError('CREATIVE_RESOURCE_RETRY_FROZEN_INPUT_INVALID', resourceId)
    }
    if (
      payload.resource.resourceId !== resourceId
      || payload.resource.mediaType !== params.mediaType
      || payload.resource.schemaId !== resource.schemaId
    ) {
      throw retryError('CREATIVE_RESOURCE_RETRY_FROZEN_INPUT_MISMATCH', resourceId)
    }
    return {
      resourceId,
      name: resource.name,
      schemaId: resource.schemaId,
      candidateIndex: resource.candidateIndex ?? position,
      candidateSetId: resource.candidateSetId,
      sourceTaskId: root.id,
      payload,
    }
  })
}
