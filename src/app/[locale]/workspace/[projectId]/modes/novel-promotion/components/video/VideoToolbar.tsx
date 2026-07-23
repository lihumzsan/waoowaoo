'use client'
import { useTranslations } from 'next-intl'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import { AppIcon } from '@/components/ui/icons'

interface VideoToolbarProps {
  totalPanels: number
  runningCount: number
  videosWithUrl: number
  failedCount: number
  isAnyTaskRunning: boolean
  onGenerateAll: () => void
  onBack: () => void
  onEnterEditor?: () => void  // 进入剪辑器
  videosReady?: boolean  // 是否有视频可以剪辑
}

export default function VideoToolbar({
  totalPanels,
  runningCount,
  videosWithUrl,
  failedCount,
  isAnyTaskRunning,
  onGenerateAll,
  onBack,
  onEnterEditor,
  videosReady = false
}: VideoToolbarProps) {
  const t = useTranslations('video')
  const videoTaskRunningState = isAnyTaskRunning
    ? resolveTaskPresentationState({
      phase: 'processing',
      intent: 'generate',
      resource: 'video',
      hasOutput: videosWithUrl > 0,
    })
    : null
  return (
    <div className="glass-surface overflow-hidden p-4">
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-sm font-semibold text-[var(--glass-text-secondary)]">
             {t('toolbar.title')}
          </span>
          <span className="text-sm text-[var(--glass-text-tertiary)]">
            {t('toolbar.totalShots', { count: totalPanels })}
            {runningCount > 0 && (
              <span className="text-[var(--glass-tone-info-fg)] ml-2 animate-pulse">({t('toolbar.generatingShots', { count: runningCount })})</span>
            )}
            {videosWithUrl > 0 && (
              <span className="text-[var(--glass-tone-success-fg)] ml-2">({t('toolbar.completedShots', { count: videosWithUrl })})</span>
            )}
            {failedCount > 0 && (
              <span className="text-[var(--glass-tone-danger-fg)] ml-2">({t('toolbar.failedShots', { count: failedCount })})</span>
            )}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
          <button
            onClick={onGenerateAll}
            disabled={isAnyTaskRunning}
            className="glass-btn-base glass-btn-primary flex min-w-0 items-center justify-center gap-2 px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isAnyTaskRunning ? (
              <TaskStatusInline state={videoTaskRunningState} className="text-white [&>span]:text-white [&_svg]:text-white" />
            ) : (
              <>
                <AppIcon name="plus" className="w-4 h-4" />
                <span>{t('toolbar.generateAll')}</span>
              </>
            )}
          </button>
          {onEnterEditor && (
            <button
              onClick={onEnterEditor}
              disabled={!videosReady}
              className="glass-btn-base glass-btn-secondary flex min-w-0 items-center justify-center gap-2 px-4 py-2 text-sm font-medium border border-[var(--glass-stroke-base)] disabled:opacity-50 disabled:cursor-not-allowed"
              title={videosReady ? t('toolbar.enterEditor') : t('panelCard.needVideo')}
            >
              <AppIcon name="wandOff" className="w-4 h-4" />
              <span>{t('toolbar.enterEdit')}</span>
            </button>
          )}
          <button
            onClick={onBack}
            className={`glass-btn-base glass-btn-secondary flex min-w-0 items-center justify-center gap-2 px-4 py-2 text-sm font-medium border border-[var(--glass-stroke-base)] hover:text-[var(--glass-tone-info-fg)] ${onEnterEditor ? 'col-span-2 sm:col-span-1' : ''}`}
          >
            <AppIcon name="chevronLeft" className="w-4 h-4" />
            <span>{t('toolbar.back')}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
