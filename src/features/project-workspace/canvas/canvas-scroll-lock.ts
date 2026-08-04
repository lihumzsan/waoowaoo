import type { HTMLAttributes } from 'react'

export const WORKSPACE_CANVAS_SCROLL_LOCK_ATTRIBUTE = 'data-workspace-canvas-scroll-lock'
export const WORKSPACE_CANVAS_SCROLL_LOCK_SELECTOR = `[${WORKSPACE_CANVAS_SCROLL_LOCK_ATTRIBUTE}="true"], .nowheel`

export interface WorkspaceCanvasScrollableRegionProps<TElement extends HTMLElement>
  extends Readonly<Pick<HTMLAttributes<TElement>, 'onPointerDownCapture' | 'onWheelCapture'>> {
  readonly 'data-workspace-canvas-scroll-lock': 'true'
}

export function isWorkspaceCanvasWheelLockedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return target.closest(WORKSPACE_CANVAS_SCROLL_LOCK_SELECTOR) !== null
}

export function workspaceCanvasScrollableRegionProps<TElement extends HTMLElement>(): WorkspaceCanvasScrollableRegionProps<TElement> {
  return {
    'data-workspace-canvas-scroll-lock': 'true',
    onPointerDownCapture: (event) => event.stopPropagation(),
    onWheelCapture: (event) => event.stopPropagation(),
  }
}
