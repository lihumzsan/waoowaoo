import { describe, expect, it } from 'vitest'
import {
  readWorkspaceScopeId,
  WORKSPACE_SCOPE_ALL_ID,
  workspaceChapterScopeId,
} from '@/features/project-workspace/workspace-scope'

describe('workspace scope', () => {
  it('keeps canvas scope limited to all or a concrete chapter', () => {
    expect(readWorkspaceScopeId(WORKSPACE_SCOPE_ALL_ID)).toEqual({ kind: 'all' })
    expect(readWorkspaceScopeId(workspaceChapterScopeId('chapter-1'))).toEqual({
      kind: 'chapter',
      chapterId: 'chapter-1',
    })
  })

  it('does not treat former overview or bible review screens as canvas scopes', () => {
    expect(readWorkspaceScopeId('overview')).toEqual({ kind: 'all' })
    expect(readWorkspaceScopeId('bible_review')).toEqual({ kind: 'all' })
  })
})
