import {
  createWorkspaceAggregateUpdatedAtVersion,
  createWorkspaceRevisionUpdatedAtVersion,
  type WorkspaceMaterializedResourceVersion,
} from './materialized-resource-version'

const EPOCH = '1970-01-01T00:00:00.000Z'

function canonicalTimestamp(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  if (typeof value !== 'string') return null
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return null
  const canonical = new Date(timestamp).toISOString()
  return canonical === value ? canonical : null
}

function collectLatestPersistenceTimestamp(value: unknown, latest: string): string {
  if (!value || typeof value !== 'object') return latest
  if (value instanceof Date) return latest
  if (Array.isArray(value)) {
    return value.reduce(
      (current, item) => collectLatestPersistenceTimestamp(item, current),
      latest,
    )
  }

  let current = latest
  for (const [key, child] of Object.entries(value)) {
    if (key === 'updatedAt' || key === 'createdAt') {
      const timestamp = canonicalTimestamp(child)
      if (timestamp && timestamp > current) current = timestamp
    }
    current = collectLatestPersistenceTimestamp(child, current)
  }
  return current
}

export function createEpisodeDataQueryDto<TData extends object>(
  data: TData,
): TData & {
  readonly resourceVersion: Extract<WorkspaceMaterializedResourceVersion, { scheme: 'aggregate_updated_at' }>
} {
  const latestUpdatedAt = collectLatestPersistenceTimestamp(data, EPOCH)
  if (latestUpdatedAt === EPOCH) {
    throw new Error('CANVAS_TERMINAL_RESOURCE_VERSION_MISSING:episodeData')
  }
  return {
    ...data,
    resourceVersion: createWorkspaceAggregateUpdatedAtVersion(latestUpdatedAt),
  }
}

export function createEditBibleQueryDto<TBible extends { readonly version: number } | null, TChapter>(
  editBible: TBible,
  chapters: readonly TChapter[],
): {
  readonly editBible: (TBible & { readonly chapters: readonly TChapter[] }) | null
  readonly chapters: readonly TChapter[]
  readonly resourceVersion: Extract<WorkspaceMaterializedResourceVersion, { scheme: 'revision_updated_at' }>
} {
  const data = {
    editBible: editBible ? { ...editBible, chapters } : null,
    chapters,
  }
  const revision = editBible?.version ?? 0
  const latestUpdatedAt = collectLatestPersistenceTimestamp(data, EPOCH)
  return {
    ...data,
    resourceVersion: createWorkspaceRevisionUpdatedAtVersion({
      revision,
      updatedAt: latestUpdatedAt,
    }),
  }
}
