'use client'

import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { useClientErrorMessage } from '@/hooks/useClientErrorMessage'
import type { CanvasUploadQueueItem } from './useCanvasUploadQueue'

export function CanvasUploadQueue({
  items,
  onRetry,
  onDismiss,
}: {
  readonly items: readonly CanvasUploadQueueItem[]
  readonly onRetry: (item: CanvasUploadQueueItem) => void
  readonly onDismiss: (id: string) => void
}) {
  const t = useTranslations('projectWorkflow.canvas.workspace.upload')
  const resolveError = useClientErrorMessage()
  if (items.length === 0 || typeof document === 'undefined') return null

  return createPortal(
    <aside className="fixed bottom-5 right-5 z-[100] w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)]/95 shadow-2xl backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-[var(--glass-stroke-soft)] px-4 py-3">
        <h3 className="text-sm font-semibold text-[var(--glass-text-primary)]">{t('title')}</h3>
        <span className="text-xs tabular-nums text-[var(--glass-text-tertiary)]">{items.length}</span>
      </div>
      <ul className="max-h-72 space-y-1 overflow-y-auto p-2">
        {items.map((item) => {
          const active = item.stage === 'uploading' || item.stage === 'materializing'
          const failed = item.stage === 'failed_upload' || item.stage === 'failed_materialize'
          return (
            <li key={item.id} className="rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-100">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-[var(--glass-text-tertiary)] ring-1 ring-slate-200">
                  <AppIcon name={item.file.type.startsWith('audio/') ? 'audioWave' : 'image'} className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-[var(--glass-text-primary)]" title={item.file.name}>{item.file.name}</p>
                  <p className={`mt-0.5 text-[10px] ${failed ? 'text-[var(--glass-tone-danger-fg)]' : 'text-[var(--glass-text-tertiary)]'}`}>
                    {failed
                      ? resolveError(item.error, t('failed'))
                      : t(`stage.${item.stage}`)}
                  </p>
                </div>
                {active ? <AppIcon name="loader" className="h-4 w-4 shrink-0 animate-spin text-[var(--glass-text-tertiary)]" /> : null}
                {failed ? (
                  <button type="button" className="rounded-lg px-2 py-1 text-[11px] font-medium text-[var(--glass-tone-info-fg)] hover:bg-white" onClick={() => onRetry(item)}>
                    {item.stage === 'failed_upload' ? t('retryUpload') : t('retryMaterialize')}
                  </button>
                ) : null}
                {!active ? (
                  <button type="button" aria-label={t('dismiss')} className="rounded-full p-1 text-[var(--glass-text-tertiary)] hover:bg-white" onClick={() => onDismiss(item.id)}>
                    <AppIcon name="close" className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </aside>,
    document.body,
  )
}
