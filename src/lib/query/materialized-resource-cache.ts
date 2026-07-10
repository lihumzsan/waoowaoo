import type { QueryClient } from '@tanstack/react-query'
import type { WorkspaceMaterializedResourceEnvelope } from '@/lib/task/types'
import {
  compareWorkspaceMaterializedResourceVersions,
  parseWorkspaceMaterializedResourceVersion,
  readWorkspaceMaterializedResourceVersionFromData,
  workspaceMaterializedResourceKey,
  type WorkspaceMaterializedResourceKind,
} from '@/lib/workspace-resource/materialized-resource-version'
import { queryKeys } from './keys'

export interface MaterializedResourceIgnored {
  readonly envelope: WorkspaceMaterializedResourceEnvelope
  readonly reason: 'duplicate' | 'stale'
}

export interface MaterializedResourceApplyResult {
  readonly outcome: 'applied' | 'duplicate' | 'stale' | 'identity-conflict' | 'missing' | 'invalid'
  readonly applied: readonly WorkspaceMaterializedResourceEnvelope[]
  readonly ignored: readonly MaterializedResourceIgnored[]
  readonly errors: readonly string[]
}

type EnvelopeReadResult =
  | { readonly envelope: WorkspaceMaterializedResourceEnvelope; readonly error: null }
  | { readonly envelope: null; readonly error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isMaterializedResourceKind(value: unknown): value is WorkspaceMaterializedResourceKind {
  return value === 'editBible' || value === 'episodeData'
}

function readEnvelope(value: unknown, index: number): EnvelopeReadResult {
  if (!isRecord(value)) {
    return { envelope: null, error: `CANVAS_TERMINAL_RESOURCE_ENVELOPE_INVALID:${index}` }
  }
  if (!isMaterializedResourceKind(value.kind)) {
    return {
      envelope: null,
      error: `CANVAS_TERMINAL_RESOURCE_VERSION_UNSUPPORTED:${String(value.kind ?? index)}`,
    }
  }
  const kind = value.kind
  if (
    typeof value.projectId !== 'string'
    || typeof value.episodeId !== 'string'
    || typeof value.resourceKey !== 'string'
    || typeof value.taskId !== 'string'
    || !Object.prototype.hasOwnProperty.call(value, 'data')
  ) {
    return { envelope: null, error: `CANVAS_TERMINAL_RESOURCE_ENVELOPE_INVALID:${index}` }
  }
  const resourceVersion = parseWorkspaceMaterializedResourceVersion(kind, value.resourceVersion)
  if (!resourceVersion) {
    return {
      envelope: null,
      error: `CANVAS_TERMINAL_RESOURCE_VERSION_INVALID:${kind}:${index}`,
    }
  }
  if (kind === 'editBible' && resourceVersion.scheme === 'revision_updated_at') {
    return {
      error: null,
      envelope: {
        kind,
        projectId: value.projectId,
        episodeId: value.episodeId,
        resourceKey: value.resourceKey,
        resourceVersion,
        taskId: value.taskId,
        data: value.data,
      },
    }
  }
  if (kind === 'episodeData' && resourceVersion.scheme === 'aggregate_updated_at') {
    return {
      error: null,
      envelope: {
        kind,
        projectId: value.projectId,
        episodeId: value.episodeId,
        resourceKey: value.resourceKey,
        resourceVersion,
        taskId: value.taskId,
        data: value.data,
      },
    }
  }
  return {
    envelope: null,
    error: `CANVAS_TERMINAL_RESOURCE_VERSION_NOT_COMPARABLE:${kind}:${index}`,
  }
}

function queryKeyForEnvelope(envelope: WorkspaceMaterializedResourceEnvelope): readonly unknown[] {
  return envelope.kind === 'editBible'
    ? queryKeys.project.editBible(envelope.projectId, envelope.episodeId)
    : queryKeys.episodeData(envelope.projectId, envelope.episodeId)
}

function validateData(envelope: WorkspaceMaterializedResourceEnvelope): string | null {
  if (!isRecord(envelope.data)) {
    return `CANVAS_TERMINAL_RESOURCE_ENVELOPE_DATA_INVALID:${envelope.resourceKey}`
  }
  if (envelope.kind === 'editBible') {
    if (!Array.isArray(envelope.data.chapters) || !isRecord(envelope.data.editBible)) {
      return `CANVAS_TERMINAL_RESOURCE_ENVELOPE_DATA_INVALID:${envelope.resourceKey}`
    }
  } else if (typeof envelope.data.id !== 'string') {
    return `CANVAS_TERMINAL_RESOURCE_ENVELOPE_DATA_INVALID:${envelope.resourceKey}`
  }
  const dataVersion = readWorkspaceMaterializedResourceVersionFromData(envelope.kind, envelope.data)
  if (!dataVersion) {
    return `CANVAS_TERMINAL_RESOURCE_DATA_VERSION_INVALID:${envelope.resourceKey}`
  }
  const order = compareWorkspaceMaterializedResourceVersions({
    kind: envelope.kind,
    incoming: envelope.resourceVersion,
    current: dataVersion,
  })
  return order === 'same'
    ? null
    : `CANVAS_TERMINAL_RESOURCE_DATA_VERSION_MISMATCH:${envelope.resourceKey}`
}

function replaceWorkspaceMaterializedResourceSnapshot(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  data: unknown,
): void {
  void queryClient.cancelQueries({ queryKey, exact: true })
  queryClient.setQueryData(queryKey, data)
}

export function applyWorkspaceMaterializedResourcesToCache(input: {
  readonly queryClient: QueryClient
  readonly taskId: string
  readonly projectId: string
  readonly value: unknown
}): MaterializedResourceApplyResult {
  if (!Array.isArray(input.value) || input.value.length === 0) {
    return { outcome: 'missing', applied: [], ignored: [], errors: [] }
  }
  const applied: WorkspaceMaterializedResourceEnvelope[] = []
  const ignored: MaterializedResourceIgnored[] = []
  const errors: string[] = []

  input.value.forEach((value, index) => {
    const readResult = readEnvelope(value, index)
    if (!readResult.envelope) {
      errors.push(readResult.error)
      return
    }
    const envelope = readResult.envelope
    const expectedResourceKey = workspaceMaterializedResourceKey({
      kind: envelope.kind,
      projectId: envelope.projectId,
      episodeId: envelope.episodeId,
    })
    if (
      envelope.taskId !== input.taskId
      || envelope.projectId !== input.projectId
      || envelope.resourceKey !== expectedResourceKey
    ) {
      errors.push(`CANVAS_TERMINAL_RESOURCE_ENVELOPE_SCOPE_MISMATCH:${envelope.resourceKey}`)
      return
    }
    const dataError = validateData(envelope)
    if (dataError) {
      errors.push(dataError)
      return
    }

    const queryKey = queryKeyForEnvelope(envelope)
    const currentData = input.queryClient.getQueryData(queryKey)
    if (currentData !== undefined) {
      const currentVersion = readWorkspaceMaterializedResourceVersionFromData(envelope.kind, currentData)
      if (!currentVersion) {
        errors.push(`CANVAS_TERMINAL_RESOURCE_CURRENT_VERSION_INVALID:${envelope.resourceKey}`)
        return
      }
      const order = compareWorkspaceMaterializedResourceVersions({
        kind: envelope.kind,
        incoming: envelope.resourceVersion,
        current: currentVersion,
      })
      if (order !== 'newer') {
        ignored.push({
          envelope,
          reason: order === 'same' ? 'duplicate' : 'stale',
        })
        return
      }
    }

    replaceWorkspaceMaterializedResourceSnapshot(input.queryClient, queryKey, envelope.data)
    applied.push(envelope)
  })

  const hasIdentityConflict = errors.some((error) => (
    error.startsWith('CANVAS_TERMINAL_RESOURCE_ENVELOPE_SCOPE_MISMATCH:')
  ))
  const outcome: MaterializedResourceApplyResult['outcome'] = hasIdentityConflict
    ? 'identity-conflict'
    : errors.length > 0
      ? 'invalid'
      : applied.length > 0
        ? 'applied'
        : ignored.some((item) => item.reason === 'stale')
          ? 'stale'
          : 'duplicate'

  return { outcome, applied, ignored, errors }
}

export function restoreWorkspaceMaterializedResourceSnapshot(input: {
  readonly queryClient: QueryClient
  readonly kind: WorkspaceMaterializedResourceKind
  readonly projectId: string
  readonly episodeId: string
  readonly snapshot: unknown
}): 'restored' | 'newer-current-preserved' {
  const snapshotVersion = readWorkspaceMaterializedResourceVersionFromData(input.kind, input.snapshot)
  if (!snapshotVersion) {
    throw new Error(`CANVAS_OPTIMISTIC_ROLLBACK_VERSION_INVALID:${input.kind}:snapshot`)
  }
  const queryKey = input.kind === 'editBible'
    ? queryKeys.project.editBible(input.projectId, input.episodeId)
    : queryKeys.episodeData(input.projectId, input.episodeId)
  const current = input.queryClient.getQueryData(queryKey)
  if (current !== undefined) {
    const currentVersion = readWorkspaceMaterializedResourceVersionFromData(input.kind, current)
    if (!currentVersion) {
      throw new Error(`CANVAS_OPTIMISTIC_ROLLBACK_VERSION_INVALID:${input.kind}:current`)
    }
    const order = compareWorkspaceMaterializedResourceVersions({
      kind: input.kind,
      incoming: snapshotVersion,
      current: currentVersion,
    })
    if (order === 'older') return 'newer-current-preserved'
  }
  replaceWorkspaceMaterializedResourceSnapshot(input.queryClient, queryKey, input.snapshot)
  return 'restored'
}
