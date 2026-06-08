'use client'

import React, { type CSSProperties } from 'react'
import { AppIcon } from '@/components/ui/icons'

interface WorkspaceAssistantCollapseHandleProps {
  collapseLabel: string
  panelWidthPx: number
  topOffset: string
  onCollapse: () => void
}

export function WorkspaceAssistantCollapseHandle({
  collapseLabel,
  panelWidthPx,
  topOffset,
  onCollapse,
}: WorkspaceAssistantCollapseHandleProps) {
  const style = {
    top: `calc(${topOffset} + 0.75rem)`,
    right: `calc(1rem + ${panelWidthPx}px - 1.25rem)`,
  } satisfies CSSProperties

  return (
    <button
      type="button"
      aria-label={collapseLabel}
      title={collapseLabel}
      onClick={onCollapse}
      className="pointer-events-auto fixed z-30 inline-flex h-10 w-10 items-center justify-center rounded-[14px] border border-[var(--glass-stroke-base)] bg-white/90 text-[var(--glass-text-secondary)] shadow-sm backdrop-blur-md transition hover:bg-[var(--glass-bg-muted)] hover:text-[var(--glass-text-primary)]"
      style={style}
    >
      <AppIcon name="chevronRight" className="h-4 w-4" />
    </button>
  )
}
