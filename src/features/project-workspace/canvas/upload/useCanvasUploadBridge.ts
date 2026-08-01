'use client'

import { useCallback, useRef, type ChangeEvent, type ClipboardEvent, type DragEvent, type RefObject } from 'react'
import type { XYPosition } from '@xyflow/react'
import {
  PROJECT_ASSISTANT_MEDIA_ATTACHMENT_ACCEPT,
} from '@/lib/project-agent/media-attachments'

export function useCanvasUploadBridge(params: {
  readonly canvasRef: RefObject<HTMLDivElement | null>
  readonly screenToFlowPosition: (position: XYPosition) => XYPosition
  readonly addFiles: (files: readonly File[], position: XYPosition) => void
  readonly onUserInteraction: () => void
}) {
  const {
    canvasRef,
    screenToFlowPosition,
    addFiles: addFilesToQueue,
    onUserInteraction,
  } = params
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const uploadPickerPositionRef = useRef<XYPosition>({ x: 0, y: 0 })

  const addFiles = useCallback((files: readonly File[], position: XYPosition) => {
    if (files.length === 0) return
    addFilesToQueue(files, position)
  }, [addFilesToQueue])

  const openPicker = useCallback((position: XYPosition) => {
    uploadPickerPositionRef.current = position
    uploadInputRef.current?.click()
  }, [])

  const handleInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files ?? []), uploadPickerPositionRef.current)
    event.target.value = ''
  }, [addFiles])

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    const files = Array.from(event.dataTransfer.files)
    if (files.length === 0) return
    event.preventDefault()
    onUserInteraction()
    addFiles(files, screenToFlowPosition({ x: event.clientX, y: event.clientY }))
  }, [addFiles, onUserInteraction, screenToFlowPosition])

  const handlePaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData.files)
    if (files.length === 0) return
    event.preventDefault()
    const bounds = canvasRef.current?.getBoundingClientRect()
    const screenPosition = bounds
      ? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    addFiles(files, screenToFlowPosition(screenPosition))
  }, [addFiles, canvasRef, screenToFlowPosition])

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes('Files')) event.preventDefault()
  }, [])

  return {
    accept: PROJECT_ASSISTANT_MEDIA_ATTACHMENT_ACCEPT,
    uploadInputRef,
    openPicker,
    handleInputChange,
    handleDrop,
    handlePaste,
    handleDragOver,
  } as const
}
