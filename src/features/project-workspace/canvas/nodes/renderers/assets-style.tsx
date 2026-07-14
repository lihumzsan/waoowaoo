'use client'

import { useState, useContext } from 'react'
import { useTranslations } from 'next-intl'
import { type AppIconName, AppIcon } from '@/components/ui/icons'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { isWorkspaceCanvasLifecycleRunning, workspaceCanvasLifecycleStatusKey } from '../../lifecycle/workspace-canvas-lifecycle'
import { AdaptiveImageAspectFrame } from '../AdaptiveImageAspectFrame'
import { CanvasMediaGenerationSurface } from '../CanvasMediaGenerationSurface'
import { FieldGlyph } from '../field-glyphs'
import { type ShotField, shotDetailIconGrid } from '../shot-grid'
import { WorkspaceCanvasMotionPresence, workspaceCanvasRevealClass } from '../workspace-node-motion'
import type { WorkspaceCanvasEditAssetGroupItem, WorkspaceCanvasNodeAction, WorkspaceCanvasFlowNode } from '../../node-canvas-types'
import {
  EditablePromptSection,
  ImagePreviewHandler,
  PreviewableImage,
  SELECTABLE_TEXT_CLASS,
  WorkspaceNodeImagePreviewContext,
  editAssetDescriptionSaveHandler,
  hasText,
  nodeContentInteractionClass,
  nodeIsRunning,
  renderSection,
  renderTextBlock,
  renderTextSection,
} from './renderer-shared'
import { nodeActionIconName } from '../workspace-node-action-policy'
import { MediaPreview, editAssetPlaceholderIconName, mediaLoadingStyleImageUrl, renderChips } from './media'

export function shouldShowEditAssetStatus(asset: WorkspaceCanvasEditAssetGroupItem, previewSourceImageUrl: string | null): boolean {
  if (isWorkspaceCanvasLifecycleRunning(asset.lifecycle) || asset.lifecycle.phase === 'failed') return true
  return !hasText(previewSourceImageUrl)
}
export function editAssetStatusIconName(asset: WorkspaceCanvasEditAssetGroupItem): AppIconName {
  if (isWorkspaceCanvasLifecycleRunning(asset.lifecycle)) return 'loader'
  if (asset.lifecycle.phase === 'failed') return 'alert'
  return 'clock'
}
export function EditAssetGroupHeroCard({
  asset,
  isOpen,
  labels,
  styleImageUrl,
  onPreviewImage,
  onRunAction,
  onSelect,
}: {
  readonly asset: WorkspaceCanvasEditAssetGroupItem
  readonly isOpen: boolean
  readonly labels: ReturnType<typeof useTranslations>
  readonly styleImageUrl: string | null
  readonly onPreviewImage: ImagePreviewHandler | null
  readonly onRunAction: (action: WorkspaceCanvasNodeAction) => void
  readonly onSelect: () => void
}) {
  const statusLabels = useTranslations('projectWorkflow.canvas.workspace.status')
  const previewSourceImageUrl = asset.previewImageUrl ?? null
  const imageUrl = toDisplayImageUrl(previewSourceImageUrl)
  const loadingSize = 64
  const showStatus = shouldShowEditAssetStatus(asset, previewSourceImageUrl)
  const statusIconName = editAssetStatusIconName(asset)
  const isRunning = isWorkspaceCanvasLifecycleRunning(asset.lifecycle)
  const statusLabel = statusLabels(workspaceCanvasLifecycleStatusKey(asset.lifecycle))
  const expandLabel = isOpen ? labels('collapseDetails') : labels('expandDetails')

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isOpen}
      aria-label={`${expandLabel}: ${asset.name}`}
      className={`nodrag cursor-pointer overflow-hidden rounded-[16px] border bg-white text-left shadow-[var(--glass-shadow-sm)] transition focus:outline-none focus:ring-2 focus:ring-slate-900/30 ${isOpen ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200 hover:border-slate-300'}`}
      onClick={(event) => {
        event.stopPropagation()
        onSelect()
      }}
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
            ) : null}
            <CanvasMediaGenerationSurface
              lifecycle={asset.lifecycle}
              hasOutput={Boolean(imageUrl)}
              outputImageUrl={previewSourceImageUrl}
              styleImageUrl={styleImageUrl}
              ringSize={loadingSize}
              placeholder={<AppIcon name={editAssetPlaceholderIconName(asset.kind)} className="h-9 w-9 text-slate-300" />}
            />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-3/5 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />
            {showStatus ? (
              <span className="pointer-events-none absolute left-2.5 top-2.5 z-20 inline-flex max-w-[calc(100%-5.5rem)] items-center gap-1 rounded-full bg-black/45 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
                <AppIcon name={statusIconName} className={`h-3 w-3 shrink-0 ${statusIconName === 'loader' ? 'animate-spin' : ''}`} />
                <span className={`${SELECTABLE_TEXT_CLASS} truncate`}>{statusLabel}</span>
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
                  disabled={isRunning}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (asset.action && !isRunning) onRunAction(asset.action)
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
        <p className={`${SELECTABLE_TEXT_CLASS} px-3.5 py-3 text-xs leading-5 text-[var(--glass-text-secondary)]`}>{asset.description}</p>
      </WorkspaceCanvasMotionPresence>
    </div>
  )
}
export function EditAssetGroupContent({
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
                    styleImageUrl={mediaLoadingStyleImageUrl(data)}
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
export function StyleBiblePreview({ data }: { readonly data: WorkspaceCanvasFlowNode['data'] }) {
  const sourceImageUrl = data.previewImageUrl ?? null
  const displayImageUrl = toDisplayImageUrl(sourceImageUrl)
  const running = nodeIsRunning(data)
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
          <CanvasMediaGenerationSurface
            lifecycle={data.lifecycle}
            hasOutput={Boolean(displayImageUrl)}
            outputImageUrl={sourceImageUrl}
            styleImageUrl={mediaLoadingStyleImageUrl(data)}
            ringSize={64}
            placeholder={<AppIcon name="image" className="h-8 w-8 text-slate-400" />}
          />
        </>
      )}
    </AdaptiveImageAspectFrame>
  )
}
export function StyleBibleContent({
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
  const shouldShowPreview = data.kind === 'editStyleBible' && hasText(data.previewImageUrl)

  const collapsedContent = (
    <div className="space-y-2">
      {shouldShowPreview ? <StyleBiblePreview data={data} /> : null}
      {details.styleSummary ? renderSection(labels('styleSummary'), renderTextBlock(details.styleSummary)) : null}
    </div>
  )

  // 二级（展开）：预览图 + 视频视觉风格 + 资产图片风格
  const groups: readonly {
    readonly name: string
    readonly glyph: string
    readonly fields: readonly ShotField[]
  }[] = [
    {
      name: labels('visualPolicy'),
      glyph: 'eye',
      fields: [
        { label: labels('visualStyle'), value: details.visualStyle },
      ],
    },
    {
      name: labels('assetImageStyle'),
      glyph: 'image',
      fields: [
        {
          label: labels('lightingPrompt'),
          value: details.assetImageStyle?.lighting,
        },
        {
          label: labels('texturePrompt'),
          value: details.assetImageStyle?.texture,
        },
        {
          label: labels('compositionPrompt'),
          value: details.assetImageStyle?.composition,
        },
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
        <StyleBibleGroups groups={groups} labels={labels} />
      </WorkspaceCanvasMotionPresence>
    </>
  )
}
export function StyleBibleGroups({
  groups,
  labels,
}: {
  readonly groups: readonly {
    readonly name: string
    readonly glyph: string
    readonly fields: readonly ShotField[]
  }[]
  readonly labels: ReturnType<typeof useTranslations>
}) {
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
            <button
              key={g.name}
              type="button"
              className={`nodrag flex flex-col items-start rounded-[14px] border bg-white p-3 text-left transition ${on ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200 hover:border-slate-300'}`}
              onClick={(e) => {
                e.stopPropagation()
                setActive(on ? null : g.name)
              }}
            >
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-slate-100 text-[var(--glass-text-secondary)]">
                <FieldGlyph name={g.glyph} className="h-4 w-4" />
              </span>
              <p className={`${SELECTABLE_TEXT_CLASS} mt-2 text-xs font-semibold text-[var(--glass-text-primary)]`}>{g.name}</p>
              <p className={`${SELECTABLE_TEXT_CLASS} text-[10px] text-[var(--glass-text-tertiary)]`}>{labels('itemCount', { count: count })}</p>
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
export function EditAssetContent({
  data,
  labels,
  expanded,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly labels: ReturnType<typeof useTranslations>
  readonly expanded: boolean
}) {
  if (nodeIsRunning(data)) return <MediaPreview data={data} />
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
      {renderChips(
        labels('linkedShots'),
        details.shotNumbers.map((shotNumber) => String(shotNumber)),
      )}
      <WorkspaceCanvasMotionPresence visible={expanded && hasText(details.errorMessage)}>
        {renderSection(labels('error'), renderTextBlock(details.errorMessage))}
      </WorkspaceCanvasMotionPresence>
    </div>
  )
}
