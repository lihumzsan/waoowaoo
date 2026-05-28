'use client'

import { useEffect, useMemo, useState } from 'react'
import { Copy, ImageIcon, Loader2, RotateCcw, WandSparkles } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import type { Locale } from '@/i18n/routing'
import { apiFetch } from '@/lib/api-fetch'
import { useUserModels } from '@/lib/query/hooks'
import {
  PROMPT_SUFFIX_TEST_VARIANTS,
  buildPromptSuffixTestPrompt,
  type PromptSuffixVariantId,
} from '@/lib/prompt-suffix-test/variants'

interface PromptSuffixTestResult {
  readonly variantId: string
  readonly modelKey: string
  readonly modelName: string
  readonly imageUrl: string
  readonly displayUrl: string
  readonly finalPrompt: string
  readonly promptLength: number
  readonly externalId?: string
}

type ResultState =
  | { readonly status: 'idle' }
  | { readonly status: 'running' }
  | { readonly status: 'ready'; readonly result: PromptSuffixTestResult }
  | { readonly status: 'failed'; readonly error: string }

function localized(locale: Locale, value: Record<Locale, string>): string {
  return value[locale]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function PromptSuffixTestClient() {
  const t = useTranslations('projectWorkflow.promptSuffixTest')
  const locale = useLocale() as Locale
  const userModelsQuery = useUserModels()
  const imageModels = userModelsQuery.data?.image ?? []
  const [modelKey, setModelKey] = useState('')
  const [aspectRatio, setAspectRatio] = useState('16:9')
  const [basePrompt, setBasePrompt] = useState(t('defaults.basePrompt'))
  const [activeVariantId, setActiveVariantId] = useState<PromptSuffixVariantId>('current_full')
  const [selectedVariantIds, setSelectedVariantIds] = useState<PromptSuffixVariantId[]>([
    'current_full',
    'compact_style',
    'visual_quality',
    'negative_only',
  ])
  const [suffixOverrides, setSuffixOverrides] = useState<Record<string, string>>({})
  const [results, setResults] = useState<Record<string, ResultState>>({})

  useEffect(() => {
    if (!modelKey && imageModels[0]?.value) {
      setModelKey(imageModels[0].value)
    }
  }, [imageModels, modelKey])

  const activeVariant = useMemo(
    () => PROMPT_SUFFIX_TEST_VARIANTS.find((variant) => variant.id === activeVariantId) ?? PROMPT_SUFFIX_TEST_VARIANTS[0],
    [activeVariantId],
  )
  const activeSuffix = suffixOverrides[activeVariant.id] ?? localized(locale, activeVariant.suffix)
  const activeFinalPrompt = useMemo(() => {
    try {
      return buildPromptSuffixTestPrompt({ basePrompt, suffix: activeSuffix })
    } catch {
      return ''
    }
  }, [activeSuffix, basePrompt])

  const toggleVariant = (variantId: PromptSuffixVariantId) => {
    setSelectedVariantIds((current) => {
      if (current.includes(variantId)) return current.filter((id) => id !== variantId)
      return [...current, variantId]
    })
  }

  const resetSuffix = () => {
    setSuffixOverrides((current) => {
      const next = { ...current }
      delete next[activeVariant.id]
      return next
    })
  }

  const generateOne = async (variantId: PromptSuffixVariantId) => {
    const variant = PROMPT_SUFFIX_TEST_VARIANTS.find((item) => item.id === variantId)
    if (!variant) return
    if (!modelKey) throw new Error(t('errors.modelRequired'))
    const suffix = suffixOverrides[variant.id] ?? localized(locale, variant.suffix)
    setResults((current) => ({ ...current, [variant.id]: { status: 'running' } }))
    const response = await apiFetch('/api/user/prompt-suffix-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelKey,
        variantId: variant.id,
        basePrompt,
        suffix,
        aspectRatio,
      }),
    })
    if (!response.ok) {
      const body = await response.json().catch((): { message?: string } => ({}))
      throw new Error(body.message || t('errors.generateFailed'))
    }
    const result = await response.json() as PromptSuffixTestResult
    setResults((current) => ({ ...current, [variant.id]: { status: 'ready', result } }))
  }

  const generateSelected = async () => {
    const targets = selectedVariantIds.length > 0 ? selectedVariantIds : [activeVariantId]
    await Promise.all(targets.map(async (variantId) => {
      try {
        await generateOne(variantId)
      } catch (error) {
        setResults((current) => ({ ...current, [variantId]: { status: 'failed', error: errorMessage(error) } }))
      }
    }))
  }

  const copyFinalPrompt = async () => {
    if (!activeFinalPrompt) return
    await navigator.clipboard.writeText(activeFinalPrompt)
  }

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-5 py-6">
        <header className="flex flex-col gap-3 border-b border-zinc-200 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium text-zinc-500">{t('eyebrow')}</p>
            <h1 className="mt-1 text-2xl font-semibold">{t('title')}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={modelKey}
              onChange={(event) => setModelKey(event.target.value)}
              className="h-10 min-w-[240px] rounded-md border border-zinc-300 bg-white px-3 text-sm"
            >
              {imageModels.length === 0 ? <option value="">{t('model.empty')}</option> : null}
              {imageModels.map((model) => (
                <option key={model.value} value={model.value}>{model.label}</option>
              ))}
            </select>
            <select
              value={aspectRatio}
              onChange={(event) => setAspectRatio(event.target.value)}
              className="h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm"
            >
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
              <option value="1:1">1:1</option>
              <option value="4:3">4:3</option>
              <option value="3:4">3:4</option>
            </select>
            <button
              type="button"
              onClick={() => void generateSelected()}
              disabled={!modelKey || selectedVariantIds.length === 0}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              <WandSparkles className="h-4 w-4" />
              {t('actions.generate')}
            </button>
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-4">
            <div className="rounded-md border border-zinc-200 bg-white p-4">
              <label className="text-sm font-semibold" htmlFor="basePrompt">{t('basePrompt.label')}</label>
              <textarea
                id="basePrompt"
                value={basePrompt}
                onChange={(event) => setBasePrompt(event.target.value)}
                className="mt-3 min-h-[220px] w-full resize-y rounded-md border border-zinc-300 p-3 text-sm leading-6 outline-none focus:border-zinc-500"
              />
            </div>

            <div className="rounded-md border border-zinc-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{t('suffix.label')}</p>
                  <p className="mt-1 text-xs text-zinc-500">{localized(locale, activeVariant.description)}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={resetSuffix}
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 px-3 text-xs font-semibold"
                  >
                    <RotateCcw className="h-4 w-4" />
                    {t('actions.reset')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyFinalPrompt()}
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 px-3 text-xs font-semibold"
                  >
                    <Copy className="h-4 w-4" />
                    {t('actions.copyFinalPrompt')}
                  </button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {PROMPT_SUFFIX_TEST_VARIANTS.map((variant) => (
                  <button
                    type="button"
                    key={variant.id}
                    onClick={() => setActiveVariantId(variant.id)}
                    className={`rounded-md border px-3 py-2 text-sm font-medium ${activeVariant.id === variant.id ? 'border-zinc-950 bg-zinc-950 text-white' : 'border-zinc-200 bg-white text-zinc-700'}`}
                  >
                    {localized(locale, variant.title)}
                  </button>
                ))}
              </div>
              <textarea
                value={activeSuffix}
                onChange={(event) => setSuffixOverrides((current) => ({ ...current, [activeVariant.id]: event.target.value }))}
                className="mt-3 min-h-[180px] w-full resize-y rounded-md border border-zinc-300 p-3 text-sm leading-6 outline-none focus:border-zinc-500"
              />
              <div className="mt-3 grid gap-3 text-xs text-zinc-500 md:grid-cols-3">
                <span>{t('metrics.baseLength', { count: basePrompt.trim().length })}</span>
                <span>{t('metrics.suffixLength', { count: activeSuffix.trim().length })}</span>
                <span>{t('metrics.finalLength', { count: activeFinalPrompt.length })}</span>
              </div>
            </div>
          </div>

          <aside className="space-y-3">
            <div className="rounded-md border border-zinc-200 bg-white p-4">
              <p className="text-sm font-semibold">{t('variants.title')}</p>
              <div className="mt-3 space-y-2">
                {PROMPT_SUFFIX_TEST_VARIANTS.map((variant) => {
                  const selected = selectedVariantIds.includes(variant.id)
                  const suffix = suffixOverrides[variant.id] ?? localized(locale, variant.suffix)
                  return (
                    <label key={variant.id} className="flex cursor-pointer gap-3 rounded-md border border-zinc-200 p-3">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleVariant(variant.id)}
                        className="mt-1 h-4 w-4"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{localized(locale, variant.title)}</span>
                        <span className="mt-1 block text-xs leading-5 text-zinc-500">{localized(locale, variant.description)}</span>
                        <span className="mt-1 block text-xs text-zinc-400">{t('metrics.suffixLength', { count: suffix.trim().length })}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          </aside>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {PROMPT_SUFFIX_TEST_VARIANTS.map((variant) => {
            const state = results[variant.id] ?? { status: 'idle' }
            return (
              <article key={variant.id} className="overflow-hidden rounded-md border border-zinc-200 bg-white">
                <div className="border-b border-zinc-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold">{localized(locale, variant.title)}</h2>
                    <button
                      type="button"
                      onClick={() => void generateOne(variant.id).catch((error) => {
                        setResults((current) => ({ ...current, [variant.id]: { status: 'failed', error: errorMessage(error) } }))
                      })}
                      disabled={!modelKey || state.status === 'running'}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-300 px-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {state.status === 'running' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
                      {t('actions.generateOne')}
                    </button>
                  </div>
                </div>
                <div className="flex aspect-video items-center justify-center bg-zinc-100">
                  {state.status === 'running' ? (
                    <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
                  ) : state.status === 'ready' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={state.result.displayUrl} alt={localized(locale, variant.title)} className="h-full w-full object-contain" />
                  ) : (
                    <span className="px-4 text-center text-xs text-zinc-400">{state.status === 'failed' ? t('result.failed') : t('result.empty')}</span>
                  )}
                </div>
                <div className="space-y-2 p-3">
                  {state.status === 'ready' ? (
                    <>
                      <p className="text-xs text-zinc-500">{t('metrics.finalLength', { count: state.result.promptLength })}</p>
                      <details>
                        <summary className="cursor-pointer text-xs font-semibold text-zinc-700">{t('result.finalPrompt')}</summary>
                        <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded-md bg-zinc-50 p-2 text-xs leading-5 text-zinc-600">{state.result.finalPrompt}</pre>
                      </details>
                    </>
                  ) : null}
                  {state.status === 'failed' ? <p className="text-xs leading-5 text-red-600">{state.error}</p> : null}
                </div>
              </article>
            )
          })}
        </section>
      </div>
    </main>
  )
}
