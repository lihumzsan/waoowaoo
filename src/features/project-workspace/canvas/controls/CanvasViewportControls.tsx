'use client'

import { AppIcon } from '@/components/ui/icons'

export interface CanvasViewportControlsProps {
  readonly resetLabel: string
  readonly fitViewLabel: string
  readonly zoomInLabel: string
  readonly zoomOutLabel: string
  readonly autoFollowLabel: string
  readonly autoFollowEnabled: boolean
  readonly showHiddenLabel: string
  readonly showArchivedLabel: string
  readonly showHiddenNodes: boolean
  readonly showArchivedResources: boolean
  readonly onResetLayout: () => void
  readonly onFitView: () => void
  readonly onZoomIn: () => void
  readonly onZoomOut: () => void
  readonly onToggleAutoFollow: () => void
  readonly onToggleHiddenNodes: () => void
  readonly onToggleArchivedResources: () => void
}

export function CanvasViewportControls({
  resetLabel,
  fitViewLabel,
  zoomInLabel,
  zoomOutLabel,
  autoFollowLabel,
  autoFollowEnabled,
  showHiddenLabel,
  showArchivedLabel,
  showHiddenNodes,
  showArchivedResources,
  onResetLayout,
  onFitView,
  onZoomIn,
  onZoomOut,
  onToggleAutoFollow,
  onToggleHiddenNodes,
  onToggleArchivedResources,
}: CanvasViewportControlsProps) {
  const buttonClassName = 'inline-flex h-10 w-10 items-center justify-center border-r border-[var(--glass-stroke-soft)] text-[var(--glass-text-primary)] transition last:border-r-0 hover:bg-[var(--glass-bg-hover)]'
  const activeButtonClassName = `${buttonClassName} bg-[var(--glass-bg-hover)] text-[var(--glass-tone-info-fg)]`
  const autoFollowClassName = autoFollowEnabled
    ? activeButtonClassName
    : `${buttonClassName} text-[var(--glass-text-tertiary)]`

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
      <button
        type="button"
        className={autoFollowClassName}
        aria-label={autoFollowLabel}
        aria-pressed={autoFollowEnabled}
        title={autoFollowLabel}
        onClick={onToggleAutoFollow}
      >
        <AppIcon name="crosshair" className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={showHiddenNodes ? activeButtonClassName : buttonClassName}
        aria-label={showHiddenLabel}
        aria-pressed={showHiddenNodes}
        title={showHiddenLabel}
        onClick={onToggleHiddenNodes}
      >
        <AppIcon name={showHiddenNodes ? 'eye' : 'eyeOff'} className="h-4 w-4" />
      </button>
      <button
        type="button"
        className={showArchivedResources ? activeButtonClassName : buttonClassName}
        aria-label={showArchivedLabel}
        aria-pressed={showArchivedResources}
        title={showArchivedLabel}
        onClick={onToggleArchivedResources}
      >
        <AppIcon name={showArchivedResources ? 'undo' : 'trash'} className="h-4 w-4" />
      </button>
      <button type="button" className={buttonClassName} aria-label={resetLabel} title={resetLabel} onClick={onResetLayout}>
        <AppIcon name="refresh" className="h-4 w-4" />
      </button>
    </div>
  )
}
