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

export const WorkspaceCanvasFolderOpenContext = createContext<
  ((target: WorkspaceCanvasFolderOpenTarget) => void) | null
>(null)

export function FolderCardContent({ data }: WorkspaceCanvasNodeRendererProps) {
  const t = useTranslations('projectWorkflow.canvas.workspace.folderNavigation')
  const openFolder = useContext(WorkspaceCanvasFolderOpenContext)
  if (data.kind !== 'folder') return null
  if (!openFolder) throw new Error('WORKSPACE_CANVAS_FOLDER_OPEN_CONTEXT_REQUIRED')
  return (
    <button
      type="button"
      data-workspace-folder-id={data.folder.resourceId}
      data-workspace-folder-name={data.title}
      data-workspace-folder-path={data.folder.workspacePath}
      className="nodrag nopan flex h-[108px] w-full flex-col items-center justify-center gap-1.5 rounded-[14px] bg-amber-50/80 text-amber-500 ring-1 ring-amber-100"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        openFolder({
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
  )
}

/**
 * Expanded-folder frame (budget projection `display: 'section'`): descendants
 * render as regular sibling nodes inside this frame's coordinates, so the
 * shell only draws the boundary and the folder identity pill.
 */
export function FolderSectionShell({ data }: { readonly data: WorkspaceCanvasFolderNodeData }) {
  const t = useTranslations('projectWorkflow.canvas.workspace.folderNavigation')
  const openFolder = useContext(WorkspaceCanvasFolderOpenContext)
  if (!openFolder) throw new Error('WORKSPACE_CANVAS_FOLDER_OPEN_CONTEXT_REQUIRED')
  return (
    <section
      className="relative h-full w-full rounded-[26px] border-2 border-dashed border-slate-300/75 bg-white/25"
      data-node-id={data.nodeId}
      data-workspace-folder-id={data.folder.resourceId}
      data-workspace-folder-path={data.folder.workspacePath}
    >
      <header className="absolute left-6 top-5 flex max-w-[calc(100%-3rem)] items-center gap-2 rounded-full border border-white/80 bg-white/92 py-1.5 pl-3.5 pr-1.5 shadow-sm ring-1 ring-[var(--glass-stroke-base)]/60 backdrop-blur-xl">
        <AppIcon name="folder" className="h-3.5 w-3.5 shrink-0 text-amber-500" />
        <span className="min-w-0 truncate text-sm font-semibold text-[var(--glass-text-primary)]">
          {data.title}
        </span>
        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-[var(--glass-text-tertiary)]">
          {t('sectionCount', { count: data.folder.childCount })}
        </span>
        <button
          type="button"
          className="nodrag nopan shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold text-[var(--glass-text-secondary)] hover:bg-slate-100 hover:text-[var(--glass-text-primary)]"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            openFolder({
              resourceId: data.folder.resourceId,
              name: data.title,
              workspacePath: data.folder.workspacePath,
            })
          }}
        >
          {t('openFolder')}
        </button>
      </header>
    </section>
  )
}
