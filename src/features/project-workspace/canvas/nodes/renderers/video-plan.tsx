'use client'

import React, { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { AdaptiveImageAspectFrame } from '../AdaptiveImageAspectFrame'
import { CanvasActionButton } from '../CanvasActionButton'
import { WorkspaceCanvasMotionPresence } from '../workspace-node-motion'
import type { WorkspaceCanvasFlowNode, WorkspaceCanvasNodeAction } from '../../node-canvas-types'
import {
  EditablePromptSection,
  PreviewableImage,
  SELECTABLE_TEXT_CLASS,
  dispatchNodeAction,
  hasText,
  nodeContentInteractionClass,
  nodeIsRunning,
  renderSection,
  renderTextBlock,
  renderValue,
  videoElementAspectRatio,
  videoPlanGenerationOptions,
  videoPlanModel,
} from './renderer-shared'

export function VideoPlanReferenceThumbnail({
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
export function VideoPlanContent({
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
  const running = nodeIsRunning(data)
  const canUseNodeActions = Boolean(data.onAction) && data.readOnly !== true
  const referenceAspectRatio =
    details.sourceImages.find((cell) => typeof cell?.aspectRatio === 'number' && Number.isFinite(cell.aspectRatio) && cell.aspectRatio > 0)?.aspectRatio ??
    16 / 9
  const storedOutputAspectRatio =
    typeof details.outputAspectRatio === 'number' && Number.isFinite(details.outputAspectRatio) && details.outputAspectRatio > 0
      ? details.outputAspectRatio
      : referenceAspectRatio
  const outputAspectRatio = intrinsicOutputAspectRatio ?? storedOutputAspectRatio
  const outputStyle = { aspectRatio: String(outputAspectRatio) }
  const shouldShowVideo = Boolean(displayOutputUrl && previewMode === 'video')
  const assetReferences = details.assetReferences ?? []
  const assetReferenceImageUrls = assetReferences.map((asset) => asset.imageUrl).filter((imageUrl): imageUrl is string => hasText(imageUrl))
  const storyboardReferences = details.sourceImages
  const storyboardReferenceImageUrls = storyboardReferences.map((image) => image.imageUrl).filter((imageUrl): imageUrl is string => hasText(imageUrl))
  const assetReferenceVideoModel = videoPlanModel(data)
  const firstStoryboardReference = storyboardReferences[0] ?? null
  const canGenerateStoryboard =
    assetReferenceVideoModel.length > 0 &&
    storyboardReferenceImageUrls.length === storyboardReferences.length &&
    storyboardReferenceImageUrls.length > 0 &&
    !running &&
    canUseNodeActions &&
    (details.kind === 'group' ||
      (hasText(firstStoryboardReference?.panelId) &&
        hasText(firstStoryboardReference?.storyboardId) &&
        typeof firstStoryboardReference?.panelIndex === 'number'))
  const canGenerateAssetReference = assetReferenceImageUrls.length > 0 && assetReferenceVideoModel.length > 0 && !running && canUseNodeActions
  const canGenerateSelectedMode = generationMode === 'storyboard' ? canGenerateStoryboard : canGenerateAssetReference
  const shouldShowVideoModelHint =
    !displayOutputUrl && (storyboardReferenceImageUrls.length > 0 || assetReferenceImageUrls.length > 0) && assetReferenceVideoModel.length === 0
  const shouldShowAssetReferences = previewMode === 'reference' && generationMode === 'asset-reference'
  const missingReferenceLabel = shouldShowAssetReferences ? labels('assetReferenceImagesMissing') : labels('storyboardReferenceImagesMissing')
  const generateLabel = displayOutputUrl
    ? generationMode === 'storyboard'
      ? labels('regenerateStoryboardReferenceVideo')
      : labels('regenerateAssetReferenceVideo')
    : generationMode === 'storyboard'
      ? labels('generateStoryboardReferenceVideo')
      : labels('generateAssetReferenceVideo')
  const handleOutputVideoLoadedMetadata = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const nextAspectRatio = videoElementAspectRatio(event.currentTarget)
    if (nextAspectRatio === null) return
    setIntrinsicOutputAspectRatio((currentAspectRatio) =>
      currentAspectRatio !== null && Math.abs(currentAspectRatio - nextAspectRatio) < 0.001 ? currentAspectRatio : nextAspectRatio,
    )
  }
  const selectedGenerationAction: WorkspaceCanvasNodeAction | null = !canGenerateSelectedMode
    ? null
    : generationMode === 'asset-reference'
      ? {
          type: 'generate_asset_reference_video',
          chapterId: details.chapterId,
          segmentIndex: details.segmentIndex,
          referenceImageUrls: assetReferenceImageUrls,
          generationOptions: videoPlanGenerationOptions(data),
        }
      : details.kind === 'group'
        ? {
            type: 'generate_video_group',
            chapterId: details.chapterId,
            gridMode: details.gridMode === '3x3' ? '3x3' : '2x2',
            shotIds: details.shotIds,
            generationOptions: videoPlanGenerationOptions(data),
          }
        : hasText(firstStoryboardReference?.panelId) &&
            hasText(firstStoryboardReference?.storyboardId) &&
            typeof firstStoryboardReference.panelIndex === 'number'
          ? {
              type: 'generate_video',
              storyboardId: firstStoryboardReference.storyboardId,
              panelIndex: firstStoryboardReference.panelIndex,
              panelId: firstStoryboardReference.panelId,
              generationOptions: videoPlanGenerationOptions(data),
            }
          : null
  const renderPromptSection = (promptExpanded: boolean) =>
    details.prompt ? <EditablePromptSection title={labels('videoPlanPrompt')} value={details.prompt} expanded={promptExpanded} labels={labels} /> : null
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
                const displayImageUrl = imageUrl ? (toDisplayImageUrl(imageUrl) ?? imageUrl) : null
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
      {canUseNodeActions
        ? renderSection(
            labels('generationMode'),
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
              {selectedGenerationAction ? (
                <CanvasActionButton
                  action={selectedGenerationAction}
                  nodeId={data.nodeId ?? data.targetId}
                  type="button"
                  icon="video"
                  label={generateLabel}
                  className="w-full rounded-md"
                  onDirectAction={() => dispatchNodeAction(data, selectedGenerationAction)}
                />
              ) : (
                <button
                  type="button"
                  disabled
                  className="w-full rounded-md bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {generateLabel}
                </button>
              )}
              {shouldShowVideoModelHint ? <p className="text-xs leading-5 text-[var(--glass-tone-danger-fg)]">{labels('videoPlanModelMissing')}</p> : null}
            </div>,
          )
        : null}
      {renderSection(
        labels('videoPlanMeta'),
        <div className="space-y-1">
          {renderValue(labels('generationMode'), details.kind === 'group' ? labels('videoPlanGroup') : labels('videoPlanSingle'))}
          {renderValue(labels('duration'), `${details.durationSec}s`)}
        </div>,
      )}
      {!expanded ? renderPromptSection(false) : null}
      <WorkspaceCanvasMotionPresence visible={expanded}>{renderPromptSection(true)}</WorkspaceCanvasMotionPresence>
      {details.errorMessage ? renderSection(labels('error'), renderTextBlock(details.errorMessage)) : null}
      {details.validationMessage ? renderSection(labels('error'), renderTextBlock(details.validationMessage)) : null}
    </div>
  )
}
