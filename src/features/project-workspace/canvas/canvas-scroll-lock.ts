import type { HTMLAttributes } from 'react'

export type WorkspaceCanvasScrollableRegionProps<TElement extends HTMLElement> = Readonly<
  Pick<HTMLAttributes<TElement>, 'onPointerDownCapture' | 'onWheelCapture'>
>

export function workspaceCanvasScrollableRegionProps<TElement extends HTMLElement>(): WorkspaceCanvasScrollableRegionProps<TElement> {
  return {
    onPointerDownCapture: (event) => event.stopPropagation(),
    onWheelCapture: (event) => event.stopPropagation(),
  }
}
