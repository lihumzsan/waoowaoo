import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

function readRepoFile(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
}

function cssRule(source: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`))
  return match?.groups?.body ?? ''
}

describe('workspace canvas layout runtime contract', () => {
  it('animates React Flow node positions without transitioning node width or height', () => {
    const css = readRepoFile('src/styles/animations.css')
    const nodeTransitionRule = cssRule(css, '.workspace-canvas-layout-animated .react-flow__node:not(.dragging)')
    const shellRule = cssRule(css, '.workspace-canvas-node-shell')

    expect(nodeTransitionRule).toContain('transition: transform 240ms')
    expect(nodeTransitionRule).not.toContain('width')
    expect(nodeTransitionRule).not.toContain('height')
    expect(shellRule).not.toContain('transform')
    expect(shellRule).not.toContain('animation')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('@keyframes workspaceCanvasGlideReveal')
    expect(css).toContain('.workspace-canvas-soft-reveal')
    expect(css).toContain('transform: translateY(-8px)')
    expect(css).not.toContain('.workspace-canvas-node-shell[data-expanded="true"]')
    expect(css).not.toContain('workspaceCanvasNodeExpandIn')
    expect(css).not.toContain('workspaceCanvasNodeCollapseIn')
    expect(css).not.toContain('workspaceCanvasSoftReveal')
    expect(css).not.toContain('scale(0.985)')
    expect(css).not.toContain('filter: blur(8px)')
  })

  it('uses internal reveal motion for clicked node details instead of animating the card shell', () => {
    const node = readRepoFile('src/features/project-workspace/canvas/nodes/WorkspaceNode.tsx')

    expect(node).toContain('workspace-canvas-soft-reveal space-y-2 rounded-[14px]')
    expect(node).toContain('workspace-canvas-soft-reveal px-3.5 py-3')
    expect(node).toContain('workspace-canvas-soft-reveal whitespace-pre-wrap')
  })

  it('applies reveal motion to expanded screenplay and edit table content roots', () => {
    const node = readRepoFile('src/features/project-workspace/canvas/nodes/WorkspaceNode.tsx')

    expect(node).toContain("nodeContentInteractionClass(data, 'workspace-canvas-soft-reveal space-y-3')")
    expect(node).toContain("nodeContentInteractionClass(data, 'workspace-canvas-soft-reveal space-y-2.5')")
    expect(node).toContain('nodeContentInteractionClass(data, `workspace-canvas-soft-reveal space-y-3 ${streamClassName}`)')
  })

  it('keeps measurement local and removes collision failure flow from the canvas', () => {
    const canvas = readRepoFile('src/features/project-workspace/canvas/ProjectWorkspaceCanvas.tsx')

    expect(canvas).toContain('if (expanded && profile.expanded) return node')
    expect(canvas).toContain('return changed ? measuredNodes : currentNodes')
    expect(canvas).not.toContain('WorkspaceCanvasLayoutFailure')
    expect(canvas).not.toContain('layoutFailureVisible')
    expect(canvas).not.toContain('collisionAnchorNodeIds')
    expect(canvas).not.toContain('measuredNodePosition')
    expect(canvas).not.toContain('savedNodeLayoutPositions')
    expect(canvas).not.toContain('resolveCanvasLayoutOrCurrent')
  })

  it('removes localized layout failure copy because overlap is allowed', () => {
    const en = JSON.parse(readRepoFile('messages/en/project-workflow.json')) as {
      readonly canvas?: { readonly workspace?: { readonly layoutError?: string } }
    }
    const zh = JSON.parse(readRepoFile('messages/zh/project-workflow.json')) as {
      readonly canvas?: { readonly workspace?: { readonly layoutError?: string } }
    }

    expect(en.canvas?.workspace?.layoutError).toBeUndefined()
    expect(zh.canvas?.workspace?.layoutError).toBeUndefined()
  })
})
