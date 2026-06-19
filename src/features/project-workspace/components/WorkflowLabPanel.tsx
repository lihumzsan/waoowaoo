'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import type { WorkflowLabEpisodeSummary, WorkflowLabForkResult } from '@/lib/workflow-lab/types'

interface WorkflowLabPanelProps {
  readonly projectId: string
  readonly episodeId?: string
  readonly enabled: boolean
  readonly onEpisodeForked?: (episodeId: string) => void | Promise<void>
}

interface WorkflowLabListResponse {
  readonly enabled: boolean
  readonly episodes: readonly WorkflowLabEpisodeSummary[]
  readonly currentEpisodeId: string | null
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function readEpisodeSummary(value: unknown): WorkflowLabEpisodeSummary | null {
  const record = readRecord(value)
  if (!record) return null

  const id = readString(record.id)
  const name = readString(record.name)
  const workflowStage = readString(record.workflowStage)
  const blockingKind = readString(record.blockingKind)
  const episodeNumber = typeof record.episodeNumber === 'number' ? record.episodeNumber : null

  if (!id || !name || !workflowStage || !blockingKind || episodeNumber === null) return null

  return {
    id,
    name,
    episodeNumber,
    workflowStage: workflowStage as WorkflowLabEpisodeSummary['workflowStage'],
    blockingKind,
    blockingReason: readString(record.blockingReason),
    nextOperationId: readString(record.nextOperationId),
    allowedOperationIds: readStringArray(record.allowedOperationIds),
  }
}

function readListResponse(value: unknown): WorkflowLabListResponse | null {
  const record = readRecord(value)
  if (!record || typeof record.enabled !== 'boolean' || !Array.isArray(record.episodes)) return null

  return {
    enabled: record.enabled,
    episodes: record.episodes.map(readEpisodeSummary).filter((episode): episode is WorkflowLabEpisodeSummary => episode !== null),
    currentEpisodeId: readString(record.currentEpisodeId),
  }
}

function readForkResult(value: unknown): WorkflowLabForkResult | null {
  const record = readRecord(value)
  const result = readRecord(record?.result)
  if (!record || record.success !== true || !result) return null

  const sourceEpisode = readEpisodeSummary(result.sourceEpisode)
  const forkedEpisode = readEpisodeSummary(result.forkedEpisode)
  if (!sourceEpisode || !forkedEpisode) return null

  return {
    sourceEpisode,
    forkedEpisode,
  }
}

export default function WorkflowLabPanel({
  projectId,
  episodeId,
  enabled,
  onEpisodeForked,
}: WorkflowLabPanelProps) {
  const t = useTranslations('workspaceDetail.workflowLab')
  const [expanded, setExpanded] = useState(true)
  const [serverEnabled, setServerEnabled] = useState(true)
  const [episodes, setEpisodes] = useState<readonly WorkflowLabEpisodeSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [forkingSourceId, setForkingSourceId] = useState<string | null>(null)

  const currentEpisode = useMemo(
    () => episodes.find((episode) => episode.id === episodeId) ?? null,
    [episodeId, episodes],
  )

  const loadEpisodes = useCallback(async () => {
    if (!enabled) return

    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (episodeId) params.set('episodeId', episodeId)
      const query = params.toString()
      const response = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/workflow-lab${query ? `?${query}` : ''}`)
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, t('loadFailed')))
      }
      const payload = readListResponse(await response.json())
      if (!payload) throw new Error(t('invalidResponse'))
      setServerEnabled(payload.enabled)
      setEpisodes(payload.episodes)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [enabled, episodeId, projectId, t])

  useEffect(() => {
    void loadEpisodes()
  }, [loadEpisodes])

  const handleFork = useCallback(async (sourceEpisodeId: string) => {
    if (forkingSourceId) return

    setForkingSourceId(sourceEpisodeId)
    setError(null)
    try {
      const response = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/workflow-lab`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'forkEpisode',
          sourceEpisodeId,
        }),
      })
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, t('forkFailed')))
      }
      const result = readForkResult(await response.json())
      if (!result) throw new Error(t('invalidResponse'))
      await Promise.resolve(onEpisodeForked?.(result.forkedEpisode.id))
      await loadEpisodes()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('forkFailed'))
    } finally {
      setForkingSourceId(null)
    }
  }, [forkingSourceId, loadEpisodes, onEpisodeForked, projectId, t])

  if (!enabled) return null

  if (!expanded) {
    return (
      <button
        type="button"
        className="fixed bottom-4 left-4 z-30 flex h-11 items-center gap-2 rounded-full border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface-strong)] px-4 text-sm font-semibold text-[var(--glass-text-primary)] shadow-[0_16px_40px_rgba(15,23,42,0.18)] backdrop-blur-xl"
        onClick={() => setExpanded(true)}
        title={t('expand')}
      >
        <AppIcon name="crosshair" className="h-4 w-4" />
        <span>{t('badge')}</span>
      </button>
    )
  }

  return (
    <section className="fixed bottom-4 left-4 z-30 flex max-h-[calc(100vh-8rem)] w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface-strong)] text-[var(--glass-text-primary)] shadow-[0_24px_70px_rgba(15,23,42,0.22)] backdrop-blur-xl">
      <header className="flex items-center justify-between gap-3 border-b border-[var(--glass-stroke-subtle)] px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <AppIcon name="crosshair" className="h-4 w-4 text-[var(--glass-tone-info-fg)]" />
            <span>{t('title')}</span>
          </div>
          <p className="mt-1 truncate text-xs text-[var(--glass-text-tertiary)]">
            {currentEpisode ? t('currentStage', { stage: currentEpisode.workflowStage }) : t('currentUnknown')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="glass-btn-base glass-btn-secondary flex h-9 w-9 items-center justify-center rounded-full p-0"
            onClick={() => void loadEpisodes()}
            disabled={loading}
            aria-label={t('refresh')}
            title={t('refresh')}
          >
            <AppIcon name="refresh" className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            className="glass-btn-base glass-btn-secondary flex h-9 w-9 items-center justify-center rounded-full p-0"
            onClick={() => setExpanded(false)}
            aria-label={t('collapse')}
            title={t('collapse')}
          >
            <AppIcon name="chevronDown" className="h-4 w-4" />
          </button>
        </div>
      </header>

      {!serverEnabled ? (
        <div className="px-4 py-4 text-sm text-[var(--glass-tone-warning-fg)]">
          {t('disabled')}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {error ? (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-[var(--glass-tone-danger-ring)] bg-[var(--glass-tone-danger-bg)] px-3 py-2 text-sm text-[var(--glass-tone-danger-fg)]">
              <AppIcon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {loading && episodes.length === 0 ? (
            <div className="flex items-center gap-2 px-2 py-4 text-sm text-[var(--glass-text-secondary)]">
              <AppIcon name="loader" className="h-4 w-4 animate-spin" />
              <span>{t('loading')}</span>
            </div>
          ) : episodes.length === 0 ? (
            <div className="px-2 py-4 text-sm text-[var(--glass-text-secondary)]">
              {t('empty')}
            </div>
          ) : (
            <div className="space-y-2">
              {episodes.map((episode) => {
                const isCurrent = episode.id === episodeId
                const isForking = forkingSourceId === episode.id
                return (
                  <article
                    key={episode.id}
                    className={`rounded-lg border px-3 py-3 ${
                      isCurrent
                        ? 'border-[var(--glass-stroke-focus)] bg-[var(--glass-tone-info-bg)]'
                        : 'border-[var(--glass-stroke-subtle)] bg-[var(--glass-bg-surface)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="shrink-0 rounded-md bg-[var(--glass-bg-muted)] px-2 py-0.5 text-[11px] font-semibold text-[var(--glass-text-secondary)]">
                            {t('episodeNumber', { number: episode.episodeNumber })}
                          </span>
                          <h3 className="truncate text-sm font-semibold">{episode.name}</h3>
                        </div>
                        <div className="mt-2 space-y-1 text-xs text-[var(--glass-text-secondary)]">
                          <p>{t('stage', { stage: episode.workflowStage })}</p>
                          <p>{t('blocking', { kind: episode.blockingKind })}</p>
                          <p>{t('nextOperation', { operation: episode.nextOperationId ?? t('none') })}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="glass-btn-base glass-btn-secondary flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold disabled:cursor-wait disabled:opacity-60"
                        onClick={() => void handleFork(episode.id)}
                        disabled={forkingSourceId !== null}
                        title={t('forkAndOpen')}
                      >
                        {isForking ? (
                          <AppIcon name="loader" className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <AppIcon name="copy" className="h-3.5 w-3.5" />
                        )}
                        <span>{isForking ? t('forking') : t('forkAndOpen')}</span>
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
