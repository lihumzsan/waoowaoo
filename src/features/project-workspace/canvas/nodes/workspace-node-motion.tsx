'use client'

import { useEffect, useState, type ReactNode } from 'react'

export const WORKSPACE_CANVAS_REVEAL_CLASS = 'workspace-canvas-soft-reveal'

export const WORKSPACE_CANVAS_ENTER_DURATION_MS = 180
export const WORKSPACE_CANVAS_EXIT_DURATION_MS = 130
export const WORKSPACE_CANVAS_MEASURE_AFTER_MOTION_DELAY_MS = WORKSPACE_CANVAS_ENTER_DURATION_MS + 40
export const WORKSPACE_CANVAS_MOTION_ACTIVE_ATTRIBUTE = 'data-workspace-canvas-motion-active'
export const WORKSPACE_CANVAS_MOTION_ACTIVE_SELECTOR = `[${WORKSPACE_CANVAS_MOTION_ACTIVE_ATTRIBUTE}="true"]`

export function workspaceCanvasRevealClass(className = ''): string {
  return className ? `${WORKSPACE_CANVAS_REVEAL_CLASS} ${className}` : WORKSPACE_CANVAS_REVEAL_CLASS
}

function workspaceCanvasPresenceClass(className?: string): string {
  return className ? `workspace-canvas-motion-presence-inner ${className}` : 'workspace-canvas-motion-presence-inner'
}

function workspaceCanvasMotionDurationMs(visible: boolean): number {
  return visible ? WORKSPACE_CANVAS_ENTER_DURATION_MS : WORKSPACE_CANVAS_EXIT_DURATION_MS
}

function workspaceCanvasShouldReduceMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function WorkspaceCanvasMotionPresence({
  visible,
  motionKey,
  className,
  exit = true,
  children,
}: {
  readonly visible: boolean
  readonly motionKey?: string | number
  readonly className?: string
  readonly exit?: boolean
  readonly children: ReactNode
}) {
  const [rendered, setRendered] = useState(visible)
  const [cachedChildren, setCachedChildren] = useState<ReactNode>(children)
  const [motionActive, setMotionActive] = useState(false)
  const renderedMotionKey = motionKey === undefined ? 'default' : String(motionKey)

  useEffect(() => {
    if (visible) {
      setCachedChildren(children)
      setRendered(true)
      return undefined
    }

    if (!rendered) return undefined
    if (!exit) {
      setRendered(false)
      return undefined
    }

    const timeoutId = window.setTimeout(() => setRendered(false), WORKSPACE_CANVAS_EXIT_DURATION_MS)
    return () => window.clearTimeout(timeoutId)
  }, [children, exit, rendered, visible])

  useEffect(() => {
    if (!rendered || workspaceCanvasShouldReduceMotion()) {
      setMotionActive(false)
      return undefined
    }

    setMotionActive(true)
    const timeoutId = window.setTimeout(() => {
      setMotionActive(false)
    }, workspaceCanvasMotionDurationMs(visible))

    return () => window.clearTimeout(timeoutId)
  }, [rendered, renderedMotionKey, visible])

  if (!visible && !exit) return null
  if (!rendered) return null

  return (
    <div
      key={visible ? renderedMotionKey : `exit:${renderedMotionKey}`}
      className="workspace-canvas-motion-presence"
      data-motion-state={visible ? 'entered' : 'exiting'}
      data-workspace-canvas-motion-active={motionActive ? 'true' : 'false'}
    >
      <div className={workspaceCanvasPresenceClass(className)}>
        {visible ? children : cachedChildren}
      </div>
    </div>
  )
}
