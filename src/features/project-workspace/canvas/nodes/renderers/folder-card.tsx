'use client'

import { createContext, useContext } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { useTranslations } from 'next-intl'
import type { WorkspaceCanvasFolderNodeData } from '../../node-canvas-types'
import type { WorkspaceCanvasNodeRendererProps } from './types'

export interface WorkspaceCanvasFolderOpenTarget {
  readonly resourceId: string
  readonly name: string
  readonly workspacePath: string
}

interface WorkspaceCanvasFolderActions {
  readonly busy: boolean
  readonly open: (target: WorkspaceCanvasFolderOpenTarget) => void
  readonly remove: (target: WorkspaceCanvasFolderOpenTarget & {
    readonly operation: WorkspaceCanvasFolderNodeData['folder']['deleteOperation']
  }) => void
}

export const WorkspaceCanvasFolderActionsContext = createContext<WorkspaceCanvasFolderActions | null>(null)

export function FolderCardContent({ data }: WorkspaceCanvasNodeRendererProps) {
  const t = useTranslations('projectWorkflow.canvas.workspace.folderNavigation')
  const actions = useContext(WorkspaceCanvasFolderActionsContext)
  if (data.kind !== 'folder') return null
  if (!actions) throw new Error('WORKSPACE_CANVAS_FOLDER_ACTIONS_CONTEXT_REQUIRED')
  return (
    <div
      data-workspace-folder-id={data.folder.resourceId}
      data-workspace-folder-name={data.title}
      data-workspace-folder-path={data.folder.workspacePath}
      className="relative h-[108px] w-full"
    >
      <button
        type="button"
        className="nodrag nopan flex h-full w-full flex-col items-center justify-center gap-1.5 rounded-[14px] bg-[var(--glass-tone-surface)] text-[var(--glass-tone-warning-fg)] shadow-[var(--glass-tone-shadow)]"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          actions.open({
            resourceId: data.folder.resourceId,
            name: data.title,
            workspacePath: data.folder.workspacePath,
          })
        }}
      >
        <AppIcon name="folder" className="h-14 w-14" />
        <span className="text-[11px] font-medium text-amber-700/80">
          {t('openFolder')}
          {' · '}
          {t('sectionCount', { count: data.folder.childCount })}
        </span>
      </button>
      <button
        type="button"
        disabled={actions.busy}
        aria-label={t('deleteFolder', { path: data.folder.workspacePath })}
        title={t('deleteFolder', { path: data.folder.workspacePath })}
        className="nodrag nopan absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--glass-tone-surface)] text-[var(--glass-tone-danger-fg)] shadow-[var(--glass-tone-shadow)] transition hover:shadow-[var(--glass-tone-shadow-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          actions.remove({
            resourceId: data.folder.resourceId,
            name: data.title,
            workspacePath: data.folder.workspacePath,
            operation: data.folder.deleteOperation,
          })
        }}
      >
        <AppIcon name="trash" className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

/**
 * Expanded-folder group (budget projection `display: 'section'`): no frame,
 * no border, no enter affordance — everything is already on the canvas. Only
 * a minimal name pill marks the group; the node itself ignores pointer events
 * (projection sets `pointerEvents: none`) so the canvas behaves as blank
 * space inside the group, while the pill stays the drag handle and can be
 * double-clicked to enter the folder.
 */
export function FolderSectionShell({ data }: { readonly data: WorkspaceCanvasFolderNodeData }) {
  const t = useTranslations('projectWorkflow.canvas.workspace.folderNavigation')
  const actions = useContext(WorkspaceCanvasFolderActionsContext)
  if (!actions) throw new Error('WORKSPACE_CANVAS_FOLDER_ACTIONS_CONTEXT_REQUIRED')
  return (
    <section
      className="relative h-full w-full"
      data-node-id={data.nodeId}
      data-workspace-folder-id={data.folder.resourceId}
      data-workspace-folder-path={data.folder.workspacePath}
    >
      <header className="pointer-events-auto absolute left-0 top-0 flex max-w-full cursor-grab items-center gap-2 rounded-full border border-white/80 bg-white/92 px-3.5 py-1.5 shadow-sm ring-1 ring-[var(--glass-stroke-base)]/60 backdrop-blur-xl active:cursor-grabbing">
        <AppIcon name="folder" className="h-3.5 w-3.5 shrink-0 text-amber-500" />
        <span className="min-w-0 truncate text-sm font-semibold text-[var(--glass-text-primary)]">
          {data.title}
        </span>
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-[var(--glass-text-tertiary)]">
          {t('sectionCount', { count: data.folder.childCount })}
        </span>
        <button
          type="button"
          disabled={actions.busy}
          aria-label={t('deleteFolder', { path: data.folder.workspacePath })}
          title={t('deleteFolder', { path: data.folder.workspacePath })}
          className="nodrag nopan -mr-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-[var(--glass-tone-danger-fg)] transition hover:bg-[var(--glass-tone-soft)] disabled:cursor-not-allowed disabled:opacity-50"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            actions.remove({
              resourceId: data.folder.resourceId,
              name: data.title,
              workspacePath: data.folder.workspacePath,
              operation: data.folder.deleteOperation,
            })
          }}
        >
          <AppIcon name="trash" className="h-3.5 w-3.5" />
        </button>
      </header>
    </section>
  )
}
