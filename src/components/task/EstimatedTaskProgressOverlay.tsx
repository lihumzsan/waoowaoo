'use client'

import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import {
  useEstimatedTaskProgress,
  type EstimatedTaskProgressSource,
} from '@/lib/query/hooks/useEstimatedTaskProgress'
import type { EstimatedTaskProgressSnapshot } from '@/lib/task/estimated-progress'

interface EstimatedTaskProgressOverlayProps {
  readonly taskState: EstimatedTaskProgressSource | null | undefined
  readonly progress?: EstimatedTaskProgressSnapshot | null
  readonly className?: string
}

function formatPercent(percent: number): string {
  return `${Math.floor(Math.max(0, Math.min(99, percent)))}%`
}

export function EstimatedTaskProgressInline({
  taskState,
  progress: providedProgress,
  className,
}: EstimatedTaskProgressOverlayProps) {
  const t = useTranslations('common')
  const estimatedProgress = useEstimatedTaskProgress(providedProgress === undefined ? taskState : null)
  const progress = providedProgress ?? estimatedProgress
  if (!progress) return null
  if (progress.isCompleted || (!progress.isRunning && !progress.isFailed)) return null

  if (progress.isFailed) {
    return (
      <div
        className={[
          'flex items-center gap-2 rounded-[14px] border border-[var(--glass-tone-danger-ring)] bg-[var(--glass-tone-danger-bg)] px-3 py-2 text-xs font-semibold text-[var(--glass-tone-danger-fg)]',
          className || '',
        ].join(' ').trim()}
      >
        <AppIcon name="alertSolid" className="h-4 w-4" />
        <span>{t('taskStatus.failed.generic')}</span>
      </div>
    )
  }

  const percentLabel = formatPercent(progress.percent)

  return (
    <div
      className={[
        'rounded-[14px] border border-slate-200 bg-white/85 px-3 py-2 shadow-sm',
        className || '',
      ].join(' ').trim()}
    >
      <div className="flex items-center gap-2 text-[var(--glass-text-secondary)]">
        <AppIcon name="loader" className="h-4 w-4 shrink-0 animate-spin" />
        <span className="shrink-0 text-xs font-semibold tabular-nums">{percentLabel}</span>
        {progress.isOvertime ? (
          <span className="min-w-0 truncate text-[11px] font-medium text-[var(--glass-text-tertiary)]">{t('taskStatus.overtime')}</span>
        ) : null}
      </div>
      <div
        aria-label={t('taskStatus.progressLabel')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress.percent)}
        aria-valuetext={percentLabel}
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80"
        role="progressbar"
      >
        <div
          className="h-1.5 rounded-full bg-[linear-gradient(90deg,var(--glass-accent-from),var(--glass-accent-to))] transition-[width] duration-700 ease-out"
          style={{ width: percentLabel }}
        />
      </div>
    </div>
  )
}
