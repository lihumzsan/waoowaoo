'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import Navbar from '@/components/Navbar'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { Link } from '@/i18n/navigation'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { resolveTaskPresentationState, type TaskPresentationPhase } from '@/lib/task/presentation'

type SubmitResponse = {
  taskId?: string
}

type ScenePromptVariantResult = {
  id?: string
  label?: string
  aspectRatio?: string
  prompt?: string
  imageUrl?: string
  imageKey?: string
}

type ScenePromptTaskResult = {
  variants?: ScenePromptVariantResult[]
}

type TaskDetail<T> = {
  id: string
  status: string
  progress: number
  result?: T | null
  error?: { message?: string | null } | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function parseSubmitResponse(value: unknown): SubmitResponse {
  if (!isRecord(value)) return {}
  return { taskId: readString(value.taskId) }
}

function parseVariant(value: unknown): ScenePromptVariantResult {
  if (!isRecord(value)) return {}
  return {
    id: readString(value.id),
    label: readString(value.label),
    aspectRatio: readString(value.aspectRatio),
    prompt: readString(value.prompt),
    imageUrl: readString(value.imageUrl),
    imageKey: readString(value.imageKey),
  }
}

function parseTaskResult(value: unknown): ScenePromptTaskResult | null {
  if (!isRecord(value)) return null
  const rawVariants = Array.isArray(value.variants) ? value.variants : []
  return {
    variants: rawVariants.map(parseVariant),
  }
}

function parseTaskDetail<T>(value: unknown, parseResult: (raw: unknown) => T | null): TaskDetail<T> | null {
  if (!isRecord(value) || !isRecord(value.task)) return null
  const rawTask = value.task
  const rawError = isRecord(rawTask.error) ? rawTask.error : null
  return {
    id: readString(rawTask.id),
    status: readString(rawTask.status),
    progress: typeof rawTask.progress === 'number' ? rawTask.progress : 0,
    result: parseResult(rawTask.result),
    error: rawError ? { message: readString(rawError.message) } : null,
  }
}

function taskPhase(status: string | undefined, hasTask: boolean): TaskPresentationPhase {
  if (status === 'queued' || status === 'processing' || status === 'completed' || status === 'failed') return status
  return hasTask ? 'queued' : 'idle'
}

export default function ScenePromptTestPage() {
  const t = useTranslations('workspaceDetail.scenePromptTest')
  const [sceneInput, setSceneInput] = useState('')
  const [taskId, setTaskId] = useState<string | null>(null)
  const [task, setTask] = useState<TaskDetail<ScenePromptTaskResult> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const result = task?.result ?? null

  const pollTask = useCallback(async (id: string) => {
    const response = await apiFetch(`/api/tasks/${id}`)
    if (!response.ok) throw new Error(await readApiErrorMessage(response, t('failed')))
    const detail = parseTaskDetail(await response.json(), parseTaskResult)
    if (!detail) throw new Error(t('failed'))
    return detail
  }, [t])

  useEffect(() => {
    if (!taskId) return
    let canceled = false
    const tick = async () => {
      try {
        const detail = await pollTask(taskId)
        if (canceled) return
        setTask(detail)
        if (detail.status !== 'completed' && detail.status !== 'failed' && detail.status !== 'canceled') {
          window.setTimeout(tick, 2000)
        }
      } catch (err) {
        if (!canceled) setError(err instanceof Error ? err.message : t('failed'))
      }
    }
    void tick()
    return () => {
      canceled = true
    }
  }, [pollTask, taskId, t])

  const generate = useCallback(async () => {
    if (!sceneInput.trim()) {
      setError(t('needSceneInput'))
      return
    }
    setBusy(true)
    setError(null)
    setTask(null)
    setTaskId(null)
    try {
      const response = await apiFetch('/api/scene-prompt-test/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sceneInput }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, t('failed')))
      const parsed = parseSubmitResponse(await response.json())
      if (!parsed.taskId) throw new Error(t('failed'))
      setTaskId(parsed.taskId)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failed'))
    } finally {
      setBusy(false)
    }
  }, [sceneInput, t])

  const taskState = resolveTaskPresentationState({
    phase: taskPhase(task?.status, Boolean(taskId)),
    intent: 'generate',
    resource: 'image',
    hasOutput: Boolean(result?.variants?.some((variant) => variant.imageUrl)),
  })

  return (
    <div className="min-h-screen bg-[var(--glass-bg-base)] text-[var(--glass-text-primary)]">
      <Navbar />
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8">
        <div>
          <Link href={{ pathname: '/workspace' }} className="text-sm text-[var(--glass-text-secondary)] hover:text-[var(--glass-text-primary)]">{t('back')}</Link>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-normal">{t('title')}</h1>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--glass-text-secondary)]">{t('subtitle')}</p>
            </div>
            {taskId && <TaskStatusInline state={taskState} />}
          </div>
        </div>

        <section className="grid gap-6 lg:grid-cols-[390px_minmax(0,1fr)]">
          <div className="flex flex-col gap-4 rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-4">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">{t('sceneInputLabel')}</span>
              <textarea
                value={sceneInput}
                onChange={(event) => setSceneInput(event.target.value)}
                rows={14}
                placeholder={t('sceneInputPlaceholder')}
                className="resize-none rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface-strong)] px-3 py-2 text-sm leading-6 outline-none"
              />
            </label>
            <button
              type="button"
              onClick={generate}
              disabled={busy || !sceneInput.trim()}
              className="rounded-lg bg-[var(--glass-accent-from)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? t('submitting') : t('generate')}
            </button>
            {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}
          </div>

          <section className="rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">{t('results')}</h2>
              <span className="text-xs text-[var(--glass-text-secondary)]">{t('resultHint')}</span>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {(result?.variants ?? []).map((variant) => (
                <VariantCard
                  key={variant.id}
                  title={variant.label || t('variant')}
                  aspectRatio={variant.aspectRatio}
                  imageUrl={variant.imageUrl}
                  prompt={variant.prompt}
                  promptTitle={t('prompt')}
                  empty={t('empty')}
                  openLabel={t('openImage')}
                  aspectRatioLabel={t('aspectRatio')}
                />
              ))}
              {(result?.variants ?? []).length === 0 && (
                <p className="text-sm leading-6 text-[var(--glass-text-secondary)]">{t('empty')}</p>
              )}
            </div>
          </section>
        </section>
      </main>
    </div>
  )
}

function VariantCard(input: {
  readonly title: string
  readonly aspectRatio?: string
  readonly imageUrl?: string
  readonly prompt?: string
  readonly promptTitle: string
  readonly empty: string
  readonly openLabel: string
  readonly aspectRatioLabel: string
}) {
  return (
    <div className="grid gap-3 rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface-strong)] p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{input.title}</h3>
          {input.aspectRatio && <p className="mt-1 text-xs text-[var(--glass-text-secondary)]">{input.aspectRatioLabel}: {input.aspectRatio}</p>}
        </div>
        {input.imageUrl && <a href={input.imageUrl} target="_blank" rel="noreferrer" className="text-xs text-[var(--glass-accent-from)] hover:underline">{input.openLabel}</a>}
      </div>
      <div className="flex min-h-60 items-center justify-center overflow-hidden rounded-lg bg-black/20">
        {input.imageUrl
          ? <img src={input.imageUrl} alt={input.title} className="max-h-[460px] w-full object-contain" />
          : <span className="px-4 text-center text-sm text-[var(--glass-text-secondary)]">{input.empty}</span>}
      </div>
      {input.prompt && (
        <details>
          <summary className="cursor-pointer text-xs font-medium text-[var(--glass-text-secondary)]">{input.promptTitle}</summary>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-xs leading-5 text-[var(--glass-text-secondary)]">{input.prompt}</pre>
        </details>
      )}
    </div>
  )
}
