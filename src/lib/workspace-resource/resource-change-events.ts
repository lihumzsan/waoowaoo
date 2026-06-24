import { redis } from '@/lib/redis'
import { createScopedLogger } from '@/lib/logging/core'
import { getProjectChannel } from '@/lib/task/publisher'
import {
  WORKSPACE_SSE_EVENT_TYPE,
  type ResourceChangedSSEEvent,
  type WorkspaceResourceRef,
} from '@/lib/task/types'
import {
  dedupeWorkspaceResourceRefs,
  extractWorkspaceResourceRefsFromWriteResult,
} from './resource-impact'

export function extractWorkspaceResourceChangeEventSpecs(params: {
  result: unknown
  fallbackProjectId: string
  fallbackEpisodeId?: string | null
}): Array<{
  projectId: string
  affectedResources: WorkspaceResourceRef[]
}> {
  const refs = extractWorkspaceResourceRefsFromWriteResult({
    result: params.result,
    fallbackProjectId: params.fallbackProjectId,
    fallbackEpisodeId: params.fallbackEpisodeId,
  })
  const refsByProjectId = new Map<string, WorkspaceResourceRef[]>()
  for (const ref of refs) {
    refsByProjectId.set(ref.projectId, [...(refsByProjectId.get(ref.projectId) ?? []), ref])
  }
  return Array.from(refsByProjectId.entries()).map(([projectId, projectRefs]) => ({
    projectId,
    affectedResources: dedupeWorkspaceResourceRefs(projectRefs),
  }))
}

export async function publishWorkspaceResourceChangedEventsFromWriteResult(params: {
  result: unknown
  fallbackProjectId: string
  userId: string
  fallbackEpisodeId?: string | null
}) {
  const specs = extractWorkspaceResourceChangeEventSpecs(params)
  if (specs.length === 0) return
  const now = new Date()
  try {
    await Promise.all(specs.map(async (spec, index) => {
      const event: ResourceChangedSSEEvent = {
        id: `resource:${now.getTime()}:${index}:${spec.projectId}`,
        type: WORKSPACE_SSE_EVENT_TYPE.RESOURCE_CHANGED,
        projectId: spec.projectId,
        userId: params.userId,
        ts: now.toISOString(),
        affectedResources: spec.affectedResources,
      }
      await redis.publish(getProjectChannel(spec.projectId), JSON.stringify(event))
    }))
  } catch (error) {
    createScopedLogger({
      module: 'workspace-resource',
      action: 'resource_change.sse_publish_failed',
      projectId: params.fallbackProjectId,
      userId: params.userId,
    }).error({
      message: 'failed to publish resource change sse event',
      details: {
        specCount: specs.length,
      },
      error: error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { message: String(error) },
    })
  }
}
