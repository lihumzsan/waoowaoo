export const WORKSPACE_MATERIALIZED_RESOURCE_VERSION_SCHEME = {
  RESOURCE_REVISION: 'resource_revision',
} as const

export type WorkspaceMaterializedResourceKind = 'editBible' | 'episodeData'

export type WorkspaceMaterializedResourceVersion = {
  readonly scheme: typeof WORKSPACE_MATERIALIZED_RESOURCE_VERSION_SCHEME.RESOURCE_REVISION
  readonly value: number
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
      readonly resourceVersion: WorkspaceMaterializedResourceVersion
    })
  | (WorkspaceMaterializedResourceEnvelopeBase & {
      readonly kind: 'episodeData'
      readonly resourceVersion: WorkspaceMaterializedResourceVersion
    })

export type WorkspaceMaterializedResourceVersionOrder = 'older' | 'same' | 'newer'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function createWorkspaceResourceRevisionVersion(value: number): WorkspaceMaterializedResourceVersion {
  if (!isRevision(value)) {
    throw new Error('CANVAS_TERMINAL_RESOURCE_VERSION_INVALID:resource_revision')
  }
  return {
    scheme: WORKSPACE_MATERIALIZED_RESOURCE_VERSION_SCHEME.RESOURCE_REVISION,
    value,
  }
}

export function parseWorkspaceMaterializedResourceVersion(
  kind: WorkspaceMaterializedResourceKind,
  value: unknown,
): WorkspaceMaterializedResourceVersion | null {
  if (!isRecord(value)) return null
  if (kind !== 'editBible' && kind !== 'episodeData') return null
  return value.scheme === WORKSPACE_MATERIALIZED_RESOURCE_VERSION_SCHEME.RESOURCE_REVISION
    && isRevision(value.value)
    ? { scheme: WORKSPACE_MATERIALIZED_RESOURCE_VERSION_SCHEME.RESOURCE_REVISION, value: value.value }
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
  if (params.incoming.scheme !== 'resource_revision' || params.current.scheme !== 'resource_revision') {
    throw new Error(`CANVAS_TERMINAL_RESOURCE_VERSION_NOT_COMPARABLE:${params.kind}`)
  }
  if (!isRevision(params.incoming.value) || !isRevision(params.current.value)) {
    throw new Error(`CANVAS_TERMINAL_RESOURCE_VERSION_INVALID:${params.kind}`)
  }
  if (params.incoming.value === params.current.value) return 'same'
  return params.incoming.value > params.current.value ? 'newer' : 'older'
}

export function workspaceMaterializedResourceKey(params: {
  readonly kind: WorkspaceMaterializedResourceKind
  readonly projectId: string
  readonly episodeId: string
}): string {
  return `${params.kind}:${params.projectId}:${params.episodeId}`
}
