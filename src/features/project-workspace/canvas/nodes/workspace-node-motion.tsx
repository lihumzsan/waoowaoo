'use client'

import { useEffect, useState, type ReactNode } from 'react'

export const WORKSPACE_CANVAS_REVEAL_CLASS = 'workspace-canvas-soft-reveal'

const WORKSPACE_CANVAS_EXIT_DURATION_MS = 180

export function workspaceCanvasRevealClass(className = ''): string {
  return className ? `${WORKSPACE_CANVAS_REVEAL_CLASS} ${className}` : WORKSPACE_CANVAS_REVEAL_CLASS
}

function workspaceCanvasPresenceClass(className?: string): string {
  return className ? `workspace-canvas-motion-presence ${className}` : 'workspace-canvas-motion-presence'
}

export function WorkspaceCanvasMotionPresence({
  visible,
  motionKey,
  className,
  children,
}: {
  readonly visible: boolean
  readonly motionKey?: string | number
  readonly className?: string
  readonly children: ReactNode
}) {
  const [rendered, setRendered] = useState(visible)
  const [cachedChildren, setCachedChildren] = useState<ReactNode>(children)
  const renderedMotionKey = motionKey === undefined ? 'default' : String(motionKey)

  useEffect(() => {
    if (visible) {
      setCachedChildren(children)
      setRendered(true)
      return undefined
    }

    if (!rendered) return undefined

    const timeoutId = window.setTimeout(() => setRendered(false), WORKSPACE_CANVAS_EXIT_DURATION_MS)
    return () => window.clearTimeout(timeoutId)
  }, [children, rendered, visible])

  if (!rendered) return null

  return (
    <div
      key={visible ? renderedMotionKey : `exit:${renderedMotionKey}`}
      className={workspaceCanvasPresenceClass(className)}
      data-motion-state={visible ? 'entered' : 'exiting'}
    >
      {visible ? children : cachedChildren}
    </div>
  )
}
