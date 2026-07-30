'use client'

import React, { useContext } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { isWorkspaceCanvasLifecycleRunning } from '../../lifecycle/workspace-canvas-lifecycle'
import type { WorkspaceCanvasFlowNode } from '../../node-canvas-types'

export const SELECTABLE_TEXT_CLASS = 'select-none'

export type ImagePreviewHandler = (imageUrl: string) => void
export const WorkspaceNodeImagePreviewContext = React.createContext<ImagePreviewHandler | null>(null)

/* eslint-disable @next/next/no-img-element */
export function PreviewableImage({
  sourceImageUrl,
  displayImageUrl,
  alt,
  buttonClassName,
  imageClassName,
}: {
  readonly sourceImageUrl: string
  readonly displayImageUrl?: string
  readonly alt: string
  readonly buttonClassName: string
  readonly imageClassName: string
}) {
  const onPreviewImage = useContext(WorkspaceNodeImagePreviewContext)
  const resolvedDisplayImageUrl = displayImageUrl ?? toDisplayImageUrl(sourceImageUrl) ?? sourceImageUrl
  if (!onPreviewImage) return <img src={resolvedDisplayImageUrl} alt={alt} className={imageClassName} />
  return (
    <button
      type="button"
      className={`nodrag nowheel border-0 bg-transparent p-0 ${buttonClassName}`}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onPreviewImage(sourceImageUrl)
      }}
    >
      <img src={resolvedDisplayImageUrl} alt={alt} className={imageClassName} />
    </button>
  )
}
/* eslint-enable @next/next/no-img-element */

export function nodeIsRunning(data: WorkspaceCanvasFlowNode['data']): boolean {
  return isWorkspaceCanvasLifecycleRunning(data.lifecycle)
}

export function LoadingSpinner() {
  return <AppIcon name="loader" className="h-4 w-4 animate-spin" />
}
