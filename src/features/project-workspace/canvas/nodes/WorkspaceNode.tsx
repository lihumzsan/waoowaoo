'use client'

import React, { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useTranslations } from 'next-intl'
import ImagePreviewModal from '@/components/ui/ImagePreviewModal'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import BillingActionButton from '@/components/billing/BillingActionButton'
import { EstimatedTaskProgressInline } from '@/components/task/EstimatedTaskProgressOverlay'
import MediaGenerationLoading from '@/components/media/MediaGenerationLoading'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import EditScriptPreviewDetail from '../details/EditScriptPreviewDetail'
import { workspaceCanvasScrollableRegionProps } from '../canvas-scroll-lock'
import { getWorkspaceCanvasNodePresentationProfile } from '../node-presentation-profiles'
import { AdaptiveImageAspectFrame } from './AdaptiveImageAspectFrame'
import { FieldGlyph, glyphForField } from './field-glyphs'
import {
  WORKSPACE_CANVAS_MEASURE_AFTER_MOTION_DELAY_MS,
  WORKSPACE_CANVAS_MOTION_ACTIVE_SELECTOR,
  WorkspaceCanvasMotionPresence,
  workspaceCanvasRevealClass,
} from './workspace-node-motion'
import type {
  WorkspaceCanvasEditAssetGroupItem,
  WorkspaceCanvasFlowNode,
  WorkspaceCanvasNodeAction,
  WorkspaceCanvasShotDetails,
  WorkspaceCanvasStreamPresentation,
  WorkspaceCanvasTextLine,
} from '../node-canvas-types'
import type { LocationSpatialProfileStatus } from '@/lib/location-spatial-profile/types'

function nodeIconName(kind: WorkspaceCanvasFlowNode['data']['kind']): AppIconName {
  switch (kind) {
    case 'shot':
      return 'clapperboard'
    case 'imageAsset':
      return 'image'
    case 'videoClip':
      return 'video'
    case 'finalTimeline':
      return 'film'
    case 'editBible':
      return 'bookOpen'
    case 'editStylePreview':
      return 'image'
    case 'editStyleBible':
      return 'sparklesAlt'
    case 'editPipelineStep':
      return 'chart'
    case 'editProcessGroup':
      return 'grid'
    case 'editScript':
      return 'clipboardCheck'
    case 'editShotExecutionPlan':
      return 'image'
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
  const expandedContent = renderTextBlock(value)
  const collapsedContent = renderSummaryText(displayed, 3)
  const content = expanded ? expandedContent : collapsedContent
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
          {!expanded ? collapsedContent : null}
          <WorkspaceCanvasMotionPresence visible={expanded}>
            {expandedContent}
          </WorkspaceCanvasMotionPresence>
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
  if (data.artifactPhase) return data.artifactPhase === 'running'
  return data.isRunning === true
}

function nodeShowsMetaFooter(kind: WorkspaceCanvasFlowNode['data']['kind']): boolean {
  return kind !== 'editRequiredAsset' && kind !== 'editScript'
}

export async function dispatchNodeAction(data: WorkspaceCanvasFlowNode['data'], action: WorkspaceCanvasNodeAction) {
  await Promise.resolve(data.onAction?.(action, data.nodeId))
}

function panelPromptSaveHandler(
  data: WorkspaceCanvasFlowNode['data'],
  field: 'imagePrompt' | 'videoPrompt',
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

function nodeActionIconName(action: WorkspaceCanvasNodeAction): AppIconName {
  switch (action.type) {
    case 'generate_image':
      return 'image'
    case 'generate_video':
    case 'generate_video_group':
    case 'generate_all_videos':
    case 'generate_asset_reference_video':
      return 'video'
    case 'generate_bgm_score':
      return 'audioWave'
    case 'render_final_video':
      return 'film'
    case 'generate_edit_assets':
    case 'generate_edit_asset':
      return 'package'
    case 'regenerate_edit_asset_image':
      return 'refresh'
    default:
      return 'arrowRight'
  }
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

function shotPreviewAspectRatio(data: WorkspaceCanvasFlowNode['data']): number {
  const aspectRatio = data.previewAspectRatio
  if (typeof aspectRatio === 'number' && Number.isFinite(aspectRatio) && aspectRatio > 0) return aspectRatio
  return 16 / 9
}

function ShotImagePreview({ data }: { readonly data: WorkspaceCanvasFlowNode['data'] }) {
  const displayImageUrl = toDisplayImageUrl(data.previewImageUrl)
  const displayStyleImageUrl = toDisplayImageUrl(data.loadingStyleImageUrl)
  const running = data.__running === true
  const frameStyle: React.CSSProperties = { aspectRatio: String(shotPreviewAspectRatio(data)) }

  return (
    <div className="relative overflow-hidden rounded-[18px] border border-slate-200 bg-slate-100" style={frameStyle}>
      {displayImageUrl ? (
        <PreviewableImage
          sourceImageUrl={data.previewImageUrl ?? displayImageUrl}
          displayImageUrl={displayImageUrl}
          alt={data.title}
          buttonClassName="block h-full w-full cursor-zoom-in overflow-hidden"
          imageClassName="block h-full w-full object-cover"
        />
      ) : (
        <>
          {displayStyleImageUrl ? (
            <>
              <div
                className="absolute inset-0 scale-110"
                style={{
                  backgroundImage: `url("${displayStyleImageUrl}")`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  filter: 'blur(18px)',
                }}
              />
              <div className="absolute inset-0 bg-white/45 backdrop-blur-xl" />
            </>
          ) : (
            <div className="absolute inset-0 bg-[linear-gradient(135deg,#f8fafc_0%,#e2e8f0_48%,#cbd5e1_100%)]" />
          )}
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="inline-flex h-16 w-16 items-center justify-center rounded-[18px] bg-white/72 shadow-sm ring-1 ring-slate-200 backdrop-blur">
              <AppIcon name="image" className="h-8 w-8 text-slate-400" />
            </span>
          </div>
        </>
      )}
      <MediaGenerationLoading taskState={data.taskProgress} styleImageUrl={data.loadingStyleImageUrl} size={72} showBackground={false} />
      {running && displayImageUrl ? <div className="pointer-events-none absolute inset-0 bg-white/10" /> : null}
    </div>
  )
}

function ShotMetaAttrChip({
  icon,
  label,
  value,
}: {
  readonly icon: AppIconName
  readonly label: string
  readonly value: string | null | undefined
}) {
  if (!hasText(value)) return null
  return (
    <span className={`${SELECTABLE_TEXT_CLASS} inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-[var(--glass-text-secondary)]`}>
      <AppIcon name={icon} className="h-3.5 w-3.5 text-[var(--glass-text-tertiary)]" />
      <span className="text-[var(--glass-text-tertiary)]">{label}</span>
      <span>{value}</span>
    </span>
  )
}

function ShotMetaTagChip({
  icon,
  text,
}: {
  readonly icon: AppIconName
  readonly text: string
}) {
  if (!hasText(text)) return null
  return (
    <span className={`${SELECTABLE_TEXT_CLASS} inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-[var(--glass-text-secondary)]`}>
      <AppIcon name={icon} className="h-3.5 w-3.5 text-[var(--glass-text-tertiary)]" />
      {text}
    </span>
  )
}

function ShotMetaChips({
  details,
  labels,
}: {
  readonly details: WorkspaceCanvasShotDetails
  readonly labels: ReturnType<typeof useTranslations>
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <ShotMetaAttrChip icon="crosshair" label={labels('shotType')} value={details.shotType} />
      {details.characters.map((character) => (
        <ShotMetaTagChip
          key={`character:${character.name}:${character.appearance ?? ''}`}
          icon="user"
          text={character.appearance ? `${character.name} / ${character.appearance}` : character.name}
        />
      ))}
      <ShotMetaAttrChip icon="mapPin" label={labels('location')} value={details.location} />
    </div>
  )
}

// 最终提示词降级为只读折叠：默认收起，展开也不可编辑（imagePrompt 是 AI 依据镜头参数合成的机器产物）。
function ShotPromptDisclosure({
  details,
  labels,
}: {
  readonly details: WorkspaceCanvasShotDetails
  readonly labels: ReturnType<typeof useTranslations>
}) {
  const [open, setOpen] = useState(false)
  if (!hasText(details.imagePrompt)) return null

  return (
    <div className="space-y-2">
      <button
        type="button"
        aria-expanded={open}
        onPointerDownCapture={(event) => event.stopPropagation()}
        onClick={() => setOpen((prev) => !prev)}
        className="nodrag nowheel flex w-full items-center justify-between rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2.5 text-[12px] font-medium text-[var(--glass-text-secondary)] transition hover:bg-slate-100"
      >
        <span className="flex items-center gap-2">
          <AppIcon name="lock" className="h-4 w-4 text-[var(--glass-text-tertiary)]" />
          {labels('promptReadOnlyAdvanced')}
        </span>
        <AppIcon name="chevronDown" className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <WorkspaceCanvasMotionPresence visible={open} motionKey="shot-prompt">
        <pre
          className={`${SELECTABLE_TEXT_CLASS} nodrag nowheel max-h-56 w-full max-w-full overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words rounded-[14px] border border-slate-200 bg-white px-3 py-2.5 font-mono text-[10px] leading-4 text-[var(--glass-text-tertiary)] [overflow-wrap:anywhere]`}
          {...workspaceCanvasScrollableRegionProps<HTMLPreElement>()}
        >
          {details.imagePrompt}
        </pre>
      </WorkspaceCanvasMotionPresence>
    </div>
  )
}

function ShotContent({
  data,
  labels,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly labels: ReturnType<typeof useTranslations>
}) {
  const details = data.shotDetails
  if (!details) return <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
  return (
    <div className="space-y-3">
      <ShotImagePreview data={data} />
      <ShotMetaChips details={details} labels={labels} />
      {hasText(data.body) ? (
        <p className={`${SELECTABLE_TEXT_CLASS} text-[13px] leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
      ) : null}
      <ShotPromptDisclosure details={details} labels={labels} />
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
          <WorkspaceCanvasMotionPresence visible={expanded} className="space-y-2">
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
              {renderTextSection(labels('error'), details.errorMessage)}
          </WorkspaceCanvasMotionPresence>
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
          <WorkspaceCanvasMotionPresence visible={expanded} className="space-y-2">
              {renderSection(labels('videoMeta'), (
                <div className="space-y-1">
                  {renderValue(labels('videoModel'), details.videoModel)}
                  {renderValue(labels('baseVideo'), details.videoUrl)}
                </div>
              ))}
              {details.lastVideoGenerationOptions && details.lastVideoGenerationOptions.length > 0
                ? renderSection(labels('lastOptions'), renderLines(details.lastVideoGenerationOptions, labels))
                : null}
              {renderTextSection(labels('error'), details.errorMessage)}
          </WorkspaceCanvasMotionPresence>
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
      <WorkspaceCanvasMotionPresence visible={expanded}>
        {renderChips(labels('videoOrder'), details.orderedVideoLabels)}
      </WorkspaceCanvasMotionPresence>
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
  const wideLayoutActive = expanded && data.expandedLayout === 'wide'
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
  const errorSection = renderTextSection(labels('error'), details.errorMessage)

  const wideContent = (
    <div className={`grid gap-3 rounded-[18px] lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)] ${data.__running === true ? 'workspace-node-loading-surface' : ''}`}>
      <div className="space-y-2">
        {mixSection}
        {statsSection}
        {missingPromptSection}
        {errorSection}
      </div>
      <WorkspaceCanvasMotionPresence visible={expanded} exit={false} className="grid min-w-0 gap-3 md:grid-cols-2">
        <div className="space-y-2">
          {overviewSection}
          {designSections}
          {virtualLayerSections}
        </div>
        <div className="space-y-2">
          {promptSections}
          {finalPromptSection}
        </div>
      </WorkspaceCanvasMotionPresence>
    </div>
  )
  const standardContent = (
    <div className={`space-y-2 rounded-[18px] ${data.__running === true ? 'workspace-node-loading-surface' : ''}`}>
      {mixSection}
      {statsSection}
      {missingPromptSection}
      <WorkspaceCanvasMotionPresence visible={expanded} className="space-y-2">
        {overviewSection}
        {designSections}
        {virtualLayerSections}
        {promptSections}
        {finalPromptSection}
      </WorkspaceCanvasMotionPresence>
      {errorSection}
    </div>
  )
  return (
    <>
      {!wideLayoutActive ? standardContent : null}
      <WorkspaceCanvasMotionPresence visible={wideExpanded} exit={false}>
        {wideContent}
      </WorkspaceCanvasMotionPresence>
    </>
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
  const collapsedSummary = <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
  return (
    <>
      {!expanded ? collapsedSummary : null}
      <WorkspaceCanvasMotionPresence visible={expanded} className="space-y-2">
        {details.items.map((item, index) => (
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
      </WorkspaceCanvasMotionPresence>
    </>
  )
}

const PROCESS_STEP_GLYPHS: Record<string, string> = {
  timeline: 'clock', action: 'motion', camera: 'target', audio: 'sound', primaryTable: 'film', assetExtract: 'people',
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
  const collapsedSummary = <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
  return (
    <>
      {!expanded ? collapsedSummary : null}
      <WorkspaceCanvasMotionPresence visible={expanded} exit={false}>
        <ProcessStepGrid steps={details.steps} labels={labels} />
      </WorkspaceCanvasMotionPresence>
    </>
  )
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
      <WorkspaceCanvasMotionPresence
        visible={Boolean(current)}
        motionKey={current?.key ?? 'none'}
        className="space-y-2 rounded-[14px] bg-slate-50 p-3 ring-1 ring-slate-100"
      >
        {current ? (
          <>
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
          </>
        ) : null}
      </WorkspaceCanvasMotionPresence>
      {!current ? (
        <p className={`${SELECTABLE_TEXT_CLASS} text-xs text-[var(--glass-text-tertiary)]`}>{labels('expandDetails')}</p>
      ) : null}
    </div>
  )
}

interface ShotGridCard {
  readonly key: string
  readonly badge: ReactNode
  readonly title: string
  readonly subtitle?: string
  readonly meta?: string
  readonly characterCount: number
  readonly detailTitle?: string
  readonly detailMeta?: string
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
type EditScriptShotCardSource = NonNullable<WorkspaceCanvasFlowNode['data']['editScriptDetails']>['shots'][number]
type EditPipelineStepCardSource = NonNullable<WorkspaceCanvasFlowNode['data']['editPipelineStepDetails']>['items'][number]

function compactEntityName(value: string): string {
  const name = value.split('/')[0]?.trim()
  return name && name.length > 0 ? name : value.trim()
}

function uniqueCompactEntityNames(values: readonly string[]): readonly string[] {
  const seen = new Set<string>()
  const names: string[] = []
  values.forEach((value) => {
    const name = compactEntityName(value)
    if (!name || seen.has(name)) return
    seen.add(name)
    names.push(name)
  })
  return names
}

function editScriptShotCharacterNames(shot: EditScriptShotCardSource): readonly string[] {
  return uniqueCompactEntityNames(shot.characters)
}

function compactList(values: readonly string[], separator: string): string {
  return values.join(separator)
}

function fieldValue(fields: readonly ShotField[], label: string): string | null {
  return fields.find((field) => field.label === label)?.value ?? null
}

function numericChipValue(values: readonly string[] | undefined): string | null {
  return values?.find((value) => /^\d+$/.test(value.trim()))?.trim() ?? null
}

function executionPlanShotKey(item: EditPipelineStepCardSource, index: number): string {
  return numericChipValue(item.chips) ?? item.title.match(/\d+/)?.[0] ?? String(index + 1)
}

function executionPlanCharacterNames(item: EditPipelineStepCardSource): readonly string[] {
  return uniqueCompactEntityNames((item.chips ?? []).filter((chip) => chip.includes('/')))
}

function executionPlanObjectNames(item: EditPipelineStepCardSource): readonly string[] {
  return uniqueCompactEntityNames((item.chips ?? []).filter((chip) => {
    const trimmed = chip.trim()
    return trimmed.length > 0 && !trimmed.includes('/') && !/^\d+$/.test(trimmed)
  }))
}

// 图标字段卡：图标 + 标签 + 值（可读性强的三级排版）
function shotIconField(field: ShotField, options?: { readonly allowWideFields?: boolean }) {
  if (!hasText(field.value)) return null
  const span = options?.allowWideFields !== false && (field.value ?? '').length > 40
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
function shotDetailIconGrid(fields: readonly ShotField[], options?: { readonly fixedColumns?: boolean; readonly allowWideFields?: boolean }) {
  const cells = fields.map((field) => shotIconField(field, { allowWideFields: options?.allowWideFields })).filter(Boolean)
  if (cells.length === 0) return null
  return <div className={`grid gap-2 ${options?.fixedColumns === true ? 'grid-cols-2' : 'sm:grid-cols-2'}`}>{cells}</div>
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
                        <AppIcon name="usersRound" className="h-3 w-3" />
                        {card.characterCount}
                        <AppIcon name={isActive ? 'chevronUp' : 'chevronDown'} className="h-3.5 w-3.5" />
                      </span>
                    </div>
                    <p className={`${SELECTABLE_TEXT_CLASS} mt-2 truncate text-[11px] font-semibold leading-4 text-[var(--glass-text-primary)]`}>{card.title}</p>
                    {card.subtitle ? <p className={`${SELECTABLE_TEXT_CLASS} mt-1.5 line-clamp-2 text-[11px] leading-4 text-[var(--glass-text-secondary)]`}>{card.subtitle}</p> : null}
                    {card.meta ? <p className={`${SELECTABLE_TEXT_CLASS} mt-1 truncate text-[10px] leading-4 text-[var(--glass-text-tertiary)]`}>{card.meta}</p> : null}
                  </button>
                )
              })}
            </div>
            <WorkspaceCanvasMotionPresence
              visible={Boolean(activeCard)}
              motionKey={activeCard?.key ?? 'none'}
              className={`space-y-2 rounded-[14px] border border-slate-200 bg-slate-50 p-4 ${streamPresentation?.isStreaming === true ? 'workspace-node-stream-soft-detail' : ''}`}
            >
              {activeCard ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white ${badgeClass}`}>{activeCard.badge}</span>
                    <span className={`${SELECTABLE_TEXT_CLASS} text-sm font-semibold text-[var(--glass-text-primary)]`}>{activeCard.detailTitle ?? activeCard.title}</span>
                    {activeCard.detailMeta ?? activeCard.meta ? <span className={`${SELECTABLE_TEXT_CLASS} min-w-0 truncate text-xs text-[var(--glass-text-tertiary)]`}>{activeCard.detailMeta ?? activeCard.meta}</span> : null}
                  </div>
                  {activeCard.detail}
                </>
              ) : null}
            </WorkspaceCanvasMotionPresence>
          </div>
        )
      })}
    </div>
  )
}

function EditScriptContent({
  data,
  labels,
  expanded,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly labels: ReturnType<typeof useTranslations>
  readonly expanded: boolean
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
  const listSeparator = labels('listSeparator')
  const allCharacterNames = uniqueCompactEntityNames(details.shots.flatMap((shot) => shot.characters))
  const summaryText = allCharacterNames.length > 0
    ? labels('editScriptCompactSummaryWithCharacters', {
        count: details.shotCount,
        characters: compactList(allCharacterNames.slice(0, 4), listSeparator),
      })
    : labels('editScriptCompactSummary', { count: details.shotCount })
  const summaryLine = (
    <div className="flex items-center gap-2.5 rounded-[14px] bg-slate-50 px-4 py-3 ring-1 ring-slate-100">
      <AppIcon name="clapperboard" className="h-4 w-4 shrink-0 text-[var(--glass-text-tertiary)]" />
      <p className={`${SELECTABLE_TEXT_CLASS} truncate text-sm text-[var(--glass-text-secondary)]`}>{summaryText}</p>
    </div>
  )
  const showShotGrid = expanded

  const cards: ShotGridCard[] = details.shots.map((shot) => {
    const characterNames = editScriptShotCharacterNames(shot)
    const keyObjectNames = uniqueCompactEntityNames(shot.keyObjects)
    return {
      key: String(shot.shotNumber),
      badge: shot.shotNumber,
      title: shot.sceneName || labels('shotIndex', { index: shot.shotNumber }),
      subtitle: shot.action,
      meta: characterNames.length > 0 ? compactList(characterNames, listSeparator) : labels('noCharacters'),
      characterCount: characterNames.length,
      detail: (
        <div className="space-y-2.5">
          {shotDetailIconGrid([
            { label: labels('scene'), value: shot.sceneName },
            { label: labels('action'), value: shot.action },
            { label: labels('characters'), value: compactList(characterNames, '\n') },
            { label: labels('keyObjects'), value: compactList(keyObjectNames, '\n') },
            { label: labels('duration'), value: `${shot.durationSec}s` },
            { label: labels('sound'), value: shot.sound },
          ])}
        </div>
      ),
    }
  })

  return (
    <>
      {!showShotGrid ? summaryLine : null}
      <WorkspaceCanvasMotionPresence visible={showShotGrid} exit={false} className={nodeContentInteractionClass(data, 'space-y-3')}>
        {summaryLine}
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
        <ShotGrid cards={cards} accent="slate" streamPresentation={data.streamPresentation} />
      </WorkspaceCanvasMotionPresence>
    </>
  )
}

function EditShotExecutionPlanContent({
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

  const listSeparator = labels('listSeparator')
  const allCharacterNames = uniqueCompactEntityNames(details.items.flatMap((item) => executionPlanCharacterNames(item)))
  const summaryText = allCharacterNames.length > 0
    ? labels('editScriptCompactSummaryWithCharacters', {
        count: details.items.length,
        characters: compactList(allCharacterNames.slice(0, 4), listSeparator),
      })
    : labels('editScriptCompactSummary', { count: details.items.length })
  const summaryLine = (
    <div className="flex items-center gap-2.5 rounded-[14px] bg-slate-50 px-4 py-3 ring-1 ring-slate-100">
      <AppIcon name="image" className="h-4 w-4 shrink-0 text-[var(--glass-text-tertiary)]" />
      <p className={`${SELECTABLE_TEXT_CLASS} truncate text-sm text-[var(--glass-text-secondary)]`}>{summaryText}</p>
    </div>
  )

  const cards: ShotGridCard[] = details.items.map((item, index) => {
    const fields = item.fields
    const shotScale = fieldValue(fields, labels('shotScale'))
    const lens = fieldValue(fields, labels('lens'))
    const focus = fieldValue(fields, labels('focus'))
    const cameraHeight = fieldValue(fields, labels('cameraHeight'))
    const cameraAngle = fieldValue(fields, labels('cameraAngle'))
    const movement = fieldValue(fields, labels('movement'))
    const composition = fieldValue(fields, labels('composition'))
    const lighting = fieldValue(fields, labels('lighting'))
    const axisAndEyeline = fieldValue(fields, labels('axisAndEyeline'))
    const characterNames = executionPlanCharacterNames(item)
    const objectNames = executionPlanObjectNames(item)
    const titleParts = [shotScale, lens].filter(hasText)
    const metaParts = [movement ?? composition, lighting].filter(hasText)
    return {
      key: executionPlanShotKey(item, index),
      badge: index + 1,
      title: titleParts.length > 0 ? compactList(titleParts, ' · ') : item.title,
      subtitle: item.body ?? undefined,
      meta: metaParts.length > 0 ? compactList(metaParts, ' · ') : undefined,
      characterCount: characterNames.length,
      detailTitle: labels('shotIndex', { index: index + 1 }),
      detailMeta: titleParts.length > 0 ? compactList(titleParts, ' · ') : item.title,
      detail: (
        <div className="space-y-2.5">
          {shotDetailIconGrid([
            { label: labels('shotScale'), value: shotScale },
            { label: labels('lens'), value: lens },
            { label: labels('focus'), value: focus },
            { label: labels('cameraHeight'), value: cameraHeight },
            { label: labels('cameraAngle'), value: cameraAngle },
            { label: labels('movement'), value: movement },
            { label: labels('composition'), value: composition },
            { label: labels('lighting'), value: lighting },
            { label: labels('axisAndEyeline'), value: axisAndEyeline },
            { label: labels('characters'), value: compactList(characterNames, '\n') },
            { label: labels('keyObjects'), value: compactList(objectNames, '\n') },
            { label: labels('description'), value: item.body },
          ], { fixedColumns: true, allowWideFields: false })}
        </div>
      ),
    }
  })

  return (
    <>
      {!expanded ? summaryLine : null}
      <WorkspaceCanvasMotionPresence visible={expanded} exit={false} className={nodeContentInteractionClass(data, 'space-y-2.5')}>
        <ShotGrid cards={cards} accent="slate" streamPresentation={data.streamPresentation} />
      </WorkspaceCanvasMotionPresence>
    </>
  )
}

function shouldShowEditAssetStatus(
  asset: WorkspaceCanvasEditAssetGroupItem,
  previewSourceImageUrl: string | null,
): boolean {
  if (!hasText(asset.statusLabel)) return false
  const phase = asset.taskProgress?.phase
  if (asset.isRunning || phase === 'queued' || phase === 'processing' || phase === 'failed') return true
  return !hasText(previewSourceImageUrl)
}

function editAssetStatusIconName(asset: WorkspaceCanvasEditAssetGroupItem): AppIconName {
  const phase = asset.taskProgress?.phase
  if (asset.isRunning || phase === 'queued' || phase === 'processing') return 'loader'
  if (phase === 'failed') return 'alert'
  return 'clock'
}

function EditAssetGroupHeroCard({
  asset,
  isOpen,
  labels,
  loadingStyleImageUrl,
  onPreviewImage,
  onRunAction,
  onSelect,
}: {
  readonly asset: WorkspaceCanvasEditAssetGroupItem
  readonly isOpen: boolean
  readonly labels: ReturnType<typeof useTranslations>
  readonly loadingStyleImageUrl?: string | null
  readonly onPreviewImage: ImagePreviewHandler | null
  readonly onRunAction: (action: WorkspaceCanvasNodeAction) => void
  readonly onSelect: () => void
}) {
  const previewSourceImageUrl = asset.previewImageUrl ?? null
  const imageUrl = toDisplayImageUrl(previewSourceImageUrl)
  const loadingSize = 64
  const showStatus = shouldShowEditAssetStatus(asset, previewSourceImageUrl)
  const statusIconName = editAssetStatusIconName(asset)
  const expandLabel = isOpen ? labels('collapseDetails') : labels('expandDetails')

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isOpen}
      aria-label={`${expandLabel}: ${asset.name}`}
      className={`nodrag cursor-pointer overflow-hidden rounded-[16px] border bg-white text-left shadow-[var(--glass-shadow-sm)] transition focus:outline-none focus:ring-2 focus:ring-slate-900/30 ${isOpen ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200 hover:border-slate-300'}`}
      onClick={(event) => { event.stopPropagation(); onSelect() }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        onSelect()
      }}
    >
      <AdaptiveImageAspectFrame
        sourceKey={previewSourceImageUrl}
        className="relative flex w-full items-center justify-center overflow-hidden bg-slate-100 text-[var(--glass-text-tertiary)]"
      >
        {({ onImageLoad }) => (
          <>
            {imageUrl ? (
              <MediaImageWithLoading
                src={imageUrl}
                alt={asset.name}
                containerClassName="h-full w-full bg-slate-100"
                className="h-full w-full object-contain"
                onLoad={onImageLoad}
              />
            ) : asset.isRunning ? null : (
              <AppIcon name={editAssetPlaceholderIconName(asset.kind)} className="h-9 w-9 text-slate-300" />
            )}
            <MediaGenerationLoading
              taskState={asset.taskProgress}
              styleImageUrl={loadingStyleImageUrl}
              size={loadingSize}
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-3/5 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />
            {showStatus ? (
              <span className="pointer-events-none absolute left-2.5 top-2.5 z-20 inline-flex max-w-[calc(100%-5.5rem)] items-center gap-1 rounded-full bg-black/45 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
                <AppIcon name={statusIconName} className={`h-3 w-3 shrink-0 ${statusIconName === 'loader' ? 'animate-spin' : ''}`} />
                <span className={`${SELECTABLE_TEXT_CLASS} truncate`}>{asset.statusLabel}</span>
              </span>
            ) : null}
            <div className="absolute right-2.5 top-2.5 z-30 flex items-center gap-1.5">
              {previewSourceImageUrl && imageUrl && onPreviewImage ? (
                <button
                  type="button"
                  className="nodrag nowheel inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition hover:bg-black/65 focus:outline-none focus:ring-2 focus:ring-white/80"
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
              {asset.action && asset.actionLabel ? (
                <button
                  type="button"
                  className="nodrag nowheel inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition hover:bg-black/65 focus:outline-none focus:ring-2 focus:ring-white/80 disabled:cursor-not-allowed disabled:opacity-45"
                  aria-label={`${asset.actionLabel}: ${asset.name}`}
                  title={asset.actionLabel}
                  disabled={asset.isRunning}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (asset.action && !asset.isRunning) onRunAction(asset.action)
                  }}
                >
                  <AppIcon name={nodeActionIconName(asset.action)} className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 p-3 pr-12">
              <p className={`${SELECTABLE_TEXT_CLASS} truncate text-lg font-semibold text-white drop-shadow-sm`}>{asset.name}</p>
            </div>
            <span className="pointer-events-none absolute bottom-2.5 right-2.5 z-20 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm">
              <AppIcon name="chevronDown" className={`h-4 w-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            </span>
          </>
        )}
      </AdaptiveImageAspectFrame>
      <WorkspaceCanvasMotionPresence visible={isOpen && hasText(asset.description)} motionKey={asset.requirementId}>
        <p className={`${SELECTABLE_TEXT_CLASS} px-3.5 py-3 text-xs leading-5 text-[var(--glass-text-secondary)]`}>
          {asset.description}
        </p>
      </WorkspaceCanvasMotionPresence>
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
    <div className={nodeContentInteractionClass(data, workspaceCanvasRevealClass('space-y-3'))}>
      <div className="space-y-4">
        {groupedAssets.map((group) => (
          <section key={group.key} className="space-y-2.5">
            <div className="flex items-center gap-2">
              <FieldGlyph name={group.key === 'character' ? 'people' : 'pin'} className="h-4 w-4 text-[var(--glass-text-secondary)]" />
              <span className={`${SELECTABLE_TEXT_CLASS} text-xs font-semibold text-[var(--glass-text-primary)]`}>{group.title}</span>
              <span className={`${SELECTABLE_TEXT_CLASS} text-[11px] text-[var(--glass-text-tertiary)]`}>{group.assets.length}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {group.assets.map((asset) => {
                const on = open === asset.requirementId
                const selectAsset = () => setOpen(on ? null : asset.requirementId)
                return (
                  <EditAssetGroupHeroCard
                    key={asset.requirementId}
                    asset={asset}
                    isOpen={on}
                    labels={labels}
                    loadingStyleImageUrl={data.loadingStyleImageUrl}
                    onPreviewImage={onPreviewImage}
                    onRunAction={(action) => data.onAction?.(action, data.nodeId)}
                    onSelect={selectAsset}
                  />
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function StyleBiblePreview({ data }: { readonly data: WorkspaceCanvasFlowNode['data'] }) {
  const sourceImageUrl = data.previewImageUrl ?? null
  const displayImageUrl = toDisplayImageUrl(sourceImageUrl)
  const running = data.__running === true
  if (!sourceImageUrl || !displayImageUrl) return null

  return (
    <AdaptiveImageAspectFrame
      sourceKey={sourceImageUrl}
      initialAspectRatio={data.previewAspectRatio}
      className={`relative flex w-full items-center justify-center overflow-hidden rounded-[18px] border border-slate-200 bg-slate-100 ${running ? 'workspace-node-loading-surface' : ''}`}
    >
      {({ onImageLoad }) => (
        <>
          <PreviewableImage
            sourceImageUrl={sourceImageUrl}
            displayImageUrl={displayImageUrl}
            alt={data.title}
            buttonClassName="flex h-full w-full cursor-zoom-in items-center justify-center overflow-hidden"
            imageClassName="h-full w-full object-contain"
            onImageLoad={onImageLoad}
          />
          <MediaGenerationLoading
            taskState={data.taskProgress}
            styleImageUrl={data.loadingStyleImageUrl}
            size={64}
          />
        </>
      )}
    </AdaptiveImageAspectFrame>
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

  const collapsedContent = (
    <div className="space-y-2">
      {shouldShowPreview ? <StyleBiblePreview data={data} /> : null}
      {details.styleSummary ? renderSection(labels('styleSummary'), renderTextBlock(details.styleSummary)) : null}
    </div>
  )

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
    <>
      {!expanded ? collapsedContent : null}
      <WorkspaceCanvasMotionPresence visible={expanded} exit={false} className={nodeContentInteractionClass(data, 'space-y-3')}>
        {shouldShowPreview ? <StyleBiblePreview data={data} /> : null}
        {renderTextSection(labels('styleSummary'), details.styleSummary)}
        {renderTextSection(labels('rawUserStyle'), details.rawUserStyle)}
        <StyleBibleGroups groups={groups} />
      </WorkspaceCanvasMotionPresence>
    </>
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
      <WorkspaceCanvasMotionPresence visible={Boolean(current)} motionKey={current?.name ?? 'none'}>
        {current ? shotDetailIconGrid(current.fields) : null}
      </WorkspaceCanvasMotionPresence>
    </div>
  )
}

function EditBibleContent({
  data,
  labels,
  expanded,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly labels: ReturnType<typeof useTranslations>
  readonly expanded: boolean
}) {
  const details = data.editBibleDetails
  if (!details) return <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
  const parsed = parseBibleOutline(details.bibleText)
  const streamClassName = data.streamPresentation?.isStreaming === true ? 'workspace-node-stream-soft-detail' : ''

  const collapsedContent = (
    <div className={`space-y-2 ${streamClassName}`}>
      {parsed.summary
        ? renderSection(labels('summary'), renderSummaryText(parsed.summary, 4))
        : renderSection(labels('bible'), renderSummaryText(details.bibleText, 6))}
    </div>
  )

  return (
    <>
      {!expanded ? collapsedContent : null}
      <WorkspaceCanvasMotionPresence visible={expanded} className={nodeContentInteractionClass(data, `space-y-3 ${streamClassName}`)}>
        {parsed.summary ? renderSection(labels('summary'), renderTextBlock(parsed.summary)) : null}
        {parsed.characters.length > 0 ? (
          <div className="space-y-1.5">
            <p className={`${SELECTABLE_TEXT_CLASS} flex items-center gap-1 text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}><FieldGlyph name="people" className="h-3 w-3" />{labels('characters')}</p>
            <BibleAccordion items={parsed.characters.map((c) => ({ key: c.name, title: c.name, body: c.desc }))} />
          </div>
        ) : null}
        {parsed.scenes.length > 0 ? (
          <div className="space-y-1.5">
            <p className={`${SELECTABLE_TEXT_CLASS} flex items-center gap-1 text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}><FieldGlyph name="frame" className="h-3 w-3" />{labels('scenes')}</p>
            <BibleAccordion items={parsed.scenes.map((s, i) => ({ key: `sc${i}`, badge: String(i + 1), title: s.header, body: s.actions.join('\n') }))} />
          </div>
        ) : (
          renderSection(labels('bible'), renderTextBlock(details.bibleText))
        )}
        {details.chapters.length > 0 ? renderSection(labels('chapters'), (
          <div className="space-y-2">
            {details.chapters.map((chapter) => (
              <div key={chapter.id} className="rounded-md border border-[var(--glass-border-subtle)] bg-[var(--glass-surface-soft)] px-2.5 py-2">
                <div className="flex items-start justify-between gap-2">
                  <p className={`${SELECTABLE_TEXT_CLASS} text-xs font-semibold text-[var(--glass-text-primary)]`}>
                    {String(chapter.chapterIndex + 1).padStart(2, '0')} · {chapter.title}
                  </p>
                  <p className="shrink-0 text-[10px] text-[var(--glass-text-tertiary)]">{chapter.targetDurationSec}s</p>
                </div>
                <p className={`${SELECTABLE_TEXT_CLASS} mt-1 line-clamp-2 text-[11px] leading-5 text-[var(--glass-text-secondary)]`}>{chapter.summary}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] text-[var(--glass-text-tertiary)]">
                  <span>{labels('planStatus')}: {chapter.status}</span>
                  <span>{labels('renderStatus')}: {chapter.renderStatus ?? '-'}</span>
                </div>
              </div>
            ))}
          </div>
        )) : null}
        {renderSection(labels('originalRequest'), renderTextBlock(details.userPrompt))}
      </WorkspaceCanvasMotionPresence>
    </>
  )
}

interface BibleOutline {
  readonly summary: string
  readonly characters: readonly { readonly name: string; readonly desc: string }[]
  readonly scenes: readonly { readonly header: string; readonly actions: readonly string[] }[]
}
function parseBibleOutline(text: string): BibleOutline {
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

function BibleAccordion({ items }: { readonly items: readonly { readonly key: string; readonly badge?: string; readonly title: string; readonly body: string }[] }) {
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
            <WorkspaceCanvasMotionPresence visible={on} motionKey={it.key}>
              <p className={`${SELECTABLE_TEXT_CLASS} whitespace-pre-wrap break-words bg-slate-50/70 px-3 pb-3 pt-1 text-[11px] leading-5 text-[var(--glass-text-secondary)]`}>{it.body}</p>
            </WorkspaceCanvasMotionPresence>
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
          <WorkspaceCanvasMotionPresence visible={expanded && Boolean(details.spatialProfileJson)}>
            {renderSubsection(labels('spatialProfileJson'), renderJsonBlock(details.spatialProfileJson))}
          </WorkspaceCanvasMotionPresence>
        </div>
      )) : null}
      <WorkspaceCanvasMotionPresence visible={expanded && hasText(details.errorMessage)}>
        {renderSection(labels('error'), renderTextBlock(details.errorMessage))}
      </WorkspaceCanvasMotionPresence>
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
  if (!sourceImageUrl) {
    return (
      <AdaptiveImageAspectFrame
        sourceKey={sourceImageUrl}
        initialAspectRatio={initialAspectRatio}
        className="flex w-full items-center justify-center rounded-[10px] bg-slate-50 text-sm font-semibold text-slate-400 ring-1 ring-slate-200"
      >
        {() => label}
      </AdaptiveImageAspectFrame>
    )
  }

  return (
    <AdaptiveImageAspectFrame
      sourceKey={sourceImageUrl}
      initialAspectRatio={initialAspectRatio}
      className="overflow-hidden rounded-[10px] bg-slate-50 ring-1 ring-slate-200"
    >
      {({ onImageLoad }) => (
        <PreviewableImage
          sourceImageUrl={sourceImageUrl}
          displayImageUrl={displayImageUrl ?? undefined}
          alt={alt}
          buttonClassName="block h-full w-full cursor-zoom-in overflow-hidden"
          imageClassName="h-full w-full object-contain"
          onImageLoad={onImageLoad}
        />
      )}
    </AdaptiveImageAspectFrame>
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
        segmentIndex: details.segmentIndex,
        referenceImageUrls: assetReferenceImageUrls,
        generationOptions: videoPlanGenerationOptions(data),
      })
      return
    }
    if (details.kind === 'group') {
      void dispatchNodeAction(data, {
        type: 'generate_video_group',
        gridMode: details.gridMode === '3x3' ? '3x3' : '2x2',
        shotIds: details.shotIds,
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
  const renderPromptSection = (promptExpanded: boolean) => details.prompt ? (
    <EditablePromptSection
      title={labels('videoPlanPrompt')}
      value={details.prompt}
      expanded={promptExpanded}
      labels={labels}
    />
  ) : null
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
      {!expanded ? renderPromptSection(false) : null}
      <WorkspaceCanvasMotionPresence visible={expanded}>
        {renderPromptSection(true)}
      </WorkspaceCanvasMotionPresence>
      {details.errorMessage ? renderSection(labels('error'), renderTextBlock(details.errorMessage)) : null}
      {details.validationMessage ? renderSection(labels('error'), renderTextBlock(details.validationMessage)) : null}
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
      data.kind === 'imageAsset' ||
      data.kind === 'videoClip' ||
      data.kind === 'editRequiredAsset'
    ) {
      return <MediaPreview data={data} />
    }
  }

  switch (data.kind) {
    case 'shot':
      return <ShotContent data={data} labels={labels} />
    case 'imageAsset':
      return <ImageContent data={data} labels={labels} expanded={expanded} />
    case 'videoClip':
      return <VideoContent data={data} labels={labels} expanded={expanded} />
    case 'finalTimeline':
      return <FinalContent data={data} labels={labels} expanded={expanded} />
    case 'bgmScore':
      return <BgmScoreContent data={data} labels={labels} expanded={expanded} />
    case 'editBible':
      return <EditBibleContent data={data} labels={labels} expanded={expanded} />
    case 'editStylePreview':
      return <StyleBibleContent data={data} labels={labels} expanded={expanded} />
    case 'editStyleBible':
      return <StyleBibleContent data={data} labels={labels} expanded={expanded} />
    case 'editPipelineStep':
      return <EditPipelineStepContent data={data} labels={labels} expanded={expanded} />
    case 'editProcessGroup':
      return <ProcessGroupContent data={data} labels={labels} expanded={expanded} />
    case 'editScript':
      return <EditScriptContent data={data} labels={labels} expanded={expanded} />
    case 'editShotExecutionPlan':
      return <EditShotExecutionPlanContent data={data} labels={labels} expanded={expanded} />
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
  const deferredMeasureTimeoutRef = useRef<number | null>(null)
  const expanded = data.disclosure?.effectiveExpanded ?? (data.expanded === true)
  const hasSource = data.kind !== 'finalTimeline'
  const action = data.action
  const isRunning = nodeIsRunning(data)
  const secondaryAction = data.secondaryAction
  const tertiaryAction = data.tertiaryAction
  const secondaryActionIcon: AppIconName = secondaryAction
    ? nodeActionIconName(secondaryAction)
    : 'externalLink'
  const tertiaryActionIcon: AppIconName = tertiaryAction
    ? nodeActionIconName(tertiaryAction)
    : 'externalLink'
  const nodeId = data.nodeId
  const onMeasureNodeSize = data.onMeasureNodeSize
  const showDetailsToggle = data.disclosure?.canToggle === true && Boolean(data.onToggleExpanded)
  const showHeaderAction = Boolean(action && data.actionLabel && data.kind === 'editRequiredAsset')
  const showLargeTitle = data.kind !== 'shot'
  const fixedExpandedShell = expanded && Boolean(getWorkspaceCanvasNodePresentationProfile(data.kind).expanded)
  const shellLayoutClass = data.kind === 'editScript'
    ? 'overflow-hidden'
    : fixedExpandedShell
      ? 'min-h-full overflow-visible'
      : 'overflow-visible'
  const isFocusHighlighted = data.focusHighlighted === true
  const isVisuallyEmphasized = isRunning || isFocusHighlighted
  const showStatusBadge = typeof data.statusLabel === 'string' && data.statusLabel.trim().length > 0
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
    const measuredNodeId = nodeId
    if (typeof measuredNodeId !== 'string') return undefined

    const measureNodeSize = onMeasureNodeSize
    if (!measureNodeSize) return undefined

    const measuredElement = measuredContentRef.current
    if (!measuredElement) return undefined
    const measurementTarget: {
      readonly nodeId: string
      readonly measureNodeSize: (nodeId: string, size: { readonly width: number; readonly height: number }) => void
      readonly element: HTMLDivElement
    } = {
      nodeId: measuredNodeId,
      measureNodeSize,
      element: measuredElement,
    }

    function clearDeferredMeasure() {
      if (deferredMeasureTimeoutRef.current === null) return
      window.clearTimeout(deferredMeasureTimeoutRef.current)
      deferredMeasureTimeoutRef.current = null
    }

    function scheduleDeferredMeasure() {
      if (deferredMeasureTimeoutRef.current !== null) return
      deferredMeasureTimeoutRef.current = window.setTimeout(() => {
        deferredMeasureTimeoutRef.current = null
        measure()
      }, WORKSPACE_CANVAS_MEASURE_AFTER_MOTION_DELAY_MS)
    }

    function measure() {
      if (measurementTarget.element.querySelector(WORKSPACE_CANVAS_MOTION_ACTIVE_SELECTOR)) {
        scheduleDeferredMeasure()
        return
      }

      const rect = measurementTarget.element.getBoundingClientRect()
      measurementTarget.measureNodeSize(measurementTarget.nodeId, {
        width: Math.ceil(rect.width),
        height: Math.ceil(measurementTarget.element.scrollHeight + 2),
      })
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(measurementTarget.element)
    return () => {
      observer.disconnect()
      clearDeferredMeasure()
    }
  }, [data.kind, data.expanded, data.isRunning, data.streamPresentation, data.bgmScoreDetails, data.editBibleDetails, data.styleBibleDetails, data.editScriptDetails, data.editPipelineStepDetails, data.editProcessGroupDetails, data.editAssetGroupDetails, nodeId, onMeasureNodeSize])

  return (
    <WorkspaceNodeImagePreviewContext.Provider value={setPreviewImageUrl}>
      <div className={`relative overflow-visible ${data.kind === 'editScript' ? 'h-auto' : 'h-full'}`}>
        <Handle type="target" position={Position.Left} className="!z-10 !h-3.5 !w-3.5 !border-2 !border-white !bg-slate-500 !shadow-sm" />
        {hasSource ? <Handle type="source" position={Position.Right} className="!z-10 !h-3.5 !w-3.5 !border-2 !border-white !bg-slate-500 !shadow-sm" /> : null}

        <article
          className={`workspace-canvas-node-shell relative ${shellLayoutClass} rounded-[24px] border bg-white/92 shadow-[0_18px_48px_rgba(15,23,42,0.08)] backdrop-blur-xl ${isVisuallyEmphasized ? 'workspace-node-running-breathing border-sky-300' : 'border-slate-200'}`}
          data-expanded={expanded ? 'true' : 'false'}
        >
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
                <BillingActionButton
                  type="button"
                  icon={nodeActionIconName(action)}
                  label={data.actionLabel}
                  quote={data.actionBillingQuote}
                  className="py-2"
                  disabled={data.actionDisabled === true || isRunning}
                  onClick={() => {
                    if (!isRunning) data.onAction?.(action, data.nodeId)
                  }}
                />
              ) : null}
              {showStatusBadge ? (
                <span className={`${SELECTABLE_TEXT_CLASS} inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium ${isRunning ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white text-[var(--glass-text-secondary)]'}`}>
                  {isRunning ? <LoadingSpinner /> : null}
                  {data.statusLabel}
                </span>
              ) : null}
            </div>
          </header>

          <div
            className={`workspace-canvas-node-content space-y-4 px-5 py-5 ${isRunning ? 'opacity-90' : ''}`}
            data-expanded={expanded ? 'true' : 'false'}
          >
            <NodeContent data={runningData} labels={labels} expanded={expanded} />
            {nodeUsesInlineTaskProgress(data.kind) ? (
              <EstimatedTaskProgressInline taskState={data.taskProgress} />
            ) : null}

            {shouldShowFooter ? (
              <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
                <div className="min-w-0">
                  <p className={`${SELECTABLE_TEXT_CLASS} truncate text-xs text-[var(--glass-text-tertiary)]`}>
                    {data.kind === 'editRequiredAsset' ? '' : data.meta}
                  </p>
                </div>
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
                    <BillingActionButton
                      type="button"
                      icon={nodeActionIconName(action)}
                      label={data.actionLabel}
                      quote={data.actionBillingQuote}
                      loading={isRunning}
                      disabled={data.actionDisabled === true || isRunning}
                      onClick={() => {
                        if (!isRunning) data.onAction?.(action, data.nodeId)
                      }}
                    />
                  ) : null}
                  {secondaryAction && data.secondaryActionLabel ? (
                    <BillingActionButton
                      type="button"
                      tone="secondary"
                      icon={secondaryActionIcon}
                      label={data.secondaryActionLabel}
                      quote={data.secondaryActionBillingQuote}
                      disabled={data.actionDisabled === true || isRunning}
                      onClick={() => {
                        if (!isRunning) data.onAction?.(secondaryAction, data.nodeId)
                      }}
                    />
                  ) : null}
                  {tertiaryAction && data.tertiaryActionLabel ? (
                    <BillingActionButton
                      type="button"
                      tone="secondary"
                      icon={tertiaryActionIcon}
                      label={data.tertiaryActionLabel}
                      quote={data.tertiaryActionBillingQuote}
                      disabled={data.actionDisabled === true || isRunning}
                      onClick={() => {
                        if (!isRunning) data.onAction?.(tertiaryAction, data.nodeId)
                      }}
                    />
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
