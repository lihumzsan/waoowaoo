import { describe, expect, it } from 'vitest'
import {
  assertUniqueWorkspaceResourcePaths,
  buildGeneratedWorkspaceResourcePath,
  buildSavedWorkspaceDocumentPath,
  workspaceResourceDisplayName,
  WorkspaceResourcePathError,
  WorkspaceResourcePlacementError,
} from '@/lib/workspace-resource/path'

describe('WorkspaceResource readable path contract', () => {
  it('keeps a single generated Resource path readable in the working language', () => {
    expect(buildGeneratedWorkspaceResourcePath({
      parentPath: '沙海史诗短片/视频片段',
      name: '风暴加冕',
      mediaType: 'video',
    })).toBe('沙海史诗短片/视频片段/风暴加冕')
  })

  it('uses visible sortable numbering only for actual alternatives', () => {
    expect(buildGeneratedWorkspaceResourcePath({
      parentPath: '角色参考',
      name: '许宁 正面',
      mediaType: 'image',
      alternativeIndex: 0,
    })).toBe('角色参考/许宁-正面-01')
    expect(buildGeneratedWorkspaceResourcePath({
      parentPath: '角色参考',
      name: '许宁 正面',
      mediaType: 'image',
      alternativeIndex: 1,
    })).toBe('角色参考/许宁-正面-02')
  })

  it('keeps saved-document paths readable and preserves the content extension', () => {
    expect(buildSavedWorkspaceDocumentPath({
      parentPath: '创作方向',
      name: '视觉方案.json',
      contentKind: 'structured',
    })).toBe('创作方向/视觉方案.json')
  })

  it('removes only the exact historical suffix derived from the owning Resource ID', () => {
    expect(workspaceResourceDisplayName({
      workspacePath: '角色参考/许宁-正面-0123456789AB',
      resourceId: 'r_0123456789AB',
    })).toBe('许宁-正面')
    expect(workspaceResourceDisplayName({
      workspacePath: '角色参考/许宁-正面-0123456789AC',
      resourceId: 'r_0123456789AB',
    })).toBe('许宁-正面-0123456789AC')
  })

  it('rejects duplicate planned paths and invalid alternative indexes explicitly', () => {
    expect(() => assertUniqueWorkspaceResourcePaths(['视频片段/镜头-01', '视频片段/镜头-01']))
      .toThrow(WorkspaceResourcePlacementError)
    expect(() => buildGeneratedWorkspaceResourcePath({
      parentPath: null,
      name: '镜头',
      mediaType: 'video',
      alternativeIndex: -1,
    })).toThrow(WorkspaceResourcePathError)
  })
})
