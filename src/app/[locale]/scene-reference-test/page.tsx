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

type SceneImageResult = {
  imageUrl?: string
  imageKey?: string
  prompt?: string
}

type MultiSceneResult = SceneImageResult & {
  id?: string
  label?: string
}

type SceneTaskResult = {
  singleView?: SceneImageResult
  multiViews?: MultiSceneResult[]
}

type ComparePair = {
  variantId?: string
  variantLabel?: string
  pairIndex?: number
  singleView?: SceneImageResult
  multiView?: SceneImageResult
}

type CompareTaskResult = {
  prompt?: string
  aspectRatio?: string
  pairs?: ComparePair[]
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

function parseSceneImage(value: unknown): SceneImageResult {
  if (!isRecord(value)) return {}
  return {
    imageUrl: readString(value.imageUrl),
    imageKey: readString(value.imageKey),
    prompt: readString(value.prompt),
  }
}

function parseSceneTaskResult(value: unknown): SceneTaskResult | null {
  if (!isRecord(value)) return null
  const rawMultiViews = Array.isArray(value.multiViews) ? value.multiViews : []
  return {
    singleView: parseSceneImage(value.singleView),
    multiViews: rawMultiViews.map((item) => ({
      ...parseSceneImage(item),
      id: isRecord(item) ? readString(item.id) : '',
      label: isRecord(item) ? readString(item.label) : '',
    })),
  }
}

function parseCompareTaskResult(value: unknown): CompareTaskResult | null {
  if (!isRecord(value)) return null
  const rawPairs = Array.isArray(value.pairs) ? value.pairs : []
  return {
    prompt: readString(value.prompt),
    aspectRatio: readString(value.aspectRatio),
    pairs: rawPairs.map((item) => ({
      variantId: isRecord(item) ? readString(item.variantId) : '',
      variantLabel: isRecord(item) ? readString(item.variantLabel) : '',
      pairIndex: isRecord(item) && typeof item.pairIndex === 'number' ? item.pairIndex : 0,
      singleView: isRecord(item) ? parseSceneImage(item.singleView) : {},
      multiView: isRecord(item) ? parseSceneImage(item.multiView) : {},
    })),
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

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function taskPhase(status: string | undefined, hasTask: boolean): TaskPresentationPhase {
  if (status === 'queued' || status === 'processing' || status === 'completed' || status === 'failed') return status
  return hasTask ? 'queued' : 'idle'
}

export default function SceneReferenceTestPage() {
  const t = useTranslations('workspaceDetail.sceneReferenceTest')
  const [characterImageUrl, setCharacterImageUrl] = useState('')
  const [sceneDescription, setSceneDescription] = useState('')
  const [styleRequest, setStyleRequest] = useState('')
  const [storyboardPrompt, setStoryboardPrompt] = useState('')
  const [pairCount, setPairCount] = useState(2)
  const [aspectRatio, setAspectRatio] = useState('16:9')
  const [sceneTaskId, setSceneTaskId] = useState<string | null>(null)
  const [compareTaskId, setCompareTaskId] = useState<string | null>(null)
  const [sceneTask, setSceneTask] = useState<TaskDetail<SceneTaskResult> | null>(null)
  const [compareTask, setCompareTask] = useState<TaskDetail<CompareTaskResult> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sceneResult = sceneTask?.result ?? null
  const compareResult = compareTask?.result ?? null
  const standardSceneBoard = (sceneResult?.multiViews ?? []).find((item) => item.id && item.label && item.imageUrl)

  const pollTask = useCallback(async <T,>(id: string, parseResult: (raw: unknown) => T | null) => {
    const response = await apiFetch(`/api/tasks/${id}`)
    if (!response.ok) throw new Error(await readApiErrorMessage(response, t('failed')))
    const detail = parseTaskDetail(await response.json(), parseResult)
    if (!detail) throw new Error(t('failed'))
    return detail
  }, [t])

  useEffect(() => {
    if (!sceneTaskId) return
    let canceled = false
    const tick = async () => {
      try {
        const detail = await pollTask(sceneTaskId, parseSceneTaskResult)
        if (canceled) return
        setSceneTask(detail)
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
  }, [pollTask, sceneTaskId, t])

  useEffect(() => {
    if (!compareTaskId) return
    let canceled = false
    const tick = async () => {
      try {
        const detail = await pollTask(compareTaskId, parseCompareTaskResult)
        if (canceled) return
        setCompareTask(detail)
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
  }, [compareTaskId, pollTask, t])

  const uploadCharacter = useCallback(async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const imageBase64 = await fileToDataUrl(file)
      const response = await apiFetch('/api/asset-hub/upload-temp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imageBase64 }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, t('uploadFailed')))
      const parsed = await response.json()
      if (!isRecord(parsed) || typeof parsed.url !== 'string') throw new Error(t('uploadFailed'))
      setCharacterImageUrl(parsed.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('uploadFailed'))
    } finally {
      setBusy(false)
    }
  }, [t])

  const generateScenes = useCallback(async () => {
    if (!sceneDescription.trim()) {
      setError(t('needSceneInput'))
      return
    }
    setBusy(true)
    setError(null)
    setSceneTask(null)
    setCompareTask(null)
    setSceneTaskId(null)
    setCompareTaskId(null)
    try {
      const response = await apiFetch('/api/scene-reference-test/generate-scenes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sceneDescription, styleRequest }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, t('failed')))
      const parsed = parseSubmitResponse(await response.json())
      if (!parsed.taskId) throw new Error(t('failed'))
      setSceneTaskId(parsed.taskId)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failed'))
    } finally {
      setBusy(false)
    }
  }, [sceneDescription, styleRequest, t])

  const runComparison = useCallback(async () => {
    if (!characterImageUrl.trim() || !sceneResult?.singleView?.imageUrl || !standardSceneBoard?.imageUrl || !storyboardPrompt.trim()) {
      setError(t('needCompareInput'))
      return
    }
    setBusy(true)
    setError(null)
    setCompareTask(null)
    setCompareTaskId(null)
    try {
      const response = await apiFetch('/api/scene-reference-test/run-comparison', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          characterImageUrl,
          singleSceneImageUrl: sceneResult.singleView.imageUrl,
          storyboardPrompt,
          aspectRatio,
          pairCount,
          variants: [{
            id: standardSceneBoard.id,
            label: standardSceneBoard.label,
            imageUrl: standardSceneBoard.imageUrl,
          }],
        }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, t('failed')))
      const parsed = parseSubmitResponse(await response.json())
      if (!parsed.taskId) throw new Error(t('failed'))
      setCompareTaskId(parsed.taskId)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failed'))
    } finally {
      setBusy(false)
    }
  }, [aspectRatio, characterImageUrl, pairCount, sceneResult?.singleView?.imageUrl, standardSceneBoard?.id, standardSceneBoard?.imageUrl, standardSceneBoard?.label, storyboardPrompt, t])

  const sceneState = resolveTaskPresentationState({
    phase: taskPhase(sceneTask?.status, Boolean(sceneTaskId)),
    intent: 'generate',
    resource: 'image',
    hasOutput: Boolean(sceneResult?.singleView?.imageUrl),
  })
  const compareState = resolveTaskPresentationState({
    phase: taskPhase(compareTask?.status, Boolean(compareTaskId)),
    intent: 'generate',
    resource: 'image',
    hasOutput: Boolean(compareResult?.pairs?.length),
  })

  return (
    <div className="min-h-screen bg-[var(--glass-bg-base)] text-[var(--glass-text-primary)]">
      <Navbar />
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8">
        <div>
          <Link href={{ pathname: '/workspace' }} className="text-sm text-[var(--glass-text-secondary)] hover:text-[var(--glass-text-primary)]">{t('back')}</Link>
          <h1 className="mt-3 text-2xl font-semibold tracking-normal">{t('title')}</h1>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--glass-text-secondary)]">{t('subtitle')}</p>
        </div>

        <section className="grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
          <div className="flex flex-col gap-4 rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-4">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">{t('characterUpload')}</span>
              <input type="file" accept="image/*" disabled={busy} onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void uploadCharacter(file)
              }} />
            </label>
            <input
              value={characterImageUrl}
              onChange={(event) => setCharacterImageUrl(event.target.value)}
              placeholder={t('characterUrlPlaceholder')}
              className="rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface-strong)] px-3 py-2 text-sm outline-none"
            />
            {characterImageUrl && <img src={characterImageUrl} alt={t('characterAlt')} className="max-h-48 rounded-lg object-contain" />}

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">{t('sceneDescription')}</span>
              <textarea value={sceneDescription} onChange={(event) => setSceneDescription(event.target.value)} rows={5} placeholder={t('scenePlaceholder')} className="resize-none rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface-strong)] px-3 py-2 text-sm leading-6 outline-none" />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">{t('styleRequest')}</span>
              <textarea value={styleRequest} onChange={(event) => setStyleRequest(event.target.value)} rows={3} placeholder={t('stylePlaceholder')} className="resize-none rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface-strong)] px-3 py-2 text-sm leading-6 outline-none" />
            </label>
            <div className="rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface-strong)] px-3 py-2 text-sm text-[var(--glass-text-secondary)]">
              <span className="font-medium text-[var(--glass-text-primary)]">{t('standardBoardTitle')}</span>
              <span className="mt-1 block">{t('standardBoardDescription')}</span>
            </div>
            <button type="button" onClick={generateScenes} disabled={busy || !sceneDescription.trim()} className="rounded-lg bg-[var(--glass-accent-from)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {t('generateScenes')}
            </button>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">{t('storyboardPrompt')}</span>
              <textarea value={storyboardPrompt} onChange={(event) => setStoryboardPrompt(event.target.value)} rows={5} placeholder={t('storyboardPlaceholder')} className="resize-none rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface-strong)] px-3 py-2 text-sm leading-6 outline-none" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium">{t('pairCount')}</span>
                <input type="number" min={1} max={4} value={pairCount} onChange={(event) => setPairCount(Number(event.target.value))} className="rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface-strong)] px-3 py-2 text-sm outline-none" />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium">{t('aspectRatio')}</span>
                <input value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)} className="rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface-strong)] px-3 py-2 text-sm outline-none" />
              </label>
            </div>
            <button type="button" onClick={runComparison} disabled={busy || !sceneResult?.singleView?.imageUrl || !standardSceneBoard?.imageUrl} className="rounded-lg bg-[var(--glass-accent-from)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {t('runComparison')}
            </button>
            {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}
          </div>

          <div className="flex flex-col gap-6">
            <section className="rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">{t('sceneResults')}</h2>
                {sceneTaskId && <TaskStatusInline state={sceneState} />}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <ImageCard title={t('singleView')} imageUrl={sceneResult?.singleView?.imageUrl} prompt={sceneResult?.singleView?.prompt} promptTitle={t('prompt')} empty={t('emptyScenes')} openLabel={t('openImage')} />
                {(sceneResult?.multiViews ?? []).map((item) => (
                  <ImageCard key={item.id} title={item.label || t('multiView')} imageUrl={item.imageUrl} prompt={item.prompt} promptTitle={t('prompt')} empty={t('emptyScenes')} openLabel={t('openImage')} />
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">{t('comparisonResults')}</h2>
                {compareTaskId && <TaskStatusInline state={compareState} />}
              </div>
              <div className="grid gap-5">
                {(compareResult?.pairs ?? []).map((pair, index) => (
                  <div key={`${pair.variantId}-${pair.pairIndex}-${index}`} className="grid gap-3 rounded-lg border border-[var(--glass-stroke-base)] p-3">
                    <h3 className="text-sm font-semibold">{pair.variantLabel} · {t('pair')} {pair.pairIndex}</h3>
                    <div className="grid gap-3 md:grid-cols-2">
                      <ImageCard title={t('singleComparison')} imageUrl={pair.singleView?.imageUrl} prompt={compareResult?.prompt} promptTitle={t('sharedPrompt')} empty={t('emptyComparison')} openLabel={t('openImage')} />
                      <ImageCard title={t('multiComparison')} imageUrl={pair.multiView?.imageUrl} prompt={compareResult?.prompt} promptTitle={t('sharedPrompt')} empty={t('emptyComparison')} openLabel={t('openImage')} />
                    </div>
                  </div>
                ))}
                {(compareResult?.pairs ?? []).length === 0 && <p className="text-sm text-[var(--glass-text-secondary)]">{t('emptyComparison')}</p>}
              </div>
            </section>
          </div>
        </section>
      </main>
    </div>
  )
}

function ImageCard(input: {
  readonly title: string
  readonly imageUrl?: string
  readonly prompt?: string
  readonly promptTitle: string
  readonly empty: string
  readonly openLabel: string
}) {
  return (
    <div className="grid gap-3 rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface-strong)] p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{input.title}</h3>
        {input.imageUrl && <a href={input.imageUrl} target="_blank" rel="noreferrer" className="text-xs text-[var(--glass-accent-from)] hover:underline">{input.openLabel}</a>}
      </div>
      <div className="flex min-h-52 items-center justify-center overflow-hidden rounded-lg bg-black/20">
        {input.imageUrl
          ? <img src={input.imageUrl} alt={input.title} className="max-h-[420px] w-full object-contain" />
          : <span className="px-4 text-center text-sm text-[var(--glass-text-secondary)]">{input.empty}</span>}
      </div>
      {input.prompt && (
        <details>
          <summary className="cursor-pointer text-xs font-medium text-[var(--glass-text-secondary)]">{input.promptTitle}</summary>
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-xs leading-5 text-[var(--glass-text-secondary)]">{input.prompt}</pre>
        </details>
      )}
    </div>
  )
}
