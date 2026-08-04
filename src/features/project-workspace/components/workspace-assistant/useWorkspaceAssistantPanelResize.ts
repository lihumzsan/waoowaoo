'use client'

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  clampWorkspaceAssistantPanelWidth,
  WORKSPACE_ASSISTANT_PANEL_WIDTH_PX,
} from './panel-layout'

const WORKSPACE_ASSISTANT_WIDTH_STORAGE_KEY = 'workspace-assistant-panel-width'

function readStoredAssistantPanelWidth(): number {
  if (typeof window === 'undefined') return WORKSPACE_ASSISTANT_PANEL_WIDTH_PX
  const storedValue = window.localStorage.getItem(WORKSPACE_ASSISTANT_WIDTH_STORAGE_KEY)
  if (!storedValue) return WORKSPACE_ASSISTANT_PANEL_WIDTH_PX
  const parsedValue = Number(storedValue)
  return Number.isFinite(parsedValue)
    ? clampWorkspaceAssistantPanelWidth(parsedValue)
    : WORKSPACE_ASSISTANT_PANEL_WIDTH_PX
}

export function useWorkspaceAssistantPanelResize() {
  const [width, setWidth] = useState(readStoredAssistantPanelWidth)
  const [isResizing, setIsResizing] = useState(false)
  const resizeStateRef = useRef<{
    startX: number
    startWidth: number
    currentWidth: number
  } | null>(null)

  const onResizePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: width,
      currentWidth: width,
    }
    setIsResizing(true)
  }, [width])

  useEffect(() => {
    if (!isResizing) return

    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'

    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = resizeStateRef.current
      if (!resizeState) return
      const nextWidth = clampWorkspaceAssistantPanelWidth(
        resizeState.startWidth + resizeState.startX - event.clientX,
      )
      resizeState.currentWidth = nextWidth
      setWidth(nextWidth)
    }

    const handlePointerUp = () => {
      const currentWidth = resizeStateRef.current?.currentWidth ?? width
      window.localStorage.setItem(WORKSPACE_ASSISTANT_WIDTH_STORAGE_KEY, String(currentWidth))
      resizeStateRef.current = null
      setIsResizing(false)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
    }
  }, [isResizing, width])

  return {
    width,
    isResizing,
    onResizePointerDown,
  } as const
}
