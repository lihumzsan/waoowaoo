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
    const presenceRule = cssRule(css, '.workspace-canvas-motion-presence')
    const presenceInnerRule = cssRule(css, '.workspace-canvas-motion-presence-inner')
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
    expect(css).toContain('transform: translateY(-4px)')
    expect(css).toContain('transform: translateY(-3px)')
    expect(presenceRule).toContain('display: grid')
    expect(presenceRule).toContain('grid-template-rows: 1fr')
    expect(presenceRule).toContain('overflow: hidden')
    expect(presenceRule).toContain('will-change: grid-template-rows, opacity, transform')
    expect(presenceInnerRule).toContain('min-height: 0')
    expect(presenceInnerRule).toContain('overflow: hidden')
    expect(presenceEnterRule).toContain('workspaceCanvasGlideReveal')
    expect(presenceEnterRule).toContain('180ms')
    expect(presenceExitRule).toContain('workspaceCanvasGlideHide')
    expect(presenceExitRule).toContain('130ms')
    expect(presenceExitRule).toContain('pointer-events: none')
    expect(css).toContain('grid-template-rows: 0fr')
    expect(css).not.toContain('.workspace-canvas-node-shell[data-expanded="true"]')
    expect(css).not.toContain('workspaceCanvasNodeExpandIn')
    expect(css).not.toContain('workspaceCanvasNodeCollapseIn')
    expect(css).not.toContain('workspaceCanvasSoftReveal')
    expect(css).not.toContain('scale(0.985)')
    expect(css).not.toContain('filter: blur(8px)')
  })

  it('uses presence motion for clicked node details instead of animating the card shell', () => {
    const node = readRepoFile('src/features/project-workspace/canvas/nodes/WorkspaceNode.tsx')
    // ShotGrid（网格卡片 · 整行展开）已抽离为共享权威实现，供核心剪辑表 / 摄影指导 / 剧本创作 / 制作规划复用。
    const shotGrid = readRepoFile('src/features/project-workspace/canvas/nodes/shot-grid.tsx')

    expect(shotGrid).toContain('visible={Boolean(activeCard)}')
    expect(node).toContain('visible={Boolean(current)}')
    expect(node).toContain('visible={isOpen && hasText(asset.description)}')
    expect(node).toContain('visible={on}')
    expect(node).toContain('visible={open}')
    expect(shotGrid).toContain("motionKey={activeCard?.key ?? 'none'}")
    expect(node).toContain("motionKey={current?.key ?? 'none'}")
    expect(node).toContain("motionKey={current?.name ?? 'none'}")
  })

  it('locks scrollable node regions and wraps read-only prompts vertically', () => {
    const canvas = readRepoFile('src/features/project-workspace/canvas/ProjectWorkspaceCanvas.tsx')
    const node = readRepoFile('src/features/project-workspace/canvas/nodes/WorkspaceNode.tsx')
    const scrollLock = readRepoFile('src/features/project-workspace/canvas/canvas-scroll-lock.ts')
    const previewDetail = readRepoFile('src/features/project-workspace/canvas/details/EditScriptPreviewDetail.tsx')

    expect(scrollLock).toContain('function workspaceCanvasScrollableRegionProps')
    expect(scrollLock).toContain('function isWorkspaceCanvasWheelLockedTarget')
    expect(scrollLock).toContain('WORKSPACE_CANVAS_SCROLL_LOCK_SELECTOR')
    expect(scrollLock).toContain("'data-workspace-canvas-scroll-lock': 'true'")
    expect(scrollLock).toContain('onWheelCapture: (event) => event.stopPropagation()')
    expect(canvas).toContain('isWorkspaceCanvasWheelLockedTarget(event.target)')
    expect(canvas.indexOf('isWorkspaceCanvasWheelLockedTarget(event.target)')).toBeLessThan(canvas.indexOf('event.preventDefault()'))
    expect(node).toContain('<WorkspaceCanvasMotionPresence visible={open} motionKey="shot-prompt">')
    expect(node).toContain('{...workspaceCanvasScrollableRegionProps<HTMLPreElement>()}')
    expect(node).toContain('aria-expanded={open}')
    expect(node).toContain('overflow-y-auto')
    expect(node).toContain('overflow-x-hidden')
    expect(node).toContain('whitespace-pre-wrap')
    expect(node).toContain('[overflow-wrap:anywhere]')
    expect(node).not.toContain('max-h-56 overflow-auto')
    expect(previewDetail).toContain('{...workspaceCanvasScrollableRegionProps<HTMLDivElement>()}')
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
      'SoundscapeContent',
      'EditPipelineStepContent',
      'ProcessGroupContent',
      'EditScriptContent',
      'EditShotExecutionPlanContent',
      'StyleBibleContent',
      'EditBibleContent',
      'SourceScriptContent',
      'EditAssetContent',
      'VideoPlanContent',
    ])
    expandedFunctions.forEach((entry) => {
      expect(entry.body, `${entry.name} must wire expanded content through WorkspaceCanvasMotionPresence`).toContain('WorkspaceCanvasMotionPresence')
    })
    expect(node).not.toContain("'workspace-canvas-soft-reveal")
    expect(node).not.toContain('"workspace-canvas-soft-reveal')
    expect(motion).toContain("export const WORKSPACE_CANVAS_REVEAL_CLASS = 'workspace-canvas-soft-reveal'")
    expect(motion).toContain('WORKSPACE_CANVAS_ENTER_DURATION_MS = 180')
    expect(motion).toContain('WORKSPACE_CANVAS_EXIT_DURATION_MS = 130')
    expect(motion).toContain('readonly motionKey?: string | number')
    expect(motion).toContain('readonly exit?: boolean')
    expect(motion).toContain('workspace-canvas-motion-presence-inner')
  })

  it('defers node measurement during local canvas motion', () => {
    const node = readRepoFile('src/features/project-workspace/canvas/nodes/WorkspaceNode.tsx')
    const motion = readRepoFile('src/features/project-workspace/canvas/nodes/workspace-node-motion.tsx')

    expect(motion).toContain("WORKSPACE_CANVAS_MOTION_ACTIVE_ATTRIBUTE = 'data-workspace-canvas-motion-active'")
    expect(motion).toContain('WORKSPACE_CANVAS_MOTION_ACTIVE_SELECTOR')
    expect(motion).toContain('WORKSPACE_CANVAS_MEASURE_AFTER_MOTION_DELAY_MS = WORKSPACE_CANVAS_ENTER_DURATION_MS + 40')
    expect(motion).toContain('data-workspace-canvas-motion-active={motionActive ?')
    expect(motion).not.toContain('WORKSPACE_CANVAS_MEASURE_DEFER_SELECTOR')
    expect(node).toContain('WORKSPACE_CANVAS_MOTION_ACTIVE_SELECTOR')
    expect(node).toContain('WORKSPACE_CANVAS_MEASURE_AFTER_MOTION_DELAY_MS')
    expect(node).toContain('measurementTarget.element.querySelector(WORKSPACE_CANVAS_MOTION_ACTIVE_SELECTOR)')
    expect(node).toContain('measurementTarget.measureNodeSize(measurementTarget.nodeId')
    expect(node).toContain('scheduleDeferredMeasure()')
    expect(node).toContain('clearDeferredMeasure()')
    expect(node).toContain('observer.disconnect()')
  })

  it('lets width-stable card shells follow local collapse without filling stale node height', () => {
    const node = readRepoFile('src/features/project-workspace/canvas/nodes/WorkspaceNode.tsx')

    expect(node).toContain('fixedExpandedShell = expanded && Boolean(getWorkspaceCanvasNodePresentationProfile(data.kind).expanded)')
    expect(node).toContain("fixedExpandedShell\n      ? 'min-h-full overflow-visible'\n      : 'overflow-visible'")
    expect(node).toContain('${shellLayoutClass}')
    expect(node).not.toContain("data.kind === 'editScript' ? 'overflow-hidden' : 'min-h-full overflow-visible'")
  })

  it('keeps collapse motion for width-stable expanded content only', () => {
    const node = readRepoFile('src/features/project-workspace/canvas/nodes/WorkspaceNode.tsx')
    const widthStableFunctions = [
      'EditablePromptSection',
      'ImageContent',
      'VideoContent',
      'FinalContent',
      'EditPipelineStepContent',
      'EditAssetContent',
      'VideoPlanContent',
    ]
    // 剧本创作 / 制作规划 展开态改为 760 宽横向布局，折叠回 420，属于宽度变化节点，需跳过折叠退出动画。
    const widthChangingFunctions = [
      'BgmScoreContent',
      'ProcessGroupContent',
      'EditScriptContent',
      'EditShotExecutionPlanContent',
      'StyleBibleContent',
      'SourceScriptContent',
      'EditBibleContent',
    ]

    widthStableFunctions.forEach((name) => {
      expect(readFunctionSource(node, name).body, `${name} should animate collapse because card width is stable`).not.toContain('exit={false}')
    })
    widthChangingFunctions.forEach((name) => {
      expect(readFunctionSource(node, name).body, `${name} should skip collapse exit motion because card width changes`).toContain('exit={false}')
    })
  })

  it('removes width-changing collapse exit motion while keeping local detail motion', () => {
    const canvas = readRepoFile('src/features/project-workspace/canvas/ProjectWorkspaceCanvas.tsx')
    const node = readRepoFile('src/features/project-workspace/canvas/nodes/WorkspaceNode.tsx')
    const shotGrid = readRepoFile('src/features/project-workspace/canvas/nodes/shot-grid.tsx')
    const motion = readRepoFile('src/features/project-workspace/canvas/nodes/workspace-node-motion.tsx')
    const types = readRepoFile('src/features/project-workspace/canvas/node-canvas-types.ts')

    expect(types).not.toContain('readonly layoutExpanded?: boolean')
    expect(canvas).toContain('interface WorkspaceCanvasNodeDisclosureOverride')
    expect(canvas).toContain('readonly expanded: boolean')
    expect(canvas).toContain('nodeDisclosureOverridesRef')
    expect(canvas).toContain('setNodeDisclosureOverrides((current) =>')
    expect(canvas).toContain('expanded: !currentExpanded,')
    expect(canvas).toContain('expanded,')
    expect(canvas).toContain('expandedLayout: expanded ? profile.expandedLayout : undefined')
    expect(canvas).toContain('if (expanded && profile.expanded) return node')
    expect(canvas).not.toContain('WORKSPACE_CANVAS_EXIT_DURATION_MS')
    expect(canvas).not.toContain('layoutExpanded')
    expect(canvas).not.toContain('layoutCollapseNodeIds')
    expect(canvas).not.toContain('startLayoutCollapseHold(nodeId)')
    expect(canvas).not.toContain('clearLayoutCollapseHold(nodeId)')
    expect(node).not.toContain('function nodeIsCollapseMotionActive')
    expect(node).not.toContain('layoutExpanded')
    expect(node).not.toContain('collapseMotionActive')
    expect(node).not.toContain('deferCollapsedContent')
    expect(node).toContain('<WorkspaceCanvasMotionPresence visible={expanded} exit={false}')
    expect(node).toContain("data-expanded={expanded ? 'true' : 'false'}")
    expect(shotGrid).toContain('visible={Boolean(activeCard)}')
    expect(node).toContain('visible={isOpen && hasText(asset.description)}')
    expect(motion).toContain('if (!visible && !exit) return null')
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
