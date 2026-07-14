'use client'

import React from 'react'
import { useTranslations } from 'next-intl'
import { type AppIconName, AppIcon } from '@/components/ui/icons'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { CanvasMediaGenerationSurface } from '../CanvasMediaGenerationSurface'
import type {
  WorkspaceCanvasEditAssetGroupItem,
  WorkspaceCanvasFlowNode,
  WorkspaceCanvasTextLine,
} from '../../node-canvas-types'
import { PreviewableImage, SELECTABLE_TEXT_CLASS, renderSection } from './renderer-shared'

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

export function mediaLoadingStyleImageUrl(data: WorkspaceCanvasFlowNode['data']): string | null {
  return data.mediaLoadingContext?.styleImageUrl ?? null
}

export function MediaPreview({ data }: { readonly data: WorkspaceCanvasFlowNode['data'] }) {
  const displayVideoUrl = data.kind === 'videoPlan' ? toDisplayImageUrl(data.videoPlanDetails?.outputUrl) : null
  const displayImageUrl = toDisplayImageUrl(data.previewImageUrl)
  const isEditAsset = data.kind === 'editRequiredAsset'
  const aspectRatio =
    typeof data.previewAspectRatio === 'number' && Number.isFinite(data.previewAspectRatio) && data.previewAspectRatio > 0
      ? data.previewAspectRatio
      : null
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
