'use client'

import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { useLocale, useTranslations } from 'next-intl'
import BillingActionButton from '@/components/billing/BillingActionButton'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { buildBillingActionQuotePreview } from '@/lib/billing/action-quote-preview'
import {
  CONTINUITY_EXPERIMENT_STORIES,
  CONTINUITY_EXPERIMENT_VARIANT_IDS,
  type ContinuityExperimentStoryId,
  type ContinuityExperimentVariantId,
} from '@/lib/continuity-experiment/catalog'
import type { ContinuityExperimentCellInput } from '@/lib/continuity-experiment/compiler'
import type { OperationPlanView } from '@/lib/operations/planning'
import {
  fetchOperationPlanView,
  issueOperationApprovalGrant,
} from '@/lib/query/operation-plan-client'
import { waitForTaskResult } from '@/lib/task/client'
import { resolveTaskErrorMessage } from '@/lib/task/error-message'

type CellPhase = 'idle' | 'queued' | 'processing' | 'completed' | 'failed'

interface CellViewState {
  readonly phase: CellPhase
  readonly progress: number | null
  readonly taskId: string | null
  readonly imageUrl: string | null
  readonly prompt: string | null
  readonly promptPacket: unknown
  readonly error: string | null
}

interface ExecuteResult {
  readonly taskIds: readonly string[]
  readonly results?: readonly { readonly refId: string; readonly taskId: string }[]
}

function cellId(cell: ContinuityExperimentCellInput): string {
  return `${cell.storyId}:${cell.variantId}:${cell.shotId}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readExecuteResult(value: unknown): ExecuteResult {
  if (!isRecord(value) || !Array.isArray(value.taskIds)) throw new Error('CONTINUITY_EXPERIMENT_EXECUTION_INVALID')
  const taskIds = value.taskIds.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
  const results = Array.isArray(value.results)
    ? value.results.flatMap((item) => {
        if (!isRecord(item) || typeof item.refId !== 'string' || typeof item.taskId !== 'string') return []
        return [{ refId: item.refId, taskId: item.taskId }]
      })
    : undefined
  return { taskIds, ...(results ? { results } : {}) }
}

function readCompletedResult(value: unknown) {
  if (!isRecord(value)) throw new Error('CONTINUITY_EXPERIMENT_TASK_RESULT_INVALID')
  return {
    imageUrl: typeof value.imageUrl === 'string' ? value.imageUrl : null,
    prompt: typeof value.prompt === 'string' ? value.prompt : null,
    promptPacket: value.promptPacket ?? null,
  }
}

function freshCellState(phase: CellPhase = 'idle', taskId: string | null = null): CellViewState {
  return {
    phase,
    progress: null,
    taskId,
    imageUrl: null,
    prompt: null,
    promptPacket: null,
    error: null,
  }
}

function defaultShots(): Record<ContinuityExperimentStoryId, string[]> {
  return Object.fromEntries(
    CONTINUITY_EXPERIMENT_STORIES.map((story) => [story.id, [...story.quickShotIds]]),
  ) as Record<ContinuityExperimentStoryId, string[]>
}

export default function ContinuityLabClient({ projectId }: { readonly projectId: string }) {
  const t = useTranslations('continuityLab')
  const locale = useLocale()
  const [runId, setRunId] = useState(() => crypto.randomUUID())
  const [selectedVariants, setSelectedVariants] = useState<ContinuityExperimentVariantId[]>([
    ...CONTINUITY_EXPERIMENT_VARIANT_IDS,
  ])
  const [selectedShots, setSelectedShots] = useState(defaultShots)
  const [plan, setPlan] = useState<OperationPlanView | null>(null)
  const [planSignature, setPlanSignature] = useState('')
  const [planLoading, setPlanLoading] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [cellsState, setCellsState] = useState<Record<string, CellViewState>>({})

  const cells = useMemo<ContinuityExperimentCellInput[]>(() => CONTINUITY_EXPERIMENT_STORIES.flatMap((story) => {
    const shots = selectedShots[story.id] || []
    return shots.flatMap((shotId) => selectedVariants.map((variantId) => ({
      storyId: story.id,
      variantId,
      shotId,
    })))
  }), [selectedShots, selectedVariants])
  const selectionSignature = useMemo(() => JSON.stringify({ runId, cells }), [cells, runId])
  const currentPlan = planSignature === selectionSignature ? plan : null
  const quote = useMemo(() => currentPlan ? buildBillingActionQuotePreview({
    plan: currentPlan,
    withCredits: ({ count, cost }) => t('quoteWithCredits', { count, cost }),
    withoutCredits: ({ count }) => t('quoteWithoutCredits', { count }),
  }) : null, [currentPlan, t])

  useEffect(() => {
    if (!projectId || cells.length === 0 || running) return
    let ignored = false
    const timer = window.setTimeout(() => {
      setPlanLoading(true)
      setPlanError(null)
      void fetchOperationPlanView({
        projectId,
        operationId: 'generate_continuity_experiment_images',
        input: { runId, cells },
        context: { locale },
      }).then((nextPlan) => {
        if (ignored) return
        setPlan(nextPlan)
        setPlanSignature(selectionSignature)
      }).catch((error: unknown) => {
        if (ignored) return
        setPlan(null)
        setPlanSignature('')
        setPlanError(resolveTaskErrorMessage(error, t('planFailed')))
      }).finally(() => {
        if (!ignored) setPlanLoading(false)
      })
    }, 350)
    return () => {
      ignored = true
      window.clearTimeout(timer)
    }
  }, [cells, locale, projectId, runId, running, selectionSignature, t])

  const toggleVariant = (variantId: ContinuityExperimentVariantId) => {
    setSelectedVariants((current) => current.includes(variantId)
      ? current.filter((item) => item !== variantId)
      : [...current, variantId])
  }

  const toggleShot = (storyId: ContinuityExperimentStoryId, shotId: string) => {
    setSelectedShots((current) => {
      const storyShots = current[storyId] || []
      return {
        ...current,
        [storyId]: storyShots.includes(shotId)
          ? storyShots.filter((item) => item !== shotId)
          : [...storyShots, shotId],
      }
    })
  }

  const selectQuick = () => setSelectedShots(defaultShots())
  const selectAll = () => setSelectedShots(Object.fromEntries(
    CONTINUITY_EXPERIMENT_STORIES.map((story) => [story.id, story.shots.map((shot) => shot.id)]),
  ) as Record<ContinuityExperimentStoryId, string[]>)

  const execute = async () => {
    if (!currentPlan || running || cells.length === 0) return
    setRunning(true)
    setPlanError(null)
    setCellsState(Object.fromEntries(cells.map((cell) => [cellId(cell), freshCellState('queued')])))
    try {
      const approval = await issueOperationApprovalGrant(currentPlan)
      const response = await apiFetch(`/api/projects/${projectId}/operations/generate_continuity_experiment_images/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { runId, cells }, ...approval }),
      })
      const responseBody: unknown = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(resolveTaskErrorMessage(responseBody, t('executionFailed')))
      const submitted = readExecuteResult(responseBody)
      const taskByCell = new Map((submitted.results || []).map((item) => [item.refId, item.taskId]))
      if (taskByCell.size !== cells.length) throw new Error('CONTINUITY_EXPERIMENT_TASK_MAPPING_INCOMPLETE')
      setCellsState((current) => Object.fromEntries(Object.entries(current).map(([id, state]) => [
        id,
        { ...state, taskId: taskByCell.get(id) || null },
      ])))

      await Promise.all(cells.map(async (cell) => {
        const id = cellId(cell)
        const taskId = taskByCell.get(id)
        if (!taskId) return
        try {
          const result = await waitForTaskResult(taskId, {
            intervalMs: 1500,
            onTaskUpdate: (task) => {
              setCellsState((current) => ({
                ...current,
                [id]: {
                  ...(current[id] || freshCellState()),
                  taskId,
                  phase: task.status === 'queued' ? 'queued' : task.status === 'processing' ? 'processing' : current[id]?.phase || 'idle',
                  progress: typeof task.progress === 'number' ? task.progress : null,
                },
              }))
            },
          })
          const completed = readCompletedResult(result)
          setCellsState((current) => ({
            ...current,
            [id]: {
              ...(current[id] || freshCellState()),
              taskId,
              phase: 'completed',
              progress: 100,
              imageUrl: completed.imageUrl,
              prompt: completed.prompt,
              promptPacket: completed.promptPacket,
              error: null,
            },
          }))
        } catch (error) {
          setCellsState((current) => ({
            ...current,
            [id]: {
              ...(current[id] || freshCellState()),
              taskId,
              phase: 'failed',
              error: resolveTaskErrorMessage(error, t('taskFailed')),
            },
          }))
        }
      }))
      setRunId(crypto.randomUUID())
    } catch (error) {
      setPlanError(resolveTaskErrorMessage(error, t('executionFailed')))
    } finally {
      setRunning(false)
    }
  }

  if (!projectId) {
    return (
      <main className="min-h-screen bg-slate-50 px-6 py-16">
        <div className="mx-auto max-w-xl rounded-3xl border border-amber-200 bg-amber-50 p-8 text-amber-950">
          <h1 className="text-xl font-semibold">{t('missingProjectTitle')}</h1>
          <p className="mt-3 text-sm leading-6">{t('missingProjectBody')}</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#e0e7ff_0,transparent_35%),linear-gradient(#f8fafc,#eef2ff)] px-4 py-8 text-slate-950 sm:px-8">
      <div className="mx-auto max-w-[1680px] space-y-6">
        <header className="rounded-[28px] border border-white/80 bg-white/85 p-6 shadow-sm backdrop-blur-xl sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-indigo-600">
                <AppIcon name="crosshair" className="h-4 w-4" />
                {t('eyebrow')}
              </div>
              <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{t('title')}</h1>
              <p className="mt-3 text-sm leading-7 text-slate-600 sm:text-base">{t('description')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={selectQuick} disabled={running} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50">
                {t('quickSelection')}
              </button>
              <button type="button" onClick={selectAll} disabled={running} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50">
                {t('allShots')}
              </button>
              <BillingActionButton
                icon="sparkles"
                label={running ? t('running') : planLoading ? t('planning') : t('run', { count: cells.length })}
                quote={quote}
                loading={running || planLoading}
                disabled={running || planLoading || !currentPlan || cells.length === 0}
                onClick={() => { void execute() }}
                className="min-w-44"
              />
            </div>
          </div>
          {planError ? <div className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{planError}</div> : null}
        </header>

        <section className="grid gap-4 lg:grid-cols-3">
          {CONTINUITY_EXPERIMENT_STORIES.map((story) => (
            <article key={story.id} className="rounded-3xl border border-white/80 bg-white/90 p-5 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold text-indigo-600">{t('difficulty', { level: story.difficulty })}</div>
                  <h2 className="mt-1 text-xl font-bold">{t(`stories.${story.id}.title`)}</h2>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{story.shots.length} {t('shotsUnit')}</span>
              </div>
              <p className="mt-3 min-h-12 text-sm leading-6 text-slate-600">{t(`stories.${story.id}.description`)}</p>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {story.shots.map((shot, index) => {
                  const selected = selectedShots[story.id]?.includes(shot.id)
                  return (
                    <button
                      key={shot.id}
                      type="button"
                      disabled={running}
                      onClick={() => toggleShot(story.id, shot.id)}
                      className={`rounded-xl border px-2 py-2 text-left text-xs transition ${selected ? 'border-indigo-500 bg-indigo-50 text-indigo-800' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}
                    >
                      <span className="block font-bold">{t('shotNumber', { number: index + 1 })}</span>
                      <span className="mt-0.5 block truncate">{t(`stories.${story.id}.shots.${shot.id}`)}</span>
                    </button>
                  )
                })}
              </div>
            </article>
          ))}
        </section>

        <section className="rounded-3xl border border-white/80 bg-white/90 p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold">{t('variantsTitle')}</h2>
              <p className="mt-1 text-sm text-slate-500">{t('variantsDescription')}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {CONTINUITY_EXPERIMENT_VARIANT_IDS.map((variantId) => {
                const selected = selectedVariants.includes(variantId)
                return (
                  <button key={variantId} type="button" disabled={running} onClick={() => toggleVariant(variantId)} className={`rounded-xl border px-4 py-2 text-sm font-semibold ${selected ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-500'}`}>
                    {t(`variants.${variantId}.title`)}
                  </button>
                )
              })}
            </div>
          </div>
        </section>

        <section className="space-y-6">
          {CONTINUITY_EXPERIMENT_STORIES.map((story) => {
            const storyShotIds = selectedShots[story.id] || []
            if (storyShotIds.length === 0) return null
            return (
              <article key={story.id} className="overflow-hidden rounded-3xl border border-white/80 bg-white/90 shadow-sm">
                <div className="border-b border-slate-200 px-5 py-4">
                  <h2 className="text-lg font-bold">{t(`stories.${story.id}.title`)}</h2>
                </div>
                <div className="overflow-x-auto">
                  <div className="min-w-[1040px]">
                    <div className="grid grid-cols-[170px_repeat(3,minmax(280px,1fr))] border-b border-slate-200 bg-slate-50/80">
                      <div className="p-3 text-xs font-bold text-slate-500">{t('matrixShot')}</div>
                      {CONTINUITY_EXPERIMENT_VARIANT_IDS.map((variantId) => (
                        <div key={variantId} className="border-l border-slate-200 p-3">
                          <div className="text-sm font-bold">{t(`variants.${variantId}.title`)}</div>
                          <div className="mt-1 text-xs leading-5 text-slate-500">{t(`variants.${variantId}.description`)}</div>
                        </div>
                      ))}
                    </div>
                    {story.shots.filter((shot) => storyShotIds.includes(shot.id)).map((shot, index) => (
                      <div key={shot.id} className="grid grid-cols-[170px_repeat(3,minmax(280px,1fr))] border-b border-slate-100 last:border-b-0">
                        <div className="p-4">
                          <div className="text-xs font-bold text-indigo-600">{t('shotNumber', { number: index + 1 })}</div>
                          <div className="mt-1 text-sm font-semibold">{t(`stories.${story.id}.shots.${shot.id}`)}</div>
                        </div>
                        {CONTINUITY_EXPERIMENT_VARIANT_IDS.map((variantId) => {
                          const id = `${story.id}:${variantId}:${shot.id}`
                          const state = cellsState[id] || freshCellState()
                          const enabled = selectedVariants.includes(variantId)
                          return (
                            <div key={variantId} className="border-l border-slate-200 p-3">
                              {!enabled ? (
                                <div className="flex aspect-video items-center justify-center rounded-2xl border border-dashed border-slate-200 text-xs text-slate-400">{t('notSelected')}</div>
                              ) : state.imageUrl ? (
                                <div>
                                  <Image
                                    src={state.imageUrl}
                                    alt={t('resultAlt', { story: t(`stories.${story.id}.title`), variant: t(`variants.${variantId}.title`) })}
                                    width={1280}
                                    height={720}
                                    unoptimized
                                    className="aspect-video w-full rounded-2xl bg-slate-100 object-cover"
                                  />
                                  <details className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                                    <summary className="cursor-pointer font-semibold text-slate-600">{t('promptDetails')}</summary>
                                    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-slate-600">{state.prompt || JSON.stringify(state.promptPacket, null, 2)}</pre>
                                  </details>
                                </div>
                              ) : (
                                <div className={`flex aspect-video flex-col items-center justify-center rounded-2xl border text-center ${state.phase === 'failed' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                                  {state.phase === 'queued' || state.phase === 'processing' ? <AppIcon name="loader" className="mb-2 h-5 w-5 animate-spin" /> : <AppIcon name="imageLandscape" className="mb-2 h-5 w-5" />}
                                  <div className="text-xs font-semibold">{state.phase === 'failed' ? t('failed') : state.phase === 'queued' ? t('queued') : state.phase === 'processing' ? t('processing', { progress: state.progress ?? 0 }) : t('waiting')}</div>
                                  {state.error ? <div className="mt-2 max-w-64 px-3 text-[11px] leading-4">{state.error}</div> : null}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            )
          })}
        </section>
      </div>
    </main>
  )
}
