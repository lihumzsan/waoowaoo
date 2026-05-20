'use client'

import React, { useEffect, useRef, useState, type ReactNode } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useTranslations } from 'next-intl'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import StoryDetail from '../details/StoryDetail'
import type {
  WorkspaceCanvasAssetRef,
  WorkspaceCanvasFlowNode,
  WorkspaceCanvasNodeAction,
  WorkspaceCanvasScriptScene,
  WorkspaceCanvasTextLine,
} from '../node-canvas-types'

function nodeIconName(kind: WorkspaceCanvasFlowNode['data']['kind']): AppIconName {
  switch (kind) {
    case 'storyInput':
      return 'fileText'
    case 'analysis':
      return 'chart'
    case 'scriptClip':
      return 'bookOpen'
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
    case 'editPipelineStep':
      return 'chart'
    case 'editScript':
      return 'clipboardCheck'
    case 'spaceConsistency':
      return 'chart'
    case 'videoPlan':
      return 'clapperboard'
    case 'bgmScore':
      return 'audioWave'
    case 'editRequiredAsset':
      return 'package'
  }
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function videoElementAspectRatio(video: Pick<HTMLVideoElement, 'videoWidth' | 'videoHeight'>): number | null {
  const { videoWidth, videoHeight } = video
  if (!Number.isFinite(videoWidth) || !Number.isFinite(videoHeight)) return null
  if (videoWidth <= 0 || videoHeight <= 0) return null
  return videoWidth / videoHeight
}

const SELECTABLE_TEXT_CLASS = 'select-none'

function renderSection(title: string, children: ReactNode) {
  return (
    <section className="space-y-1.5 rounded-[16px] bg-slate-50 p-3 ring-1 ring-slate-100">
      <p className={`${SELECTABLE_TEXT_CLASS} text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}>{title}</p>
      {children}
    </section>
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
  return kind !== 'storyInput' && kind !== 'analysis' && kind !== 'editScript'
}

function nodeShowsMetaFooter(kind: WorkspaceCanvasFlowNode['data']['kind']): boolean {
  return kind !== 'editRequiredAsset' && kind !== 'editScript'
}

export function nodeNeedsActualHeightMeasurement(kind: WorkspaceCanvasFlowNode['data']['kind']): boolean {
  return kind === 'editScreenplay' || kind === 'editScript' || kind === 'videoPlan'
}

async function dispatchNodeAction(data: WorkspaceCanvasFlowNode['data'], action: WorkspaceCanvasNodeAction) {
  await Promise.resolve(data.onAction?.(action))
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
  if (action.type === 'generate_video_group') return action.videoModel.trim()
  if (action.type === 'generate_video') return typeof action.videoModel === 'string' ? action.videoModel.trim() : ''
  return ''
}

function LoadingSpinner() {
  return <AppIcon name="loader" className="h-4 w-4 animate-spin" />
}

function MediaSkeleton({ height }: { readonly height: number }) {
  return (
    <div
      className="workspace-node-loading-surface overflow-hidden rounded-[18px] border border-slate-200 bg-slate-100"
      style={{ height }}
    />
  )
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

function renderScene(scene: WorkspaceCanvasScriptScene, index: number, labels: ReturnType<typeof useTranslations>) {
  return (
    <section key={`${scene.sceneNumber ?? index}-${scene.heading ?? ''}`} className="space-y-2 rounded-[16px] bg-slate-50 p-3 ring-1 ring-slate-100">
      <div className="flex items-center justify-between gap-2">
        <p className={`${SELECTABLE_TEXT_CLASS} text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}>
          {labels('scene', { index: scene.sceneNumber ?? index + 1 })}
        </p>
        {scene.heading ? <span className={`${SELECTABLE_TEXT_CLASS} truncate text-[11px] text-[var(--glass-text-secondary)]`}>{scene.heading}</span> : null}
      </div>
      {renderTextBlock(scene.description)}
      {renderChips(labels('characters'), scene.characters)}
      {renderLines(scene.lines, labels)}
    </section>
  )
}

function StoryContent({
  data,
  onDraftChange,
  draft,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly draft: string
  readonly onDraftChange: (value: string) => void
}) {
  if (data.projectId) {
    return (
      <StoryDetail
        projectId={data.projectId}
        storyText={data.body}
        episodeName={data.episodeName}
        variant="node"
      />
    )
  }

  return (
    <textarea
      className="nodrag nowheel h-[116px] w-full resize-none rounded-[18px] border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm leading-6 text-[var(--glass-text-secondary)] outline-none transition focus:border-slate-400"
      value={draft}
      placeholder={data.body || data.title}
      onChange={(event) => onDraftChange(event.target.value)}
      onBlur={() => {
        if (draft !== data.body) {
          data.onAction?.({ type: 'update_story', value: draft })
        }
      }}
    />
  )
}

function AnalysisContent({ data }: { readonly data: WorkspaceCanvasFlowNode['data'] }) {
  return <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
}

function ScriptClipContent({
  data,
  labels,
  expanded,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly labels: ReturnType<typeof useTranslations>
  readonly expanded: boolean
}) {
  const details = data.scriptDetails
  if (!details) return <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
  if (!expanded) {
    return (
      <div className="space-y-2">
        {renderAssetChips(labels('characters'), details.characters)}
        {renderChips(labels('locations'), details.locations)}
        {renderSection(labels('description'), renderSummaryText(details.screenplayText || data.body, 4))}
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {renderAssetChips(labels('characters'), details.characters)}
      {renderChips(labels('locations'), details.locations)}
      {renderChips(labels('props'), details.props)}
      {renderSection(labels('clipMeta'), (
        <div className="space-y-1">
          {renderValue(labels('timeRange'), details.timeRange)}
          {renderValue(labels('duration'), details.duration)}
          {renderValue(labels('shotCount'), details.shotCount)}
        </div>
      ))}
      {details.scenes.length > 0
        ? details.scenes.map((scene, index) => renderScene(scene, index, labels))
        : renderSection(labels('screenplay'), renderTextBlock(details.screenplayText) ?? renderTextBlock(data.body))}
      {renderSection(labels('originalClip'), renderTextBlock(details.originalText))}
    </div>
  )
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
  const promptShot = details.promptShot
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
      {promptShot ? renderSection(labels('promptShot'), (
        <div className="space-y-1">
          {renderValue(labels('sequence'), promptShot.sequence)}
          {renderValue(labels('locations'), promptShot.locations)}
          {renderValue(labels('characters'), promptShot.characters)}
          {renderValue(labels('plot'), promptShot.plot)}
          {renderValue(labels('pov'), promptShot.pov)}
          {renderValue(labels('scale'), promptShot.scale)}
          {renderValue(labels('module'), promptShot.module)}
          {renderValue(labels('focus'), promptShot.focus)}
          {renderValue(labels('summary'), promptShot.zhSummarize)}
        </div>
      )) : null}
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
  const aspectRatio = typeof data.previewAspectRatio === 'number' && Number.isFinite(data.previewAspectRatio) && data.previewAspectRatio > 0
    ? data.previewAspectRatio
    : null
  const previewHeight = isEditAsset
    ? 240
    : typeof data.previewDisplayHeight === 'number' && Number.isFinite(data.previewDisplayHeight) && data.previewDisplayHeight > 0
      ? data.previewDisplayHeight
      : 118
  const running = data.__running === true
  if (running && !displayVideoUrl && !displayImageUrl) {
    return <MediaSkeleton height={previewHeight} />
  }
  if (isShotPreview && displayImageUrl) {
    return (
      <div className="space-y-2">
        <div className={`relative overflow-hidden bg-transparent ${running ? 'workspace-node-loading-surface' : ''}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={displayImageUrl}
            alt={data.title}
            className="block h-auto w-full object-contain"
          />
        </div>
        {!running && panelId && candidateUrls.length > 0 ? (
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
                    <button
                      type="button"
                      className="block w-full"
                      onClick={(event) => {
                        event.stopPropagation()
                        void dispatchNodeAction(data, { type: 'select_candidate', panelId, imageUrl: url })
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={candidateImageUrl}
                        alt={labels('candidateImageAlt', { index: index + 1 })}
                        className="h-24 w-full object-cover"
                      />
                    </button>
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
  const frameClassName = `relative flex items-center justify-center overflow-hidden rounded-[18px] border border-slate-200 bg-slate-100 ${running ? 'workspace-node-loading-surface' : ''}`
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
          style={mediaStyle}
          className={`${aspectRatio ? mediaClassName : 'h-full w-full object-contain'} bg-black`}
        />
      ) : displayImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={displayImageUrl}
          alt={data.title}
          style={mediaStyle}
          className={isEditAsset ? 'h-full w-full object-contain' : mediaClassName}
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
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={toDisplayImageUrl(url) ?? url} alt={labels('candidateImageAlt', { index: index + 1 })} className="h-12 w-full object-cover" />
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
        <div className="overflow-hidden rounded-[18px] border border-slate-200 bg-slate-100">
          <video
            src={displayOutputUrl}
            aria-label={data.title}
            controls
            className="h-[156px] w-full bg-black object-contain"
          />
        </div>
      ) : null}
      {renderSection(labels('finalStats'), (
        <div className="space-y-1">
          {renderValue(labels('totalShots'), details.totalShots)}
          {renderValue(labels('totalImages'), details.totalImages)}
          {renderValue(labels('totalVideos'), details.totalVideos)}
          {renderValue(labels('totalDuration'), details.totalDuration)}
        </div>
      ))}
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
        return (
          <section key={`${section.title}-${index}`} className="space-y-1.5 rounded-[16px] bg-slate-50 p-3 ring-1 ring-slate-100">
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
    <div className="space-y-1.5 rounded-[14px] border border-slate-200 bg-white p-2">
      <p className={`${SELECTABLE_TEXT_CLASS} text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}>
        {labels('finalBgmMix')}
      </p>
      <audio src={displayMixUrl} controls className="w-full" />
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
        <section key={`${layer.name}-${index}`} className="space-y-1.5 rounded-[16px] bg-slate-50 p-3 ring-1 ring-slate-100">
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

function renderEditScriptCell(label: string, children: ReactNode, className = '') {
  return (
    <td aria-label={label} className={`border-l border-slate-100 px-3 py-3 align-top text-xs leading-5 text-[var(--glass-text-secondary)] first:border-l-0 ${className}`}>
      <div className={`${SELECTABLE_TEXT_CLASS} whitespace-pre-wrap break-words`}>{children}</div>
    </td>
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
        <section key={`${item.title}-${index}`} className="space-y-2 rounded-[16px] bg-slate-50 p-3 ring-1 ring-slate-100">
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

function EditScriptContent({
  data,
  labels,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly labels: ReturnType<typeof useTranslations>
}) {
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
  return (
    <div className="nodrag nowheel space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {renderSection(labels('editScriptMeta'), (
          <div className="space-y-1">
            {renderValue(labels('totalDuration'), details.durationSec)}
            {renderValue(labels('shotCount'), details.shotCount)}
          </div>
        ))}
        {renderSection(labels('description'), renderTextBlock(data.body))}
      </div>
      {details.screenplayText
        ? renderSection(labels('screenplay'), renderSummaryText(details.screenplayText, 8))
        : null}
      <div className="overflow-hidden rounded-[16px] border border-slate-200 bg-white">
        <table className="w-full border-collapse text-left">
          <thead className="bg-slate-50">
            <tr className="text-[10px] font-semibold uppercase tracking-normal text-[var(--glass-text-tertiary)]">
              <th className="w-16 px-3 py-2">{labels('shotIndexHeader')}</th>
              <th className="w-16 border-l border-slate-100 px-3 py-2">{labels('duration')}</th>
              <th className="w-[22%] border-l border-slate-100 px-3 py-2">{labels('description')}</th>
              <th className="w-[14%] border-l border-slate-100 px-3 py-2">{labels('charactersAndScene')}</th>
              <th className="w-[13%] border-l border-slate-100 px-3 py-2">{labels('cameraMove')}</th>
              <th className="w-[28%] border-l border-slate-100 px-3 py-2">{labels('videoPrompt')}</th>
              <th className="w-[14%] border-l border-slate-100 px-3 py-2">{labels('sound')}</th>
            </tr>
          </thead>
          <tbody>
            {details.shots.map((shot) => (
              <tr key={shot.shotNumber} className="border-t border-slate-100">
                {renderEditScriptCell(labels('shotIndexHeader'), shot.shotNumber, 'font-semibold text-[var(--glass-text-primary)]')}
                {renderEditScriptCell(labels('duration'), `${shot.durationSec}s`)}
                {renderEditScriptCell(labels('description'), shot.visualAction)}
                {renderEditScriptCell(labels('charactersAndScene'), shot.charactersAndScene)}
                {renderEditScriptCell(labels('cameraMove'), shot.camera)}
                {renderEditScriptCell(labels('videoPrompt'), shot.videoPrompt)}
                {renderEditScriptCell(labels('sound'), shot.sound)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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

  return (
    <div className="space-y-2">
      {renderSection(labels('screenplay'), expanded
        ? renderTextBlock(details.screenplayText)
        : renderSummaryText(details.screenplayText, 8))}
      {expanded ? renderSection(labels('originalRequest'), renderTextBlock(details.userPrompt)) : null}
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
    <div className="nodrag nowheel space-y-2">
      <MediaPreview data={data} />
      <EditablePromptSection
        title={labels('imagePrompt')}
        value={details.description}
        expanded={expanded}
        labels={labels}
        onSave={editAssetDescriptionSaveHandler(data)}
      />
      {renderChips(labels('linkedShots'), details.shotNumbers.map((shotNumber) => String(shotNumber)))}
      {expanded && details.errorMessage ? renderSection(labels('error'), renderTextBlock(details.errorMessage)) : null}
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
    && (
      details.kind === 'group'
      || (
        hasText(firstStoryboardReference?.panelId)
        && hasText(firstStoryboardReference?.storyboardId)
        && typeof firstStoryboardReference?.panelIndex === 'number'
      )
    )
  const canGenerateAssetReference = assetReferenceImageUrls.length > 0 && assetReferenceVideoModel.length > 0 && !running
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
        videoModel: assetReferenceVideoModel,
        blockIndex: details.blockIndex,
        referenceImageUrls: assetReferenceImageUrls,
        generationOptions: videoPlanGenerationOptions(data),
      })
      return
    }
    if (details.kind === 'group') {
      void dispatchNodeAction(data, {
        type: 'generate_video_group',
        videoModel: assetReferenceVideoModel,
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
        videoModel: assetReferenceVideoModel,
        generationOptions: videoPlanGenerationOptions(data),
      })
    }
  }
  return (
    <div className="nodrag nowheel space-y-3">
      {displayOutputUrl ? (
        <div className="inline-flex w-full rounded-full bg-slate-100 p-1 ring-1 ring-slate-200">
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
        <div className="relative flex w-full items-center justify-center overflow-hidden rounded-[16px] bg-black" style={outputStyle}>
          <video
            src={displayOutputUrl}
            aria-label={data.title}
            controls
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
                if (!imageUrl) {
                  const label = 'name' in item ? item.name : String(item.shotNumber)
                  return (
                    <div key={key} className="flex h-28 items-center justify-center rounded-[10px] bg-slate-50 text-sm font-semibold text-slate-400 ring-1 ring-slate-200">
                      {label}
                    </div>
                  )
                }
                const displayImageUrl = toDisplayImageUrl(imageUrl) ?? imageUrl
                return (
                  <div key={key} className="overflow-hidden rounded-[10px] bg-slate-50 ring-1 ring-slate-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={displayImageUrl} alt={alt} className="h-28 w-full object-contain" />
                  </div>
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
      {renderSection(labels('generationMode'), (
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
      ))}
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
  const imageArtifacts = details.artifacts.filter((artifact) => artifact.imageUrl)
  const shouldShowGeneratedDetails = data.isRunning !== true
    && details.stage !== 'preparing'
    && details.stage !== 'floor_plan_prompts_ready'
    && details.stage !== 'floor_plans_generating'
  const visibleShotCoordinates = shouldShowGeneratedDetails
    ? expanded ? details.shotCoordinates : details.shotCoordinates.slice(0, 6)
    : []
  const visibleBlocks = shouldShowGeneratedDetails
    ? expanded ? details.blocks : details.blocks.slice(0, 2)
    : []
  return (
    <div className="nodrag nowheel space-y-3">
      <MediaPreview data={data} />
      {renderSection(labels('spaceConsistencyStats'), (
        <div className="space-y-1">
          {renderValue(labels('status'), details.stage ?? data.statusLabel)}
          {renderValue(labels('floorPlanCount'), details.floorPlanCount)}
          {renderValue(labels('coordinateOverlayCount'), details.overlayCount)}
          {renderValue(labels('shotCoordinateCount'), details.shotCoordinates.length)}
          {renderValue(labels('cameraPlanCount'), details.cameraPlanCount)}
        </div>
      ))}
      {imageArtifacts.length > 0 ? renderSection(labels('coordinateMaps'), (
        <div className="grid grid-cols-2 gap-2">
          {imageArtifacts.slice(0, expanded ? imageArtifacts.length : 4).map((artifact) => {
            const imageUrl = artifact.imageUrl ? toDisplayImageUrl(artifact.imageUrl) ?? artifact.imageUrl : null
            return imageUrl ? (
              <div key={artifact.id} className="overflow-hidden rounded-[12px] bg-white ring-1 ring-slate-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt={artifact.kind} className="h-28 w-full object-contain" />
                <div className="border-t border-slate-100 px-2 py-1">
                  <p className={`${SELECTABLE_TEXT_CLASS} truncate text-[10px] font-semibold text-[var(--glass-text-tertiary)]`}>
                    {artifact.kind}
                  </p>
                </div>
              </div>
            ) : null
          })}
        </div>
      )) : null}
      {visibleShotCoordinates.length > 0 ? (
        <div className="space-y-2">
          {visibleShotCoordinates.map((shot) => (
            <section key={`shot-coordinate:${shot.shotNumber}`} className="space-y-2 rounded-[16px] bg-slate-50 p-3 ring-1 ring-slate-100">
              <div className="flex items-center justify-between gap-2">
                <p className={`${SELECTABLE_TEXT_CLASS} truncate text-xs font-semibold text-[var(--glass-text-primary)]`}>
                  {labels('shotCoordinate', { shot: shot.shotNumber })}
                </p>
                <span className={`${SELECTABLE_TEXT_CLASS} shrink-0 rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200`}>
                  {shot.classification ?? labels('emptyCoordinates')}
                </span>
              </div>
              {shot.sourceVideoBlockId ? renderTextBlock(shot.sourceVideoBlockId) : null}
              {shot.cinematicTranslation ? renderTextBlock(shot.cinematicTranslation) : null}
              {shot.coordinates.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {shot.coordinates.slice(0, expanded ? shot.coordinates.length : 6).map((coordinate, coordinateIndex) => (
                    <span key={`${shot.shotNumber}:${coordinate.name ?? coordinate.kind ?? 'coordinate'}:${coordinateIndex}`} className={`${SELECTABLE_TEXT_CLASS} inline-flex rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 ring-1 ring-slate-200`}>
                      {coordinate.name ?? coordinate.kind ?? labels('coordinate')}
                      {typeof coordinate.x === 'number' && typeof coordinate.y === 'number' ? ` [${coordinate.x}, ${coordinate.y}]` : ''}
                    </span>
                  ))}
                </div>
              ) : (
                <p className={`${SELECTABLE_TEXT_CLASS} text-xs text-[var(--glass-text-tertiary)]`}>
                  {labels('emptyCoordinates')}
                </p>
              )}
              {expanded && shot.reason ? renderTextBlock(shot.reason) : null}
            </section>
          ))}
          {!expanded && details.shotCoordinates.length > visibleShotCoordinates.length ? (
            <p className={`${SELECTABLE_TEXT_CLASS} text-xs text-[var(--glass-text-tertiary)]`}>
              {labels('moreItems', { count: details.shotCoordinates.length - visibleShotCoordinates.length })}
            </p>
          ) : null}
        </div>
      ) : visibleBlocks.length > 0 ? (
        <div className="space-y-2">
          {visibleBlocks.map((block, index) => (
            <section key={`${block.sourceVideoBlockId ?? 'block'}:${index}`} className="space-y-2 rounded-[16px] bg-slate-50 p-3 ring-1 ring-slate-100">
              <div className="flex items-center justify-between gap-2">
                <p className={`${SELECTABLE_TEXT_CLASS} truncate text-xs font-semibold text-[var(--glass-text-primary)]`}>
                  {block.sourceVideoBlockId ?? labels('blockingBlock')}
                </p>
                <span className={`${SELECTABLE_TEXT_CLASS} shrink-0 rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200`}>
                  {block.classification ?? labels('unknown')}
                </span>
              </div>
              {block.cinematicTranslation ? renderTextBlock(block.cinematicTranslation) : null}
              {block.coordinates.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {block.coordinates.slice(0, expanded ? block.coordinates.length : 6).map((coordinate, coordinateIndex) => (
                    <span key={`${coordinate.name ?? coordinate.kind ?? 'coordinate'}:${coordinateIndex}`} className={`${SELECTABLE_TEXT_CLASS} inline-flex rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 ring-1 ring-slate-200`}>
                      {coordinate.name ?? coordinate.kind ?? labels('coordinate')}
                      {typeof coordinate.x === 'number' && typeof coordinate.y === 'number' ? ` [${coordinate.x}, ${coordinate.y}]` : ''}
                    </span>
                  ))}
                </div>
              ) : null}
              {expanded && block.reason ? renderTextBlock(block.reason) : null}
            </section>
          ))}
          {!expanded && details.blocks.length > visibleBlocks.length ? (
            <p className={`${SELECTABLE_TEXT_CLASS} text-xs text-[var(--glass-text-tertiary)]`}>
              {labels('moreItems', { count: details.blocks.length - visibleBlocks.length })}
            </p>
          ) : null}
        </div>
      ) : renderTextSection(labels('reason'), data.body)}
      {details.cameraPlans.length > 0 ? renderSection(labels('cameraPlans'), (
        <div className="space-y-2">
          {details.cameraPlans.slice(0, expanded ? details.cameraPlans.length : 2).map((plan, index) => (
            <section key={`${plan.sourceShotNumber ?? index}:${plan.sourceVideoBlockId ?? 'camera'}`} className="space-y-1.5 rounded-[16px] bg-white p-3 ring-1 ring-slate-100">
              <p className={`${SELECTABLE_TEXT_CLASS} text-xs font-semibold text-[var(--glass-text-primary)]`}>
                {labels('cameraPlan')} #{plan.sourceShotNumber ?? index + 1}
              </p>
              {renderValue(labels('cameraMove'), plan.cameraMovement)}
              {plan.shotScale || plan.cameraAngle || plan.cameraHeight ? renderTextBlock([
                plan.shotScale,
                plan.cameraHeight,
                plan.cameraAngle,
              ].filter(Boolean).join(' · ')) : null}
              {plan.composition ? renderTextBlock(plan.composition) : null}
              {expanded && plan.lensAndDepth ? renderTextBlock(plan.lensAndDepth) : null}
              {expanded && plan.aestheticIntent ? renderTextBlock(plan.aestheticIntent) : null}
            </section>
          ))}
          {!expanded && details.cameraPlans.length > 2 ? (
            <p className={`${SELECTABLE_TEXT_CLASS} text-xs text-[var(--glass-text-tertiary)]`}>
              {labels('moreItems', { count: details.cameraPlans.length - 2 })}
            </p>
          ) : null}
        </div>
      )) : null}
      {expanded ? (
        <div className="space-y-2">
          {details.artifacts.filter((artifact) => artifact.prompt).slice(0, 3).map((artifact) => (
            <React.Fragment key={artifact.id}>
              {renderSection(labels('floorPlanPrompt'), renderSummaryText(artifact.prompt, 5))}
            </React.Fragment>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function NodeContent({
  data,
  draft,
  setDraft,
  labels,
  expanded,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly draft: string
  readonly setDraft: (value: string) => void
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
    case 'storyInput':
      return <StoryContent data={data} draft={draft} onDraftChange={setDraft} />
    case 'analysis':
      return <AnalysisContent data={data} />
    case 'scriptClip':
      return <ScriptClipContent data={data} labels={labels} expanded={expanded} />
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
    case 'editPipelineStep':
      return <EditPipelineStepContent data={data} labels={labels} expanded={expanded} />
    case 'editScript':
      return <EditScriptContent data={data} labels={labels} />
    case 'spaceConsistency':
      return <SpaceConsistencyContent data={data} labels={labels} expanded={expanded} />
    case 'videoPlan':
      return <VideoPlanContent data={data} labels={labels} expanded={expanded} />
    case 'editRequiredAsset':
      return <EditAssetContent data={data} labels={labels} expanded={expanded} />
  }
}

export default function WorkspaceNode({ data }: NodeProps<WorkspaceCanvasFlowNode>) {
  const labels = useTranslations('projectWorkflow.canvas.workspace.nodeFields')
  const measuredContentRef = useRef<HTMLDivElement | null>(null)
  const [storyDraft, setStoryDraft] = useState(data.body)
  const expanded = data.expanded === true
  const hasTarget = data.kind !== 'storyInput'
  const hasSource = data.kind !== 'finalTimeline'
  const action = data.action
  const canToggleDetails = nodeCanToggleDetails(data.kind)
  const isRunning = nodeIsRunning(data)
  const secondaryAction = data.secondaryAction
  const nodeId = data.nodeId
  const onMeasureNodeSize = data.onMeasureNodeSize
  const showHeaderAction = Boolean(action && data.actionLabel && (data.kind === 'spaceConsistency' || data.kind === 'editRequiredAsset'))
  const showLargeTitle = data.kind !== 'shot'
  const shouldShowFooter = !isRunning && (
    canToggleDetails ||
    Boolean(action && data.actionLabel && !showHeaderAction) ||
    Boolean(secondaryAction && data.secondaryActionLabel) ||
    nodeShowsMetaFooter(data.kind)
  )
  const runningData = isRunning ? { ...data, __running: true } : data

  useEffect(() => {
    setStoryDraft(data.body)
  }, [data.body])

  useEffect(() => {
    if (!nodeId || !onMeasureNodeSize || !nodeNeedsActualHeightMeasurement(data.kind)) return undefined
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
  }, [data.kind, data.expanded, data.editScreenplayDetails, data.editScriptDetails, nodeId, onMeasureNodeSize])

  return (
    <div className={`relative overflow-visible ${data.kind === 'editScript' ? 'h-auto' : 'h-full'}`}>
      {hasTarget ? <Handle type="target" position={Position.Left} className="!z-10 !h-3.5 !w-3.5 !border-2 !border-white !bg-slate-500 !shadow-sm" /> : null}
      {hasSource ? <Handle type="source" position={Position.Right} className="!z-10 !h-3.5 !w-3.5 !border-2 !border-white !bg-slate-500 !shadow-sm" /> : null}

      <article className={`relative ${data.kind === 'editScript' ? 'overflow-hidden' : 'min-h-full overflow-visible'} rounded-[24px] border bg-white/92 shadow-[0_18px_48px_rgba(15,23,42,0.08)] backdrop-blur-xl ${isRunning ? 'border-sky-200 ring-2 ring-sky-100' : 'border-slate-200'}`}>
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
            <NodeContent data={runningData} draft={storyDraft} setDraft={setStoryDraft} labels={labels} expanded={expanded} />

            {shouldShowFooter ? (
              <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
                <p className={`${SELECTABLE_TEXT_CLASS} min-w-0 truncate text-xs text-[var(--glass-text-tertiary)]`}>
                  {data.kind === 'editRequiredAsset' ? '' : data.meta}
                </p>
                <div className="flex shrink-0 items-center gap-1.5">
                  {canToggleDetails ? (
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
                      <AppIcon name="externalLink" className="h-3.5 w-3.5" />
                      {data.secondaryActionLabel}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </article>
    </div>
  )
}
