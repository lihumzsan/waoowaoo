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

    expect(nodeTransitionRule).toContain('transition: transform 220ms')
    expect(nodeTransitionRule).not.toContain('width')
    expect(nodeTransitionRule).not.toContain('height')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('.workspace-canvas-node-content[data-expanded="false"]')
  })

  it('keeps measured expanded profile sizes authoritative and avoids whole-canvas base recapture', () => {
    const canvas = readRepoFile('src/features/project-workspace/canvas/ProjectWorkspaceCanvas.tsx')

    expect(canvas).toContain('if (expanded && profile.expanded) return node')
    expect(canvas).toContain('collisionAnchorNodeIds: options?.collisionAnchorNodeIds')
    expect(canvas).not.toContain('savedNodeLayoutPositions')
    expect(canvas).not.toContain('captureLayoutBasePositions(alignedNodes')
  })

  it('uses localized copy for visible layout failures', () => {
    const en = JSON.parse(readRepoFile('messages/en/project-workflow.json')) as {
      readonly canvas?: { readonly workspace?: { readonly layoutError?: string } }
    }
    const zh = JSON.parse(readRepoFile('messages/zh/project-workflow.json')) as {
      readonly canvas?: { readonly workspace?: { readonly layoutError?: string } }
    }

    expect(en.canvas?.workspace?.layoutError).toBe('Canvas layout could not resolve without overlap. The last stable layout is still shown.')
    expect(zh.canvas?.workspace?.layoutError).toBe('画布布局无法在无覆盖状态下完成，当前保留上一个稳定布局。')
  })
})
