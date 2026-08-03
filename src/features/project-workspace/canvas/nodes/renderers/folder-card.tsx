'use client'

import { createContext, useContext } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { useTranslations } from 'next-intl'
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
      <span className="text-[11px] font-medium text-amber-700/80">{t('openFolder')}</span>
    </button>
  )
}
