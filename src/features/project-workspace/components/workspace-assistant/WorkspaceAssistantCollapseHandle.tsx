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
    top: `calc(${topOffset} + 1rem)`,
    right: `calc(1rem + ${panelWidthPx}px - 0.75rem)`,
  } satisfies CSSProperties

  return (
    <button
      type="button"
      aria-label={collapseLabel}
      title={collapseLabel}
      onClick={onCollapse}
      className="pointer-events-auto fixed z-30 inline-flex h-14 w-6 items-center justify-center rounded-full border border-white/85 bg-white/75 text-[var(--glass-text-secondary)] shadow-[0_8px_24px_rgba(15,23,42,0.10)] backdrop-blur-md transition hover:border-[var(--glass-accent-from)]/30 hover:bg-white/90 hover:text-[var(--glass-text-primary)]"
      style={style}
    >
      <AppIcon name="chevronRight" className="h-3.5 w-3.5" />
    </button>
  )
}
