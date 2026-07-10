export const WORKSPACE_MATERIALIZED_RESOURCE_VERSION_SCHEME = {
  REVISION_UPDATED_AT: 'revision_updated_at',
  AGGREGATE_UPDATED_AT: 'aggregate_updated_at',
} as const

export type WorkspaceMaterializedResourceKind = 'editBible' | 'episodeData'

export type WorkspaceMaterializedResourceVersion =
  | {
      readonly scheme: typeof WORKSPACE_MATERIALIZED_RESOURCE_VERSION_SCHEME.REVISION_UPDATED_AT
      readonly value: {
        readonly revision: number
        readonly updatedAt: string
      }
    }
  | {
      readonly scheme: typeof WORKSPACE_MATERIALIZED_RESOURCE_VERSION_SCHEME.AGGREGATE_UPDATED_AT
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
      readonly resourceVersion: Extract<WorkspaceMaterializedResourceVersion, { scheme: 'revision_updated_at' }>
    })
  | (WorkspaceMaterializedResourceEnvelopeBase & {
      readonly kind: 'episodeData'
      readonly resourceVersion: Extract<WorkspaceMaterializedResourceVersion, { scheme: 'aggregate_updated_at' }>
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

export function createWorkspaceRevisionUpdatedAtVersion(value: {
  readonly revision: number
  readonly updatedAt: string
}): Extract<
  WorkspaceMaterializedResourceVersion,
  { scheme: 'revision_updated_at' }
> {
  if (!isRevision(value.revision) || !isCanonicalIsoTimestamp(value.updatedAt)) {
    throw new Error('CANVAS_TERMINAL_RESOURCE_VERSION_INVALID:revision_updated_at')
  }
  return {
    scheme: WORKSPACE_MATERIALIZED_RESOURCE_VERSION_SCHEME.REVISION_UPDATED_AT,
    value,
  }
}

export function createWorkspaceAggregateUpdatedAtVersion(value: string): Extract<
  WorkspaceMaterializedResourceVersion,
  { scheme: 'aggregate_updated_at' }
> {
  if (!isCanonicalIsoTimestamp(value)) {
    throw new Error('CANVAS_TERMINAL_RESOURCE_VERSION_INVALID:aggregate_updated_at')
  }
  return {
    scheme: WORKSPACE_MATERIALIZED_RESOURCE_VERSION_SCHEME.AGGREGATE_UPDATED_AT,
    value,
  }
}

export function parseWorkspaceMaterializedResourceVersion(
  kind: WorkspaceMaterializedResourceKind,
  value: unknown,
): WorkspaceMaterializedResourceVersion | null {
  if (!isRecord(value)) return null
  if (kind === 'editBible') {
    if (value.scheme !== WORKSPACE_MATERIALIZED_RESOURCE_VERSION_SCHEME.REVISION_UPDATED_AT) return null
    if (!isRecord(value.value)) return null
    if (!isRevision(value.value.revision) || !isCanonicalIsoTimestamp(value.value.updatedAt)) return null
    return {
      scheme: WORKSPACE_MATERIALIZED_RESOURCE_VERSION_SCHEME.REVISION_UPDATED_AT,
      value: { revision: value.value.revision, updatedAt: value.value.updatedAt },
    }
  }
  return value.scheme === WORKSPACE_MATERIALIZED_RESOURCE_VERSION_SCHEME.AGGREGATE_UPDATED_AT
    && isCanonicalIsoTimestamp(value.value)
    ? { scheme: WORKSPACE_MATERIALIZED_RESOURCE_VERSION_SCHEME.AGGREGATE_UPDATED_AT, value: value.value }
    : null
}

export function readWorkspaceMaterializedResourceVersionFromData(
  kind: WorkspaceMaterializedResourceKind,
  data: unknown,
): WorkspaceMaterializedResourceVersion | null {
  if (!isRecord(data)) return null
  return parseWorkspaceMaterializedResourceVersion(kind, data.resourceVersion)
}

export function compareWorkspaceMaterializedResourceVersions(params: {
  readonly kind: WorkspaceMaterializedResourceKind
  readonly incoming: WorkspaceMaterializedResourceVersion
  readonly current: WorkspaceMaterializedResourceVersion
}): WorkspaceMaterializedResourceVersionOrder {
  if (params.kind === 'editBible') {
    if (
      params.incoming.scheme !== 'revision_updated_at'
      || params.current.scheme !== 'revision_updated_at'
    ) {
      throw new Error('CANVAS_TERMINAL_RESOURCE_VERSION_NOT_COMPARABLE:editBible')
    }
    if (
      !isRevision(params.incoming.value.revision)
      || !isRevision(params.current.value.revision)
      || !isCanonicalIsoTimestamp(params.incoming.value.updatedAt)
      || !isCanonicalIsoTimestamp(params.current.value.updatedAt)
    ) {
      throw new Error('CANVAS_TERMINAL_RESOURCE_VERSION_INVALID:editBible')
    }
    if (params.incoming.value.revision !== params.current.value.revision) {
      return params.incoming.value.revision > params.current.value.revision ? 'newer' : 'older'
    }
    if (params.incoming.value.updatedAt === params.current.value.updatedAt) return 'same'
    return params.incoming.value.updatedAt > params.current.value.updatedAt ? 'newer' : 'older'
  }
  if (
    params.incoming.scheme !== 'aggregate_updated_at'
    || params.current.scheme !== 'aggregate_updated_at'
  ) {
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
