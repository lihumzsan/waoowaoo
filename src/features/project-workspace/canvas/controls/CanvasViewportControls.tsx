'use client'

import { AppIcon } from '@/components/ui/icons'

export interface CanvasViewportControlsProps {
  readonly fitViewLabel: string
  readonly zoomInLabel: string
  readonly zoomOutLabel: string
  readonly onFitView: () => void
  readonly onZoomIn: () => void
  readonly onZoomOut: () => void
}

export function CanvasViewportControls({
  fitViewLabel,
  zoomInLabel,
  zoomOutLabel,
  onFitView,
  onZoomIn,
  onZoomOut,
}: CanvasViewportControlsProps) {
  const buttonClassName = 'inline-flex h-10 w-10 items-center justify-center border-r border-[var(--glass-stroke-soft)] text-[var(--glass-text-primary)] transition last:border-r-0 hover:bg-[var(--glass-bg-hover)]'

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)]/95 shadow-lg backdrop-blur-md">
      <button type="button" className={buttonClassName} aria-label={zoomInLabel} title={zoomInLabel} onClick={onZoomIn}>
        <AppIcon name="plus" className="h-4 w-4" />
      </button>
      <button type="button" className={buttonClassName} aria-label={zoomOutLabel} title={zoomOutLabel} onClick={onZoomOut}>
        <AppIcon name="minus" className="h-4 w-4" />
      </button>
      <button type="button" className={buttonClassName} aria-label={fitViewLabel} title={fitViewLabel} onClick={onFitView}>
        <AppIcon name="searchPlus" className="h-4 w-4" />
      </button>
    </div>
  )
}
