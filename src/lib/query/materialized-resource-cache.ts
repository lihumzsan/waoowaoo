import type { QueryClient } from '@tanstack/react-query'
import type {
  WorkspaceMaterializedResourceEnvelope,
  WorkspaceResourceName,
} from '@/lib/task/types'
import { isWorkspaceResourceName } from '@/lib/workspace-resource/resource-impact'
import { queryKeys } from './keys'

interface MaterializedResourceApplyResult {
  readonly applied: readonly WorkspaceMaterializedResourceEnvelope[]
  readonly errors: readonly string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readEnvelope(value: unknown): WorkspaceMaterializedResourceEnvelope | null {
  if (!isRecord(value)) return null
  const kind = value.kind
  const episodeId = value.episodeId
  if (
    typeof kind !== 'string'
    || !isWorkspaceResourceName(kind)
    || typeof value.projectId !== 'string'
    || (episodeId !== null && typeof episodeId !== 'string')
    || typeof value.resourceKey !== 'string'
    || typeof value.resourceVersion !== 'string'
    || typeof value.taskId !== 'string'
    || !Object.prototype.hasOwnProperty.call(value, 'data')
  ) {
    return null
  }
  return {
    kind,
    projectId: value.projectId,
    episodeId,
    resourceKey: value.resourceKey,
    resourceVersion: value.resourceVersion,
    taskId: value.taskId,
    data: value.data,
  }
}

function queryKeyForEnvelope(envelope: WorkspaceMaterializedResourceEnvelope): readonly unknown[] | null {
  const episodeId = envelope.episodeId
  switch (envelope.kind) {
    case 'editBible':
      return episodeId ? queryKeys.project.editBible(envelope.projectId, episodeId) : null
    case 'editScript':
      return episodeId ? queryKeys.project.editScript(envelope.projectId, episodeId) : null
    case 'editShotExecutionPlan':
      return episodeId ? queryKeys.project.editShotExecutionPlan(envelope.projectId, episodeId) : null
    case 'storyboards':
      return episodeId ? queryKeys.storyboards.all(episodeId) : null
    case 'videos':
      return episodeId ? queryKeys.videos.all(episodeId) : null
    case 'episodeData':
      return episodeId ? queryKeys.episodeData(envelope.projectId, episodeId) : null
    case 'projectData':
      return queryKeys.projectData(envelope.projectId)
    case 'projectContext':
      return queryKeys.project.context(envelope.projectId, episodeId)
    case 'projectAssets':
    case 'globalAssets':
      return null
  }
}

function validateData(kind: WorkspaceResourceName, data: unknown): boolean {
  if (!isRecord(data)) return false
  if (kind === 'editBible') {
    return Array.isArray(data.chapters)
      && (data.editBible === null || isRecord(data.editBible))
  }
  if (kind === 'episodeData') return typeof data.id === 'string'
  return true
}

export function applyWorkspaceMaterializedResourcesToCache(input: {
  readonly queryClient: QueryClient
  readonly taskId: string
  readonly projectId: string
  readonly value: unknown
}): MaterializedResourceApplyResult {
  if (!Array.isArray(input.value)) return { applied: [], errors: [] }
  const applied: WorkspaceMaterializedResourceEnvelope[] = []
  const errors: string[] = []

  input.value.forEach((value, index) => {
    const envelope = readEnvelope(value)
    if (!envelope) {
      errors.push(`CANVAS_TERMINAL_RESOURCE_ENVELOPE_INVALID:${index}`)
      return
    }
    if (envelope.taskId !== input.taskId || envelope.projectId !== input.projectId) {
      errors.push(`CANVAS_TERMINAL_RESOURCE_ENVELOPE_SCOPE_MISMATCH:${envelope.resourceKey}`)
      return
    }
    if (!validateData(envelope.kind, envelope.data)) {
      errors.push(`CANVAS_TERMINAL_RESOURCE_ENVELOPE_DATA_INVALID:${envelope.resourceKey}`)
      return
    }
    const queryKey = queryKeyForEnvelope(envelope)
    if (!queryKey) {
      errors.push(`CANVAS_TERMINAL_RESOURCE_ENVELOPE_QUERY_UNSUPPORTED:${envelope.resourceKey}`)
      return
    }
    input.queryClient.setQueryData(queryKey, envelope.data)
    applied.push(envelope)
  })

  return { applied, errors }
}
