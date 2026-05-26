'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { useUserModels } from '@/lib/query/hooks'
import type { TextPlacementAssetKind, TextPlacementFinalImageResult, TextPlacementShot } from '@/lib/text-placement-test/types'
import { FinalShotPanel, ImagePanel, TextPanel } from './TextPlacementPanels'
import {
  isRetryResponse,
  isTextPlacementTestStreamEvent,
  type PersistedTextPlacementTestState,
  type RetryAssetPayload,
  type RetryResponse,
  type TextPlacementProgressResult,
  type TextPlacementTestResponse,
  type TextPlacementTestStreamEvent,
} from './client-state'
import {
  clearTextPlacementTestState,
  loadTextPlacementTestState,
  saveTextPlacementTestState,
} from './client-persistence'
import {
  getAssetPrompt,
  getFinalImageByShot,
  parseStreamEventBlock,
  readErrorMessage,
  upsertFinalImage,
} from './client-utils'

export function TextPlacementTestClient() {
  const t = useTranslations('textPlacementTest')
  const locale = useLocale()
  const userModels = useUserModels()
  const [storyPrompt, setStoryPrompt] = useState('')
  const [llmModelKey, setLlmModelKey] = useState('')
  const [imageModelKey, setImageModelKey] = useState('')
  const [result, setResult] = useState<TextPlacementTestResponse | null>(null)
  const [progressResult, setProgressResult] = useState<TextPlacementProgressResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [retryingKey, setRetryingKey] = useState<string | null>(null)
  const [hasLoadedPersistedState, setHasLoadedPersistedState] = useState(false)

  useEffect(() => {
    let isMounted = true
    void loadTextPlacementTestState()
      .then((persisted) => {
        if (!isMounted) return
        if (persisted) {
          setStoryPrompt(persisted.storyPrompt)
          setLlmModelKey(persisted.llmModelKey)
          setImageModelKey(persisted.imageModelKey)
          setResult(persisted.result)
          setProgressResult(persisted.progressResult)
          setError(persisted.error)
        }
      })
      .catch((caught: unknown) => {
        if (!isMounted) return
        setError(caught instanceof Error ? caught.message : String(caught))
      })
      .finally(() => {
        if (isMounted) setHasLoadedPersistedState(true)
      })
    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (!hasLoadedPersistedState) return
    const persisted: PersistedTextPlacementTestState = {
      storyPrompt,
      llmModelKey,
      imageModelKey,
      result,
      progressResult,
      error,
    }
    void saveTextPlacementTestState(persisted).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : String(caught))
    })
  }, [error, hasLoadedPersistedState, imageModelKey, llmModelKey, progressResult, result, storyPrompt])

  useEffect(() => {
    if (!llmModelKey && userModels.data?.llm[0]?.value) setLlmModelKey(userModels.data.llm[0].value)
    if (!imageModelKey && userModels.data?.image[0]?.value) setImageModelKey(userModels.data.image[0].value)
  }, [imageModelKey, llmModelKey, userModels.data?.image, userModels.data?.llm])

  const isRetrying = retryingKey !== null
  const runDisabled = !storyPrompt.trim() || !llmModelKey || !imageModelKey || isRunning || isRetrying

  const handleRun = useCallback(async () => {
    if (!storyPrompt.trim() || !llmModelKey || !imageModelKey) return
    const initialProgressResult: TextPlacementProgressResult = {
      llmModelKey,
      imageModelKey,
      finalImages: [],
    }
    setIsRunning(true)
    setError(null)
    setResult(null)
    setProgressResult(initialProgressResult)
    const applyStreamEvent = (event: TextPlacementTestStreamEvent) => {
      if (event.type === 'error') {
        throw new Error(event.message)
      }
      if (event.type === 'complete') {
        setResult(event.result)
        setProgressResult(event.result)
        return
      }
      setProgressResult((previous) => {
        const current = previous || initialProgressResult
        if (event.type === 'placementPlan') {
          return {
            ...current,
            placementPlan: event.placementPlan,
            placementPrompt: event.placementPrompt,
            placementRawText: event.placementRawText,
          }
        }
        if (event.type === 'assetPrompts') {
          return {
            ...current,
            scenePrompt: event.scenePrompt,
            characterAPrompt: event.characterAPrompt,
            characterBPrompt: event.characterBPrompt,
          }
        }
        if (event.type === 'asset') {
          if (event.asset === 'scene') {
            return {
              ...current,
              scenePrompt: event.prompt,
              sceneImageUrl: event.imageUrl,
              sceneStorageKey: event.storageKey,
            }
          }
          if (event.asset === 'characterA') {
            return {
              ...current,
              characterAPrompt: event.prompt,
              characterAImageUrl: event.imageUrl,
              characterAStorageKey: event.storageKey,
            }
          }
          return {
            ...current,
            characterBPrompt: event.prompt,
            characterBImageUrl: event.imageUrl,
            characterBStorageKey: event.storageKey,
          }
        }
        return {
          ...current,
          finalImages: upsertFinalImage(current.finalImages, event.image),
          totalFinalImageCount: event.totalFinalImageCount,
        }
      })
    }
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
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null)
        throw new Error(readErrorMessage(payload, response.statusText))
      }
      if (!response.body) throw new Error('TEXT_PLACEMENT_TEST_STREAM_MISSING')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let completed = false
      while (!completed) {
        const chunk = await reader.read()
        completed = chunk.done
        buffer += decoder.decode(chunk.value, { stream: !chunk.done })
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() || ''
        for (const block of blocks) {
          const parsed = parseStreamEventBlock(block)
          if (!isTextPlacementTestStreamEvent(parsed)) throw new Error('INVALID_TEXT_PLACEMENT_TEST_STREAM_EVENT')
          applyStreamEvent(parsed)
        }
      }
      if (buffer.trim()) {
        const parsed = parseStreamEventBlock(buffer)
        if (!isTextPlacementTestStreamEvent(parsed)) throw new Error('INVALID_TEXT_PLACEMENT_TEST_STREAM_EVENT')
        applyStreamEvent(parsed)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setIsRunning(false)
    }
  }, [imageModelKey, llmModelKey, locale, storyPrompt])

  const displayResult = result || progressResult

  const applyRetriedAsset = useCallback((asset: TextPlacementAssetKind, payload: RetryAssetPayload) => {
    setResult(null)
    setProgressResult((previous) => {
      const current = previous || displayResult || {
        llmModelKey,
        imageModelKey,
        finalImages: [],
      }
      if (asset === 'scene') {
        return {
          ...current,
          scenePrompt: payload.prompt,
          sceneImageUrl: payload.imageUrl,
          sceneStorageKey: payload.storageKey,
          finalImages: [],
          totalFinalImageCount: current.placementPlan?.shots.length,
        }
      }
      if (asset === 'characterA') {
        return {
          ...current,
          characterAPrompt: payload.prompt,
          characterAImageUrl: payload.imageUrl,
          characterAStorageKey: payload.storageKey,
          finalImages: [],
          totalFinalImageCount: current.placementPlan?.shots.length,
        }
      }
      return {
        ...current,
        characterBPrompt: payload.prompt,
        characterBImageUrl: payload.imageUrl,
        characterBStorageKey: payload.storageKey,
        finalImages: [],
        totalFinalImageCount: current.placementPlan?.shots.length,
      }
    })
  }, [displayResult, imageModelKey, llmModelKey])

  const applyRetriedFinalImage = useCallback((image: TextPlacementFinalImageResult) => {
    setResult(null)
    setProgressResult((previous) => {
      const current = previous || displayResult || {
        llmModelKey,
        imageModelKey,
        finalImages: [],
      }
      return {
        ...current,
        finalImages: upsertFinalImage(current.finalImages, image),
        totalFinalImageCount: current.placementPlan?.shots.length || current.totalFinalImageCount,
      }
    })
  }, [displayResult, imageModelKey, llmModelKey])

  const postRetry = useCallback(async (body: Record<string, unknown>): Promise<RetryResponse> => {
    const response = await fetch('/api/user/text-placement-test/retry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...body,
        locale,
      }),
    })
    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok) throw new Error(readErrorMessage(payload, response.statusText))
    if (!isRetryResponse(payload)) throw new Error('INVALID_TEXT_PLACEMENT_TEST_RETRY_RESPONSE')
    return payload
  }, [locale])

  const handleRetryAsset = useCallback(async (asset: TextPlacementAssetKind) => {
    if (!displayResult || isRunning || isRetrying) return
    const prompt = getAssetPrompt(displayResult, asset)
    if (!prompt) {
      setError('TEXT_PLACEMENT_TEST_RETRY_ASSET_PROMPT_MISSING')
      return
    }
    setRetryingKey(`asset:${asset}`)
    setError(null)
    try {
      const payload = await postRetry({
        type: 'asset',
        imageModelKey,
        asset,
        prompt,
      })
      if (payload.type !== 'asset') throw new Error('TEXT_PLACEMENT_TEST_RETRY_ASSET_RESPONSE_INVALID')
      applyRetriedAsset(asset, payload.asset)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setRetryingKey(null)
    }
  }, [applyRetriedAsset, displayResult, imageModelKey, isRetrying, isRunning, postRetry])

  const retryFinalShot = useCallback(async (shot: TextPlacementShot): Promise<TextPlacementFinalImageResult> => {
    if (!displayResult?.sceneImageUrl || !displayResult.characterAImageUrl || !displayResult.characterBImageUrl) {
      throw new Error('TEXT_PLACEMENT_TEST_RETRY_REFERENCES_MISSING')
    }
    const payload = await postRetry({
      type: 'finalImage',
      storyPrompt: storyPrompt.trim(),
      imageModelKey,
      shot,
      referenceImages: [
        displayResult.sceneImageUrl,
        displayResult.characterAImageUrl,
        displayResult.characterBImageUrl,
      ],
    })
    if (payload.type !== 'finalImage') throw new Error('TEXT_PLACEMENT_TEST_RETRY_FINAL_RESPONSE_INVALID')
    applyRetriedFinalImage(payload.image)
    return payload.image
  }, [applyRetriedFinalImage, displayResult, imageModelKey, postRetry, storyPrompt])

  const handleRetryFinalShot = useCallback(async (shot: TextPlacementShot) => {
    if (isRunning || isRetrying) return
    setRetryingKey(`final:${shot.shotNumber}`)
    setError(null)
    try {
      await retryFinalShot(shot)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setRetryingKey(null)
    }
  }, [isRetrying, isRunning, retryFinalShot])

  const handleRetryMissingFinalShots = useCallback(async () => {
    if (!displayResult?.placementPlan || isRunning || isRetrying) return
    const missingShots = displayResult.placementPlan.shots.filter((shot) => !getFinalImageByShot(displayResult.finalImages, shot.shotNumber))
    if (missingShots.length === 0) return
    setRetryingKey('final:missing')
    setError(null)
    try {
      const settled = await Promise.allSettled(missingShots.map((shot) => retryFinalShot(shot)))
      const failures = settled.filter((item): item is PromiseRejectedResult => item.status === 'rejected')
      if (failures.length > 0) {
        throw new Error(failures.map((failure) => failure.reason instanceof Error ? failure.reason.message : String(failure.reason)).join(' | '))
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setRetryingKey(null)
    }
  }, [displayResult, isRetrying, isRunning, retryFinalShot])

  const handleClearSavedState = useCallback(() => {
    void clearTextPlacementTestState().catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : String(caught))
    })
    setStoryPrompt('')
    setResult(null)
    setProgressResult(null)
    setError(null)
  }, [])

  const finalImageCountLabel = displayResult
    ? `${displayResult.finalImages.length}${displayResult.totalFinalImageCount ? `/${displayResult.totalFinalImageCount}` : ''}`
    : '0'
  const finalShots = displayResult?.placementPlan?.shots || []
  const missingFinalShotCount = displayResult?.placementPlan
    ? displayResult.placementPlan.shots.filter((shot) => !getFinalImageByShot(displayResult.finalImages, shot.shotNumber)).length
    : 0
  const canRetryFinalImages = !!displayResult?.placementPlan
    && !!displayResult.sceneImageUrl
    && !!displayResult.characterAImageUrl
    && !!displayResult.characterBImageUrl
    && !isRunning
    && !isRetrying

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
            <button
              type="button"
              disabled={isRunning || isRetrying || (!displayResult && !storyPrompt.trim() && !error)}
              className="flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={handleClearSavedState}
            >
              <AppIcon name="trash" className="h-4 w-4" />
              {t('clearSavedTest')}
            </button>

            {error ? <p className="max-h-48 overflow-auto rounded-md border border-red-200 bg-red-50 p-2 text-xs leading-5 text-red-700">{error}</p> : null}
            {displayResult ? (
              <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                <span>{t('llmModel')}: {displayResult.llmModelKey}</span>
                <span>{t('imageModel')}: {displayResult.imageModelKey}</span>
                <span>{t('progressPlacementPlan')}: {displayResult.placementPlan ? t('progressDone') : t('progressPending')}</span>
                <span>{t('progressSceneAsset')}: {displayResult.sceneImageUrl ? t('progressDone') : t('progressPending')}</span>
                <span>{t('progressCharacterAAsset')}: {displayResult.characterAImageUrl ? t('progressDone') : t('progressPending')}</span>
                <span>{t('progressCharacterBAsset')}: {displayResult.characterBImageUrl ? t('progressDone') : t('progressPending')}</span>
                <span>{t('finalImageCount')}: {finalImageCountLabel}</span>
              </div>
            ) : null}
          </aside>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <ImagePanel
              title={t('sceneAsset')}
              empty={t('emptyScene')}
              imageUrl={displayResult?.sceneImageUrl || null}
              storageKey={displayResult?.sceneStorageKey}
              actionLabel={t('retry')}
              actionDisabled={!displayResult?.scenePrompt || isRunning || isRetrying}
              actionBusy={retryingKey === 'asset:scene'}
              onAction={() => void handleRetryAsset('scene')}
            />
            <ImagePanel
              title={t('characterAAsset')}
              empty={t('emptyCharacterA')}
              imageUrl={displayResult?.characterAImageUrl || null}
              storageKey={displayResult?.characterAStorageKey}
              actionLabel={t('retry')}
              actionDisabled={!displayResult?.characterAPrompt || isRunning || isRetrying}
              actionBusy={retryingKey === 'asset:characterA'}
              onAction={() => void handleRetryAsset('characterA')}
            />
            <ImagePanel
              title={t('characterBAsset')}
              empty={t('emptyCharacterB')}
              imageUrl={displayResult?.characterBImageUrl || null}
              storageKey={displayResult?.characterBStorageKey}
              actionLabel={t('retry')}
              actionDisabled={!displayResult?.characterBPrompt || isRunning || isRetrying}
              actionBusy={retryingKey === 'asset:characterB'}
              onAction={() => void handleRetryAsset('characterB')}
            />
            {finalShots.length ? (
              <section className="grid gap-3 lg:col-span-2">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-slate-900">{t('finalImageSequence')}</h2>
                  <button
                    type="button"
                    disabled={!canRetryFinalImages || missingFinalShotCount === 0}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => void handleRetryMissingFinalShots()}
                  >
                    <AppIcon name={retryingKey === 'final:missing' ? 'loader' : 'refresh'} className={`h-3.5 w-3.5 ${retryingKey === 'final:missing' ? 'animate-spin' : ''}`} />
                    {t('retryMissingFinalImages')}
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                  {finalShots.map((shot) => {
                    const image = getFinalImageByShot(displayResult?.finalImages || [], shot.shotNumber)
                    return (
                      <FinalShotPanel
                        key={shot.shotNumber}
                        title={`${shot.shotNumber}. ${shot.shotLabel}`}
                        image={image}
                        empty={t('emptyFinalShot')}
                        actionLabel={t('retry')}
                        actionDisabled={!canRetryFinalImages}
                        actionBusy={retryingKey === `final:${shot.shotNumber}`}
                        onAction={() => void handleRetryFinalShot(shot)}
                      />
                    )
                  })}
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
              value={displayResult?.placementPlan ? JSON.stringify(displayResult.placementPlan, null, 2) : ''}
              empty={t('emptyText')}
            />
            <TextPanel title={t('placementPrompt')} value={displayResult?.placementPrompt || ''} empty={t('emptyText')} />
            <TextPanel title={t('scenePrompt')} value={displayResult?.scenePrompt || ''} empty={t('emptyText')} />
            <TextPanel title={t('characterAPrompt')} value={displayResult?.characterAPrompt || ''} empty={t('emptyText')} />
            <TextPanel title={t('characterBPrompt')} value={displayResult?.characterBPrompt || ''} empty={t('emptyText')} />
            <TextPanel
              title={t('finalPrompts')}
              value={displayResult?.finalImages.map((image) => [
                `# ${image.shotNumber}. ${image.shotLabel}`,
                image.prompt,
              ].join('\n')).join('\n\n') || ''}
              empty={t('emptyText')}
            />
            <TextPanel title={t('rawPlan')} value={displayResult?.placementRawText || ''} empty={t('emptyText')} />
          </div>
        </section>
      </div>
    </main>
  )
}
