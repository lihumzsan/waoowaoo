'use client'

import { useTranslations } from 'next-intl'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import type { WorkspaceResourceCardView } from '../contracts/workspace-canvas-interactions'
import { getWorkspaceCanvasNodeDefinition } from '../registry/workspace-canvas-node-registry'
import type { WorkspaceCanvasNodeActionKey } from '../contracts/workspace-canvas-interactions'
import type { WorkspaceNodeDetailsActions } from './WorkspaceNodeDetailsCard'

export function WorkspaceNodeActionBar({
  card,
  busy,
  onDiscuss,
  onDownload,
  onPreview,
  onOperation,
}: {
  readonly card: WorkspaceResourceCardView
  readonly busy: boolean
  readonly onDiscuss: () => void
  readonly onDownload: (() => void) | null
  readonly onPreview: () => void
  readonly onOperation: WorkspaceNodeDetailsActions['onOperation']
}) {
  const t = useTranslations('projectWorkflow.canvas.workspace.actions')
  const resource = card.resource
  const hasPreview = card.presentation.summary.kind !== 'empty'
  const declared = new Set(
    getWorkspaceCanvasNodeDefinition('resourceCard').actionKeysByMediaType[resource.mediaType],
  )
  const operationByKind = new Map(
    card.canvasOperations.map((operation) => [operation.kind, operation] as const),
  )
  const actions: Array<{ key: string; icon: AppIconName; label: string; run: () => void; tone?: 'danger' }> = []
  const add = (key: WorkspaceCanvasNodeActionKey, icon: AppIconName, label: string, run: () => void, tone?: 'danger') => {
    if (declared.has(key)) actions.push({ key, icon, label, run, ...(tone ? { tone } : {}) })
  }

  add('discuss', 'sparkles', t('discuss'), onDiscuss)
  if (hasPreview) add('preview_alternatives', 'searchPlus', t('preview'), onPreview)
  if (onDownload) add('download', 'download', t('download'), onDownload)

  for (const kind of ['retry', 'variant'] as const) {
    const operation = operationByKind.get(kind)
    if (!operation) continue
    add(kind, 'refresh', t(kind), () => onOperation(operation))
  }
  const deleteOperation = operationByKind.get('delete')
  if (deleteOperation) {
    add('delete', 'trash', t('delete'), () => onOperation(deleteOperation), 'danger')
  }
  return (
    <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-2.5">
      {actions.map((action) => (
        <button
          key={action.key}
          type="button"
          disabled={busy}
          className={`inline-flex items-center gap-1.5 rounded-lg border bg-white px-2.5 py-1.5 text-xs font-medium transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 ${action.tone === 'danger' ? 'border-red-200 text-[var(--glass-tone-danger-fg)]' : 'border-slate-200 text-[var(--glass-text-secondary)]'}`}
          onClick={action.run}
        >
          <AppIcon name={action.icon} className="h-3.5 w-3.5" />
          {action.label}
        </button>
      ))}
    </div>
  )
}
