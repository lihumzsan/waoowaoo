'use client'

import React from 'react'
import { AppIcon } from '@/components/ui/icons'

interface WorkspaceAssistantPanelHeaderProps {
  collapseLabel: string
  onCollapse: () => void
}

export function WorkspaceAssistantPanelHeader(props: WorkspaceAssistantPanelHeaderProps) {
  return (
    <div className="flex shrink-0 justify-end bg-transparent px-4 py-4">
      <button
        type="button"
        aria-label={props.collapseLabel}
        title={props.collapseLabel}
        onClick={props.onCollapse}
        className="inline-flex h-10 w-10 items-center justify-center rounded-[14px] border border-[var(--glass-stroke-base)] bg-white/80 text-[var(--glass-text-secondary)] transition hover:bg-[var(--glass-bg-muted)] hover:text-[var(--glass-text-primary)]"
      >
        <AppIcon name="chevronRight" className="h-4 w-4" />
      </button>
    </div>
  )
}
