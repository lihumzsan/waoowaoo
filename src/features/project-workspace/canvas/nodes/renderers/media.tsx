'use client'

import React, { useState } from 'react'
import { useTranslations } from 'next-intl'
import { type AppIconName, AppIcon } from '@/components/ui/icons'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { workspaceCanvasScrollableRegionProps } from '../../canvas-scroll-lock'
import { CanvasMediaGenerationSurface } from '../CanvasMediaGenerationSurface'
import { WorkspaceCanvasMotionPresence } from '../workspace-node-motion'
import type { WorkspaceCanvasEditAssetGroupItem, WorkspaceCanvasTextLine, WorkspaceCanvasFlowNode, WorkspaceCanvasShotDetails } from '../../node-canvas-types'
import {
  EditablePromptSection,
  PreviewableImage,
  SELECTABLE_TEXT_CLASS,
  hasText,
  nodeIsRunning,
  panelPromptSaveHandler,
  renderSection,
  renderTextSection,
  renderValue,
} from './renderer-shared'

export function editAssetPlaceholderIconName(kind: WorkspaceCanvasEditAssetGroupItem['kind']): AppIconName {
  return kind === 'character' ? 'user' : 'mapPin'
}
export function renderChips(label: string, values: readonly string[]) {
  if (values.length === 0) return null
  return renderSection(
    label,
    <div className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <span
          key={value}
          className={`${SELECTABLE_TEXT_CLASS} rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-[var(--glass-text-secondary)]`}
        >
          {value}
        </span>
      ))}
    </div>,
  )
}
export function renderLines(lines: readonly WorkspaceCanvasTextLine[], labels: ReturnType<typeof useTranslations>) {
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
export function shotPreviewAspectRatio(data: WorkspaceCanvasFlowNode['data']): number {
  const aspectRatio = data.previewAspectRatio
  if (typeof aspectRatio === 'number' && Number.isFinite(aspectRatio) && aspectRatio > 0) return aspectRatio
  return 16 / 9
}
export function mediaLoadingStyleImageUrl(data: WorkspaceCanvasFlowNode['data']): string | null {
  return data.mediaLoadingContext?.styleImageUrl ?? null
}
export function ShotImagePreview({ data }: { readonly data: WorkspaceCanvasFlowNode['data'] }) {
  const displayImageUrl = toDisplayImageUrl(data.previewImageUrl)
  const styleImageUrl = mediaLoadingStyleImageUrl(data)
  const frameStyle: React.CSSProperties = {
    aspectRatio: String(shotPreviewAspectRatio(data)),
  }

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
      ) : null}
      <CanvasMediaGenerationSurface
        lifecycle={data.lifecycle}
        hasOutput={Boolean(displayImageUrl)}
        outputImageUrl={data.previewImageUrl}
        styleImageUrl={styleImageUrl}
        ringSize={72}
        placeholder={
          <span className="inline-flex h-16 w-16 items-center justify-center rounded-[18px] bg-white/72 shadow-sm ring-1 ring-slate-200 backdrop-blur">
            <AppIcon name="image" className="h-8 w-8 text-slate-400" />
          </span>
        }
      />
    </div>
  )
}
export function ShotMetaAttrChip({ icon, label, value }: { readonly icon: AppIconName; readonly label: string; readonly value: string | null | undefined }) {
  if (!hasText(value)) return null
  return (
    <span
      className={`${SELECTABLE_TEXT_CLASS} inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-[var(--glass-text-secondary)]`}
    >
      <AppIcon name={icon} className="h-3.5 w-3.5 text-[var(--glass-text-tertiary)]" />
      <span className="text-[var(--glass-text-tertiary)]">{label}</span>
      <span>{value}</span>
    </span>
  )
}
export function ShotMetaTagChip({ icon, text }: { readonly icon: AppIconName; readonly text: string }) {
  if (!hasText(text)) return null
  return (
    <span
      className={`${SELECTABLE_TEXT_CLASS} inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-[var(--glass-text-secondary)]`}
    >
      <AppIcon name={icon} className="h-3.5 w-3.5 text-[var(--glass-text-tertiary)]" />
      {text}
    </span>
  )
}
export function ShotMetaChips({ details, labels }: { readonly details: WorkspaceCanvasShotDetails; readonly labels: ReturnType<typeof useTranslations> }) {
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
export function ShotPromptDisclosure({
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
export function ShotContent({ data, labels }: { readonly data: WorkspaceCanvasFlowNode['data']; readonly labels: ReturnType<typeof useTranslations> }) {
  const details = data.shotDetails
  if (!details) return <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
  return (
    <div className="space-y-3">
      <ShotImagePreview data={data} />
      <ShotMetaChips details={details} labels={labels} />
      {hasText(data.body) ? <p className={`${SELECTABLE_TEXT_CLASS} text-[13px] leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p> : null}
      <ShotPromptDisclosure details={details} labels={labels} />
      {renderTextSection(labels('error'), details.errorMessage)}
    </div>
  )
}
export function MediaPreview({ data }: { readonly data: WorkspaceCanvasFlowNode['data'] }) {
  const displayVideoUrl = data.kind === 'videoClip' ? toDisplayImageUrl(data.videoDetails?.videoUrl) : null
  const displayImageUrl = toDisplayImageUrl(data.previewImageUrl)
  const isEditAsset = data.kind === 'editRequiredAsset'
  const aspectRatio =
    typeof data.previewAspectRatio === 'number' && Number.isFinite(data.previewAspectRatio) && data.previewAspectRatio > 0 ? data.previewAspectRatio : null
  const previewHeight = isEditAsset
    ? 240
    : typeof data.previewDisplayHeight === 'number' && Number.isFinite(data.previewDisplayHeight) && data.previewDisplayHeight > 0
      ? data.previewDisplayHeight
      : 118
  const loadingRingSize = Math.max(48, Math.min(96, Math.round(previewHeight * 0.5)))
  const mediaStyle = aspectRatio ? { aspectRatio: String(aspectRatio) } : undefined
  const mediaClassName = aspectRatio ? 'h-full max-w-full rounded-[16px] object-contain' : 'h-full w-full object-contain'
  const mediaInteractionClass = displayVideoUrl ? 'nodrag nowheel ' : ''
  const frameClassName = `${mediaInteractionClass}relative flex items-center justify-center overflow-hidden rounded-[18px] border border-slate-200 bg-slate-100`
  return (
    <div className={frameClassName} style={{ height: previewHeight }}>
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
      ) : null}
      <CanvasMediaGenerationSurface
        lifecycle={data.lifecycle}
        hasOutput={Boolean(displayVideoUrl || displayImageUrl)}
        outputImageUrl={data.previewImageUrl ?? displayVideoUrl}
        styleImageUrl={mediaLoadingStyleImageUrl(data)}
        ringSize={loadingRingSize}
        placeholder={
          isEditAsset ? (
            <AppIcon name="imageAlt" className="h-8 w-8 text-slate-300" />
          ) : (
            <span
              className={`${SELECTABLE_TEXT_CLASS} rounded-full border border-white/80 bg-white/80 px-3 py-1 text-xs font-semibold text-[var(--glass-text-secondary)] shadow-sm`}
            >
              {data.body}
            </span>
          )
        }
      />
    </div>
  )
}
export function ImageContent({
  data,
  labels,
  expanded,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly labels: ReturnType<typeof useTranslations>
  readonly expanded: boolean
}) {
  if (nodeIsRunning(data)) return <MediaPreview data={data} />
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
            {details.candidateImages.length > 0
              ? renderSection(
                  labels('candidateImages'),
                  <div className="grid grid-cols-3 gap-1.5">
                    {details.candidateImages.map((url, index) => (
                      <div key={url} className="overflow-hidden rounded-[10px] bg-white ring-1 ring-slate-200">
                        <PreviewableImage
                          sourceImageUrl={url}
                          displayImageUrl={toDisplayImageUrl(url) ?? url}
                          alt={labels('candidateImageAlt', {
                            index: index + 1,
                          })}
                          buttonClassName="block w-full cursor-zoom-in overflow-hidden"
                          imageClassName="h-12 w-full object-cover"
                        />
                      </div>
                    ))}
                  </div>,
                )
              : null}
            {renderTextSection(labels('error'), details.errorMessage)}
          </WorkspaceCanvasMotionPresence>
        </>
      ) : null}
    </div>
  )
}
export function VideoContent({
  data,
  labels,
  expanded,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly labels: ReturnType<typeof useTranslations>
  readonly expanded: boolean
}) {
  if (nodeIsRunning(data)) return <MediaPreview data={data} />
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
            {renderSection(
              labels('videoMeta'),
              <div className="space-y-1">
                {renderValue(labels('videoModel'), details.videoModel)}
                {renderValue(labels('baseVideo'), details.videoUrl)}
              </div>,
            )}
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
