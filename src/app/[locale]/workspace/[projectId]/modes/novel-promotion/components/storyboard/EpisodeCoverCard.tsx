'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import { AppIcon } from '@/components/ui/icons'
import { GlassButton, GlassSurface } from '@/components/ui/primitives'
import { useGenerateEpisodeCover } from '@/lib/query/hooks'
import { useTaskTargetStateMap } from '@/lib/query/hooks/useTaskTargetStateMap'
import { invalidateEpisodeQueries } from '@/lib/query/episode-cache'
import { queryKeys } from '@/lib/query/keys'
import { resolveTaskPresentationState, type TaskPresentationState } from '@/lib/task/presentation'
import { TASK_TYPE } from '@/lib/task/types'

interface EpisodeCoverCardProps {
  coverImageUrl?: string | null
  videoRatio: string
  taskState: TaskPresentationState | null
  errorMessage?: string | null
  isSubmitting?: boolean
  onGenerate: () => void
}

interface EpisodeCoverSectionProps {
  projectId: string
  episodeId: string
  coverImageUrl?: string | null
  videoRatio: string
}

const EPISODE_COVER_ACTIVE_POLLING_INTERVAL_MS = 5_000

function parseRatio(value: string): { width: number; height: number } | null {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/)
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }
  return { width, height }
}

export function resolveEpisodeCoverAspectRatio(value: string): string {
  const ratio = parseRatio(value)
  return ratio ? `${ratio.width} / ${ratio.height}` : '16 / 9'
}

function resolvePreviewWidthClass(value: string): string {
  const ratio = parseRatio(value)
  if (!ratio) return 'w-full md:w-80'
  if (ratio.width < ratio.height) return 'w-48 self-center md:w-52'
  if (ratio.width === ratio.height) return 'w-56 self-center md:w-60'
  return 'w-full md:w-80'
}

export default function EpisodeCoverCard({
  coverImageUrl,
  videoRatio,
  taskState,
  errorMessage,
  isSubmitting = false,
  onGenerate,
}: EpisodeCoverCardProps) {
  const t = useTranslations('storyboard')
  const isRunning = isSubmitting || !!taskState?.isRunning
  const isFailed = !!errorMessage || !!taskState?.isError
  const actionLabel = isRunning
    ? t('episodeCover.generating')
    : isFailed
      ? t('episodeCover.retry')
      : coverImageUrl
        ? t('episodeCover.regenerate')
        : t('episodeCover.generate')

  return (
    <GlassSurface variant="card" density="compact" className="overflow-hidden">
      <div className="flex flex-col gap-5 md:flex-row md:items-center">
        <div
          className={`relative shrink-0 overflow-hidden rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] ${resolvePreviewWidthClass(videoRatio)}`}
          style={{ aspectRatio: resolveEpisodeCoverAspectRatio(videoRatio) }}
        >
          {coverImageUrl ? (
            <MediaImageWithLoading
              src={coverImageUrl}
              alt={t('episodeCover.imageAlt')}
              fill
              sizes="(max-width: 767px) 100vw, 320px"
              containerClassName="absolute inset-0"
              className="h-full w-full object-cover"
            />
          ) : !isRunning ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[var(--glass-text-tertiary)]">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--glass-bg-surface-strong)]">
                <AppIcon name="image" className="h-5 w-5" />
              </span>
              <span className="text-xs">{t('episodeCover.empty')}</span>
            </div>
          ) : null}

          {isRunning && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-[var(--glass-overlay)] text-white">
              <AppIcon name="loader" className="h-6 w-6 animate-spin" />
              <span className="text-xs font-medium">{t('episodeCover.generating')}</span>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)]">
              <AppIcon name="sparkles" className="h-4 w-4" />
            </span>
            <h2 className="text-base font-semibold text-[var(--glass-text-primary)]">
              {t('episodeCover.title')}
            </h2>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--glass-text-secondary)]">
            {t('episodeCover.description')}
          </p>
          <p className="mt-1 text-xs text-[var(--glass-text-tertiary)]">
            {t('episodeCover.pureImageHint')}
          </p>

          {isFailed && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-[var(--glass-tone-danger-fg)]/20 bg-[var(--glass-tone-danger-bg)] px-3 py-2 text-xs text-[var(--glass-tone-danger-fg)]">
              <AppIcon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{errorMessage || t('episodeCover.failed')}</span>
            </div>
          )}

          <div className="mt-4">
            <GlassButton
              type="button"
              variant={coverImageUrl ? 'secondary' : 'primary'}
              size="sm"
              disabled={isRunning}
              onClick={onGenerate}
              iconLeft={!isRunning ? <AppIcon name={coverImageUrl ? 'refresh' : 'sparklesAlt'} className="h-4 w-4" /> : undefined}
            >
              {actionLabel}
            </GlassButton>
          </div>
        </div>
      </div>
    </GlassSurface>
  )
}

export function EpisodeCoverSection({
  projectId,
  episodeId,
  coverImageUrl,
  videoRatio,
}: EpisodeCoverSectionProps) {
  const queryClient = useQueryClient()
  const generateCover = useGenerateEpisodeCover(projectId)
  const targets = useMemo(() => [{
    targetType: 'NovelPromotionEpisode',
    targetId: episodeId,
    types: [TASK_TYPE.IMAGE_EPISODE_COVER],
    resource: 'image' as const,
    hasOutput: !!coverImageUrl,
  }], [coverImageUrl, episodeId])
  const taskStates = useTaskTargetStateMap(projectId, targets, {
    enabled: targets.length > 0,
    activePollingInterval: EPISODE_COVER_ACTIVE_POLLING_INTERVAL_MS,
  })
  const taskState = taskStates.getState('NovelPromotionEpisode', episodeId)
  const taskPresentation = useMemo(() => taskState
    ? resolveTaskPresentationState({
      phase: taskState.phase,
      intent: taskState.intent,
      resource: 'image',
      hasOutput: !!coverImageUrl || !!taskState.hasOutputAtStart,
    })
    : null, [coverImageUrl, taskState])
  const terminalSignature = taskState && (taskState.phase === 'completed' || taskState.phase === 'failed')
    ? `${taskState.phase}:${taskState.updatedAt || ''}`
    : ''
  const lastTerminalSignatureRef = useRef('')

  useEffect(() => {
    if (!terminalSignature) {
      lastTerminalSignatureRef.current = ''
      return
    }
    if (terminalSignature === lastTerminalSignatureRef.current) return
    lastTerminalSignatureRef.current = terminalSignature
    void Promise.all([
      invalidateEpisodeQueries(queryClient, projectId, episodeId),
      queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) }),
    ])
  }, [episodeId, projectId, queryClient, terminalSignature])

  const mutationError = generateCover.error instanceof Error ? generateCover.error.message : null
  const errorMessage = mutationError || taskState?.lastError?.message || null

  return (
    <EpisodeCoverCard
      coverImageUrl={coverImageUrl}
      videoRatio={videoRatio}
      taskState={taskPresentation}
      errorMessage={errorMessage}
      isSubmitting={generateCover.isPending}
      onGenerate={() => generateCover.mutate({ episodeId, hasOutput: !!coverImageUrl })}
    />
  )
}
