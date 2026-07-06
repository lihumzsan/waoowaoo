import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

function readRepoFile(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
}

describe('workspace current layout', () => {
  it('keeps the current workspace layout on the real page without a right dock query switch', () => {
    const workspacePage = readRepoFile('src/app/[locale]/workspace/[projectId]/page.tsx')
    const workspaceTypes = readRepoFile('src/features/project-workspace/types.ts')

    expect(workspacePage).toContain('<ProjectWorkspace')
    expect(workspacePage).not.toContain("searchParams.get('layout')")
    expect(workspacePage).not.toContain('right-dock-lab')
    expect(workspacePage).not.toContain('rightInsetPx=')
    expect(workspacePage).not.toContain('workspaceLayoutVariant=')
    expect(workspaceTypes).not.toContain('workspaceLayoutVariant')
  })

  it('keeps the global workspace and asset hub navigation visible in the workspace layout', () => {
    const navbar = readRepoFile('src/components/Navbar.tsx')
    const workspacePage = readRepoFile('src/app/[locale]/workspace/[projectId]/page.tsx')

    expect(navbar).toContain("href={{ pathname: '/workspace' }}")
    expect(navbar).toContain("href={{ pathname: '/workspace/asset-hub' }}")
    expect(navbar).not.toContain('showPrimaryNav')
    expect(workspacePage).not.toContain('showPrimaryNav=')
  })

  it('removes the duplicate workspace top actions from the current workspace page', () => {
    const workspace = readRepoFile('src/features/project-workspace/ProjectWorkspace.tsx')
    const headerShell = readRepoFile('src/features/project-workspace/components/WorkspaceHeaderShell.tsx')

    expect(workspace).not.toContain('assetLibraryLabel=')
    expect(workspace).not.toContain('refreshTitle=')
    expect(headerShell).not.toContain("from './WorkspaceTopActions'")
    expect(headerShell).not.toContain('<WorkspaceTopActions')
  })

  it('moves the current assistant panel up below the global workspace navigation', () => {
    const panelLayout = readRepoFile('src/features/project-workspace/components/workspace-assistant/panel-layout.ts')
    const assistant = readRepoFile('src/features/project-workspace/components/WorkspaceAssistantPanel.tsx')

    expect(panelLayout).toContain("WORKSPACE_ASSISTANT_TOP_OFFSET = '6rem'")
    expect(assistant).toContain('top: WORKSPACE_ASSISTANT_TOP_OFFSET')
    expect(assistant).toContain('height: `calc(100vh - ${WORKSPACE_ASSISTANT_TOP_OFFSET} - 1.5rem)`')
  })

  it('keeps the assistant panel open without collapse controls', () => {
    const workspace = readRepoFile('src/features/project-workspace/ProjectWorkspace.tsx')
    const assistant = readRepoFile('src/features/project-workspace/components/WorkspaceAssistantPanel.tsx')

    expect(workspace).not.toContain('isAssistantPanelCollapsed')
    expect(workspace).not.toContain('onToggleCollapsed=')
    expect(assistant).not.toContain('WorkspaceAssistantCollapseHandle')
    expect(assistant).not.toContain('WorkspaceAssistantPanelRail')
    expect(assistant).not.toContain('float-right h-14 w-14')
  })

  it('uses native delayed browser titles for the canvas viewport controls', () => {
    const canvas = readRepoFile('src/features/project-workspace/canvas/ProjectWorkspaceCanvas.tsx')

    expect(canvas).toContain('title={zoomInLabel}')
    expect(canvas).toContain('title={zoomOutLabel}')
    expect(canvas).toContain('title={fitViewLabel}')
    expect(canvas).toContain('title={autoFollowLabel}')
    expect(canvas).toContain('title={resetLabel}')
    expect(canvas).not.toContain('CanvasViewportControlButton')
    expect(canvas).not.toContain('group-hover:opacity-100')
    expect(canvas).not.toContain('bottom-full')
  })

  it('uses the episode canvas payload as the edit script display source', () => {
    const canvas = readRepoFile('src/features/project-workspace/canvas/ProjectWorkspaceCanvas.tsx')

    expect(canvas).toContain('storyboards,')
    expect(canvas).toContain('editScript,')
    expect(canvas).toContain('editScripts,')
    expect(canvas).toContain('editShotExecutionPlans,')
    expect(canvas).toContain('finalVideo,')
    expect(canvas).toContain('videoGroups,')
    expect(canvas).toContain('storyboards: scopedStoryboards')
    expect(canvas).toContain('videoGroups: scopedVideoGroups')
    expect(canvas).not.toContain('useProjectEditScript')
  })

  it('keeps project config modal messages complete for the workspace settings modal', () => {
    const zhConfigModal = readRepoFile('messages/zh/configModal.json')
    const enConfigModal = readRepoFile('messages/en/configModal.json')

    expect(zhConfigModal).toContain('"musicModel": "音乐模型"')
    expect(enConfigModal).toContain('"musicModel": "Music Model"')
  })
})
