export const WORKSPACE_MATERIALIZED_RESOURCE_VERSION_SCHEME = {
  REVISION: 'revision',
  UPDATED_AT: 'updated_at',
} as const

export type WorkspaceMaterializedResourceKind = 'editBible' | 'episodeData'

export type WorkspaceMaterializedResourceVersion =
  | {
      readonly scheme: typeof WORKSPACE_MATERIALIZED_RESOURCE_VERSION_SCHEME.REVISION
      readonly value: number
    }
  | {
      readonly scheme: typeof WORKSPACE_MATERIALIZED_RESOURCE_VERSION_SCHEME.UPDATED_AT
      readonly value: string
    }

interface WorkspaceMaterializedResourceEnvelopeBase {
  readonly projectId: string
  readonly episodeId: string
  readonly resourceKey: string
  readonly taskId: string
  readonly data: unknown
}

export type WorkspaceMaterializedResourceEnvelope =
  | (WorkspaceMaterializedResourceEnvelopeBase & {
      readonly kind: 'editBible'
      readonly resourceVersion: Extract<WorkspaceMaterializedResourceVersion, { scheme: 'revision' }>
    })
  | (WorkspaceMaterializedResourceEnvelopeBase & {
      readonly kind: 'episodeData'
      readonly resourceVersion: Extract<WorkspaceMaterializedResourceVersion, { scheme: 'updated_at' }>
    })

export type WorkspaceMaterializedResourceVersionOrder = 'older' | 'same' | 'newer'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

export function createWorkspaceRevisionVersion(value: number): Extract<
  WorkspaceMaterializedResourceVersion,
  { scheme: 'revision' }
> {
  if (!isRevision(value)) throw new Error('CANVAS_TERMINAL_RESOURCE_VERSION_INVALID:revision')
  return {
    scheme: WORKSPACE_MATERIALIZED_RESOURCE_VERSION_SCHEME.REVISION,
    value,
  }
}

export function createWorkspaceUpdatedAtVersion(value: string): Extract<
  WorkspaceMaterializedResourceVersion,
  { scheme: 'updated_at' }
> {
  if (!isCanonicalIsoTimestamp(value)) throw new Error('CANVAS_TERMINAL_RESOURCE_VERSION_INVALID:updated_at')
  return {
    scheme: WORKSPACE_MATERIALIZED_RESOURCE_VERSION_SCHEME.UPDATED_AT,
    value,
  }
}

export function parseWorkspaceMaterializedResourceVersion(
  kind: WorkspaceMaterializedResourceKind,
  value: unknown,
): WorkspaceMaterializedResourceVersion | null {
  if (!isRecord(value)) return null
  if (kind === 'editBible') {
    return value.scheme === WORKSPACE_MATERIALIZED_RESOURCE_VERSION_SCHEME.REVISION
      && isRevision(value.value)
      ? { scheme: WORKSPACE_MATERIALIZED_RESOURCE_VERSION_SCHEME.REVISION, value: value.value }
      : null
  }
  return value.scheme === WORKSPACE_MATERIALIZED_RESOURCE_VERSION_SCHEME.UPDATED_AT
    && isCanonicalIsoTimestamp(value.value)
    ? { scheme: WORKSPACE_MATERIALIZED_RESOURCE_VERSION_SCHEME.UPDATED_AT, value: value.value }
    : null
}

export function readWorkspaceMaterializedResourceVersionFromData(
  kind: WorkspaceMaterializedResourceKind,
  data: unknown,
): WorkspaceMaterializedResourceVersion | null {
  if (!isRecord(data)) return null
  if (kind === 'editBible') {
    const editBible = data.editBible
    if (editBible === null && Array.isArray(data.chapters)) {
      return {
        scheme: WORKSPACE_MATERIALIZED_RESOURCE_VERSION_SCHEME.REVISION,
        value: 0,
      }
    }
    if (!isRecord(editBible) || !isRevision(editBible.version)) return null
    return {
      scheme: WORKSPACE_MATERIALIZED_RESOURCE_VERSION_SCHEME.REVISION,
      value: editBible.version,
    }
  }
  return isCanonicalIsoTimestamp(data.updatedAt)
    ? {
        scheme: WORKSPACE_MATERIALIZED_RESOURCE_VERSION_SCHEME.UPDATED_AT,
        value: data.updatedAt,
      }
    : null
}

export function compareWorkspaceMaterializedResourceVersions(params: {
  readonly kind: WorkspaceMaterializedResourceKind
  readonly incoming: WorkspaceMaterializedResourceVersion
  readonly current: WorkspaceMaterializedResourceVersion
}): WorkspaceMaterializedResourceVersionOrder {
  if (params.kind === 'editBible') {
    if (params.incoming.scheme !== 'revision' || params.current.scheme !== 'revision') {
      throw new Error('CANVAS_TERMINAL_RESOURCE_VERSION_NOT_COMPARABLE:editBible')
    }
    if (!isRevision(params.incoming.value) || !isRevision(params.current.value)) {
      throw new Error('CANVAS_TERMINAL_RESOURCE_VERSION_INVALID:editBible')
    }
    if (params.incoming.value === params.current.value) return 'same'
    return params.incoming.value > params.current.value ? 'newer' : 'older'
  }
  if (params.incoming.scheme !== 'updated_at' || params.current.scheme !== 'updated_at') {
    throw new Error('CANVAS_TERMINAL_RESOURCE_VERSION_NOT_COMPARABLE:episodeData')
  }
  if (!isCanonicalIsoTimestamp(params.incoming.value) || !isCanonicalIsoTimestamp(params.current.value)) {
    throw new Error('CANVAS_TERMINAL_RESOURCE_VERSION_INVALID:episodeData')
  }
  const incomingTimestamp = Date.parse(params.incoming.value)
  const currentTimestamp = Date.parse(params.current.value)
  if (incomingTimestamp === currentTimestamp) return 'same'
  return incomingTimestamp > currentTimestamp ? 'newer' : 'older'
}

export function workspaceMaterializedResourceKey(params: {
  readonly kind: WorkspaceMaterializedResourceKind
  readonly projectId: string
  readonly episodeId: string
}): string {
  return `${params.kind}:${params.projectId}:${params.episodeId}`
}
