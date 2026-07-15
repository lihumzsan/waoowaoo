'use client'

import { useTranslations } from 'next-intl'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { shotDetailIconGrid } from '../shot-grid'
import { WorkspaceCanvasMotionPresence } from '../workspace-node-motion'
import type { WorkspaceCanvasFlowNode } from '../../node-canvas-types'
import { SELECTABLE_TEXT_CLASS, nodeIsRunning, renderSection, renderSummaryText, renderTextSection, renderValue } from './renderer-shared'
import { renderChips } from './media'

export function FinalContent({
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
  const running = nodeIsRunning(data)
  const displayOutputUrl = details.renderStatus === 'completed' ? (toDisplayImageUrl(details.outputUrl) ?? details.outputUrl) : null
  return (
    <div className={`space-y-2 rounded-[18px] ${running ? 'workspace-node-loading-surface' : ''}`}>
      {displayOutputUrl ? (
        <div className="nodrag nowheel overflow-hidden rounded-[18px] border border-slate-200 bg-slate-100">
          <video src={displayOutputUrl} aria-label={data.title} controls preload="metadata" className="h-[156px] w-full bg-black object-contain" />
        </div>
      ) : null}
      {renderSection(
        labels('finalStats'),
        shotDetailIconGrid([
          {
            label: labels('totalShots'),
            value: details.totalShots != null ? String(details.totalShots) : '',
          },
          {
            label: labels('totalImages'),
            value: details.totalImages != null ? String(details.totalImages) : '',
          },
          {
            label: labels('totalVideos'),
            value: details.totalVideos != null ? String(details.totalVideos) : '',
          },
          {
            label: labels('totalDuration'),
            value: details.totalDuration != null ? String(details.totalDuration) : '',
          },
        ]),
      )}
      <WorkspaceCanvasMotionPresence visible={expanded}>{renderChips(labels('videoOrder'), details.orderedVideoLabels)}</WorkspaceCanvasMotionPresence>
    </div>
  )
}
export function BgmScoreContent({
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
  const renderTimedSectionList = (sections: typeof details.designSections, sectionTitle: string) =>
    sections.length > 0 ? (
      <div className="space-y-2">
        <p className={`${SELECTABLE_TEXT_CLASS} text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}>{sectionTitle}</p>
        {sections.map((section, index) => {
          const timeRange =
            typeof section.startSec === 'number' || typeof section.endSec === 'number'
              ? `${section.startSec ?? 0}s - ${section.endSec ?? details.durationSeconds ?? ''}s`
              : null
          const streamClassName = data.lifecycle.stream?.isStreaming === true ? 'workspace-node-stream-soft-enter' : ''
          return (
            <section key={`${section.title}-${index}`} className={`space-y-1.5 rounded-[16px] bg-slate-50 p-3 ring-1 ring-slate-100 ${streamClassName}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  {section.category ? (
                    <p className={`${SELECTABLE_TEXT_CLASS} text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}>{section.category}</p>
                  ) : null}
                  <p className={`${SELECTABLE_TEXT_CLASS} break-words text-xs font-semibold text-[var(--glass-text-primary)]`}>{section.title}</p>
                </div>
                {timeRange ? <span className={`${SELECTABLE_TEXT_CLASS} shrink-0 text-[10px] text-[var(--glass-text-tertiary)]`}>{timeRange}</span> : null}
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
      <p className={`${SELECTABLE_TEXT_CLASS} text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}>{labels('finalBgmMix')}</p>
      <audio src={displayMixUrl} controls preload="metadata" className="w-full" />
    </div>
  ) : null
  const statsSection = renderSection(
    labels('bgmScoreStats'),
    <div className="space-y-1">
      {renderValue(labels('status'), details.status)}
      {renderValue(labels('totalDuration'), details.durationSeconds)}
      {details.hasPromptDesign ? renderValue(labels('designSectionCount'), details.designSectionCount) : null}
      {details.hasPromptDesign ? renderValue(labels('promptSectionCount'), details.promptSectionCount) : null}
      {details.hasPromptDesign ? renderValue(labels('virtualLayerCount'), details.virtualLayerCount) : null}
      {renderValue(labels('musicModel'), details.musicModel)}
    </div>,
  )
  const missingPromptSection = details.promptDesignMissing ? renderTextSection(labels('promptDesignMissing'), labels('promptDesignMissingDescription')) : null
  const overviewSection = expanded ? renderTextSection(labels('scoreOverview'), details.scoreOverview) : null
  const designSections = expanded ? renderTimedSectionList(details.designSections, labels('scoreDesignSections')) : null
  const virtualLayerSections =
    expanded && details.virtualLayers.length > 0 ? (
      <div className="space-y-2">
        <p className={`${SELECTABLE_TEXT_CLASS} text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}>{labels('virtualLayers')}</p>
        {details.virtualLayers.map((layer, index) => (
          <section
            key={`${layer.name}-${index}`}
            className={`space-y-1.5 rounded-[16px] bg-slate-50 p-3 ring-1 ring-slate-100 ${data.lifecycle.stream?.isStreaming === true ? 'workspace-node-stream-soft-enter' : ''}`}
          >
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
    <div
      className={`grid gap-3 rounded-[18px] lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)] ${nodeIsRunning(data) ? 'workspace-node-loading-surface' : ''}`}
    >
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
    <div className={`space-y-2 rounded-[18px] ${nodeIsRunning(data) ? 'workspace-node-loading-surface' : ''}`}>
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
