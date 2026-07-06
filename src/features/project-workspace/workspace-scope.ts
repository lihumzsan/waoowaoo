export const WORKSPACE_SCOPE_OVERVIEW_ID = 'overview'
export const WORKSPACE_SCOPE_BIBLE_REVIEW_ID = 'bible_review'

export type WorkspaceScopeId =
  | typeof WORKSPACE_SCOPE_OVERVIEW_ID
  | typeof WORKSPACE_SCOPE_BIBLE_REVIEW_ID
  | `chapter:${string}`

export type WorkspaceScope =
  | { readonly kind: 'overview' }
  | { readonly kind: 'bible_review' }
  | { readonly kind: 'chapter'; readonly chapterId: string }

export function workspaceChapterScopeId(chapterId: string): WorkspaceScopeId {
  return `chapter:${chapterId}`
}

export function readWorkspaceScopeId(value: string): WorkspaceScope {
  if (value === WORKSPACE_SCOPE_OVERVIEW_ID) return { kind: 'overview' }
  if (value === WORKSPACE_SCOPE_BIBLE_REVIEW_ID) return { kind: 'bible_review' }
  if (value.startsWith('chapter:')) {
    const chapterId = value.slice('chapter:'.length).trim()
    if (chapterId) return { kind: 'chapter', chapterId }
  }
  return { kind: 'overview' }
}
