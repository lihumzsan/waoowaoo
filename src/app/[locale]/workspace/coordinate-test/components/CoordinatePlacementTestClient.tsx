'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { CoordinateReferenceMode } from '@/lib/coordinate-placement-test/types'
import { AppIcon } from '@/components/ui/icons'
import { FileInput, NumberField, PreviewPanel } from './CoordinatePlacementPanels'
import { buildCoordinateReference, clampInteger, readFileAsDataUrl } from './coordinate-reference'

type GridPresetId = '12x8' | '16x9' | '24x14'

interface GridPreset {
  readonly id: GridPresetId
  readonly columns: number
  readonly rows: number
}

interface GeneratedResponse {
  readonly success: true
  readonly imageUrl: string
  readonly storageKey: string
  readonly modelKey: string
  readonly finalPrompt: string
}

interface ImageState {
  readonly dataUrl: string
  readonly fileName: string
}

const GRID_PRESETS: readonly GridPreset[] = [
  { id: '12x8', columns: 12, rows: 8 },
  { id: '16x9', columns: 16, rows: 9 },
  { id: '24x14', columns: 24, rows: 14 },
]

function isGeneratedResponse(value: unknown): value is GeneratedResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.success === true
    && typeof record.imageUrl === 'string'
    && typeof record.storageKey === 'string'
    && typeof record.modelKey === 'string'
    && typeof record.finalPrompt === 'string'
}

export function CoordinatePlacementTestClient() {
  const t = useTranslations('coordinateTest')
  const locale = useLocale()
  const [sceneImage, setSceneImage] = useState<ImageState | null>(null)
  const [characterImage, setCharacterImage] = useState<ImageState | null>(null)
  const [referenceMode, setReferenceMode] = useState<CoordinateReferenceMode>('overlay')
  const [gridPresetId, setGridPresetId] = useState<GridPresetId>('16x9')
  const [targetX, setTargetX] = useState(8)
  const [targetY, setTargetY] = useState(5)
  const [userPrompt, setUserPrompt] = useState('')
  const [coordinatePreview, setCoordinatePreview] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [isBuildingPreview, setIsBuildingPreview] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generated, setGenerated] = useState<GeneratedResponse | null>(null)
  const [generateError, setGenerateError] = useState<string | null>(null)

  const gridPreset = useMemo(
    () => GRID_PRESETS.find((item) => item.id === gridPresetId) || GRID_PRESETS[1],
    [gridPresetId],
  )

  useEffect(() => {
    setTargetX((value) => clampInteger(value, 1, gridPreset.columns))
    setTargetY((value) => clampInteger(value, 1, gridPreset.rows))
  }, [gridPreset.columns, gridPreset.rows])

  const rebuildPreview = useCallback(async () => {
    if (!sceneImage) {
      setCoordinatePreview(null)
      setPreviewError(null)
      return
    }
    setIsBuildingPreview(true)
    setPreviewError(null)
    try {
      const preview = await buildCoordinateReference({
        sceneImage: sceneImage.dataUrl,
        mode: referenceMode,
        columns: gridPreset.columns,
        rows: gridPreset.rows,
      })
      setCoordinatePreview(preview)
    } catch (error) {
      setCoordinatePreview(null)
      setPreviewError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsBuildingPreview(false)
    }
  }, [gridPreset.columns, gridPreset.rows, referenceMode, sceneImage])

  useEffect(() => {
    void rebuildPreview()
  }, [rebuildPreview])

  const handleImageInput = useCallback(async (
    event: ChangeEvent<HTMLInputElement>,
    setter: (image: ImageState | null) => void,
  ) => {
    const file = event.currentTarget.files?.[0]
    if (!file) {
      setter(null)
      return
    }
    const dataUrl = await readFileAsDataUrl(file)
    setter({ dataUrl, fileName: file.name })
  }, [])

  const submitDisabled = !sceneImage || !characterImage || !coordinatePreview || !userPrompt.trim() || isGenerating

  const handleGenerate = useCallback(async () => {
    if (!sceneImage || !characterImage || !coordinatePreview || !userPrompt.trim()) return
    setIsGenerating(true)
    setGenerateError(null)
    setGenerated(null)
    try {
      const response = await fetch('/api/user/coordinate-placement-test/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          coordinateReferenceImage: coordinatePreview,
          characterImage: characterImage.dataUrl,
          userPrompt: userPrompt.trim(),
          locale,
          referenceMode,
          grid: {
            columns: gridPreset.columns,
            rows: gridPreset.rows,
          },
          target: {
            x: targetX,
            y: targetY,
          },
        }),
      })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const message = payload && typeof payload === 'object' && !Array.isArray(payload)
          ? JSON.stringify(payload)
          : response.statusText
        throw new Error(message)
      }
      if (!isGeneratedResponse(payload)) throw new Error('INVALID_GENERATE_RESPONSE')
      setGenerated(payload)
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsGenerating(false)
    }
  }, [
    characterImage,
    coordinatePreview,
    gridPreset.columns,
    gridPreset.rows,
    locale,
    referenceMode,
    sceneImage,
    targetX,
    targetY,
    userPrompt,
  ])

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-5 py-6">
        <header className="flex flex-col gap-2 border-b border-slate-200 pb-5">
          <p className="text-sm font-semibold text-cyan-700">{t('eyebrow')}</p>
          <h1 className="text-2xl font-semibold tracking-normal">{t('title')}</h1>
          <p className="max-w-3xl text-sm leading-6 text-slate-600">{t('subtitle')}</p>
        </header>

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-[390px_minmax(0,1fr)]">
          <aside className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid gap-3">
              <FileInput
                label={t('sceneImage')}
                value={sceneImage?.fileName || t('emptyFile')}
                icon={<AppIcon name="image" className="h-4 w-4" />}
                onChange={(event) => void handleImageInput(event, setSceneImage)}
              />
              <FileInput
                label={t('characterImage')}
                value={characterImage?.fileName || t('emptyFile')}
                icon={<AppIcon name="upload" className="h-4 w-4" />}
                onChange={(event) => void handleImageInput(event, setCharacterImage)}
              />
            </div>

            <div className="grid gap-2">
              <span className="text-sm font-medium text-slate-800">{t('referenceMode')}</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm ${referenceMode === 'overlay' ? 'border-cyan-600 bg-cyan-50 text-cyan-800' : 'border-slate-200 bg-white text-slate-700'}`}
                  onClick={() => setReferenceMode('overlay')}
                >
                  <AppIcon name="grid" className="h-4 w-4" />
                  {t('modes.overlay')}
                </button>
                <button
                  type="button"
                  className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm ${referenceMode === 'outer_axes' ? 'border-cyan-600 bg-cyan-50 text-cyan-800' : 'border-slate-200 bg-white text-slate-700'}`}
                  onClick={() => setReferenceMode('outer_axes')}
                >
                  <AppIcon name="crosshair" className="h-4 w-4" />
                  {t('modes.outerAxes')}
                </button>
              </div>
            </div>

            <label className="grid gap-2 text-sm">
              <span className="font-medium text-slate-800">{t('gridPreset')}</span>
              <select
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none ring-cyan-500 focus:ring-2"
                value={gridPresetId}
                onChange={(event) => setGridPresetId(event.currentTarget.value as GridPresetId)}
              >
                {GRID_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>{t(`presets.${preset.id}`)}</option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label={t('targetX')}
                value={targetX}
                min={1}
                max={gridPreset.columns}
                onChange={setTargetX}
              />
              <NumberField
                label={t('targetY')}
                value={targetY}
                min={1}
                max={gridPreset.rows}
                onChange={setTargetY}
              />
            </div>

            <label className="grid gap-2 text-sm">
              <span className="font-medium text-slate-800">{t('prompt')}</span>
              <textarea
                className="min-h-36 resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-6 outline-none ring-cyan-500 focus:ring-2"
                value={userPrompt}
                placeholder={t('promptPlaceholder')}
                onChange={(event) => setUserPrompt(event.currentTarget.value)}
              />
            </label>

            <button
              type="button"
              disabled={submitDisabled}
              className="flex h-11 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              onClick={() => void handleGenerate()}
            >
              {isGenerating ? <AppIcon name="loader" className="h-4 w-4 animate-spin" /> : <AppIcon name="sparklesAlt" className="h-4 w-4" />}
              {isGenerating ? t('generating') : t('generate')}
            </button>

            <button
              type="button"
              className="flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm text-slate-700"
              onClick={() => void rebuildPreview()}
            >
              <AppIcon name="refresh" className="h-4 w-4" />
              {t('rebuildPreview')}
            </button>

            {previewError ? <p className="text-sm text-red-600">{previewError}</p> : null}
            {generateError ? <p className="max-h-40 overflow-auto rounded-md border border-red-200 bg-red-50 p-2 text-xs leading-5 text-red-700">{generateError}</p> : null}
          </aside>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <PreviewPanel
              title={t('coordinatePreview')}
              loading={isBuildingPreview}
              empty={t('emptyPreview')}
              imageUrl={coordinatePreview}
            />
            <PreviewPanel
              title={t('characterPreview')}
              empty={t('emptyCharacter')}
              imageUrl={characterImage?.dataUrl || null}
            />
            <PreviewPanel
              title={t('result')}
              loading={isGenerating}
              empty={t('emptyResult')}
              imageUrl={generated?.imageUrl || null}
              className="lg:col-span-2"
            />
            {generated ? (
              <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm lg:col-span-2">
                <div className="grid gap-2">
                  <div className="flex flex-wrap gap-3 text-slate-600">
                    <span>{t('model')}: {generated.modelKey}</span>
                    <span>{t('storageKey')}: {generated.storageKey}</span>
                  </div>
                  <pre className="max-h-52 overflow-auto rounded-md bg-slate-950 p-3 text-xs leading-5 text-slate-100">{generated.finalPrompt}</pre>
                </div>
              </section>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  )
}
