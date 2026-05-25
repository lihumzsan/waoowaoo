'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import {
  buildCoordinateAnalysisPrompt,
  buildCoordinateCameraGenerationPrompt,
} from '@/lib/coordinate-placement-test/prompt'
import {
  coordinatePlacementAnalysisSequenceSchema,
  type CoordinatePlacementAnalysisSequence,
  type CoordinateFinalPromptVariant,
  type CoordinateReferenceMode,
  type CoordinatePlacementShot,
} from '@/lib/coordinate-placement-test/types'
import type { Locale } from '@/i18n/routing'
import { useUserModels } from '@/lib/query/hooks'
import { AppIcon } from '@/components/ui/icons'
import { FileInput, PreviewPanel } from './CoordinatePlacementPanels'
import {
  buildCameraMarkerReference,
  buildCoordinateReference,
  readFileAsDataUrl,
} from './coordinate-reference'

type GridPresetId = '12x8' | '16x9' | '24x14'

interface GridPreset {
  readonly id: GridPresetId
  readonly columns: number
  readonly rows: number
}

interface AnalyzeResponse {
  readonly success: true
  readonly modelKey: string
  readonly finalPrompt: string
  readonly analysis: CoordinatePlacementAnalysisSequence
  readonly rawText: string
}

interface ReferenceViewsResponse {
  readonly success: true
  readonly modelKey: string
  readonly floorPlanImageUrl: string
  readonly floorPlanImageDataUrl: string
  readonly floorPlanStorageKey: string
  readonly threeViewImageUrl: string
  readonly threeViewImageDataUrl: string
  readonly threeViewStorageKey: string
  readonly floorPlanPrompt: string
  readonly threeViewPrompt: string
}

interface GeneratedResponse {
  readonly success: true
  readonly imageUrl: string
  readonly storageKey: string
  readonly modelKey: string
  readonly shotNumber: number
  readonly shotLabel: string
  readonly promptVariant: CoordinateFinalPromptVariant
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

const ACTIVE_FINAL_PROMPT_VARIANT: CoordinateFinalPromptVariant = 'camera_ray_cast'
const FINAL_PROMPT_VARIANTS: readonly CoordinateFinalPromptVariant[] = [ACTIVE_FINAL_PROMPT_VARIANT]

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isAnalyzeResponse(value: unknown): value is AnalyzeResponse {
  if (!isRecord(value)) return false
  return value.success === true
    && typeof value.modelKey === 'string'
    && typeof value.finalPrompt === 'string'
    && typeof value.rawText === 'string'
    && coordinatePlacementAnalysisSequenceSchema.safeParse(value.analysis).success
}

function isReferenceViewsResponse(value: unknown): value is ReferenceViewsResponse {
  if (!isRecord(value)) return false
  return value.success === true
    && typeof value.modelKey === 'string'
    && typeof value.floorPlanImageUrl === 'string'
    && typeof value.floorPlanImageDataUrl === 'string'
    && typeof value.floorPlanStorageKey === 'string'
    && typeof value.threeViewImageUrl === 'string'
    && typeof value.threeViewImageDataUrl === 'string'
    && typeof value.threeViewStorageKey === 'string'
    && typeof value.floorPlanPrompt === 'string'
    && typeof value.threeViewPrompt === 'string'
}

function isGeneratedResponse(value: unknown): value is GeneratedResponse {
  if (!isRecord(value)) return false
  return value.success === true
    && typeof value.imageUrl === 'string'
    && typeof value.storageKey === 'string'
    && typeof value.modelKey === 'string'
    && Number.isInteger(value.shotNumber)
    && typeof value.shotLabel === 'string'
    && FINAL_PROMPT_VARIANTS.includes(value.promptVariant as CoordinateFinalPromptVariant)
    && typeof value.finalPrompt === 'string'
}

function readErrorMessage(payload: unknown, fallback: string): string {
  return isRecord(payload) ? JSON.stringify(payload) : fallback
}

function parseAnalysisJson(value: string): CoordinatePlacementAnalysisSequence | null {
  try {
    return coordinatePlacementAnalysisSequenceSchema.parse(JSON.parse(value))
  } catch {
    return null
  }
}

export function CoordinatePlacementTestClient() {
  const t = useTranslations('coordinateTest')
  const locale = useLocale()
  const promptLocale: Locale = locale === 'en' ? 'en' : 'zh'
  const userModels = useUserModels()
  const [sceneImage, setSceneImage] = useState<ImageState | null>(null)
  const [floorPlanImage, setFloorPlanImage] = useState<ImageState | null>(null)
  const [threeViewImage, setThreeViewImage] = useState<ImageState | null>(null)
  const [characterImage, setCharacterImage] = useState<ImageState | null>(null)
  const [referenceMode, setReferenceMode] = useState<CoordinateReferenceMode>('overlay')
  const [gridPresetId, setGridPresetId] = useState<GridPresetId>('16x9')
  const [llmModelKey, setLlmModelKey] = useState('')
  const [imageModelKey, setImageModelKey] = useState('')
  const [coordinatePreview, setCoordinatePreview] = useState<string | null>(null)
  const [cameraPreviewsByShot, setCameraPreviewsByShot] = useState<Partial<Record<number, string>>>({})
  const [analysisJson, setAnalysisJson] = useState('')
  const [analysisResult, setAnalysisResult] = useState<AnalyzeResponse | null>(null)
  const [referenceViewsResult, setReferenceViewsResult] = useState<ReferenceViewsResponse | null>(null)
  const [generatedByShot, setGeneratedByShot] = useState<Partial<Record<number, GeneratedResponse>>>({})
  const [generatingShotNumbers, setGeneratingShotNumbers] = useState<readonly number[]>([])
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [referenceViewsError, setReferenceViewsError] = useState<string | null>(null)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [isBuildingPreview, setIsBuildingPreview] = useState(false)
  const [isGeneratingReferenceViews, setIsGeneratingReferenceViews] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  const gridPreset = useMemo(
    () => GRID_PRESETS.find((item) => item.id === gridPresetId) || GRID_PRESETS[1],
    [gridPresetId],
  )

  const parsedAnalysis = useMemo(() => parseAnalysisJson(analysisJson), [analysisJson])

  useEffect(() => {
    if (!llmModelKey && userModels.data?.llm[0]?.value) setLlmModelKey(userModels.data.llm[0].value)
    if (!imageModelKey && userModels.data?.image[0]?.value) setImageModelKey(userModels.data.image[0].value)
  }, [imageModelKey, llmModelKey, userModels.data?.image, userModels.data?.llm])

  const analysisPromptPreview = useMemo(() => buildCoordinateAnalysisPrompt({
    coordinateReferenceImage: 'data:image/png;base64,PREVIEW',
    userPrompt: '',
    referenceMode,
    llmModelKey: llmModelKey || 'MODEL_NOT_SELECTED',
    grid: {
      columns: gridPreset.columns,
      rows: gridPreset.rows,
    },
  }, promptLocale), [
    gridPreset.columns,
    gridPreset.rows,
    llmModelKey,
    promptLocale,
    referenceMode,
  ])

  const imagePromptPreviews = useMemo(() => {
    if (!parsedAnalysis) return {}
    return Object.fromEntries(parsedAnalysis.shots.map((shot) => [shot.shotNumber, buildCoordinateCameraGenerationPrompt({
      cameraReferenceImage: 'data:image/png;base64,PREVIEW',
      threeViewReferenceImage: 'data:image/png;base64,PREVIEW',
      characterImage: 'data:image/png;base64,PREVIEW',
      userPrompt: '',
      imageModelKey: imageModelKey || 'MODEL_NOT_SELECTED',
      promptVariant: ACTIVE_FINAL_PROMPT_VARIANT,
      grid: {
        columns: gridPreset.columns,
        rows: gridPreset.rows,
      },
      analysis: shot,
    }, promptLocale)])) as Partial<Record<number, string>>
  }, [
    gridPreset.columns,
    gridPreset.rows,
    imageModelKey,
    parsedAnalysis,
    promptLocale,
  ])

  const rebuildCoordinatePreview = useCallback(async () => {
    if (!floorPlanImage) {
      setCoordinatePreview(null)
      setPreviewError(null)
      return
    }
    setIsBuildingPreview(true)
    setPreviewError(null)
    try {
      const preview = await buildCoordinateReference({
        sceneImage: floorPlanImage.dataUrl,
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
  }, [floorPlanImage, gridPreset.columns, gridPreset.rows, referenceMode])

  useEffect(() => {
    void rebuildCoordinatePreview()
  }, [rebuildCoordinatePreview])

  useEffect(() => {
    if (!floorPlanImage || !parsedAnalysis) {
      setCameraPreviewsByShot({})
      return
    }
    const shots = parsedAnalysis.shots
    const floorPlanImageDataUrl = floorPlanImage.dataUrl
    let cancelled = false
    async function rebuildCameraPreview() {
      try {
        const previews = await Promise.all(shots.map(async (shot) => {
          const preview = await buildCameraMarkerReference({
            sceneImage: floorPlanImageDataUrl,
            columns: gridPreset.columns,
            rows: gridPreset.rows,
            analysis: shot,
          })
          return [shot.shotNumber, preview] as const
        }))
        if (!cancelled) setCameraPreviewsByShot(Object.fromEntries(previews))
      } catch (error) {
        if (!cancelled) {
          setCameraPreviewsByShot({})
          setPreviewError(error instanceof Error ? error.message : String(error))
        }
      }
    }
    void rebuildCameraPreview()
    return () => { cancelled = true }
  }, [floorPlanImage, gridPreset.columns, gridPreset.rows, parsedAnalysis])

  const handleImageInput = useCallback(async (
    event: ChangeEvent<HTMLInputElement>,
    setter: (image: ImageState | null) => void,
    options: { readonly resetSceneReferences: boolean },
  ) => {
    const file = event.currentTarget.files?.[0]
    if (!file) {
      setter(null)
      return
    }
    const dataUrl = await readFileAsDataUrl(file)
    setter({ dataUrl, fileName: file.name })
    if (options.resetSceneReferences) {
      setFloorPlanImage(null)
      setThreeViewImage(null)
      setReferenceViewsResult(null)
    }
    setAnalysisResult(null)
    setAnalysisJson('')
    setGeneratedByShot({})
  }, [])

  const referenceViewsDisabled = !sceneImage || !imageModelKey || isGeneratingReferenceViews
  const analyzeDisabled = !floorPlanImage || !coordinatePreview || !llmModelKey || isAnalyzing
  const generateDisabled = !threeViewImage || !characterImage || !parsedAnalysis || parsedAnalysis.shots.length === 0 || !imageModelKey
  const isGeneratingAnyShot = generatingShotNumbers.length > 0

  const handleGenerateReferenceViews = useCallback(async () => {
    if (!sceneImage || !imageModelKey) return
    setIsGeneratingReferenceViews(true)
    setReferenceViewsError(null)
    setReferenceViewsResult(null)
    setFloorPlanImage(null)
    setThreeViewImage(null)
    setAnalysisResult(null)
    setAnalysisJson('')
    setGeneratedByShot({})
    try {
      const response = await fetch('/api/user/coordinate-placement-test/reference-views', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sceneImage: sceneImage.dataUrl,
          locale,
          imageModelKey,
        }),
      })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(readErrorMessage(payload, response.statusText))
      if (!isReferenceViewsResponse(payload)) throw new Error('INVALID_REFERENCE_VIEWS_RESPONSE')
      setReferenceViewsResult(payload)
      setFloorPlanImage({ dataUrl: payload.floorPlanImageDataUrl, fileName: t('generatedFloorPlan') })
      setThreeViewImage({ dataUrl: payload.threeViewImageDataUrl, fileName: t('generatedThreeView') })
    } catch (error) {
      setReferenceViewsError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsGeneratingReferenceViews(false)
    }
  }, [
    imageModelKey,
    locale,
    sceneImage,
    t,
  ])

  const handleAnalyze = useCallback(async () => {
    if (!coordinatePreview || !llmModelKey) return
    setIsAnalyzing(true)
    setAnalysisError(null)
    setAnalysisResult(null)
    setGeneratedByShot({})
    try {
      const response = await fetch('/api/user/coordinate-placement-test/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          coordinateReferenceImage: coordinatePreview,
          locale,
          referenceMode,
          llmModelKey,
          grid: {
            columns: gridPreset.columns,
            rows: gridPreset.rows,
          },
        }),
      })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(readErrorMessage(payload, response.statusText))
      if (!isAnalyzeResponse(payload)) throw new Error('INVALID_ANALYZE_RESPONSE')
      setAnalysisResult(payload)
      setAnalysisJson(JSON.stringify(payload.analysis, null, 2))
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsAnalyzing(false)
    }
  }, [
    coordinatePreview,
    gridPreset.columns,
    gridPreset.rows,
    llmModelKey,
    locale,
    referenceMode,
  ])

  const handleGenerateShot = useCallback(async (shot: CoordinatePlacementShot) => {
    const cameraPreview = cameraPreviewsByShot[shot.shotNumber]
    if (!cameraPreview || !threeViewImage || !characterImage || !imageModelKey) return
    const threeViewImageDataUrl = threeViewImage.dataUrl
    setGeneratingShotNumbers((current) => current.includes(shot.shotNumber) ? current : [...current, shot.shotNumber])
    setGenerateError(null)
    try {
      const response = await fetch('/api/user/coordinate-placement-test/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cameraReferenceImage: cameraPreview,
          threeViewReferenceImage: threeViewImageDataUrl,
          characterImage: characterImage.dataUrl,
          locale,
          imageModelKey,
          promptVariant: ACTIVE_FINAL_PROMPT_VARIANT,
          grid: {
            columns: gridPreset.columns,
            rows: gridPreset.rows,
          },
          analysis: shot,
        }),
      })
      const payload: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(readErrorMessage(payload, response.statusText))
      if (!isGeneratedResponse(payload)) throw new Error('INVALID_GENERATE_RESPONSE')
      setGeneratedByShot((current) => ({ ...current, [shot.shotNumber]: payload }))
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : String(error))
    } finally {
      setGeneratingShotNumbers((current) => current.filter((shotNumber) => shotNumber !== shot.shotNumber))
    }
  }, [
    cameraPreviewsByShot,
    characterImage,
    gridPreset.columns,
    gridPreset.rows,
    imageModelKey,
    locale,
    threeViewImage,
  ])

  const handleGenerateAll = useCallback(async () => {
    if (!parsedAnalysis) return
    await Promise.all(parsedAnalysis.shots.map((shot) => handleGenerateShot(shot)))
  }, [handleGenerateShot, parsedAnalysis])

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-5 py-6">
        <header className="flex flex-col gap-2 border-b border-slate-200 pb-5">
          <p className="text-sm font-semibold text-cyan-700">{t('eyebrow')}</p>
          <h1 className="text-2xl font-semibold tracking-normal">{t('title')}</h1>
          <p className="max-w-3xl text-sm leading-6 text-slate-600">{t('subtitle')}</p>
        </header>

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-[410px_minmax(0,1fr)]">
          <aside className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid gap-3">
              <FileInput
                label={t('sceneImage')}
                value={sceneImage?.fileName || t('emptyFile')}
                icon={<AppIcon name="image" className="h-4 w-4" />}
                onChange={(event) => void handleImageInput(event, setSceneImage, { resetSceneReferences: true })}
              />
              <FileInput
                label={t('characterImage')}
                value={characterImage?.fileName || t('emptyFile')}
                icon={<AppIcon name="upload" className="h-4 w-4" />}
                onChange={(event) => void handleImageInput(event, setCharacterImage, { resetSceneReferences: false })}
              />
            </div>

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

            <button
              type="button"
              disabled={referenceViewsDisabled}
              className="flex h-11 items-center justify-center gap-2 rounded-md bg-cyan-800 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              onClick={() => void handleGenerateReferenceViews()}
            >
              {isGeneratingReferenceViews ? <AppIcon name="loader" className="h-4 w-4 animate-spin" /> : <AppIcon name="image" className="h-4 w-4" />}
              {isGeneratingReferenceViews ? t('generatingReferenceViews') : t('generateReferenceViews')}
            </button>

            <button
              type="button"
              disabled={analyzeDisabled}
              className="flex h-11 items-center justify-center gap-2 rounded-md bg-cyan-700 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              onClick={() => void handleAnalyze()}
            >
              {isAnalyzing ? <AppIcon name="loader" className="h-4 w-4 animate-spin" /> : <AppIcon name="crosshair" className="h-4 w-4" />}
              {isAnalyzing ? t('analyzing') : t('analyzeSequence')}
            </button>

            <button
              type="button"
              disabled={generateDisabled || isGeneratingAnyShot}
              className="flex h-11 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              onClick={() => void handleGenerateAll()}
            >
              {isGeneratingAnyShot ? <AppIcon name="loader" className="h-4 w-4 animate-spin" /> : <AppIcon name="sparklesAlt" className="h-4 w-4" />}
              {isGeneratingAnyShot ? t('generatingSequence') : t('generateSequenceResults')}
            </button>

            <button
              type="button"
              className="flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm text-slate-700"
              onClick={() => void rebuildCoordinatePreview()}
            >
              <AppIcon name="refresh" className="h-4 w-4" />
              {t('rebuildPreview')}
            </button>

            {previewError ? <p className="text-sm text-red-600">{previewError}</p> : null}
            {referenceViewsError ? <p className="max-h-40 overflow-auto rounded-md border border-red-200 bg-red-50 p-2 text-xs leading-5 text-red-700">{referenceViewsError}</p> : null}
            {analysisError ? <p className="max-h-40 overflow-auto rounded-md border border-red-200 bg-red-50 p-2 text-xs leading-5 text-red-700">{analysisError}</p> : null}
            {generateError ? <p className="max-h-40 overflow-auto rounded-md border border-red-200 bg-red-50 p-2 text-xs leading-5 text-red-700">{generateError}</p> : null}
          </aside>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <PreviewPanel
              title={t('floorPlanPreview')}
              loading={isGeneratingReferenceViews}
              empty={t('emptyFloorPlan')}
              imageUrl={floorPlanImage?.dataUrl || null}
            />
            <PreviewPanel
              title={t('threeViewPreview')}
              loading={isGeneratingReferenceViews}
              empty={t('emptyThreeView')}
              imageUrl={threeViewImage?.dataUrl || null}
            />
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
            {parsedAnalysis?.shots.map((shot) => (
              <PreviewPanel
                key={`camera-${shot.shotNumber}`}
                title={t('shotCameraTitle', { number: shot.shotNumber, label: shot.shotLabel })}
                empty={t('emptyCameraPreview')}
                imageUrl={cameraPreviewsByShot[shot.shotNumber] || null}
              />
            ))}
            {parsedAnalysis?.shots.map((shot) => (
              <PreviewPanel
                key={`result-${shot.shotNumber}`}
                title={t('shotResultTitle', { number: shot.shotNumber, label: shot.shotLabel })}
                loading={generatingShotNumbers.includes(shot.shotNumber)}
                empty={t('emptyResult')}
                imageUrl={generatedByShot[shot.shotNumber]?.imageUrl || null}
              />
            ))}

            {referenceViewsResult ? (
              <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm lg:col-span-2">
                <div className="grid gap-3">
                  <div className="flex flex-wrap gap-3 text-slate-600">
                    <span>{t('model')}: {referenceViewsResult.modelKey}</span>
                    <span>{t('floorPlanStorageKey')}: {referenceViewsResult.floorPlanStorageKey}</span>
                    <span>{t('threeViewStorageKey')}: {referenceViewsResult.threeViewStorageKey}</span>
                  </div>
                  <pre className="max-h-44 overflow-auto rounded-md bg-slate-950 p-3 text-xs leading-5 text-slate-100">{referenceViewsResult.floorPlanPrompt}</pre>
                  <pre className="max-h-44 overflow-auto rounded-md bg-slate-950 p-3 text-xs leading-5 text-slate-100">{referenceViewsResult.threeViewPrompt}</pre>
                </div>
              </section>
            ) : null}

            <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm lg:col-span-2">
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center justify-between gap-3 text-slate-600">
                  <span className="font-medium text-slate-800">{t('analysisJson')}</span>
                  {analysisResult ? <span>{t('serverPromptReturned')}: {analysisResult.modelKey}</span> : <span>{t('editableAfterAnalyze')}</span>}
                </div>
                <textarea
                  className="min-h-48 resize-y rounded-md border border-slate-300 bg-white p-3 font-mono text-xs leading-5 outline-none ring-cyan-500 focus:ring-2"
                  value={analysisJson}
                  placeholder={t('analysisJsonPlaceholder')}
                  onChange={(event) => setAnalysisJson(event.currentTarget.value)}
                />
                {analysisJson && !parsedAnalysis ? <p className="text-xs text-red-600">{t('analysisJsonInvalid')}</p> : null}
                {analysisResult ? <pre className="max-h-32 overflow-auto rounded-md bg-slate-100 p-3 text-xs leading-5 text-slate-700">{analysisResult.rawText}</pre> : null}
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm lg:col-span-2">
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center justify-between gap-3 text-slate-600">
                  <span className="font-medium text-slate-800">{t('analysisPrompt')}</span>
                  <span>{analysisResult ? t('serverPromptReturned') : t('clientPromptPreview')}</span>
                </div>
                <pre className="max-h-52 overflow-auto rounded-md bg-slate-950 p-3 text-xs leading-5 text-slate-100">{analysisResult?.finalPrompt || analysisPromptPreview}</pre>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm lg:col-span-2">
              <div className="grid gap-4">
                <div className="flex flex-wrap items-center justify-between gap-3 text-slate-600">
                  <span className="font-medium text-slate-800">{t('finalPrompt')}</span>
                  <button
                    type="button"
                    disabled={generateDisabled || isGeneratingAnyShot}
                    className="rounded-md bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                    onClick={() => void handleGenerateAll()}
                  >
                    {isGeneratingAnyShot ? t('generatingSequence') : t('generateSequenceResults')}
                  </button>
                </div>
                {!parsedAnalysis ? <p className="text-sm text-slate-500">{t('analysisRequiredForImagePrompt')}</p> : null}
                {parsedAnalysis?.shots.map((shot) => {
                  const generated = generatedByShot[shot.shotNumber]
                  const isGeneratingShot = generatingShotNumbers.includes(shot.shotNumber)
                  return (
                    <div key={shot.shotNumber} className="grid gap-2 rounded-md border border-slate-200 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-900">{t('shotPromptTitle', { number: shot.shotNumber, label: shot.shotLabel })}</h3>
                          <p className="text-xs text-slate-500">{shot.shotIntent}</p>
                        </div>
                        <button
                          type="button"
                          disabled={generateDisabled || isGeneratingShot}
                          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:text-slate-300"
                          onClick={() => void handleGenerateShot(shot)}
                        >
                          {isGeneratingShot ? t('generating') : t('generateThisShot')}
                        </button>
                      </div>
                      <pre className="max-h-72 overflow-auto rounded-md bg-slate-950 p-3 text-xs leading-5 text-slate-100">{generated?.finalPrompt || imagePromptPreviews[shot.shotNumber] || t('analysisRequiredForImagePrompt')}</pre>
                      {generated ? (
                        <div className="flex flex-wrap gap-3 text-xs text-slate-600">
                          <span>{t('model')}: {generated.modelKey}</span>
                          <span>{t('storageKey')}: {generated.storageKey}</span>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  )
}
