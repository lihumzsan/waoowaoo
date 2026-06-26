'use client'

import React, { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useTranslations } from 'next-intl'
import ImagePreviewModal from '@/components/ui/ImagePreviewModal'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import { EstimatedTaskProgressInline } from '@/components/task/EstimatedTaskProgressOverlay'
import MediaGenerationLoading from '@/components/media/MediaGenerationLoading'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import EditScriptPreviewDetail from '../details/EditScriptPreviewDetail'
import { FieldGlyph, glyphForField } from './field-glyphs'
import type {
  WorkspaceCanvasAssetRef,
  WorkspaceCanvasEditAssetGroupItem,
  WorkspaceCanvasFlowNode,
  WorkspaceCanvasNodeAction,
  WorkspaceCanvasStreamPresentation,
  WorkspaceCanvasTextLine,
} from '../node-canvas-types'
import type { LocationSpatialProfileStatus } from '@/lib/location-spatial-profile/types'

function nodeIconName(kind: WorkspaceCanvasFlowNode['data']['kind']): AppIconName {
  switch (kind) {
    case 'analysis':
      return 'chart'
    case 'shot':
      return 'clapperboard'
    case 'imageAsset':
      return 'image'
    case 'videoClip':
      return 'video'
    case 'finalTimeline':
      return 'film'
    case 'editScreenplay':
      return 'bookOpen'
    case 'editStylePreview':
      return 'image'
    case 'editStyleBible':
      return 'sparklesAlt'
    case 'editDirectorDecoupage':
      return 'clapperboard'
    case 'editPipelineStep':
      return 'chart'
    case 'editProcessGroup':
      return 'grid'
    case 'editScript':
      return 'clipboardCheck'
    case 'editCinematographyShotPlan':
      return 'image'
    case 'spaceConsistency':
      return 'chart'
    case 'storyboardPanelGeneration':
      return 'clapperboard'
    case 'videoPlan':
      return 'clapperboard'
    case 'bgmScore':
      return 'audioWave'
    case 'editRequiredAsset':
      return 'package'
    case 'editAssetGroup':
      return 'package'
  }
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function nodeContentInteractionClass(data: WorkspaceCanvasFlowNode['data'], className: string): string {
  return data.readOnly === true ? className : `nodrag nowheel ${className}`
}

function nodeUsesInlineTaskProgress(kind: WorkspaceCanvasFlowNode['data']['kind']): boolean {
  return kind === 'videoPlan' || kind === 'bgmScore' || kind === 'finalTimeline'
}

export function videoElementAspectRatio(video: Pick<HTMLVideoElement, 'videoWidth' | 'videoHeight'>): number | null {
  const { videoWidth, videoHeight } = video
  if (!Number.isFinite(videoWidth) || !Number.isFinite(videoHeight)) return null
  if (videoWidth <= 0 || videoHeight <= 0) return null
  return videoWidth / videoHeight
}

const SELECTABLE_TEXT_CLASS = 'select-none'

type ImagePreviewHandler = (imageUrl: string) => void

const WorkspaceNodeImagePreviewContext = React.createContext<ImagePreviewHandler | null>(null)

function PreviewableImage({
  sourceImageUrl,
  displayImageUrl,
  alt,
  buttonClassName,
  imageClassName,
  imageStyle,
  onImageLoad,
}: {
  readonly sourceImageUrl: string
  readonly displayImageUrl?: string
  readonly alt: string
  readonly buttonClassName: string
  readonly imageClassName: string
  readonly imageStyle?: React.CSSProperties
  readonly onImageLoad?: React.ReactEventHandler<HTMLImageElement>
}) {
  const onPreviewImage = useContext(WorkspaceNodeImagePreviewContext)
  const resolvedDisplayImageUrl = displayImageUrl ?? toDisplayImageUrl(sourceImageUrl) ?? sourceImageUrl

  if (!onPreviewImage) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={resolvedDisplayImageUrl} alt={alt} style={imageStyle} className={imageClassName} onLoad={onImageLoad} />
  }

  return (
    <button
      type="button"
      className={`nodrag nowheel border-0 bg-transparent p-0 ${buttonClassName}`}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onPreviewImage(sourceImageUrl)
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={resolvedDisplayImageUrl}
        alt={alt}
        style={imageStyle}
        className={imageClassName}
        onLoad={onImageLoad}
      />
    </button>
  )
}

function renderSection(title: string, children: ReactNode) {
  return (
    <section className="space-y-1.5 rounded-[16px] bg-slate-50 p-3 ring-1 ring-slate-100">
      <p className={`${SELECTABLE_TEXT_CLASS} text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}>{title}</p>
      {children}
    </section>
  )
}

function renderSubsection(title: string, children: ReactNode) {
  return (
    <div className="space-y-1.5 border-t border-slate-200/70 pt-2">
      <p className={`${SELECTABLE_TEXT_CLASS} text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}>{title}</p>
      {children}
    </div>
  )
}

function renderValue(label: string, value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="grid grid-cols-[4.5rem_1fr] gap-2 text-xs leading-5">
      <span className={`${SELECTABLE_TEXT_CLASS} text-[var(--glass-text-tertiary)]`}>{label}</span>
      <span className={`${SELECTABLE_TEXT_CLASS} min-w-0 break-words text-[var(--glass-text-secondary)]`}>{value}</span>
    </div>
  )
}

function renderTextBlock(value: string | null | undefined) {
  if (!hasText(value)) return null
  return <p className={`${SELECTABLE_TEXT_CLASS} whitespace-pre-wrap break-words text-xs leading-5 text-[var(--glass-text-secondary)]`}>{value}</p>
}

function renderJsonBlock(value: unknown) {
  if (value === null || value === undefined) return null
  return renderTextBlock(JSON.stringify(value, null, 2))
}

function spatialProfileStatusLabel(
  labels: ReturnType<typeof useTranslations>,
  status: LocationSpatialProfileStatus | null | undefined,
): string | null {
  return status ? labels(`spatialProfileStatus.${status}`) : null
}

function renderTextSection(title: string, value: string | null | undefined) {
  const content = renderTextBlock(value)
  return content ? renderSection(title, content) : null
}

function renderSummaryText(value: string | null | undefined, lines = 3) {
  if (!hasText(value)) return null
  const lineClampClass = lines === 2 ? 'line-clamp-2' : lines === 4 ? 'line-clamp-4' : 'line-clamp-3'
  return <p className={`${SELECTABLE_TEXT_CLASS} ${lineClampClass} break-words text-xs leading-5 text-[var(--glass-text-secondary)]`}>{value}</p>
}

type PromptSaveStatus = 'idle' | 'saving' | 'saved' | 'failed'

function estimatePromptRows(value: string): number {
  const charactersPerLine = 92
  return Math.max(10, value.split(/\r?\n/).reduce((total, line) => (
    total + Math.max(1, Math.ceil(line.length / charactersPerLine))
  ), 0) + 2)
}

function EditablePromptSection({
  title,
  value,
  summaryValue,
  expanded,
  labels,
  onSave,
}: {
  readonly title: string
  readonly value: string | null | undefined
  readonly summaryValue?: string | null
  readonly expanded: boolean
  readonly labels: ReturnType<typeof useTranslations>
  readonly onSave?: (nextValue: string) => Promise<void>
}) {
  const sectionRef = useRef<HTMLElement | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [status, setStatus] = useState<PromptSaveStatus>('idle')

  useEffect(() => {
    if (!editing) setDraft(value ?? '')
  }, [editing, value])

  useEffect(() => {
    if (!editing) return undefined
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (sectionRef.current?.contains(target)) return
      setDraft(value ?? '')
      setStatus('idle')
      setEditing(false)
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [editing, value])

  const displayed = value ?? summaryValue ?? null
  const content = expanded ? renderTextBlock(value) : renderSummaryText(displayed, 3)
  if (!content && !onSave) return null

  const normalizedDraft = draft.trim()
  const normalizedValue = (value ?? '').trim()
  const canSave = normalizedDraft.length > 0 && normalizedDraft !== normalizedValue
  const editRows = estimatePromptRows(draft)

  const handleSave = async () => {
    if (!onSave || !canSave) {
      setEditing(false)
      return
    }
    setStatus('saving')
    try {
      await onSave(normalizedDraft)
      setStatus('saved')
      setEditing(false)
    } catch {
      setStatus('failed')
    }
  }

  return (
    <section
      ref={sectionRef}
      className={editing
        ? 'nodrag nowheel relative z-50 -mx-2 w-[min(980px,calc(100vw-96px))] space-y-2 rounded-[16px] bg-white p-4 shadow-[0_20px_70px_rgba(15,23,42,0.18)] ring-1 ring-slate-200'
        : 'space-y-1.5 rounded-[16px] bg-slate-50 p-3 ring-1 ring-slate-100'}
      onPointerDownCapture={editing ? (event) => event.stopPropagation() : undefined}
      onWheelCapture={editing ? (event) => {
        event.preventDefault()
        event.stopPropagation()
      } : undefined}
      onKeyDownCapture={editing ? (event) => event.stopPropagation() : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <p className={`${SELECTABLE_TEXT_CLASS} text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}>{title}</p>
        {onSave ? (
          <button
            type="button"
            className="nodrag inline-flex h-6 w-6 items-center justify-center text-[var(--glass-text-secondary)] transition hover:text-[var(--glass-text-primary)]"
            aria-label={labels('editPrompt')}
            title={labels('editPrompt')}
            onClick={() => {
              setStatus('idle')
              setEditing(true)
            }}
          >
            <AppIcon name="edit" className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {editing ? (
        <div className="space-y-2">
          <textarea
            className="nodrag nowheel min-h-[280px] w-full resize-none overflow-hidden rounded-[12px] border border-slate-200 bg-white px-3 pb-5 pt-2 text-xs leading-5 text-[var(--glass-text-secondary)] outline-none transition focus:border-slate-400"
            value={draft}
            rows={editRows}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="flex items-center justify-between gap-2">
            <span className={`${SELECTABLE_TEXT_CLASS} text-[10px] text-[var(--glass-text-tertiary)]`}>
              {status === 'saving'
                ? labels('promptSaving')
                : status === 'failed'
                  ? labels('promptSaveFailed')
                  : ''}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="nodrag rounded-[10px] border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-[var(--glass-text-secondary)] transition hover:bg-slate-50"
                disabled={status === 'saving'}
                onClick={() => {
                  setDraft(value ?? '')
                  setStatus('idle')
                  setEditing(false)
                }}
              >
                {labels('cancelEdit')}
              </button>
              <button
                type="button"
                className="nodrag rounded-[10px] bg-slate-950 px-2.5 py-1.5 text-[10px] font-semibold text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-slate-400"
                disabled={!canSave || status === 'saving'}
                onClick={() => void handleSave()}
              >
                {labels('savePrompt')}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {content}
          {status === 'saved' ? (
            <p className={`${SELECTABLE_TEXT_CLASS} text-[10px] font-medium text-emerald-600`}>{labels('promptSaved')}</p>
          ) : status === 'failed' ? (
            <p className={`${SELECTABLE_TEXT_CLASS} text-[10px] font-medium text-red-600`}>{labels('promptSaveFailed')}</p>
          ) : null}
        </>
      )}
    </section>
  )
}

function nodeIsRunning(data: WorkspaceCanvasFlowNode['data']): boolean {
  return data.isRunning === true
}

function nodeCanToggleDetails(kind: WorkspaceCanvasFlowNode['data']['kind']): boolean {
  return kind !== 'analysis' && kind !== 'editScript' && kind !== 'editCinematographyShotPlan' && kind !== 'editAssetGroup'
}

function nodeShowsMetaFooter(kind: WorkspaceCanvasFlowNode['data']['kind']): boolean {
  return kind !== 'editRequiredAsset' && kind !== 'editScript'
}

export function nodeNeedsActualHeightMeasurement(kind: WorkspaceCanvasFlowNode['data']['kind']): boolean {
  return kind === 'editScreenplay' || kind === 'editStyleBible' || kind === 'editScript' || kind === 'editCinematographyShotPlan' || kind === 'editProcessGroup' || kind === 'editAssetGroup' || kind === 'videoPlan' || kind === 'bgmScore'
}

export function nodeFreezesMeasurementWhileRunning(kind: WorkspaceCanvasFlowNode['data']['kind']): boolean {
  return kind === 'videoPlan'
}

export async function dispatchNodeAction(data: WorkspaceCanvasFlowNode['data'], action: WorkspaceCanvasNodeAction) {
  await Promise.resolve(data.onAction?.(action, data.nodeId))
}

function panelPromptSaveHandler(
  data: WorkspaceCanvasFlowNode['data'],
  field: 'imagePrompt' | 'videoPrompt' | 'firstLastFramePrompt',
): ((nextValue: string) => Promise<void>) | undefined {
  if (!data.onAction) return undefined
  if (typeof data.storyboardId !== 'string' || typeof data.panelIndex !== 'number') return undefined
  const storyboardId = data.storyboardId
  const panelIndex = data.panelIndex
  return async (nextValue) => {
    await dispatchNodeAction(data, {
      type: 'update_video_prompt',
      storyboardId,
      panelIndex,
      value: nextValue,
      field,
    })
  }
}

function videoPlanPromptSaveHandler(data: WorkspaceCanvasFlowNode['data']): ((nextValue: string) => Promise<void>) | undefined {
  if (!data.onAction) return undefined
  const details = data.videoPlanDetails
  if (!details) return undefined
  return async (nextValue) => {
    await dispatchNodeAction(data, {
      type: 'update_video_plan_prompt',
      editScriptId: details.editScriptId,
      blockIndex: details.blockIndex,
      prompt: nextValue,
    })
  }
}

function editAssetDescriptionSaveHandler(data: WorkspaceCanvasFlowNode['data']): ((nextValue: string) => Promise<void>) | undefined {
  if (!data.onAction) return undefined
  const details = data.editAssetDetails
  if (!details) return undefined
  return async (nextValue) => {
    await dispatchNodeAction(data, {
      type: 'update_edit_asset_requirement_description',
      editScriptId: details.editScriptId,
      requirementId: details.requirementId,
      description: nextValue,
    })
  }
}

function videoPlanGenerationOptions(data: WorkspaceCanvasFlowNode['data']): Record<string, string | number | boolean> | undefined {
  const action = data.action
  if (!action) return undefined
  if (action.type === 'generate_video_group' || action.type === 'generate_video') {
    return action.generationOptions
  }
  return undefined
}

function videoPlanModel(data: WorkspaceCanvasFlowNode['data']): string {
  const assetReferenceVideoModel = data.videoPlanDetails?.assetReferenceVideoModel
  if (typeof assetReferenceVideoModel === 'string' && assetReferenceVideoModel.trim()) {
    return assetReferenceVideoModel.trim()
  }
  const action = data.action
  if (!action) return ''
  return ''
}

function LoadingSpinner() {
  return <AppIcon name="loader" className="h-4 w-4 animate-spin" />
}

function editAssetPlaceholderIconName(kind: WorkspaceCanvasEditAssetGroupItem['kind']): AppIconName {
  return kind === 'character' ? 'user' : 'mapPin'
}

function validCandidateImages(data: WorkspaceCanvasFlowNode['data']): string[] {
  if (data.kind !== 'shot') return []
  return (data.imageDetails?.candidateImages ?? []).filter((url) => !url.startsWith('PENDING:'))
}

function renderChips(label: string, values: readonly string[]) {
  if (values.length === 0) return null
  return renderSection(label, (
    <div className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <span key={value} className={`${SELECTABLE_TEXT_CLASS} rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-[var(--glass-text-secondary)]`}>
          {value}
        </span>
      ))}
    </div>
  ))
}

function renderAssetChips(label: string, values: readonly WorkspaceCanvasAssetRef[]) {
  if (values.length === 0) return null
  return renderSection(label, (
    <div className="flex flex-wrap gap-1.5">
      {values.map((value) => {
        const key = `${value.name}:${value.appearance ?? ''}`
        return (
          <span key={key} className={`${SELECTABLE_TEXT_CLASS} rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-[var(--glass-text-secondary)]`}>
            {value.appearance ? `${value.name} / ${value.appearance}` : value.name}
          </span>
        )
      })}
    </div>
  ))
}

function renderLines(lines: readonly WorkspaceCanvasTextLine[], labels: ReturnType<typeof useTranslations>) {
  if (lines.length === 0) return null
  return (
    <div className="space-y-1.5">
      {lines.map((line, index) => (
        <div key={`${line.kind}-${index}`} className="rounded-[12px] bg-white px-2.5 py-2 text-xs leading-5 ring-1 ring-slate-100">
          <div className={`${SELECTABLE_TEXT_CLASS} mb-0.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}>
            <span>{labels(`lineKind.${line.kind}`)}</span>
            {line.speaker ? <span>{line.speaker}</span> : null}
          </div>
          <p className={`${SELECTABLE_TEXT_CLASS} whitespace-pre-wrap break-words text-[var(--glass-text-secondary)]`}>{line.text}</p>
        </div>
      ))}
    </div>
  )
}

function AnalysisContent({ data }: { readonly data: WorkspaceCanvasFlowNode['data'] }) {
  return <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
}

function ShotContent({
  data,
  labels,
  expanded,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly labels: ReturnType<typeof useTranslations>
  readonly expanded: boolean
}) {
  const details = data.shotDetails
  if (!details) return <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
  const shouldShowPreview = hasText(data.previewImageUrl)
  if (!expanded) {
    return (
      <div className="space-y-2">
        {shouldShowPreview ? <MediaPreview data={data} /> : null}
        {renderSection(labels('shotCore'), (
          <div className="space-y-1">
            {renderValue(labels('location'), details.location)}
            {renderValue(labels('duration'), details.duration)}
          </div>
        ))}
        {renderAssetChips(labels('characters'), details.characters)}
        {renderSection(labels('description'), renderSummaryText(data.body, 4))}
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {shouldShowPreview ? <MediaPreview data={data} /> : null}
      {renderSection(labels('shotCore'), (
        <div className="space-y-1">
          {renderValue(labels('shotType'), details.shotType)}
          {renderValue(labels('cameraMove'), details.cameraMove)}
          {renderValue(labels('location'), details.location)}
          {renderValue(labels('timeRange'), details.timeRange)}
          {renderValue(labels('duration'), details.duration)}
        </div>
      ))}
      {renderAssetChips(labels('characters'), details.characters)}
      {renderChips(labels('props'), details.props)}
      {renderTextSection(labels('description'), data.body)}
      {renderTextSection(labels('srtSegment'), details.srtSegment)}
      {details.shotBlocking ? renderSection(labels('shotBlocking'), renderJsonBlock(details.shotBlocking)) : null}
      {renderTextSection(labels('fullFinalPrompt'), details.imagePrompt)}
      <EditablePromptSection
        title={labels('imagePrompt')}
        value={details.imagePrompt}
        expanded={expanded}
        labels={labels}
        onSave={panelPromptSaveHandler(data, 'imagePrompt')}
      />
      <EditablePromptSection
        title={labels('videoPrompt')}
        value={details.videoPrompt}
        expanded={expanded}
        labels={labels}
        onSave={panelPromptSaveHandler(data, 'videoPrompt')}
      />
      {renderTextSection(labels('photographyRules'), details.photographyRules)}
      {renderTextSection(labels('actingNotes'), details.actingNotes)}
      {renderTextSection(labels('error'), details.errorMessage)}
    </div>
  )
}

function MediaPreview({ data }: { readonly data: WorkspaceCanvasFlowNode['data'] }) {
  const labels = useTranslations('projectWorkflow.canvas.workspace.nodeFields')
  const displayVideoUrl = data.kind === 'videoClip' ? toDisplayImageUrl(data.videoDetails?.videoUrl) : null
  const displayImageUrl = toDisplayImageUrl(data.previewImageUrl)
  const isEditAsset = data.kind === 'editRequiredAsset'
  const isShotPreview = data.kind === 'shot'
  const candidateUrls = validCandidateImages(data)
  const panelId = data.kind === 'shot' && data.targetType === 'panel' ? data.targetId : null
  const canUseCandidateActions = Boolean(data.onAction) && data.readOnly !== true
  const aspectRatio = typeof data.previewAspectRatio === 'number' && Number.isFinite(data.previewAspectRatio) && data.previewAspectRatio > 0
    ? data.previewAspectRatio
    : null
  const previewHeight = isEditAsset
    ? 240
    : typeof data.previewDisplayHeight === 'number' && Number.isFinite(data.previewDisplayHeight) && data.previewDisplayHeight > 0
      ? data.previewDisplayHeight
      : 118
  const running = data.__running === true
  const loadingRingSize = Math.max(48, Math.min(96, Math.round(previewHeight * 0.5)))
  if (running && !displayVideoUrl && !displayImageUrl) {
    return (
      <div className="relative" style={{ height: previewHeight }}>
        <MediaGenerationLoading
          taskState={data.taskProgress}
          styleImageUrl={data.loadingStyleImageUrl}
          size={loadingRingSize}
        />
      </div>
    )
  }
  if (isShotPreview && displayImageUrl) {
    return (
      <div className="space-y-2">
        <div className={`relative overflow-hidden bg-transparent ${running ? 'workspace-node-loading-surface' : ''}`}>
          <PreviewableImage
            sourceImageUrl={data.previewImageUrl ?? displayImageUrl}
            displayImageUrl={displayImageUrl}
            alt={data.title}
            buttonClassName="block w-full cursor-zoom-in overflow-hidden"
            imageClassName="block h-auto w-full object-contain"
          />
          <MediaGenerationLoading
            taskState={data.taskProgress}
            styleImageUrl={data.loadingStyleImageUrl}
            size={loadingRingSize}
          />
        </div>
        {!running && panelId && candidateUrls.length > 0 && canUseCandidateActions ? (
          <div className="nodrag nowheel rounded-[16px] border border-sky-100 bg-sky-50/80 p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className={`${SELECTABLE_TEXT_CLASS} text-[10px] font-semibold uppercase text-sky-700`}>
                {labels('candidateImages')}
              </p>
              <button
                type="button"
                className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50"
                onClick={(event) => {
                  event.stopPropagation()
                  void dispatchNodeAction(data, { type: 'cancel_candidate', panelId })
                }}
              >
                {labels('cancelCandidate')}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {candidateUrls.slice(0, 4).map((url, index) => {
                const candidateImageUrl = toDisplayImageUrl(url) ?? url
                return (
                  <div key={url} className="overflow-hidden rounded-[12px] bg-white ring-1 ring-slate-200">
                    <PreviewableImage
                      sourceImageUrl={url}
                      displayImageUrl={candidateImageUrl}
                      alt={labels('candidateImageAlt', { index: index + 1 })}
                      buttonClassName="block w-full cursor-zoom-in overflow-hidden"
                      imageClassName="h-24 w-full object-cover"
                    />
                    <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-2 py-1.5">
                      <span className={`${SELECTABLE_TEXT_CLASS} text-[10px] font-semibold text-[var(--glass-text-tertiary)]`}>
                        {labels('candidateImageAlt', { index: index + 1 })}
                      </span>
                      <button
                        type="button"
                        className="rounded-full bg-slate-950 px-2 py-1 text-[10px] font-semibold text-white transition hover:bg-slate-800"
                        onClick={(event) => {
                          event.stopPropagation()
                          void dispatchNodeAction(data, { type: 'select_candidate', panelId, imageUrl: url })
                        }}
                      >
                        {labels('selectCandidate')}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}
      </div>
    )
  }
  const mediaStyle = aspectRatio && !isShotPreview ? { aspectRatio: String(aspectRatio) } : undefined
  const mediaClassName = aspectRatio
    ? 'h-full max-w-full rounded-[16px] object-contain'
    : 'h-full w-full object-contain'
  const mediaInteractionClass = displayVideoUrl ? 'nodrag nowheel ' : ''
  const frameClassName = `${mediaInteractionClass}relative flex items-center justify-center overflow-hidden rounded-[18px] border border-slate-200 bg-slate-100 ${running ? 'workspace-node-loading-surface' : ''}`
  return (
    <div
      className={frameClassName}
      style={{ height: previewHeight }}
    >
      {displayVideoUrl ? (
        <video
          src={displayVideoUrl}
          aria-label={data.title}
          controls
          preload="metadata"
          style={mediaStyle}
          className={`${aspectRatio ? mediaClassName : 'h-full w-full object-contain'} bg-black`}
        />
      ) : displayImageUrl ? (
        <PreviewableImage
          sourceImageUrl={data.previewImageUrl ?? displayImageUrl}
          displayImageUrl={displayImageUrl}
          alt={data.title}
          imageStyle={mediaStyle}
          buttonClassName="flex h-full w-full cursor-zoom-in items-center justify-center overflow-hidden"
          imageClassName={isEditAsset ? 'h-full w-full object-contain' : mediaClassName}
        />
      ) : isEditAsset ? (
        <div className="flex h-full w-full items-center justify-center text-slate-300">
          <AppIcon name="imageAlt" className="h-8 w-8" />
        </div>
      ) : (
        <div className="flex h-full items-center justify-center bg-[linear-gradient(135deg,#f8fafc_0%,#e2e8f0_48%,#cbd5e1_100%)]">
          <span className={`${SELECTABLE_TEXT_CLASS} rounded-full border border-white/80 bg-white/80 px-3 py-1 text-xs font-semibold text-[var(--glass-text-secondary)] shadow-sm`}>
            {data.body}
          </span>
        </div>
      )}
      <MediaGenerationLoading
        taskState={data.taskProgress}
        styleImageUrl={data.loadingStyleImageUrl}
        size={loadingRingSize}
      />
    </div>
  )
}

function ImageContent({
  data,
  labels,
  expanded,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly labels: ReturnType<typeof useTranslations>
  readonly expanded: boolean
}) {
  if (data.__running === true) return <MediaPreview data={data} />
  const details = data.imageDetails
  return (
    <div className="space-y-2">
      <MediaPreview data={data} />
      {details ? (
        <>
          <EditablePromptSection
            title={labels('imagePrompt')}
            value={details.imagePrompt}
            summaryValue={details.description}
            expanded={expanded}
            labels={labels}
            onSave={panelPromptSaveHandler(data, 'imagePrompt')}
          />
          {expanded ? (
            <>
              {renderTextSection(labels('description'), details.description)}
              {details.candidateImages.length > 0 ? renderSection(labels('candidateImages'), (
                <div className="grid grid-cols-3 gap-1.5">
                  {details.candidateImages.map((url, index) => (
                    <div key={url} className="overflow-hidden rounded-[10px] bg-white ring-1 ring-slate-200">
                      <PreviewableImage
                        sourceImageUrl={url}
                        displayImageUrl={toDisplayImageUrl(url) ?? url}
                        alt={labels('candidateImageAlt', { index: index + 1 })}
                        buttonClassName="block w-full cursor-zoom-in overflow-hidden"
                        imageClassName="h-12 w-full object-cover"
                      />
                    </div>
                  ))}
                </div>
              )) : null}
              {renderTextSection(labels('imageHistory'), details.imageHistory)}
              {renderValue(labels('sketchImage'), details.sketchImageUrl)}
              {renderValue(labels('previousImage'), details.previousImageUrl)}
              {renderTextSection(labels('error'), details.errorMessage)}
            </>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function VideoContent({
  data,
  labels,
  expanded,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly labels: ReturnType<typeof useTranslations>
  readonly expanded: boolean
}) {
  if (data.__running === true) return <MediaPreview data={data} />
  const details = data.videoDetails
  return (
    <div className="space-y-2">
      <MediaPreview data={data} />
      {details ? (
        <>
          <EditablePromptSection
            title={labels('videoPrompt')}
            value={details.videoPrompt}
            summaryValue={data.body}
            expanded={expanded}
            labels={labels}
            onSave={panelPromptSaveHandler(data, 'videoPrompt')}
          />
          {expanded ? (
            <>
              {renderTextSection(labels('firstLastFramePrompt'), details.firstLastFramePrompt)}
              {renderSection(labels('videoMeta'), (
                <div className="space-y-1">
                  {renderValue(labels('generationMode'), details.videoGenerationMode)}
                  {renderValue(labels('videoModel'), details.videoModel)}
                  {renderValue(labels('linkedToNextPanel'), details.linkedToNextPanel === true ? labels('yes') : null)}
                  {renderValue(labels('baseVideo'), details.videoUrl)}
                </div>
              ))}
              {details.lastVideoGenerationOptions && details.lastVideoGenerationOptions.length > 0
                ? renderSection(labels('lastOptions'), renderLines(details.lastVideoGenerationOptions, labels))
                : null}
              {renderTextSection(labels('error'), details.errorMessage)}
            </>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function FinalContent({
  data,
  labels,
  expanded,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly labels: ReturnType<typeof useTranslations>
  readonly expanded: boolean
}) {
  const details = data.finalDetails
  if (!details) return <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
  const running = data.__running === true
  const displayOutputUrl = details.renderStatus === 'completed'
    ? toDisplayImageUrl(details.outputUrl) ?? details.outputUrl
    : null
  return (
    <div className={`space-y-2 rounded-[18px] ${running ? 'workspace-node-loading-surface' : ''}`}>
      {displayOutputUrl ? (
        <div className="nodrag nowheel overflow-hidden rounded-[18px] border border-slate-200 bg-slate-100">
          <video
            src={displayOutputUrl}
            aria-label={data.title}
            controls
            preload="metadata"
            className="h-[156px] w-full bg-black object-contain"
          />
        </div>
      ) : null}
      {renderSection(labels('finalStats'), shotDetailIconGrid([
        { label: labels('totalShots'), value: details.totalShots != null ? String(details.totalShots) : '' },
        { label: labels('totalImages'), value: details.totalImages != null ? String(details.totalImages) : '' },
        { label: labels('totalVideos'), value: details.totalVideos != null ? String(details.totalVideos) : '' },
        { label: labels('totalDuration'), value: details.totalDuration != null ? String(details.totalDuration) : '' },
      ]))}
      {expanded ? renderChips(labels('videoOrder'), details.orderedVideoLabels) : null}
    </div>
  )
}

function BgmScoreContent({
  data,
  labels,
  expanded,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly labels: ReturnType<typeof useTranslations>
  readonly expanded: boolean
}) {
  const details = data.bgmScoreDetails
  if (!details) return <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
  const displayMixUrl = toDisplayImageUrl(details.mixUrl) ?? details.mixUrl ?? null
  const wideExpanded = expanded && data.expandedLayout === 'wide'
  const renderTimedSectionList = (
    sections: typeof details.designSections,
    sectionTitle: string,
  ) => sections.length > 0 ? (
    <div className="space-y-2">
      <p className={`${SELECTABLE_TEXT_CLASS} text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}>{sectionTitle}</p>
      {sections.map((section, index) => {
        const timeRange = typeof section.startSec === 'number' || typeof section.endSec === 'number'
          ? `${section.startSec ?? 0}s - ${section.endSec ?? details.durationSeconds ?? ''}s`
          : null
        const streamClassName = data.streamPresentation?.isStreaming === true ? 'workspace-node-stream-soft-enter' : ''
        return (
          <section key={`${section.title}-${index}`} className={`space-y-1.5 rounded-[16px] bg-slate-50 p-3 ring-1 ring-slate-100 ${streamClassName}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                {section.category ? (
                  <p className={`${SELECTABLE_TEXT_CLASS} text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}>{section.category}</p>
                ) : null}
                <p className={`${SELECTABLE_TEXT_CLASS} break-words text-xs font-semibold text-[var(--glass-text-primary)]`}>{section.title}</p>
              </div>
              {timeRange ? (
                <span className={`${SELECTABLE_TEXT_CLASS} shrink-0 text-[10px] text-[var(--glass-text-tertiary)]`}>{timeRange}</span>
              ) : null}
            </div>
            {renderSummaryText(section.purpose ?? null, 2)}
            {renderSummaryText(section.content, 4)}
          </section>
        )
      })}
    </div>
  ) : null

  const mixSection = displayMixUrl ? (
    <div className="nodrag nowheel space-y-1.5 rounded-[14px] border border-slate-200 bg-white p-2">
      <p className={`${SELECTABLE_TEXT_CLASS} text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}>
        {labels('finalBgmMix')}
      </p>
      <audio src={displayMixUrl} controls preload="metadata" className="w-full" />
    </div>
  ) : null
  const statsSection = renderSection(labels('bgmScoreStats'), (
    <div className="space-y-1">
      {renderValue(labels('status'), details.status)}
      {renderValue(labels('totalDuration'), details.durationSeconds)}
      {details.hasPromptDesign ? renderValue(labels('designSectionCount'), details.designSectionCount) : null}
      {details.hasPromptDesign ? renderValue(labels('promptSectionCount'), details.promptSectionCount) : null}
      {details.hasPromptDesign ? renderValue(labels('virtualLayerCount'), details.virtualLayerCount) : null}
      {renderValue(labels('musicModel'), details.musicModel)}
    </div>
  ))
  const missingPromptSection = details.promptDesignMissing
    ? renderTextSection(labels('promptDesignMissing'), labels('promptDesignMissingDescription'))
    : null
  const overviewSection = expanded ? renderTextSection(labels('scoreOverview'), details.scoreOverview) : null
  const designSections = expanded ? renderTimedSectionList(details.designSections, labels('scoreDesignSections')) : null
  const virtualLayerSections = expanded && details.virtualLayers.length > 0 ? (
    <div className="space-y-2">
      <p className={`${SELECTABLE_TEXT_CLASS} text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}>{labels('virtualLayers')}</p>
      {details.virtualLayers.map((layer, index) => (
        <section key={`${layer.name}-${index}`} className={`space-y-1.5 rounded-[16px] bg-slate-50 p-3 ring-1 ring-slate-100 ${data.streamPresentation?.isStreaming === true ? 'workspace-node-stream-soft-enter' : ''}`}>
          <p className={`${SELECTABLE_TEXT_CLASS} break-words text-xs font-semibold text-[var(--glass-text-primary)]`}>{layer.name}</p>
          {renderSummaryText(layer.purpose, 2)}
          {renderSummaryText(layer.content, 4)}
        </section>
      ))}
    </div>
  ) : null
  const promptSections = expanded ? renderTimedSectionList(details.promptSections, labels('promptSections')) : null
  const finalPromptSection = expanded ? renderTextSection(labels('finalMusicPrompt'), details.finalPrompt) : null
  const negativePromptSection = expanded ? renderTextSection(labels('negativePrompt'), details.negativePrompt) : null
  const errorSection = renderTextSection(labels('error'), details.errorMessage)

  if (wideExpanded) {
    return (
      <div className={`grid gap-3 rounded-[18px] lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)] ${data.__running === true ? 'workspace-node-loading-surface' : ''}`}>
        <div className="space-y-2">
          {mixSection}
          {statsSection}
          {missingPromptSection}
          {errorSection}
        </div>
        <div className="grid min-w-0 gap-3 md:grid-cols-2">
          <div className="space-y-2">
            {overviewSection}
            {designSections}
            {virtualLayerSections}
          </div>
          <div className="space-y-2">
            {promptSections}
            {finalPromptSection}
            {negativePromptSection}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`space-y-2 rounded-[18px] ${data.__running === true ? 'workspace-node-loading-surface' : ''}`}>
      {mixSection}
      {statsSection}
      {missingPromptSection}
      {overviewSection}
      {designSections}
      {virtualLayerSections}
      {promptSections}
      {finalPromptSection}
      {negativePromptSection}
      {errorSection}
    </div>
  )
}

function EditPipelineStepContent({
  data,
  labels,
  expanded,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly labels: ReturnType<typeof useTranslations>
  readonly expanded: boolean
}) {
  const details = data.editPipelineStepDetails
  if (!details) return <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
  if (details.items.length === 0) {
    return <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
  }
  const visibleItems = expanded ? details.items : details.items.slice(0, 3)
  return (
    <div className="space-y-2">
      {visibleItems.map((item, index) => (
        <section key={`${item.title}-${index}`} className={`space-y-2 rounded-[16px] bg-slate-50 p-3 ring-1 ring-slate-100 ${data.streamPresentation?.isStreaming === true ? 'workspace-node-stream-soft-enter' : ''}`}>
          <div className="flex items-center justify-between gap-2">
            <p className={`${SELECTABLE_TEXT_CLASS} truncate text-xs font-semibold text-[var(--glass-text-primary)]`}>{item.title}</p>
            {item.chips && item.chips.length > 0 ? (
              <span className={`${SELECTABLE_TEXT_CLASS} shrink-0 text-[10px] font-semibold text-[var(--glass-text-tertiary)]`}>
                {labels('linkedShots')}
              </span>
            ) : null}
          </div>
          {item.fields.length > 0 ? (
            <div className="space-y-1">
              {item.fields.map((field) => (
                <React.Fragment key={`${field.label}:${field.value}`}>
                  {renderValue(field.label, field.value)}
                </React.Fragment>
              ))}
            </div>
          ) : null}
          {renderSummaryText(item.body, expanded ? 4 : 2)}
          {item.chips && item.chips.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {item.chips.map((chip) => (
                <span key={chip} className={`${SELECTABLE_TEXT_CLASS} inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-white px-2 text-[10px] font-semibold text-slate-700 ring-1 ring-slate-200`}>
                  {chip}
                </span>
              ))}
            </div>
          ) : null}
        </section>
      ))}
      {!expanded && details.items.length > visibleItems.length ? (
        <p className={`${SELECTABLE_TEXT_CLASS} text-xs text-[var(--glass-text-tertiary)]`}>
          {labels('moreItems', { count: details.items.length - visibleItems.length })}
        </p>
      ) : null}
    </div>
  )
}

const PROCESS_STEP_GLYPHS: Record<string, string> = {
  timeline: 'clock', visibleAction: 'motion', camera: 'target', audio: 'sound', primaryTable: 'film', assetExtract: 'people',
}

// 生成过程：步骤网格（点步骤看其逐镜内容）。把 P1–P6 收纳进一张卡，默认折叠。
function ProcessGroupContent({
  data,
  labels,
  expanded,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly labels: ReturnType<typeof useTranslations>
  readonly expanded: boolean
}) {
  const details = data.editProcessGroupDetails
  if (!details || details.steps.length === 0) {
    return <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
  }
  if (!expanded) {
    return <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
  }
  return <ProcessStepGrid steps={details.steps} labels={labels} />
}

function ProcessStepGrid({ steps, labels }: { readonly steps: NonNullable<WorkspaceCanvasFlowNode['data']['editProcessGroupDetails']>['steps']; readonly labels: ReturnType<typeof useTranslations> }) {
  const [active, setActive] = useState<string | null>(null)
  const current = steps.find((s) => s.key === active) ?? null
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-3 gap-2.5">
        {steps.map((step) => {
          const on = active === step.key
          return (
            <button
              key={step.key}
              type="button"
              className={`nodrag flex flex-col items-start rounded-[14px] border bg-white p-3 text-left transition ${on ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200 hover:border-slate-300'}`}
              onClick={(event) => { event.stopPropagation(); setActive(on ? null : step.key) }}
            >
              <span className="flex items-center gap-1.5">
                <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-[7px] bg-slate-900 px-1.5 text-[10px] font-bold text-white">{step.badge}</span>
                <FieldGlyph name={PROCESS_STEP_GLYPHS[step.key] ?? 'dot'} className="h-3.5 w-3.5 text-[var(--glass-text-tertiary)]" />
              </span>
              <p className={`${SELECTABLE_TEXT_CLASS} mt-1.5 text-xs font-semibold text-[var(--glass-text-primary)]`}>{step.title}</p>
              <p className={`${SELECTABLE_TEXT_CLASS} text-[10px] text-[var(--glass-text-tertiary)]`}>{step.items.length} 项 · {step.statusLabel}</p>
            </button>
          )
        })}
      </div>
      {current ? (
        <section className="space-y-2 rounded-[14px] bg-slate-50 p-3 ring-1 ring-slate-100">
          <p className={`${SELECTABLE_TEXT_CLASS} flex items-center gap-1 text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}>
            <FieldGlyph name={PROCESS_STEP_GLYPHS[current.key] ?? 'dot'} className="h-3 w-3" />{current.title}
          </p>
          <div className="space-y-2">
            {current.items.map((item, index) => (
              <div key={`${item.title}-${index}`} className="space-y-1 rounded-[10px] bg-white p-2.5 ring-1 ring-slate-100">
                <p className={`${SELECTABLE_TEXT_CLASS} text-xs font-semibold text-[var(--glass-text-primary)]`}>{item.title}</p>
                {item.fields.length > 0 ? item.fields.map((field) => (
                  <React.Fragment key={`${field.label}:${field.value}`}>{renderValue(field.label, field.value)}</React.Fragment>
                )) : null}
                {renderSummaryText(item.body, 3)}
              </div>
            ))}
          </div>
        </section>
      ) : (
        <p className={`${SELECTABLE_TEXT_CLASS} text-xs text-[var(--glass-text-tertiary)]`}>{labels('expandDetails')}</p>
      )}
    </div>
  )
}

interface ShotGridCard {
  readonly key: string
  readonly badge: ReactNode
  readonly duration?: string
  readonly title: string
  readonly subtitle?: string
  readonly subtitle2?: string
  readonly detail: ReactNode
}

const SHOT_GRID_COLUMNS = 3

function chunkShotCards(cards: readonly ShotGridCard[], size: number): ShotGridCard[][] {
  const rows: ShotGridCard[][] = []
  for (let index = 0; index < cards.length; index += size) {
    rows.push(cards.slice(index, index + size))
  }
  return rows
}

type ShotField = { readonly label: string; readonly value: string | null | undefined }

// 图标字段卡：图标 + 标签 + 值（可读性强的三级排版）
function shotIconField(field: ShotField) {
  if (!hasText(field.value)) return null
  const span = (field.value ?? '').length > 40
  return (
    <div
      key={field.label}
      data-stream-field="true"
      className={`rounded-[12px] border border-slate-200 bg-white p-2.5 ${span ? 'sm:col-span-2' : ''}`}
    >
      <p className={`${SELECTABLE_TEXT_CLASS} mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}>
        <FieldGlyph name={glyphForField(field.label)} className="h-3 w-3" />{field.label}
      </p>
      <p className={`${SELECTABLE_TEXT_CLASS} whitespace-pre-wrap break-words text-[11px] leading-4 text-[var(--glass-text-secondary)]`}>{field.value}</p>
    </div>
  )
}

// 三级：图标字段网格（摄影指导）
function shotDetailIconGrid(fields: readonly ShotField[]) {
  const cells = fields.map(shotIconField).filter(Boolean)
  if (cells.length === 0) return null
  return <div className="grid gap-2 sm:grid-cols-2">{cells}</div>
}

// 三级：分区面板（核心剪辑表）
function shotDetailSections(groups: readonly { readonly name: string; readonly glyph: string; readonly fields: readonly ShotField[] }[]) {
  return (
    <div className="space-y-2">
      {groups.map((g) => {
        const cells = g.fields.map(shotIconField).filter(Boolean)
        if (cells.length === 0) return null
        return (
          <section key={g.name} className="space-y-1.5 rounded-[14px] bg-white p-3 ring-1 ring-slate-100">
            <p className={`${SELECTABLE_TEXT_CLASS} flex items-center gap-1 text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}><FieldGlyph name={g.glyph} className="h-3 w-3" />{g.name}</p>
            <div className="grid gap-2 sm:grid-cols-2">{cells}</div>
          </section>
        )
      })}
    </div>
  )
}

// 网格卡片 + 整行展开：点击任意镜头卡片，在其所在整行下方就地插入满宽详情，网格始终对齐
function ShotGrid({
  cards,
  accent,
  streamPresentation,
}: {
  readonly cards: readonly ShotGridCard[]
  readonly accent: 'slate' | 'cyan'
  readonly streamPresentation?: WorkspaceCanvasStreamPresentation
}) {
  const [pinnedKey, setPinnedKey] = useState<string | null>(null)
  const streamActiveKey = streamPresentation?.activeItemKey ?? null
  const activeKey = pinnedKey ?? streamActiveKey
  const displayedStreamKeys = useMemo(
    () => new Set(streamPresentation?.displayedItemKeys ?? []),
    [streamPresentation?.displayedItemKeys],
  )
  useEffect(() => {
    if (!pinnedKey) return
    if (cards.some((card) => card.key === pinnedKey)) return
    setPinnedKey(null)
  }, [cards, pinnedKey])
  const badgeClass = accent === 'cyan' ? 'bg-cyan-600' : 'bg-slate-900'
  const activeRingClass = accent === 'cyan'
    ? 'border-cyan-500 ring-1 ring-cyan-500'
    : 'border-slate-900 ring-1 ring-slate-900'
  return (
    <div className="space-y-2.5">
      {chunkShotCards(cards, SHOT_GRID_COLUMNS).map((row, rowIndex) => {
        const activeCard = row.find((card) => card.key === activeKey) ?? null
        return (
          <div key={rowIndex} className="space-y-2.5">
            <div className="grid grid-cols-3 gap-2.5">
              {row.map((card) => {
                const isActive = activeKey === card.key
                const isStreamDisplayed = streamPresentation?.isStreaming === true && displayedStreamKeys.has(card.key)
                return (
                  <button
                    key={card.key}
                    type="button"
                    className={`nodrag flex flex-col rounded-[14px] border bg-white p-3 text-left transition ${isActive ? activeRingClass : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'} ${isStreamDisplayed ? 'workspace-node-stream-soft-enter' : ''}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      setPinnedKey((current) => current === card.key ? null : card.key)
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white ${badgeClass}`}>{card.badge}</span>
                      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--glass-text-tertiary)]">
                        {card.duration}
                        <AppIcon name={isActive ? 'chevronUp' : 'chevronDown'} className="h-3.5 w-3.5" />
                      </span>
                    </div>
                    <p className={`${SELECTABLE_TEXT_CLASS} mt-2 line-clamp-2 text-[11px] font-semibold leading-4 text-[var(--glass-text-primary)]`}>{card.title}</p>
                    {card.subtitle ? <p className={`${SELECTABLE_TEXT_CLASS} mt-1.5 line-clamp-3 text-[11px] leading-4 text-[var(--glass-text-secondary)]`}>{card.subtitle}</p> : null}
                    {card.subtitle2 ? <p className={`${SELECTABLE_TEXT_CLASS} mt-0.5 line-clamp-1 text-[11px] leading-4 text-[var(--glass-text-tertiary)]`}>{card.subtitle2}</p> : null}
                  </button>
                )
              })}
            </div>
            {activeCard ? (
              <div className={`space-y-2 rounded-[14px] border border-slate-200 bg-slate-50 p-4 ${streamPresentation?.isStreaming === true ? 'workspace-node-stream-soft-detail' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white ${badgeClass}`}>{activeCard.badge}</span>
                  <span className={`${SELECTABLE_TEXT_CLASS} text-sm font-semibold text-[var(--glass-text-primary)]`}>{activeCard.title}</span>
                  {activeCard.duration ? <span className={`${SELECTABLE_TEXT_CLASS} text-xs text-[var(--glass-text-tertiary)]`}>{activeCard.duration}</span> : null}
                </div>
                {activeCard.detail}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function EditScriptContent({
  data,
  labels,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly labels: ReturnType<typeof useTranslations>
}) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const details = data.editScriptDetails
  if (data.__running === true && !details) {
    return (
      <div className="space-y-4">
        <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
        <div className="workspace-node-loading-surface h-[320px] rounded-[18px] border border-slate-200 bg-slate-100" />
      </div>
    )
  }
  if (!details) return <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
  const cards: ShotGridCard[] = details.shots.map((shot) => ({
    key: String(shot.shotNumber),
    badge: shot.shotNumber,
    duration: `${shot.durationSec}s`,
    title: shot.dramaticPurpose,
    subtitle: shot.visibleAction,
    detail: shotDetailSections([
      {
        name: labels('dramaticPurpose'),
        glyph: 'target',
        fields: [
          { label: labels('dramaticPurpose'), value: shot.dramaticPurpose },
          { label: labels('visibleAction'), value: shot.visibleAction },
          { label: labels('audienceFocus'), value: shot.audienceFocus },
          { label: labels('viewpoint'), value: shot.viewpoint },
          { label: labels('revealPlan'), value: shot.revealPlan },
          { label: labels('performanceBeat'), value: shot.performanceBeat },
          { label: labels('charactersAndScene'), value: shot.charactersAndScene },
        ],
      },
      {
        name: labels('sound'),
        glyph: 'sound',
        fields: [
          { label: labels('duration'), value: `${shot.durationSec}s` },
          { label: labels('sound'), value: shot.sound },
        ],
      },
      {
        name: labels('continuityIn'),
        glyph: 'link',
        fields: [
          { label: labels('continuityIn'), value: shot.continuityIn },
          { label: labels('continuityOut'), value: shot.continuityOut },
        ],
      },
    ]),
  }))
  return (
    <div className={nodeContentInteractionClass(data, 'space-y-3')}>
      <div className="grid grid-cols-2 gap-2">
        {renderSection(labels('editScriptMeta'), (
          <div className="space-y-1">
            {renderValue(labels('totalDuration'), details.durationSec)}
            {renderValue(labels('shotCount'), details.shotCount)}
          </div>
        ))}
        {renderSection(labels('description'), renderTextBlock(data.body))}
      </div>
      <button
        type="button"
        className="nodrag inline-flex items-center gap-2 rounded-[14px] bg-slate-950 px-3 py-2.5 text-xs font-semibold text-white transition hover:bg-slate-900"
        onClick={(event) => {
          event.stopPropagation()
          setPreviewOpen(true)
        }}
      >
        <AppIcon name="playCircle" className="h-4 w-4" />
        {labels('viewVideoPreview')}
      </button>
      {previewOpen ? (
        <EditScriptPreviewDetail
          details={details}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
      {details.screenplayText
        ? renderSection(labels('screenplay'), renderSummaryText(details.screenplayText, 8))
        : null}
      <ShotGrid cards={cards} accent="slate" streamPresentation={data.streamPresentation} />
    </div>
  )
}

function EditCinematographyContent({
  data,
  labels,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly labels: ReturnType<typeof useTranslations>
}) {
  const details = data.editPipelineStepDetails
  if (data.__running === true && !details) {
    return (
      <div className="space-y-4">
        <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
        <div className="workspace-node-loading-surface h-[280px] rounded-[18px] border border-slate-200 bg-slate-100" />
      </div>
    )
  }
  if (!details || details.items.length === 0) {
    return <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
  }
  const cards: ShotGridCard[] = details.items.map((item, index) => {
    const movement = item.fields[6]?.value ?? item.fields[1]?.value
    return {
      key: item.chips?.[0] ?? String(index + 1),
      badge: item.chips?.[0] ?? index + 1,
      title: item.fields[0]?.value ?? item.title,
      subtitle: movement,
      subtitle2: item.fields[1]?.value,
      detail: (
        <>
          {shotDetailIconGrid(item.fields)}
          {hasText(item.body) ? (
            <div className="mt-2">{shotIconField({ label: '构图', value: item.body })}</div>
          ) : null}
        </>
      ),
    }
  })
  return (
    <div className={nodeContentInteractionClass(data, 'space-y-3')}>
      {renderSection(labels('description'), renderTextBlock(data.body))}
      <ShotGrid cards={cards} accent="cyan" streamPresentation={data.streamPresentation} />
    </div>
  )
}

const IMAGE_THUMBNAIL_FALLBACK_ASPECT_RATIO = '16 / 9'

export function imageThumbnailAspectRatio(image: Pick<HTMLImageElement, 'naturalWidth' | 'naturalHeight'>): string | null {
  const { naturalWidth, naturalHeight } = image
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight)) return null
  if (naturalWidth <= 0 || naturalHeight <= 0) return null
  return `${naturalWidth} / ${naturalHeight}`
}

function numericAspectRatioStyleValue(aspectRatio: number | null | undefined): string | null {
  if (typeof aspectRatio !== 'number') return null
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return null
  return String(aspectRatio)
}

function EditAssetGroupThumbnailCard({
  asset,
  isOpen,
  labels,
  loadingStyleImageUrl,
  onPreviewImage,
  onSelect,
}: {
  readonly asset: WorkspaceCanvasEditAssetGroupItem
  readonly isOpen: boolean
  readonly labels: ReturnType<typeof useTranslations>
  readonly loadingStyleImageUrl?: string | null
  readonly onPreviewImage: ImagePreviewHandler | null
  readonly onSelect: () => void
}) {
  const [thumbnailAspectRatio, setThumbnailAspectRatio] = useState(IMAGE_THUMBNAIL_FALLBACK_ASPECT_RATIO)
  const previewSourceImageUrl = asset.previewImageUrl ?? null
  const imageUrl = toDisplayImageUrl(previewSourceImageUrl)
  const loadingSize = 64

  useEffect(() => {
    setThumbnailAspectRatio(IMAGE_THUMBNAIL_FALLBACK_ASPECT_RATIO)
  }, [previewSourceImageUrl])

  const handleImageLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const nextAspectRatio = imageThumbnailAspectRatio(event.currentTarget)
    if (!nextAspectRatio) return
    setThumbnailAspectRatio(nextAspectRatio)
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isOpen}
      className={`nodrag cursor-pointer overflow-hidden rounded-[14px] border bg-white text-left transition focus:outline-none focus:ring-2 focus:ring-slate-900/30 ${isOpen ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200 hover:border-slate-300'}`}
      onClick={(event) => { event.stopPropagation(); onSelect() }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        onSelect()
      }}
    >
      <div
        className="relative flex w-full items-center justify-center overflow-hidden bg-slate-100 text-[var(--glass-text-tertiary)]"
        style={{ aspectRatio: thumbnailAspectRatio }}
      >
        {imageUrl ? (
          <MediaImageWithLoading
            src={imageUrl}
            alt={asset.name}
            containerClassName="h-full w-full bg-slate-100"
            className="h-full w-full object-contain"
            onLoad={handleImageLoad}
          />
        ) : asset.isRunning ? null : (
          <AppIcon name={editAssetPlaceholderIconName(asset.kind)} className="h-6 w-6" />
        )}
        <MediaGenerationLoading
          taskState={asset.taskProgress}
          styleImageUrl={loadingStyleImageUrl}
          size={loadingSize}
        />
        {previewSourceImageUrl && imageUrl && onPreviewImage ? (
          <button
            type="button"
            className="nodrag nowheel absolute right-2 top-2 z-20 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/75 bg-slate-950/72 text-white shadow-sm backdrop-blur transition hover:bg-slate-950/85 focus:outline-none focus:ring-2 focus:ring-white/80"
            aria-label={`${labels('previewLarge')}: ${asset.name}`}
            title={labels('previewLarge')}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              onPreviewImage(previewSourceImageUrl)
            }}
          >
            <AppIcon name="searchPlus" className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      <div className="px-2.5 py-1.5">
        <p className={`${SELECTABLE_TEXT_CLASS} truncate text-[11px] font-semibold text-[var(--glass-text-primary)]`}>{asset.name}</p>
        <p className={`${SELECTABLE_TEXT_CLASS} truncate text-[10px] text-[var(--glass-text-tertiary)]`}>{asset.eyebrow} · {asset.statusLabel}</p>
      </div>
    </div>
  )
}

// 资产需求：合并为一张卡，网格展示各资产缩略图，点开看详情并可单独重新生成
function EditAssetGroupContent({
  data,
  labels,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly labels: ReturnType<typeof useTranslations>
}) {
  const [open, setOpen] = useState<string | null>(null)
  const onPreviewImage = useContext(WorkspaceNodeImagePreviewContext)
  const details = data.editAssetGroupDetails
  if (!details || details.assets.length === 0) {
    return <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
  }
  const current = details.assets.find((asset) => asset.requirementId === open) ?? null
  const currentPreviewSourceImageUrl = current?.previewImageUrl ?? null
  const currentPreviewDisplayImageUrl = toDisplayImageUrl(currentPreviewSourceImageUrl)
  const assetGroups = [
    {
      key: 'character',
      title: labels('characters'),
      assets: details.assets.filter((asset) => asset.kind === 'character'),
    },
    {
      key: 'location',
      title: labels('locations'),
      assets: details.assets.filter((asset) => asset.kind === 'location'),
    },
  ] satisfies ReadonlyArray<{
    readonly key: WorkspaceCanvasEditAssetGroupItem['kind']
    readonly title: string
    readonly assets: readonly WorkspaceCanvasEditAssetGroupItem[]
  }>
  const groupedAssets = assetGroups.filter((group) => group.assets.length > 0)
  return (
    <div className={nodeContentInteractionClass(data, 'space-y-3')}>
      {renderSection(labels('description'), renderTextBlock(data.body))}
      <div className="space-y-4">
        {groupedAssets.map((group) => (
          <section key={group.key} className="space-y-2">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-1.5">
              <FieldGlyph name={group.key === 'character' ? 'people' : 'pin'} className="h-4 w-4 text-[var(--glass-text-secondary)]" />
              <span className={`${SELECTABLE_TEXT_CLASS} text-xs font-semibold text-[var(--glass-text-primary)]`}>{group.title}</span>
              <span className={`${SELECTABLE_TEXT_CLASS} text-[11px] text-[var(--glass-text-tertiary)]`}>{group.assets.length}</span>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              {group.assets.map((asset) => {
                const on = open === asset.requirementId
                const selectAsset = () => setOpen(on ? null : asset.requirementId)
                return (
                  <EditAssetGroupThumbnailCard
                    key={asset.requirementId}
                    asset={asset}
                    isOpen={on}
                    labels={labels}
                    loadingStyleImageUrl={data.loadingStyleImageUrl}
                    onPreviewImage={onPreviewImage}
                    onSelect={selectAsset}
                  />
                )
              })}
            </div>
          </section>
        ))}
      </div>
      {current ? (
        <section className="space-y-2 rounded-[14px] bg-slate-50 p-3 ring-1 ring-slate-100">
          <div className="flex items-center gap-2">
            <FieldGlyph name={current.kind === 'character' ? 'people' : 'pin'} className="h-4 w-4 text-[var(--glass-text-secondary)]" />
            <span className={`${SELECTABLE_TEXT_CLASS} text-sm font-semibold text-[var(--glass-text-primary)]`}>{current.name}</span>
            <span className={`${SELECTABLE_TEXT_CLASS} text-xs text-[var(--glass-text-tertiary)]`}>{current.statusLabel}</span>
          </div>
          {shotDetailIconGrid([
            { label: current.eyebrow, value: current.kind === 'character' ? labels('characters') : labels('locations') },
            { label: labels('shotCount'), value: current.shotNumbers.join(', ') },
          ])}
          {renderTextBlock(current.description)}
          <div className="flex flex-wrap items-center gap-2">
            {currentPreviewSourceImageUrl && currentPreviewDisplayImageUrl && onPreviewImage ? (
              <button
                type="button"
                className="nodrag inline-flex items-center gap-1.5 rounded-[14px] border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-[var(--glass-text-secondary)] transition hover:bg-slate-50"
                onClick={(event) => {
                  event.stopPropagation()
                  onPreviewImage(currentPreviewSourceImageUrl)
                }}
              >
                <AppIcon name="searchPlus" className="h-3.5 w-3.5" />
                {labels('previewLarge')}
              </button>
            ) : null}
            {current.action && current.actionLabel ? (
              <button
                type="button"
                className="nodrag inline-flex items-center gap-1.5 rounded-[14px] border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-[var(--glass-text-secondary)] transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={current.isRunning}
                onClick={(event) => {
                  event.stopPropagation()
                  if (current.action && !current.isRunning) data.onAction?.(current.action, data.nodeId)
                }}
              >
                <AppIcon name="refresh" className="h-3.5 w-3.5" />
                {current.actionLabel}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  )
}

// 导演拆镜：镜头网格 + 整行展开（与核心剪辑表一致的设计语言）。collapsed 仅显示摘要。
function EditDirectorDecoupageContent({
  data,
  labels,
  expanded,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly labels: ReturnType<typeof useTranslations>
  readonly expanded: boolean
}) {
  const details = data.editPipelineStepDetails
  if (!details || details.items.length === 0) {
    return <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
  }
  if (!expanded) {
    return (
      <div className="space-y-2">
        {renderSection(labels('description'), renderSummaryText(data.body, 3))}
      </div>
    )
  }
  const cards: ShotGridCard[] = details.items.map((item, index) => ({
    key: String(index + 1),
    badge: index + 1,
    title: item.fields[1]?.value ?? item.fields[0]?.value ?? item.title,
    subtitle: item.body ?? undefined,
    subtitle2: item.fields[0]?.value,
    detail: (
      <>
        {shotDetailIconGrid(item.fields)}
        {hasText(item.body) ? <div className="mt-2">{shotIconField({ label: labels('visibleAction'), value: item.body })}</div> : null}
      </>
    ),
  }))
  return (
    <div className={nodeContentInteractionClass(data, 'space-y-3')}>
      {renderSection(labels('description'), renderTextBlock(data.body))}
      <ShotGrid cards={cards} accent="slate" streamPresentation={data.streamPresentation} />
    </div>
  )
}

function StyleBibleContent({
  data,
  labels,
  expanded,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly labels: ReturnType<typeof useTranslations>
  readonly expanded: boolean
}) {
  const details = data.styleBibleDetails
  if (!details) return <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
  const shouldShowPreview = (data.kind === 'editStylePreview' || data.kind === 'editStyleBible') && hasText(data.previewImageUrl)

  // 一级（折叠）：预览图 + 完整风格总结
  if (!expanded) {
    return (
      <div className="space-y-2">
        {shouldShowPreview ? <MediaPreview data={data} /> : null}
        {details.styleSummary ? renderSection(labels('styleSummary'), renderTextBlock(details.styleSummary)) : null}
      </div>
    )
  }

  // 二级（展开）：预览图 + 总结 + 分组属性网格
  const groups: readonly { readonly name: string; readonly glyph: string; readonly fields: readonly ShotField[] }[] = [
    {
      name: labels('visualPolicy'), glyph: 'eye', fields: [
        { label: labels('colorPrompt'), value: details.visual.colorPrompt },
        { label: labels('lightingPrompt'), value: details.visual.lightingPrompt },
        { label: labels('texturePrompt'), value: details.visual.texturePrompt },
        { label: labels('compositionPrompt'), value: details.visual.compositionPrompt },
        { label: labels('imageFilterPrompt'), value: details.visual.imageFilterPrompt },
      ],
    },
    {
      name: labels('cameraPolicy'), glyph: 'camera', fields: [
        { label: labels('movementPrompt'), value: details.camera.movementPrompt },
        { label: labels('lensAndDepthPrompt'), value: details.camera.lensAndDepthPrompt },
        { label: labels('videoRhythmPrompt'), value: details.camera.videoRhythmPrompt },
      ],
    },
    {
      name: labels('soundPolicy'), glyph: 'sound', fields: [
        { label: labels('soundFilterPrompt'), value: details.sound.soundFilterPrompt },
      ],
    },
  ]
  return (
    <div className={nodeContentInteractionClass(data, 'space-y-3')}>
      {shouldShowPreview ? <MediaPreview data={data} /> : null}
      {renderTextSection(labels('styleSummary'), details.styleSummary)}
      {renderTextSection(labels('rawUserStyle'), details.rawUserStyle)}
      <StyleBibleGroups groups={groups} />
    </div>
  )
}

// 风格圣经：分组属性网格（点组看字段）
function StyleBibleGroups({ groups }: { readonly groups: readonly { readonly name: string; readonly glyph: string; readonly fields: readonly ShotField[] }[] }) {
  const visibleGroups = groups.filter((g) => g.fields.some((f) => hasText(f.value)))
  const [active, setActive] = useState<string | null>(visibleGroups[0]?.name ?? null)
  const current = visibleGroups.find((g) => g.name === active)
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-3 gap-2.5">
        {visibleGroups.map((g) => {
          const on = active === g.name
          const count = g.fields.filter((f) => hasText(f.value)).length
          return (
            <button key={g.name} type="button" className={`nodrag flex flex-col items-start rounded-[14px] border bg-white p-3 text-left transition ${on ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200 hover:border-slate-300'}`} onClick={(e) => { e.stopPropagation(); setActive(on ? null : g.name) }}>
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-slate-100 text-[var(--glass-text-secondary)]"><FieldGlyph name={g.glyph} className="h-4 w-4" /></span>
              <p className={`${SELECTABLE_TEXT_CLASS} mt-2 text-xs font-semibold text-[var(--glass-text-primary)]`}>{g.name}</p>
              <p className={`${SELECTABLE_TEXT_CLASS} text-[10px] text-[var(--glass-text-tertiary)]`}>{count} 项</p>
            </button>
          )
        })}
      </div>
      {current ? shotDetailIconGrid(current.fields) : null}
    </div>
  )
}

function EditScreenplayContent({
  data,
  labels,
  expanded,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly labels: ReturnType<typeof useTranslations>
  readonly expanded: boolean
}) {
  const details = data.editScreenplayDetails
  if (!details) return <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
  const parsed = parseScreenplayOutline(details.screenplayText)
  const streamClassName = data.streamPresentation?.isStreaming === true ? 'workspace-node-stream-soft-detail' : ''

  if (!expanded) {
    return (
      <div className={`space-y-2 ${streamClassName}`}>
        {parsed.summary
          ? renderSection(labels('summary'), renderSummaryText(parsed.summary, 4))
          : renderSection(labels('screenplay'), renderSummaryText(details.screenplayText, 6))}
      </div>
    )
  }

  return (
    <div className={nodeContentInteractionClass(data, `space-y-3 ${streamClassName}`)}>
      {parsed.summary ? renderSection(labels('summary'), renderTextBlock(parsed.summary)) : null}
      {parsed.characters.length > 0 ? (
        <div className="space-y-1.5">
          <p className={`${SELECTABLE_TEXT_CLASS} flex items-center gap-1 text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}><FieldGlyph name="people" className="h-3 w-3" />{labels('characters')}</p>
          <ScreenplayAccordion items={parsed.characters.map((c) => ({ key: c.name, title: c.name, body: c.desc }))} />
        </div>
      ) : null}
      {parsed.scenes.length > 0 ? (
        <div className="space-y-1.5">
          <p className={`${SELECTABLE_TEXT_CLASS} flex items-center gap-1 text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}><FieldGlyph name="frame" className="h-3 w-3" />{labels('scenes')}</p>
          <ScreenplayAccordion items={parsed.scenes.map((s, i) => ({ key: `sc${i}`, badge: String(i + 1), title: s.header, body: s.actions.join('\n') }))} />
        </div>
      ) : (
        renderSection(labels('screenplay'), renderTextBlock(details.screenplayText))
      )}
      {renderSection(labels('originalRequest'), renderTextBlock(details.userPrompt))}
    </div>
  )
}

interface ScreenplayOutline {
  readonly summary: string
  readonly characters: readonly { readonly name: string; readonly desc: string }[]
  readonly scenes: readonly { readonly header: string; readonly actions: readonly string[] }[]
}
function parseScreenplayOutline(text: string): ScreenplayOutline {
  const lines = (text ?? '').split('\n')
  let summary = ''
  const characters: { name: string; desc: string }[] = []
  const scenes: { header: string; actions: string[] }[] = []
  let mode: 'none' | 'summary' | 'characters' | 'scene' = 'none'
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('标题')) continue
    if (line.startsWith('故事梗概')) { mode = 'summary'; continue }
    if (line.startsWith('角色表')) { mode = 'characters'; continue }
    if (/^场景\s*\d+/.test(line)) { scenes.push({ header: line.replace(/^场景\s*\d+[｜|]?\s*/, '') || line, actions: [] }); mode = 'scene'; continue }
    if (line.startsWith('动作')) continue
    if (mode === 'summary') summary += line
    else if (mode === 'characters') { const m = line.split(/[：:]/); if (m.length >= 2) characters.push({ name: m[0].trim(), desc: m.slice(1).join('：').trim() }) }
    else if (mode === 'scene' && scenes.length > 0) scenes[scenes.length - 1].actions.push(line)
  }
  return { summary, characters, scenes }
}

function ScreenplayAccordion({ items }: { readonly items: readonly { readonly key: string; readonly badge?: string; readonly title: string; readonly body: string }[] }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="divide-y divide-slate-100 overflow-hidden rounded-[14px] border border-slate-200 bg-white">
      {items.map((it) => {
        const on = open === it.key
        return (
          <div key={it.key}>
            <button type="button" className={`nodrag flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition hover:bg-slate-50 ${on ? 'bg-slate-50' : ''}`} onClick={(e) => { e.stopPropagation(); setOpen(on ? null : it.key) }}>
              {it.badge ? <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-[7px] bg-slate-900 px-1.5 text-[11px] font-bold text-white">{it.badge}</span> : null}
              <span className={`${SELECTABLE_TEXT_CLASS} min-w-0 flex-1 truncate text-xs font-semibold text-[var(--glass-text-primary)]`}>{it.title}</span>
              <AppIcon name={on ? 'chevronUp' : 'chevronDown'} className="h-3.5 w-3.5 shrink-0 text-[var(--glass-text-tertiary)]" />
            </button>
            {on ? <p className={`${SELECTABLE_TEXT_CLASS} whitespace-pre-wrap break-words bg-slate-50/70 px-3 pb-3 pt-1 text-[11px] leading-5 text-[var(--glass-text-secondary)]`}>{it.body}</p> : null}
          </div>
        )
      })}
    </div>
  )
}

function EditAssetContent({
  data,
  labels,
  expanded,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly labels: ReturnType<typeof useTranslations>
  readonly expanded: boolean
}) {
  if (data.__running === true) return <MediaPreview data={data} />
  const details = data.editAssetDetails
  if (!details) return <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
  return (
    <div className={nodeContentInteractionClass(data, 'space-y-2')}>
      <MediaPreview data={data} />
      <EditablePromptSection
        title={labels('imagePrompt')}
        value={details.description}
        expanded={expanded}
        labels={labels}
        onSave={editAssetDescriptionSaveHandler(data)}
      />
      {renderChips(labels('linkedShots'), details.shotNumbers.map((shotNumber) => String(shotNumber)))}
      {details.kind === 'location' ? renderSection(labels('spatialProfile'), (
        <div className="space-y-1">
          {renderValue(labels('status'), spatialProfileStatusLabel(labels, details.spatialProfileStatus))}
          {renderValue(labels('spatialProfileAnalyzedAt'), typeof details.spatialProfileAnalyzedAt === 'string' ? details.spatialProfileAnalyzedAt : null)}
          {renderValue(labels('spatialProfileModel'), details.spatialProfileModel)}
          {details.spatialProfileError ? renderSubsection(labels('spatialProfileError'), renderTextBlock(details.spatialProfileError)) : null}
          {expanded && details.spatialProfileJson ? renderSubsection(labels('spatialProfileJson'), renderJsonBlock(details.spatialProfileJson)) : null}
        </div>
      )) : null}
      {expanded && details.errorMessage ? renderSection(labels('error'), renderTextBlock(details.errorMessage)) : null}
    </div>
  )
}

function VideoPlanReferenceThumbnail({
  sourceImageUrl,
  displayImageUrl,
  alt,
  label,
  initialAspectRatio,
}: {
  readonly sourceImageUrl?: string | null
  readonly displayImageUrl?: string | null
  readonly alt: string
  readonly label: string
  readonly initialAspectRatio?: number | null
}) {
  const initialAspectRatioStyle = numericAspectRatioStyleValue(initialAspectRatio) ?? IMAGE_THUMBNAIL_FALLBACK_ASPECT_RATIO
  const [thumbnailAspectRatio, setThumbnailAspectRatio] = useState(initialAspectRatioStyle)

  useEffect(() => {
    setThumbnailAspectRatio(initialAspectRatioStyle)
  }, [initialAspectRatioStyle, sourceImageUrl])

  const handleImageLoad: React.ReactEventHandler<HTMLImageElement> = (event) => {
    const nextAspectRatio = imageThumbnailAspectRatio(event.currentTarget)
    if (!nextAspectRatio) return
    setThumbnailAspectRatio(nextAspectRatio)
  }

  if (!sourceImageUrl) {
    return (
      <div
        className="flex w-full items-center justify-center rounded-[10px] bg-slate-50 text-sm font-semibold text-slate-400 ring-1 ring-slate-200"
        style={{ aspectRatio: thumbnailAspectRatio }}
      >
        {label}
      </div>
    )
  }

  return (
    <div
      className="overflow-hidden rounded-[10px] bg-slate-50 ring-1 ring-slate-200"
      style={{ aspectRatio: thumbnailAspectRatio }}
    >
      <PreviewableImage
        sourceImageUrl={sourceImageUrl}
        displayImageUrl={displayImageUrl ?? undefined}
        alt={alt}
        buttonClassName="block h-full w-full cursor-zoom-in overflow-hidden"
        imageClassName="h-full w-full object-contain"
        onImageLoad={handleImageLoad}
      />
    </div>
  )
}

function VideoPlanContent({
  data,
  labels,
  expanded,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly labels: ReturnType<typeof useTranslations>
  readonly expanded: boolean
}) {
  const details = data.videoPlanDetails
  const displayOutputUrl = toDisplayImageUrl(details?.outputUrl) ?? details?.outputUrl ?? null
  const [previewMode, setPreviewMode] = useState<'reference' | 'video'>(displayOutputUrl ? 'video' : 'reference')
  const [generationMode, setGenerationMode] = useState<'storyboard' | 'asset-reference'>('storyboard')
  const [intrinsicOutputAspectRatio, setIntrinsicOutputAspectRatio] = useState<number | null>(null)
  useEffect(() => {
    setPreviewMode(displayOutputUrl ? 'video' : 'reference')
  }, [displayOutputUrl])
  useEffect(() => {
    setIntrinsicOutputAspectRatio(null)
  }, [displayOutputUrl])
  if (!details) return <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
  const running = data.__running === true
  const canUseNodeActions = Boolean(data.onAction) && data.readOnly !== true
  const referenceAspectRatio = details.sourceImages.find((cell) => (
    typeof cell?.aspectRatio === 'number' && Number.isFinite(cell.aspectRatio) && cell.aspectRatio > 0
  ))?.aspectRatio ?? 16 / 9
  const storedOutputAspectRatio = typeof details.outputAspectRatio === 'number' && Number.isFinite(details.outputAspectRatio) && details.outputAspectRatio > 0
    ? details.outputAspectRatio
    : referenceAspectRatio
  const outputAspectRatio = intrinsicOutputAspectRatio ?? storedOutputAspectRatio
  const outputStyle = { aspectRatio: String(outputAspectRatio) }
  const shouldShowVideo = Boolean(displayOutputUrl && previewMode === 'video')
  const assetReferences = details.assetReferences ?? []
  const assetReferenceImageUrls = assetReferences
    .map((asset) => asset.imageUrl)
    .filter((imageUrl): imageUrl is string => hasText(imageUrl))
  const storyboardReferences = details.sourceImages
  const storyboardReferenceImageUrls = storyboardReferences
    .map((image) => image.imageUrl)
    .filter((imageUrl): imageUrl is string => hasText(imageUrl))
  const assetReferenceVideoModel = videoPlanModel(data)
  const firstStoryboardReference = storyboardReferences[0] ?? null
  const canGenerateStoryboard = assetReferenceVideoModel.length > 0
    && storyboardReferenceImageUrls.length === storyboardReferences.length
    && storyboardReferenceImageUrls.length > 0
    && !running
    && canUseNodeActions
    && (
      details.kind === 'group'
      || (
        hasText(firstStoryboardReference?.panelId)
        && hasText(firstStoryboardReference?.storyboardId)
        && typeof firstStoryboardReference?.panelIndex === 'number'
      )
    )
  const canGenerateAssetReference = assetReferenceImageUrls.length > 0 && assetReferenceVideoModel.length > 0 && !running && canUseNodeActions
  const canGenerateSelectedMode = generationMode === 'storyboard' ? canGenerateStoryboard : canGenerateAssetReference
  const shouldShowVideoModelHint = (storyboardReferenceImageUrls.length > 0 || assetReferenceImageUrls.length > 0) && assetReferenceVideoModel.length === 0
  const shouldShowAssetReferences = previewMode === 'reference' && generationMode === 'asset-reference'
  const missingReferenceLabel = shouldShowAssetReferences ? labels('assetReferenceImagesMissing') : labels('storyboardReferenceImagesMissing')
  const generateLabel = generationMode === 'storyboard'
    ? labels('generateStoryboardReferenceVideo')
    : labels('generateAssetReferenceVideo')
  const handleOutputVideoLoadedMetadata = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const nextAspectRatio = videoElementAspectRatio(event.currentTarget)
    if (nextAspectRatio === null) return
    setIntrinsicOutputAspectRatio((currentAspectRatio) => (
      currentAspectRatio !== null && Math.abs(currentAspectRatio - nextAspectRatio) < 0.001
        ? currentAspectRatio
        : nextAspectRatio
    ))
  }
  const handleGenerateSelectedMode = () => {
    if (!canGenerateSelectedMode) return
    if (generationMode === 'asset-reference') {
      void dispatchNodeAction(data, {
        type: 'generate_asset_reference_video',
        blockIndex: details.blockIndex,
        referenceImageUrls: assetReferenceImageUrls,
        generationOptions: videoPlanGenerationOptions(data),
      })
      return
    }
    if (details.kind === 'group') {
      void dispatchNodeAction(data, {
        type: 'generate_video_group',
        gridMode: details.gridMode === '3x3' ? '3x3' : '2x2',
        shotNumbers: details.shotNumbers,
        generationOptions: videoPlanGenerationOptions(data),
      })
      return
    }
    if (
      hasText(firstStoryboardReference?.panelId)
      && hasText(firstStoryboardReference?.storyboardId)
      && typeof firstStoryboardReference.panelIndex === 'number'
    ) {
      void dispatchNodeAction(data, {
        type: 'generate_video',
        storyboardId: firstStoryboardReference.storyboardId,
        panelIndex: firstStoryboardReference.panelIndex,
        panelId: firstStoryboardReference.panelId,
        generationOptions: videoPlanGenerationOptions(data),
      })
    }
  }
  return (
    <div className={nodeContentInteractionClass(data, 'space-y-3')}>
      {displayOutputUrl ? (
        <div className="nodrag nowheel inline-flex w-full rounded-full bg-slate-100 p-1 ring-1 ring-slate-200">
          <button
            type="button"
            className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition ${previewMode === 'reference' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            onClick={() => setPreviewMode('reference')}
          >
            {labels('videoPlanReference')}
          </button>
          <button
            type="button"
            className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition ${previewMode === 'video' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            onClick={() => setPreviewMode('video')}
          >
            {labels('videoPlanOutput')}
          </button>
        </div>
      ) : null}
      {shouldShowVideo && displayOutputUrl ? (
        <div className="nodrag nowheel relative flex w-full items-center justify-center overflow-hidden rounded-[16px] bg-black" style={outputStyle}>
          <video
            src={displayOutputUrl}
            aria-label={data.title}
            controls
            preload="metadata"
            onLoadedMetadata={handleOutputVideoLoadedMetadata}
            className="h-full w-full object-contain"
          />
        </div>
      ) : (
        <div className={`space-y-2 rounded-[18px] bg-white p-3 ring-1 ring-slate-200 ${running ? 'workspace-node-loading-surface' : ''}`}>
          {(shouldShowAssetReferences ? assetReferences : storyboardReferences).length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {(shouldShowAssetReferences ? assetReferences : storyboardReferences).map((item) => {
                const imageUrl = item.imageUrl
                const key = 'id' in item ? item.id : `shot:${item.shotNumber}`
                const alt = 'name' in item ? item.name : labels('videoPlanShotAlt', { shot: item.shotNumber })
                const label = 'name' in item ? item.name : String(item.shotNumber)
                const displayImageUrl = imageUrl ? toDisplayImageUrl(imageUrl) ?? imageUrl : null
                const referenceAspectRatio = 'aspectRatio' in item ? item.aspectRatio : null
                return (
                  <VideoPlanReferenceThumbnail
                    key={key}
                    sourceImageUrl={imageUrl}
                    displayImageUrl={displayImageUrl}
                    alt={alt}
                    label={label}
                    initialAspectRatio={referenceAspectRatio}
                  />
                )
              })}
            </div>
          ) : (
            <div className="flex w-full items-center justify-center rounded-[14px] bg-white text-slate-400 ring-1 ring-slate-200" style={outputStyle}>
              <div className="flex flex-col items-center gap-1 py-8">
                <AppIcon name="image" className="h-5 w-5" />
                <span className="text-[10px] font-semibold">{missingReferenceLabel}</span>
              </div>
            </div>
          )}
        </div>
      )}
      {canUseNodeActions ? renderSection(labels('generationMode'), (
        <div className="space-y-2">
          <div className="inline-flex w-full rounded-full bg-slate-100 p-1 ring-1 ring-slate-200">
            <button
              type="button"
              className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition ${generationMode === 'storyboard' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              onClick={() => {
                setGenerationMode('storyboard')
                setPreviewMode('reference')
              }}
            >
              {labels('storyboardReferenceVideoMode')}
            </button>
            <button
              type="button"
              className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition ${generationMode === 'asset-reference' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              onClick={() => {
                setGenerationMode('asset-reference')
                setPreviewMode('reference')
              }}
            >
              {labels('assetReferenceVideoMode')}
            </button>
          </div>
          <button
            type="button"
            disabled={!canGenerateSelectedMode}
            onClick={handleGenerateSelectedMode}
            className="w-full rounded-md bg-slate-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generateLabel}
          </button>
          {shouldShowVideoModelHint ? (
            <p className="text-xs leading-5 text-[var(--glass-tone-danger-fg)]">{labels('videoPlanModelMissing')}</p>
          ) : null}
        </div>
      )) : null}
      {renderSection(labels('videoPlanMeta'), (
        <div className="space-y-1">
          {renderValue(labels('generationMode'), details.kind === 'group' ? labels('videoPlanGroup') : labels('videoPlanSingle'))}
          {renderValue(labels('duration'), `${details.durationSec}s`)}
        </div>
      ))}
      {details.prompt ? (
        <EditablePromptSection
          title={labels('videoPlanPrompt')}
          value={details.prompt}
          expanded={expanded}
          labels={labels}
          onSave={videoPlanPromptSaveHandler(data)}
        />
      ) : null}
      {expanded ? renderSection(labels('reason'), renderTextBlock(details.reason)) : null}
      {details.errorMessage ? renderSection(labels('error'), renderTextBlock(details.errorMessage)) : null}
      {details.validationMessage ? renderSection(labels('error'), renderTextBlock(details.validationMessage)) : null}
    </div>
  )
}

function SpaceConsistencyContent({
  data,
  labels,
  expanded,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly labels: ReturnType<typeof useTranslations>
  readonly expanded: boolean
}) {
  const details = data.spaceConsistencyDetails
  if (!details) return <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>

  if (!expanded) {
    return (
      <div className="space-y-3">
        <MediaPreview data={data} />
        {renderSection(labels('spaceConsistencyStats'), (
          <div className="space-y-1">
            {renderValue(labels('status'), details.stage ?? data.statusLabel)}
            {renderValue(labels('spatialProfileCount'), details.spatialProfileCount)}
            {renderValue(labels('cameraPlanCount'), details.cameraPlanCount)}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className={nodeContentInteractionClass(data, 'space-y-3')}>
      <MediaPreview data={data} />
      {renderSection(labels('spaceConsistencyStats'), (
        <div className="space-y-1">
          {renderValue(labels('status'), details.stage ?? data.statusLabel)}
          {renderValue(labels('spatialProfileCount'), details.spatialProfileCount)}
          {renderValue(labels('cameraPlanCount'), details.cameraPlanCount)}
        </div>
      ))}
      {details.cameraPlans.length > 0 ? (
        <div className="space-y-1.5">
          <p className={`${SELECTABLE_TEXT_CLASS} flex items-center gap-1 text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}><FieldGlyph name="pin" className="h-3 w-3" />{labels('cameraPlans')}</p>
          <SpaceCameraGrid details={details} />
        </div>
      ) : renderTextSection(labels('reason'), data.body)}
      {details.spatialProfiles.length > 0 ? (
        <div className="space-y-1.5">
          <p className={`${SELECTABLE_TEXT_CLASS} flex items-center gap-1 text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}><FieldGlyph name="grid" className="h-3 w-3" />{labels('spatialProfiles')}</p>
          {details.spatialProfiles.map((profile, index) => (
            <section key={`${profile.targetId ?? profile.requirementId ?? 'profile'}:${index}`} className="space-y-1.5 rounded-[14px] bg-slate-50 p-3 ring-1 ring-slate-100">
              <div className="flex items-center justify-between gap-2">
                <p className={`${SELECTABLE_TEXT_CLASS} truncate text-xs font-semibold text-[var(--glass-text-primary)]`}>{profile.name ?? labels('location')}</p>
                <span className={`${SELECTABLE_TEXT_CLASS} shrink-0 rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200`}>{profile.shotNumbers.length > 0 ? profile.shotNumbers.join(', ') : labels('unknown')}</span>
              </div>
              {profile.sceneSummary ? renderTextBlock(profile.sceneSummary) : null}
              {profile.anchors.length > 0 ? renderSubsection(labels('anchors'), (
                <div className="space-y-1.5">
                  {profile.anchors.map((anchor, anchorIndex) => (
                    <div key={`${profile.targetId ?? profile.name ?? 'anchor'}:${anchor.label ?? anchorIndex}`} className="space-y-1 rounded-[10px] bg-white p-2 ring-1 ring-slate-100">
                      {renderValue(labels('anchor'), anchor.label)}
                      {renderValue(labels('screenArea'), anchor.screenArea)}
                      {renderValue(labels('depthLayer'), anchor.depthLayer)}
                      {anchor.spatialRelations.length > 0 ? renderChips(labels('spatialRelations'), anchor.spatialRelations) : null}
                    </div>
                  ))}
                </div>
              )) : null}
              {profile.depthLayout ? renderSubsection(labels('depthLayout'), (
                <div className="space-y-1">
                  {renderValue(labels('foreground'), profile.depthLayout.foreground)}
                  {renderValue(labels('midground'), profile.depthLayout.midground)}
                  {renderValue(labels('background'), profile.depthLayout.background)}
                </div>
              )) : null}
              {profile.lightingDirection ? renderSubsection(labels('lightingDirection'), renderTextBlock(profile.lightingDirection)) : null}
            </section>
          ))}
        </div>
      ) : null}
    </div>
  )
}

// 空间一致性：机位状态网格（每镜一格，点开看机位详情）
function SpaceCameraGrid({ details }: { readonly details: NonNullable<WorkspaceCanvasFlowNode['data']['spaceConsistencyDetails']> }) {
  const plans = details.cameraPlans
  const [open, setOpen] = useState<number | null>(null)
  const cur = open === null ? null : plans[open]
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-4 gap-2">
        {plans.map((plan, index) => {
          const on = open === index
          return (
            <button key={`${plan.sourceShotNumber ?? index}:${plan.sourceVideoBlockId ?? 'c'}`} type="button" className={`nodrag flex flex-col items-center rounded-[12px] border p-2 transition ${on ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200 hover:border-slate-300'}`} onClick={(e) => { e.stopPropagation(); setOpen(on ? null : index) }}>
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white">{plan.sourceShotNumber ?? index + 1}</span>
              <FieldGlyph name="pin" className="mt-1 h-4 w-4 text-[var(--glass-text-tertiary)]" />
              <span className="mt-1 inline-flex items-center gap-0.5 text-[9px] font-semibold text-emerald-600"><AppIcon name="check" className="h-2.5 w-2.5" />OK</span>
            </button>
          )
        })}
      </div>
      {cur ? shotDetailIconGrid([
        { label: '运镜', value: cur.cameraMovement },
        { label: '景别', value: cur.shotScale },
        { label: '机位', value: cur.cameraPosition },
        { label: '机位高度', value: cur.cameraHeight },
        { label: '拍摄角度', value: cur.cameraAngle },
        { label: '镜头景深', value: cur.lensAndDepth },
        { label: '构图', value: cur.composition },
        { label: '美学意图', value: cur.aestheticIntent },
      ]) : null}
    </div>
  )
}

function NodeContent({
  data,
  labels,
  expanded,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly labels: ReturnType<typeof useTranslations>
  readonly expanded: boolean
}) {
  if (data.__running === true) {
    if (
      data.kind === 'shot' ||
      data.kind === 'imageAsset' ||
      data.kind === 'videoClip' ||
      data.kind === 'editRequiredAsset'
    ) {
      return <MediaPreview data={data} />
    }
  }

  switch (data.kind) {
    case 'analysis':
      return <AnalysisContent data={data} />
    case 'shot':
      return <ShotContent data={data} labels={labels} expanded={expanded} />
    case 'imageAsset':
      return <ImageContent data={data} labels={labels} expanded={expanded} />
    case 'videoClip':
      return <VideoContent data={data} labels={labels} expanded={expanded} />
    case 'finalTimeline':
      return <FinalContent data={data} labels={labels} expanded={expanded} />
    case 'bgmScore':
      return <BgmScoreContent data={data} labels={labels} expanded={expanded} />
    case 'editScreenplay':
      return <EditScreenplayContent data={data} labels={labels} expanded={expanded} />
    case 'editStylePreview':
      return <StyleBibleContent data={data} labels={labels} expanded={expanded} />
    case 'editStyleBible':
      return <StyleBibleContent data={data} labels={labels} expanded={expanded} />
    case 'editDirectorDecoupage':
      return <EditDirectorDecoupageContent data={data} labels={labels} expanded={expanded} />
    case 'editPipelineStep':
      return <EditPipelineStepContent data={data} labels={labels} expanded={expanded} />
    case 'editProcessGroup':
      return <ProcessGroupContent data={data} labels={labels} expanded={expanded} />
    case 'editScript':
      return <EditScriptContent data={data} labels={labels} />
    case 'editCinematographyShotPlan':
      return <EditCinematographyContent data={data} labels={labels} />
    case 'spaceConsistency':
      return <SpaceConsistencyContent data={data} labels={labels} expanded={expanded} />
    case 'storyboardPanelGeneration':
      return <EditPipelineStepContent data={data} labels={labels} expanded={expanded} />
    case 'videoPlan':
      return <VideoPlanContent data={data} labels={labels} expanded={expanded} />
    case 'editRequiredAsset':
      return <EditAssetContent data={data} labels={labels} expanded={expanded} />
    case 'editAssetGroup':
      return <EditAssetGroupContent data={data} labels={labels} />
  }
}

export default function WorkspaceNode({ data }: NodeProps<WorkspaceCanvasFlowNode>) {
  const labels = useTranslations('projectWorkflow.canvas.workspace.nodeFields')
  const measuredContentRef = useRef<HTMLDivElement | null>(null)
  const expanded = data.expanded === true
  const hasSource = data.kind !== 'finalTimeline'
  const action = data.action
  const canToggleDetails = nodeCanToggleDetails(data.kind)
  const isRunning = nodeIsRunning(data)
  const secondaryAction = data.secondaryAction
  const tertiaryAction = data.tertiaryAction
  const secondaryActionIcon: AppIconName = secondaryAction?.type === 'open_video_block_arrangement'
    ? 'link'
    : 'externalLink'
  const tertiaryActionIcon: AppIconName = tertiaryAction?.type === 'generate_storyboard_grid_images'
    ? 'grid'
    : 'externalLink'
  const nodeId = data.nodeId
  const onMeasureNodeSize = data.onMeasureNodeSize
  const showDetailsToggle = canToggleDetails && Boolean(data.onToggleExpanded)
  const showHeaderAction = Boolean(action && data.actionLabel && (data.kind === 'spaceConsistency' || data.kind === 'editRequiredAsset'))
  const showLargeTitle = data.kind !== 'shot'
  const isFocusHighlighted = data.focusHighlighted === true
  const isVisuallyEmphasized = isRunning || isFocusHighlighted
  const shouldShowFooter = (
    showDetailsToggle ||
    Boolean(action && data.actionLabel && !showHeaderAction) ||
    Boolean(secondaryAction && data.secondaryActionLabel) ||
    Boolean(tertiaryAction && data.tertiaryActionLabel) ||
    nodeShowsMetaFooter(data.kind)
  )
  const runningData = isRunning ? { ...data, __running: true } : data
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!nodeId || !onMeasureNodeSize || !nodeNeedsActualHeightMeasurement(data.kind)) return undefined
    if (data.isRunning === true && nodeFreezesMeasurementWhileRunning(data.kind)) return undefined
    const element = measuredContentRef.current
    if (!element) return undefined

    const measure = () => {
      const rect = element.getBoundingClientRect()
      onMeasureNodeSize(nodeId, {
        width: Math.ceil(rect.width),
        height: Math.ceil(element.scrollHeight + 2),
      })
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [data.kind, data.expanded, data.isRunning, data.streamPresentation, data.bgmScoreDetails, data.editScreenplayDetails, data.styleBibleDetails, data.editScriptDetails, data.editPipelineStepDetails, data.editProcessGroupDetails, data.editAssetGroupDetails, nodeId, onMeasureNodeSize])

  return (
    <WorkspaceNodeImagePreviewContext.Provider value={setPreviewImageUrl}>
      <div className={`relative overflow-visible ${data.kind === 'editScript' ? 'h-auto' : 'h-full'}`}>
        <Handle type="target" position={Position.Left} className="!z-10 !h-3.5 !w-3.5 !border-2 !border-white !bg-slate-500 !shadow-sm" />
        {hasSource ? <Handle type="source" position={Position.Right} className="!z-10 !h-3.5 !w-3.5 !border-2 !border-white !bg-slate-500 !shadow-sm" /> : null}

        <article className={`relative ${data.kind === 'editScript' ? 'overflow-hidden' : 'min-h-full overflow-visible'} rounded-[24px] border bg-white/92 shadow-[0_18px_48px_rgba(15,23,42,0.08)] backdrop-blur-xl ${isVisuallyEmphasized ? 'workspace-node-running-breathing border-sky-300' : 'border-slate-200'}`}>
        <div ref={measuredContentRef}>
          <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--glass-text-tertiary)]">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-[11px] bg-slate-100 text-[var(--glass-text-secondary)]">
                  <AppIcon name={nodeIconName(data.kind)} className="h-4 w-4" />
                </span>
                {data.indexLabel ? (
                  <span className={`${SELECTABLE_TEXT_CLASS} inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-100 px-2 text-[11px] font-semibold text-[var(--glass-text-secondary)]`}>
                    {data.indexLabel}
                  </span>
                ) : null}
                <p className={`${SELECTABLE_TEXT_CLASS} truncate`}>
                  {data.eyebrow}
                </p>
              </div>
              {showLargeTitle ? (
                <h2 className={`${SELECTABLE_TEXT_CLASS} mt-2 truncate text-xl font-semibold tracking-tight text-[var(--glass-text-primary)]`}>{data.title}</h2>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {showHeaderAction && action && data.actionLabel ? (
                <button
                  type="button"
                  className="nodrag inline-flex items-center gap-1.5 rounded-[14px] bg-slate-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-slate-400"
                  disabled={data.actionDisabled === true || isRunning}
                  onClick={() => {
                    if (!isRunning) data.onAction?.(action, data.nodeId)
                  }}
                >
                  <AppIcon name="refresh" className="h-3.5 w-3.5" />
                  {data.actionLabel}
                </button>
              ) : null}
              <span className={`${SELECTABLE_TEXT_CLASS} inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium ${isRunning ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white text-[var(--glass-text-secondary)]'}`}>
                {isRunning ? <LoadingSpinner /> : null}
                {data.statusLabel}
              </span>
            </div>
          </header>

          <div className={`space-y-4 px-5 py-5 ${isRunning ? 'opacity-90' : ''}`}>
            <NodeContent data={runningData} labels={labels} expanded={expanded} />
            {nodeUsesInlineTaskProgress(data.kind) ? (
              <EstimatedTaskProgressInline taskState={data.taskProgress} />
            ) : null}

            {shouldShowFooter ? (
              <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
                <p className={`${SELECTABLE_TEXT_CLASS} min-w-0 truncate text-xs text-[var(--glass-text-tertiary)]`}>
                  {data.kind === 'editRequiredAsset' ? '' : data.meta}
                </p>
                <div className="flex shrink-0 items-center gap-1.5">
                  {showDetailsToggle ? (
                    <button
                      type="button"
                      className="nodrag inline-flex items-center gap-1.5 rounded-[14px] border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-[var(--glass-text-secondary)] transition hover:bg-slate-50"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={(event) => {
                        event.currentTarget.blur()
                        if (data.nodeId) data.onToggleExpanded?.(data.nodeId)
                      }}
                    >
                      {expanded ? labels('collapseDetails') : labels('expandDetails')}
                    </button>
                  ) : null}
                  {action && data.actionLabel && !showHeaderAction ? (
                    <button
                      type="button"
                      className="nodrag inline-flex items-center gap-1.5 rounded-[14px] bg-slate-950 px-3 py-2.5 text-xs font-semibold text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-slate-400"
                      disabled={data.actionDisabled === true || isRunning}
                      onClick={() => {
                        if (!isRunning) data.onAction?.(action, data.nodeId)
                      }}
                    >
                      {isRunning ? <LoadingSpinner /> : <AppIcon name="arrowRight" className="h-3.5 w-3.5" />}
                      {data.actionLabel}
                    </button>
                  ) : null}
                  {secondaryAction && data.secondaryActionLabel ? (
                    <button
                      type="button"
                      className="nodrag inline-flex items-center gap-1.5 rounded-[14px] border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-[var(--glass-text-secondary)] transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={data.actionDisabled === true || isRunning}
                      onClick={() => {
                        if (!isRunning) data.onAction?.(secondaryAction, data.nodeId)
                      }}
                    >
                      <AppIcon name={secondaryActionIcon} className="h-3.5 w-3.5" />
                      {data.secondaryActionLabel}
                    </button>
                  ) : null}
                  {tertiaryAction && data.tertiaryActionLabel ? (
                    <button
                      type="button"
                      className="nodrag inline-flex items-center gap-1.5 rounded-[14px] border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-[var(--glass-text-secondary)] transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={data.actionDisabled === true || isRunning}
                      onClick={() => {
                        if (!isRunning) data.onAction?.(tertiaryAction, data.nodeId)
                      }}
                    >
                      <AppIcon name={tertiaryActionIcon} className="h-3.5 w-3.5" />
                      {data.tertiaryActionLabel}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
        </article>
      </div>
      {previewImageUrl ? (
        <ImagePreviewModal imageUrl={previewImageUrl} onClose={() => setPreviewImageUrl(null)} />
      ) : null}
    </WorkspaceNodeImagePreviewContext.Provider>
  )
}
