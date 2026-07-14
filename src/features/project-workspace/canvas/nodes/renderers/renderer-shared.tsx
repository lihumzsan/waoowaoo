'use client'

import React, { useContext, type ReactNode, useRef, useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { isWorkspaceCanvasLifecycleRunning } from '../../lifecycle/workspace-canvas-lifecycle'
import { WorkspaceCanvasMotionPresence } from '../workspace-node-motion'
import type { WorkspaceCanvasFlowNode, WorkspaceCanvasNodeAction } from '../../node-canvas-types'

export function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
export function nodeContentInteractionClass(data: WorkspaceCanvasFlowNode['data'], className: string): string {
  return data.readOnly === true ? className : `nodrag nowheel ${className}`
}
export function videoElementAspectRatio(video: Pick<HTMLVideoElement, 'videoWidth' | 'videoHeight'>): number | null {
  const { videoWidth, videoHeight } = video
  if (!Number.isFinite(videoWidth) || !Number.isFinite(videoHeight)) return null
  if (videoWidth <= 0 || videoHeight <= 0) return null
  return videoWidth / videoHeight
}
export const SELECTABLE_TEXT_CLASS = 'select-none'
export type ImagePreviewHandler = (imageUrl: string) => void
export const WorkspaceNodeImagePreviewContext = React.createContext<ImagePreviewHandler | null>(null)
/* eslint-disable @next/next/no-img-element */
export function PreviewableImage({
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
      <img src={resolvedDisplayImageUrl} alt={alt} style={imageStyle} className={imageClassName} onLoad={onImageLoad} />
    </button>
  )
}
/* eslint-enable @next/next/no-img-element */
export function renderSection(title: string, children: ReactNode) {
  return (
    <section className="space-y-1.5 rounded-[16px] bg-slate-50 p-3 ring-1 ring-slate-100">
      <p className={`${SELECTABLE_TEXT_CLASS} text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}>{title}</p>
      {children}
    </section>
  )
}
export function renderSubsection(title: string, children: ReactNode) {
  return (
    <div className="space-y-1.5 border-t border-slate-200/70 pt-2">
      <p className={`${SELECTABLE_TEXT_CLASS} text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}>{title}</p>
      {children}
    </div>
  )
}
export function renderValue(label: string, value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="grid grid-cols-[4.5rem_1fr] gap-2 text-xs leading-5">
      <span className={`${SELECTABLE_TEXT_CLASS} text-[var(--glass-text-tertiary)]`}>{label}</span>
      <span className={`${SELECTABLE_TEXT_CLASS} min-w-0 break-words text-[var(--glass-text-secondary)]`}>{value}</span>
    </div>
  )
}
export function renderTextBlock(value: string | null | undefined) {
  if (!hasText(value)) return null
  return <p className={`${SELECTABLE_TEXT_CLASS} whitespace-pre-wrap break-words text-xs leading-5 text-[var(--glass-text-secondary)]`}>{value}</p>
}
export function renderJsonBlock(value: unknown) {
  if (value === null || value === undefined) return null
  return renderTextBlock(JSON.stringify(value, null, 2))
}
export function renderTextSection(title: string, value: string | null | undefined) {
  const content = renderTextBlock(value)
  return content ? renderSection(title, content) : null
}
export function renderSummaryText(value: string | null | undefined, lines = 3) {
  if (!hasText(value)) return null
  const lineClampClass = lines === 2 ? 'line-clamp-2' : lines === 4 ? 'line-clamp-4' : 'line-clamp-3'
  return <p className={`${SELECTABLE_TEXT_CLASS} ${lineClampClass} break-words text-xs leading-5 text-[var(--glass-text-secondary)]`}>{value}</p>
}
export type PromptSaveStatus = 'idle' | 'saving' | 'saved' | 'failed'
export function estimatePromptRows(value: string): number {
  const charactersPerLine = 92
  return Math.max(10, value.split(/\r?\n/).reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0) + 2)
}
export function EditablePromptSection({
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
      className={
        editing
          ? 'nodrag nowheel relative z-50 -mx-2 w-[min(980px,calc(100vw-96px))] space-y-2 rounded-[16px] bg-white p-4 shadow-[0_20px_70px_rgba(15,23,42,0.18)] ring-1 ring-slate-200'
          : 'space-y-1.5 rounded-[16px] bg-slate-50 p-3 ring-1 ring-slate-100'
      }
      onPointerDownCapture={editing ? (event) => event.stopPropagation() : undefined}
      onWheelCapture={
        editing
          ? (event) => {
              event.preventDefault()
              event.stopPropagation()
            }
          : undefined
      }
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
              {status === 'saving' ? labels('promptSaving') : status === 'failed' ? labels('promptSaveFailed') : ''}
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
          <WorkspaceCanvasMotionPresence visible={expanded}>{expandedContent}</WorkspaceCanvasMotionPresence>
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
export function nodeIsRunning(data: WorkspaceCanvasFlowNode['data']): boolean {
  return isWorkspaceCanvasLifecycleRunning(data.lifecycle)
}
export async function dispatchNodeAction(data: WorkspaceCanvasFlowNode['data'], action: WorkspaceCanvasNodeAction) {
  await Promise.resolve(data.onAction?.(action, data.nodeId))
}
export function editAssetDescriptionSaveHandler(data: WorkspaceCanvasFlowNode['data']): ((nextValue: string) => Promise<void>) | undefined {
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
export function LoadingSpinner() {
  return <AppIcon name="loader" className="h-4 w-4 animate-spin" />
}
