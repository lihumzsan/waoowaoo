export const WORKSPACE_SCOPE_ALL_ID = 'all'

export type WorkspaceScopeId =
  | typeof WORKSPACE_SCOPE_ALL_ID
  | `chapter:${string}`

export type WorkspaceScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'chapter'; readonly chapterId: string }

export function workspaceChapterScopeId(chapterId: string): WorkspaceScopeId {
  return `chapter:${chapterId}`
}

export function readWorkspaceScopeId(value: string): WorkspaceScope {
  if (value === WORKSPACE_SCOPE_ALL_ID) return { kind: 'all' }
  if (value.startsWith('chapter:')) {
    const chapterId = value.slice('chapter:'.length).trim()
    if (chapterId) return { kind: 'chapter', chapterId }
  }
  return { kind: 'all' }
}
