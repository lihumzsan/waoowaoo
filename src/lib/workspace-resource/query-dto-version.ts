import {
  createWorkspaceResourceRevisionVersion,
  type WorkspaceMaterializedResourceVersion,
} from './materialized-resource-version'

export function createEpisodeDataQueryDto<TData extends object>(
  data: TData,
  resourceRevision: number,
): TData & { readonly resourceVersion: WorkspaceMaterializedResourceVersion } {
  return {
    ...data,
    resourceVersion: createWorkspaceResourceRevisionVersion(resourceRevision),
  }
}

export function createEditBibleQueryDto<TBible, TChapter>(
  editBible: TBible,
  chapters: readonly TChapter[],
  resourceRevision: number,
): {
  readonly editBible: (TBible & { readonly chapters: readonly TChapter[] }) | null
  readonly chapters: readonly TChapter[]
  readonly resourceVersion: WorkspaceMaterializedResourceVersion
} {
  return {
    editBible: editBible ? { ...editBible, chapters } : null,
    chapters,
    resourceVersion: createWorkspaceResourceRevisionVersion(resourceRevision),
  }
}
