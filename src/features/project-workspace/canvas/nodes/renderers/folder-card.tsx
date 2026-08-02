'use client'

import { AppIcon } from '@/components/ui/icons'
import { useTranslations } from 'next-intl'
import type { WorkspaceCanvasNodeRendererProps } from './types'

export function FolderCardContent({ data }: WorkspaceCanvasNodeRendererProps) {
  const t = useTranslations('projectWorkflow.canvas.workspace.folderNavigation')
  if (data.kind !== 'folder') return null
  return (
    <div className="flex h-[108px] flex-col items-center justify-center gap-1.5 rounded-[14px] bg-amber-50/80 text-amber-500 ring-1 ring-amber-100">
      <AppIcon name="folder" className="h-14 w-14" />
      <span className="text-[11px] font-medium text-amber-700/80">{t('openFolder')}</span>
    </div>
  )
}
