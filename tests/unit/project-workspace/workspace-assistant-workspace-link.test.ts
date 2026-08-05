import { describe, expect, it } from 'vitest'
import { projectWorkspacePathFromHref } from '@/features/project-workspace/components/workspace-assistant/workspace-assistant-workspace-link'

describe('workspace assistant project links', () => {
  it('accepts only decoded project-relative workspace paths', () => {
    expect(projectWorkspacePathFromHref('production/%E5%89%A7%E6%9C%AC.md#scene-1'))
      .toBe('production/剧本.md')
    expect(projectWorkspacePathFromHref('episodes/01/%E9%95%9C%E5%A4%B4/001?focus=1'))
      .toBe('episodes/01/镜头/001')

    for (const unsafe of [
      '/tmp/runtime/workspace/file.md',
      'file:///tmp/runtime/file.md',
      'https://example.com/file.md',
      '../outside.md',
      'production/%2e%2e/system/project.json',
      'production\\shot-list.md',
      '%2Ftmp%2Fruntime.md',
      'production/%00shot.md',
      'production//shot-list.md',
      '%E0%A4%A',
    ]) {
      expect(projectWorkspacePathFromHref(unsafe), unsafe).toBeNull()
    }
  })
})
