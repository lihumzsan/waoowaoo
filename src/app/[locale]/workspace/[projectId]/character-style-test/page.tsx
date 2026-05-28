'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Navbar from '@/components/Navbar'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { useProjectData } from '@/lib/query/hooks'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import { Link } from '@/i18n/navigation'
import type { TaskPresentationPhase } from '@/lib/task/presentation'

type EpisodeOption = {
  id: string
  name: string
  episodeNumber?: number | null
}

type SubmitResponse = {
  taskId?: string
  status?: string
}

type TaskResult = {
  imageUrl?: string
  prompt?: string
  aspectRatio?: string
  styleSummary?: string
}

type TaskDetail = {
  id: string
  status: string
  progress: number
  result?: TaskResult | null
  error?: {
    message?: string | null
  } | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function parseSubmitResponse(value: unknown): SubmitResponse {
  if (!isRecord(value)) return {}
  return {
    taskId: readString(value.taskId),
    status: readString(value.status),
  }
}

function parseTaskResult(value: unknown): TaskResult | null {
  if (!isRecord(value)) return null
  return {
    imageUrl: readString(value.imageUrl),
    prompt: readString(value.prompt),
    aspectRatio: readString(value.aspectRatio),
    styleSummary: readString(value.styleSummary),
  }
}

function parseTaskDetail(value: unknown): TaskDetail | null {
  if (!isRecord(value)) return null
  const rawTask = value.task
  if (!isRecord(rawTask)) return null
  const rawError = isRecord(rawTask.error) ? rawTask.error : null
  return {
    id: readString(rawTask.id),
    status: readString(rawTask.status),
    progress: typeof rawTask.progress === 'number' ? rawTask.progress : 0,
    result: parseTaskResult(rawTask.result),
    error: rawError ? { message: readString(rawError.message) } : null,
  }
}

export default function CharacterStyleTestPage() {
  const params = useParams<{ projectId?: string }>()
  if (!params?.projectId) {
    throw new Error('CharacterStyleTestPage requires projectId route param')
  }

  const projectId = params.projectId
  const t = useTranslations('workspaceDetail.characterStyleTest')
  const { data: project, isLoading } = useProjectData(projectId)
  const episodes = useMemo<EpisodeOption[]>(() => (
    (project?.episodes ?? []).map((episode) => ({
      id: episode.id,
      name: episode.name,
      episodeNumber: typeof episode.episodeNumber === 'number' ? episode.episodeNumber : null,
    }))
  ), [project?.episodes])

  const [episodeId, setEpisodeId] = useState('')
  const [characterRequest, setCharacterRequest] = useState('')
  const [taskId, setTaskId] = useState<string | null>(null)
  const [task, setTask] = useState<TaskDetail | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!episodeId && episodes[0]?.id) {
      setEpisodeId(episodes[0].id)
    }
  }, [episodeId, episodes])

  const pollTask = useCallback(async (id: string) => {
    const response = await apiFetch(`/api/tasks/${id}`)
    if (!response.ok) {
      throw new Error(await readApiErrorMessage(response, t('failed')))
    }
    const detail = parseTaskDetail(await response.json())
    if (!detail) {
      throw new Error(t('failed'))
    }
    setTask(detail)
    return detail
  }, [t])

  useEffect(() => {
    if (!taskId) return
    let canceled = false
    const tick = async () => {
      try {
        const detail = await pollTask(taskId)
        if (canceled) return
        if (detail.status === 'completed' || detail.status === 'failed' || detail.status === 'canceled') {
          return
        }
        window.setTimeout(tick, 2000)
      } catch (err) {
        if (!canceled) {
          setError(err instanceof Error ? err.message : t('failed'))
        }
      }
    }
    void tick()
    return () => {
      canceled = true
    }
  }, [pollTask, taskId, t])

  const handleSubmit = useCallback(async () => {
    const trimmedRequest = characterRequest.trim()
    if (!episodeId || !trimmedRequest) {
      setError(t('needInput'))
      return
    }

    setSubmitting(true)
    setError(null)
    setTask(null)
    setTaskId(null)
    try {
      const response = await apiFetch(`/api/projects/${projectId}/character-style-test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          episodeId,
          characterRequest: trimmedRequest,
        }),
      })
      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response, t('failed')))
      }
      const parsed = parseSubmitResponse(await response.json())
      if (!parsed.taskId) {
        throw new Error(t('failed'))
      }
      setTaskId(parsed.taskId)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failed'))
    } finally {
      setSubmitting(false)
    }
  }, [characterRequest, episodeId, projectId, t])

  const result = task?.result ?? null
  const taskPresentation = resolveTaskPresentationState({
    phase: (task?.status === 'queued'
      || task?.status === 'processing'
      || task?.status === 'completed'
      || task?.status === 'failed'
      ? task.status
      : taskId ? 'queued' : 'idle') as TaskPresentationPhase,
    intent: 'generate',
    resource: 'image',
    hasOutput: Boolean(result?.imageUrl),
  })
  const statusLabel = (() => {
    if (task?.status === 'completed') return t('taskCompleted')
    if (task?.status === 'failed') return t('taskFailed')
    if (taskId) return t('taskRunning')
    return t('taskQueued')
  })()

  return (
    <div className="min-h-screen bg-[var(--glass-bg-base)] text-[var(--glass-text-primary)]">
      <Navbar />
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link
              href={{ pathname: `/workspace/${projectId}` }}
              className="text-sm text-[var(--glass-text-secondary)] transition-colors hover:text-[var(--glass-text-primary)]"
            >
              {t('back')}
            </Link>
            <h1 className="mt-3 text-2xl font-semibold tracking-normal">{t('title')}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--glass-text-secondary)]">{t('subtitle')}</p>
          </div>
          {taskId && (
            <div className="flex items-center gap-3 rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-3 py-2">
              <TaskStatusInline state={taskPresentation} />
              <span className="text-sm text-[var(--glass-text-secondary)]">{statusLabel}</span>
            </div>
          )}
        </div>

        <section className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-4">
            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium">{t('episodeLabel')}</span>
                <select
                  value={episodeId}
                  onChange={(event) => setEpisodeId(event.target.value)}
                  disabled={isLoading || episodes.length === 0 || submitting}
                  className="rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface-strong)] px-3 py-2 text-sm outline-none focus:border-[var(--glass-stroke-focus)]"
                >
                  <option value="">{isLoading ? t('loadingProject') : t('episodePlaceholder')}</option>
                  {episodes.map((episode) => (
                    <option key={episode.id} value={episode.id}>
                      {episode.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium">{t('requestLabel')}</span>
                <textarea
                  value={characterRequest}
                  onChange={(event) => setCharacterRequest(event.target.value)}
                  placeholder={t('requestPlaceholder')}
                  disabled={submitting}
                  rows={8}
                  className="resize-none rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface-strong)] px-3 py-2 text-sm leading-6 outline-none focus:border-[var(--glass-stroke-focus)]"
                />
              </label>

              {episodes.length === 0 && !isLoading && (
                <p className="text-sm leading-6 text-[var(--glass-text-secondary)]">{t('noEpisodes')}</p>
              )}
              {error && (
                <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>
              )}

              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || !episodeId || !characterRequest.trim()}
                className="rounded-lg bg-[var(--glass-accent-from)] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? t('submitting') : t('submit')}
              </button>
            </div>
          </div>

          <div className="flex min-h-[520px] flex-col gap-4 rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">{t('resultTitle')}</h2>
              {result?.imageUrl && (
                <a
                  href={result.imageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-[var(--glass-accent-from)] hover:underline"
                >
                  {t('openImage')}
                </a>
              )}
            </div>

            <div className="flex min-h-[360px] items-center justify-center overflow-hidden rounded-lg border border-[var(--glass-stroke-base)] bg-black/20">
              {result?.imageUrl ? (
                <img
                  src={result.imageUrl}
                  alt={t('imageAlt')}
                  className="max-h-[620px] w-full object-contain"
                />
              ) : (
                <span className="px-6 text-center text-sm text-[var(--glass-text-secondary)]">
                  {taskId ? t('taskRunning') : t('promptHidden')}
                </span>
              )}
            </div>

            <div className="grid gap-3">
              {result?.styleSummary && (
                <p className="text-sm leading-6 text-[var(--glass-text-secondary)]">{result.styleSummary}</p>
              )}
              <details className="rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface-strong)] p-3">
                <summary className="cursor-pointer text-sm font-medium">{t('promptTitle')}</summary>
                <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap text-xs leading-5 text-[var(--glass-text-secondary)]">
                  {result?.prompt || t('promptHidden')}
                </pre>
              </details>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
