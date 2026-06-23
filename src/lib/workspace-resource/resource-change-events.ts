import { redis } from '@/lib/redis'
import { createScopedLogger } from '@/lib/logging/core'
import { getProjectChannel } from '@/lib/task/publisher'
import {
  WORKSPACE_SSE_EVENT_TYPE,
  type ResourceChangedSSEEvent,
  type WorkspaceResourceName,
} from '@/lib/task/types'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function readWriteResultData(value: unknown): unknown[] {
  if (!isRecord(value)) return []
  const candidates: unknown[] = []
  if (value.ok === true && 'data' in value) candidates.push(value.data)
  if (value.success === true && 'result' in value) candidates.push(value.result)
  if ('result' in value && isRecord(value.result)) {
    const nested = readWriteResultData(value.result)
    if (nested.length > 0) candidates.push(...nested)
  }
  return candidates.length > 0 ? candidates : [value]
}

function isEditScreenplayRecord(value: unknown): value is UnknownRecord {
  if (!isRecord(value)) return false
  return Boolean(
    readString(value.projectId)
      && readString(value.episodeId)
      && readString(value.screenplayText)
      && readString(value.status),
  )
}

function isEditScriptRecord(value: unknown): value is UnknownRecord {
  if (!isRecord(value)) return false
  return Boolean(
    readString(value.projectId)
      && readString(value.episodeId)
      && Array.isArray(value.shots)
      && Array.isArray(value.videoBlocks),
  )
}

function isEditDirectorDecoupageRecord(value: unknown): value is UnknownRecord {
  if (!isRecord(value)) return false
  return Boolean(
    readString(value.projectId)
      && readString(value.episodeId)
      && readString(value.screenplayId)
      && Array.isArray(value.shots),
  )
}

function isEditCinematographyShotPlanRecord(value: unknown): value is UnknownRecord {
  if (!isRecord(value)) return false
  return Boolean(
    readString(value.projectId)
      && readString(value.episodeId)
      && readString(value.editScriptId)
      && Array.isArray(value.shots),
  )
}

function dedupeResources(resources: readonly WorkspaceResourceName[]): WorkspaceResourceName[] {
  return Array.from(new Set(resources))
}

function editPipelineResources(): WorkspaceResourceName[] {
  return [
    'editScreenplay',
    'editDirectorDecoupage',
    'editScript',
    'editCinematographyShotPlan',
    'storyboards',
    'episodeData',
    'projectContext',
    'projectData',
  ]
}

export function extractWorkspaceResourceChangeEventSpecs(params: {
  result: unknown
  fallbackProjectId: string
  fallbackEpisodeId?: string | null
}): Array<{
  projectId: string
  episodeId: string
  resources: WorkspaceResourceName[]
}> {
  const specs: Array<{
    projectId: string
    episodeId: string
    resources: WorkspaceResourceName[]
  }> = []

  for (const data of readWriteResultData(params.result)) {
    if (isEditScreenplayRecord(data)) {
      const projectId = readString(data.projectId) ?? params.fallbackProjectId
      const episodeId = readString(data.episodeId)
      if (!episodeId) continue
      specs.push({
        projectId,
        episodeId,
        resources: editPipelineResources(),
      })
      continue
    }
    if (isEditDirectorDecoupageRecord(data)) {
      const projectId = readString(data.projectId) ?? params.fallbackProjectId
      const episodeId = readString(data.episodeId)
      if (!episodeId) continue
      specs.push({
        projectId,
        episodeId,
        resources: editPipelineResources(),
      })
      continue
    }
    if (isEditScriptRecord(data)) {
      const projectId = readString(data.projectId) ?? params.fallbackProjectId
      const episodeId = readString(data.episodeId)
      if (!episodeId) continue
      specs.push({
        projectId,
        episodeId,
        resources: [
          ...editPipelineResources(),
          'projectAssets',
        ],
      })
      continue
    }
    if (isEditCinematographyShotPlanRecord(data)) {
      const projectId = readString(data.projectId) ?? params.fallbackProjectId
      const episodeId = readString(data.episodeId)
      if (!episodeId) continue
      specs.push({
        projectId,
        episodeId,
        resources: editPipelineResources(),
      })
    }
  }

  return specs.map((spec) => ({
    ...spec,
    resources: dedupeResources(spec.resources),
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
        id: `resource:${now.getTime()}:${index}:${spec.projectId}:${spec.episodeId}`,
        type: WORKSPACE_SSE_EVENT_TYPE.RESOURCE_CHANGED,
        projectId: spec.projectId,
        userId: params.userId,
        ts: now.toISOString(),
        episodeId: spec.episodeId,
        resources: spec.resources,
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
