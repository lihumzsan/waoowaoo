'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { useUserModels } from '@/lib/query/hooks'
import {
  textPlacementPlanSchema,
  type TextPlacementFinalImageResult,
  type TextPlacementPlan,
} from '@/lib/text-placement-test/types'

interface TextPlacementTestResponse {
  readonly success: true
  readonly llmModelKey: string
  readonly imageModelKey: string
  readonly placementPlan: TextPlacementPlan
  readonly placementPrompt: string
  readonly placementRawText: string
  readonly scenePrompt: string
  readonly characterAPrompt: string
  readonly characterBPrompt: string
  readonly sceneImageUrl: string
  readonly sceneStorageKey: string
  readonly characterAImageUrl: string
  readonly characterAStorageKey: string
  readonly characterBImageUrl: string
  readonly characterBStorageKey: string
  readonly finalImages: readonly TextPlacementFinalImageResult[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isTextPlacementTestResponse(value: unknown): value is TextPlacementTestResponse {
  if (!isRecord(value)) return false
  return value.success === true
    && typeof value.llmModelKey === 'string'
    && typeof value.imageModelKey === 'string'
    && textPlacementPlanSchema.safeParse(value.placementPlan).success
    && typeof value.placementPrompt === 'string'
    && typeof value.placementRawText === 'string'
    && typeof value.scenePrompt === 'string'
    && typeof value.characterAPrompt === 'string'
    && typeof value.characterBPrompt === 'string'
    && typeof value.sceneImageUrl === 'string'
    && typeof value.sceneStorageKey === 'string'
    && typeof value.characterAImageUrl === 'string'
    && typeof value.characterAStorageKey === 'string'
    && typeof value.characterBImageUrl === 'string'
    && typeof value.characterBStorageKey === 'string'
    && Array.isArray(value.finalImages)
    && value.finalImages.every((item) => (
      isRecord(item)
      && Number.isInteger(item.shotNumber)
      && typeof item.shotLabel === 'string'
      && typeof item.prompt === 'string'
      && typeof item.imageUrl === 'string'
      && typeof item.storageKey === 'string'
    ))
}

function readErrorMessage(payload: unknown, fallback: string): string {
  return isRecord(payload) ? JSON.stringify(payload) : fallback
}

function ImagePanel(props: {
  readonly title: string
  readonly empty: string
  readonly imageUrl: string | null
  readonly storageKey?: string
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{props.title}</h2>
        {props.storageKey ? <span className="text-xs text-slate-500">{props.storageKey}</span> : null}
      </div>
      <div className="flex min-h-80 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-100">
        {props.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="max-h-[72vh] w-full object-contain" src={props.imageUrl} alt={props.title} />
        ) : (
          <p className="px-4 text-center text-sm text-slate-500">{props.empty}</p>
        )}
      </div>
    </section>
  )
}

function FinalShotPanel(props: {
  readonly image: TextPlacementFinalImageResult
}) {
  return (
    <ImagePanel
      title={`${props.image.shotNumber}. ${props.image.shotLabel}`}
      empty=""
      imageUrl={props.image.imageUrl}
      storageKey={props.image.storageKey}
    />
  )
}

function TextPanel(props: {
  readonly title: string
  readonly value: string
  readonly empty: string
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">{props.title}</h2>
      <pre className="max-h-96 overflow-auto rounded-md bg-slate-950 p-3 text-xs leading-5 text-slate-100">
        {props.value || props.empty}
      </pre>
    </section>
  )
}

export function TextPlacementTestClient() {
  const t = useTranslations('textPlacementTest')
  const locale = useLocale()
  const userModels = useUserModels()
  const [storyPrompt, setStoryPrompt] = useState('')
  const [llmModelKey, setLlmModelKey] = useState('')
  const [imageModelKey, setImageModelKey] = useState('')
  const [result, setResult] = useState<TextPlacementTestResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)

  useEffect(() => {
    if (!llmModelKey && userModels.data?.llm[0]?.value) setLlmModelKey(userModels.data.llm[0].value)
    if (!imageModelKey && userModels.data?.image[0]?.value) setImageModelKey(userModels.data.image[0].value)
  }, [imageModelKey, llmModelKey, userModels.data?.image, userModels.data?.llm])

  const runDisabled = !storyPrompt.trim() || !llmModelKey || !imageModelKey || isRunning

  const handleRun = useCallback(async () => {
    if (!storyPrompt.trim() || !llmModelKey || !imageModelKey) return
    setIsRunning(true)
    setError(null)
    setResult(null)
    try {
      const response = await fetch('/api/user/text-placement-test/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          storyPrompt: storyPrompt.trim(),
          llmModelKey,
          imageModelKey,
          locale,
        }),
      })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(readErrorMessage(payload, response.statusText))
      if (!isTextPlacementTestResponse(payload)) throw new Error('INVALID_TEXT_PLACEMENT_TEST_RESPONSE')
      setResult(payload)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setIsRunning(false)
    }
  }, [imageModelKey, llmModelKey, locale, storyPrompt])

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-5 py-6">
        <header className="flex flex-col gap-2 border-b border-slate-200 pb-5">
          <p className="text-sm font-semibold text-cyan-700">{t('eyebrow')}</p>
          <h1 className="text-2xl font-semibold tracking-normal">{t('title')}</h1>
          <p className="max-w-4xl text-sm leading-6 text-slate-600">{t('subtitle')}</p>
        </header>

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-[410px_minmax(0,1fr)]">
          <aside className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <label className="grid gap-2 text-sm">
              <span className="font-medium text-slate-800">{t('storyPrompt')}</span>
              <textarea
                className="min-h-48 resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-6 outline-none ring-cyan-500 focus:ring-2"
                value={storyPrompt}
                placeholder={t('storyPlaceholder')}
                onChange={(event) => setStoryPrompt(event.currentTarget.value)}
              />
            </label>

            <label className="grid gap-2 text-sm">
              <span className="font-medium text-slate-800">{t('llmModel')}</span>
              <select
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none ring-cyan-500 focus:ring-2"
                value={llmModelKey}
                onChange={(event) => setLlmModelKey(event.currentTarget.value)}
              >
                <option value="">{userModels.isLoading ? t('loadingModels') : t('selectModel')}</option>
                {(userModels.data?.llm || []).map((model) => (
                  <option key={model.value} value={model.value}>{model.label}</option>
                ))}
              </select>
            </label>

            <label className="grid gap-2 text-sm">
              <span className="font-medium text-slate-800">{t('imageModel')}</span>
              <select
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none ring-cyan-500 focus:ring-2"
                value={imageModelKey}
                onChange={(event) => setImageModelKey(event.currentTarget.value)}
              >
                <option value="">{userModels.isLoading ? t('loadingModels') : t('selectModel')}</option>
                {(userModels.data?.image || []).map((model) => (
                  <option key={model.value} value={model.value}>{model.label}</option>
                ))}
              </select>
            </label>

            <button
              type="button"
              disabled={runDisabled}
              className="flex h-11 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              onClick={() => void handleRun()}
            >
              {isRunning ? <AppIcon name="loader" className="h-4 w-4 animate-spin" /> : <AppIcon name="sparklesAlt" className="h-4 w-4" />}
              {isRunning ? t('running') : t('run')}
            </button>

            {error ? <p className="max-h-48 overflow-auto rounded-md border border-red-200 bg-red-50 p-2 text-xs leading-5 text-red-700">{error}</p> : null}
            {result ? (
              <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                <span>{t('llmModel')}: {result.llmModelKey}</span>
                <span>{t('imageModel')}: {result.imageModelKey}</span>
                <span>{t('finalImageCount')}: {result.finalImages.length}</span>
              </div>
            ) : null}
          </aside>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <ImagePanel
              title={t('sceneAsset')}
              empty={t('emptyScene')}
              imageUrl={result?.sceneImageUrl || null}
              storageKey={result?.sceneStorageKey}
            />
            <ImagePanel
              title={t('characterAAsset')}
              empty={t('emptyCharacterA')}
              imageUrl={result?.characterAImageUrl || null}
              storageKey={result?.characterAStorageKey}
            />
            <ImagePanel
              title={t('characterBAsset')}
              empty={t('emptyCharacterB')}
              imageUrl={result?.characterBImageUrl || null}
              storageKey={result?.characterBStorageKey}
            />
            {result?.finalImages.length ? (
              <section className="grid gap-3 lg:col-span-2">
                <h2 className="mb-3 text-sm font-semibold text-slate-900">{t('finalImageSequence')}</h2>
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  {result.finalImages.map((image) => <FinalShotPanel key={image.shotNumber} image={image} />)}
                </div>
              </section>
            ) : (
              <ImagePanel
                title={t('finalImageSequence')}
                empty={t('emptyFinal')}
                imageUrl={null}
              />
            )}
            <TextPanel
              title={t('placementJson')}
              value={result ? JSON.stringify(result.placementPlan, null, 2) : ''}
              empty={t('emptyText')}
            />
            <TextPanel title={t('placementPrompt')} value={result?.placementPrompt || ''} empty={t('emptyText')} />
            <TextPanel title={t('scenePrompt')} value={result?.scenePrompt || ''} empty={t('emptyText')} />
            <TextPanel title={t('characterAPrompt')} value={result?.characterAPrompt || ''} empty={t('emptyText')} />
            <TextPanel title={t('characterBPrompt')} value={result?.characterBPrompt || ''} empty={t('emptyText')} />
            <TextPanel
              title={t('finalPrompts')}
              value={result?.finalImages.map((image) => [
                `# ${image.shotNumber}. ${image.shotLabel}`,
                image.prompt,
              ].join('\n')).join('\n\n') || ''}
              empty={t('emptyText')}
            />
            <TextPanel title={t('rawPlan')} value={result?.placementRawText || ''} empty={t('emptyText')} />
          </div>
        </section>
      </div>
    </main>
  )
}
