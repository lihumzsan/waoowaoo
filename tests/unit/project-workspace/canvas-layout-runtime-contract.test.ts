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

interface FunctionSource {
  readonly name: string
  readonly header: string
  readonly body: string
}

function readFunctionSource(source: string, name: string): FunctionSource {
  const functionIndex = source.indexOf(`function ${name}`)
  if (functionIndex < 0) throw new Error(`Missing function ${name}`)

  const parenStart = source.indexOf('(', functionIndex)
  if (parenStart < 0) throw new Error(`Missing parameter list for ${name}`)

  let parenDepth = 0
  let parenEnd = -1
  for (let index = parenStart; index < source.length; index += 1) {
    const character = source[index]
    if (character === '(') parenDepth += 1
    if (character === ')') parenDepth -= 1
    if (parenDepth === 0) {
      parenEnd = index
      break
    }
  }
  if (parenEnd < 0) throw new Error(`Unclosed parameter list for ${name}`)

  const bodyStart = source.indexOf('{', parenEnd)
  if (bodyStart < 0) throw new Error(`Missing body for ${name}`)

  let braceDepth = 0
  let bodyEnd = -1
  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index]
    if (character === '{') braceDepth += 1
    if (character === '}') braceDepth -= 1
    if (braceDepth === 0) {
      bodyEnd = index
      break
    }
  }
  if (bodyEnd < 0) throw new Error(`Unclosed body for ${name}`)

  return {
    name,
    header: source.slice(functionIndex, bodyStart),
    body: source.slice(bodyStart + 1, bodyEnd),
  }
}

function expandedContentFunctions(source: string): readonly FunctionSource[] {
  const functions: FunctionSource[] = []
  const functionNamePattern = /function\s+([A-Z][A-Za-z0-9_]*)\s*\(/g
  const ignoredDispatchFunctions = new Set(['NodeContent'])
  let match: RegExpExecArray | null
  while ((match = functionNamePattern.exec(source)) !== null) {
    const name = match[1]
    if (!name || ignoredDispatchFunctions.has(name)) continue
    const functionSource = readFunctionSource(source, name)
    if (functionSource.header.includes('readonly expanded: boolean')) {
      functions.push(functionSource)
    }
  }
  return functions
}

describe('workspace canvas layout runtime contract', () => {
  it('animates React Flow node positions without transitioning node width or height', () => {
    const css = readRepoFile('src/styles/animations.css')
    const nodeTransitionRule = cssRule(css, '.workspace-canvas-layout-animated .react-flow__node:not(.dragging)')
    const shellRule = cssRule(css, '.workspace-canvas-node-shell')
    const presenceEnterRule = cssRule(css, '.workspace-canvas-motion-presence[data-motion-state="entered"]')
    const presenceExitRule = cssRule(css, '.workspace-canvas-motion-presence[data-motion-state="exiting"]')

    expect(nodeTransitionRule).toContain('transition: transform 240ms')
    expect(nodeTransitionRule).not.toContain('width')
    expect(nodeTransitionRule).not.toContain('height')
    expect(shellRule).not.toContain('transform')
    expect(shellRule).not.toContain('animation')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('@keyframes workspaceCanvasGlideReveal')
    expect(css).toContain('@keyframes workspaceCanvasGlideHide')
    expect(css).toContain('.workspace-canvas-soft-reveal')
    expect(css).toContain('transform: translateY(-8px)')
    expect(css).toContain('transform: translateY(-6px)')
    expect(presenceEnterRule).toContain('workspaceCanvasGlideReveal')
    expect(presenceExitRule).toContain('workspaceCanvasGlideHide')
    expect(presenceExitRule).toContain('pointer-events: none')
    expect(css).not.toContain('.workspace-canvas-node-shell[data-expanded="true"]')
    expect(css).not.toContain('workspaceCanvasNodeExpandIn')
    expect(css).not.toContain('workspaceCanvasNodeCollapseIn')
    expect(css).not.toContain('workspaceCanvasSoftReveal')
    expect(css).not.toContain('scale(0.985)')
    expect(css).not.toContain('filter: blur(8px)')
  })

  it('uses presence motion for clicked node details instead of animating the card shell', () => {
    const node = readRepoFile('src/features/project-workspace/canvas/nodes/WorkspaceNode.tsx')

    expect(node).toContain('visible={Boolean(activeCard)}')
    expect(node).toContain('visible={Boolean(current)}')
    expect(node).toContain('visible={isOpen && hasText(asset.description)}')
    expect(node).toContain('visible={on}')
    expect(node).toContain("motionKey={activeCard?.key ?? 'none'}")
    expect(node).toContain("motionKey={current?.key ?? 'none'}")
    expect(node).toContain("motionKey={current?.name ?? 'none'}")
  })

  it('requires every expanded content function to use canvas motion presence', () => {
    const node = readRepoFile('src/features/project-workspace/canvas/nodes/WorkspaceNode.tsx')
    const motion = readRepoFile('src/features/project-workspace/canvas/nodes/workspace-node-motion.tsx')
    const expandedFunctions = expandedContentFunctions(node)

    expect(expandedFunctions.map((entry) => entry.name)).toEqual([
      'EditablePromptSection',
      'ImageContent',
      'VideoContent',
      'FinalContent',
      'BgmScoreContent',
      'EditPipelineStepContent',
      'ProcessGroupContent',
      'EditScriptContent',
      'EditShotExecutionPlanContent',
      'StyleBibleContent',
      'EditScreenplayContent',
      'EditAssetContent',
      'VideoPlanContent',
    ])
    expandedFunctions.forEach((entry) => {
      expect(entry.body, `${entry.name} must wire expanded content through WorkspaceCanvasMotionPresence`).toContain('WorkspaceCanvasMotionPresence')
    })
    expect(node).not.toContain("'workspace-canvas-soft-reveal")
    expect(node).not.toContain('"workspace-canvas-soft-reveal')
    expect(motion).toContain("export const WORKSPACE_CANVAS_REVEAL_CLASS = 'workspace-canvas-soft-reveal'")
    expect(motion).toContain('WORKSPACE_CANVAS_EXIT_DURATION_MS = 180')
    expect(motion).toContain('readonly motionKey?: string | number')
  })

  it('keeps expanded layout dimensions during collapse exit motion', () => {
    const canvas = readRepoFile('src/features/project-workspace/canvas/ProjectWorkspaceCanvas.tsx')
    const node = readRepoFile('src/features/project-workspace/canvas/nodes/WorkspaceNode.tsx')
    const types = readRepoFile('src/features/project-workspace/canvas/node-canvas-types.ts')

    expect(types).toContain('readonly layoutExpanded?: boolean')
    expect(canvas).toContain('layoutCollapseNodeIds')
    expect(canvas).toContain('startLayoutCollapseHold(nodeId)')
    expect(canvas).toContain('clearLayoutCollapseHold(nodeId)')
    expect(canvas).toContain('WORKSPACE_CANVAS_EXIT_DURATION_MS')
    expect(canvas).toContain('const layoutExpanded = expanded || layoutCollapseNodeIds.has(node.id)')
    expect(canvas).toContain('expanded: layoutExpanded,')
    expect(canvas).toContain('layoutExpanded,')
    expect(canvas).toContain('expandedLayout: layoutExpanded ? profile.expandedLayout : undefined')
    expect(canvas).toContain('if (layoutExpanded && profile.expanded) return node')
    expect(node).toContain('function nodeIsCollapseMotionActive')
    expect(node).toContain('const layoutExpanded = data.layoutExpanded ?? expanded')
    expect(node).toContain("data-expanded={layoutExpanded ? 'true' : 'false'}")
    expect(node).toContain('!expanded && !collapseMotionActive')
    expect(node).toContain('deferCollapsedContent={collapseMotionActive}')
  })

  it('keeps measurement local and removes collision failure flow from the canvas', () => {
    const canvas = readRepoFile('src/features/project-workspace/canvas/ProjectWorkspaceCanvas.tsx')

    expect(canvas).toContain('if (layoutExpanded && profile.expanded) return node')
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
