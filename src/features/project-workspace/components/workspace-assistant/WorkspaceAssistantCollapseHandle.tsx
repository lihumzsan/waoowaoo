'use client'

import React from 'react'
import { AppIcon } from '@/components/ui/icons'

interface WorkspaceAssistantCollapseHandleProps {
  collapseLabel: string
  onCollapse: () => void
}

export function WorkspaceAssistantCollapseHandle({
  collapseLabel,
  onCollapse,
}: WorkspaceAssistantCollapseHandleProps) {
  return (
    <button
      type="button"
      aria-label={collapseLabel}
      title={collapseLabel}
      onClick={onCollapse}
      className="absolute right-4 top-4 z-30 inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-[var(--glass-stroke-base)] bg-white/86 text-[var(--glass-text-secondary)] shadow-[0_8px_24px_rgba(15,23,42,0.08)] backdrop-blur-md transition hover:border-[var(--glass-accent-from)]/40 hover:bg-white/94 hover:text-[var(--glass-text-primary)]"
    >
      <AppIcon name="chevronRight" className="h-4 w-4" />
    </button>
  )
}
