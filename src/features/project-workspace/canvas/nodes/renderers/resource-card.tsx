'use client'

import type {
  CreativeResourceSummaryView,
  CreativeResourceView,
} from '@/lib/creative-resource/contracts'
import type { WorkspaceCanvasNodeRendererProps } from './types'
import {
  ClampedText,
  PreviewableImage,
  SELECTABLE_TEXT_CLASS,
  renderSection,
} from './renderer-shared'

function formatStructured(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ''
  }
}

function MediaOutput({
  resource,
  media,
}: {
  readonly resource: CreativeResourceView
  readonly media: Extract<CreativeResourceSummaryView, { readonly kind: 'media' }>
}) {
  if (media.mediaType === 'image') {
    return media.url ? (
      <PreviewableImage
        sourceImageUrl={media.url}
        alt={resource.name}
        buttonClassName="w-full"
        imageClassName="max-h-72 w-full rounded-2xl bg-slate-100 object-contain"
      />
    ) : <EmptyOutput />
  }
  if (media.mediaType === 'video') {
    return media.url
      ? <video src={media.url} aria-label={resource.name} controls preload="metadata" className="max-h-72 w-full rounded-2xl bg-black object-contain" />
      : <EmptyOutput />
  }
  if (media.mediaType === 'audio') {
    return media.url
      ? <audio src={media.url} aria-label={resource.name} controls preload="metadata" className="w-full" />
      : <EmptyOutput />
  }
  return <EmptyOutput />
}

function EmptyOutput() {
  return (
    <div className="flex h-40 items-center justify-center rounded-2xl bg-slate-50 text-sm text-slate-400">
      —
    </div>
  )
}

function ResourceSummary({
  resource,
  summary,
  labels,
}: {
  readonly resource: CreativeResourceView
  readonly summary: CreativeResourceSummaryView
  readonly labels: WorkspaceCanvasNodeRendererProps['labels']
}) {
  if (summary.kind === 'text') {
    return (
      <div className="rounded-2xl bg-slate-50 p-4">
        <ClampedText text={summary.text} />
      </div>
    )
  }
  if (summary.kind === 'structured') {
    const text = summary.entryCount === null
      ? labels('structuredSummaryUnknown')
      : labels('structuredSummary', { count: summary.entryCount })
    return (
      <div className="rounded-2xl bg-slate-50 p-4">
        <ClampedText text={text} />
      </div>
    )
  }
  if (summary.kind === 'media') {
    return <MediaOutput resource={resource} media={summary} />
  }
  return <EmptyOutput />
}

function ResourceOutput({ resource }: { readonly resource: CreativeResourceView }) {
  const content = resource.materialization?.content ?? null
  if (!content) return <EmptyOutput />
  if (content.kind === 'media') {
    return (
      <MediaOutput
        resource={resource}
        media={{
          kind: 'media',
          mediaType: resource.mediaType,
          url: content.url,
          mimeType: content.mimeType,
          width: content.width,
          height: content.height,
          durationMs: content.durationMs,
        }}
      />
    )
  }
  const text = content.kind === 'text'
    ? content.text
    : formatStructured(content.data)
  return (
    <pre className={`${SELECTABLE_TEXT_CLASS} max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-slate-50 p-4 text-xs leading-5 text-slate-700`}>
      {text}
    </pre>
  )
}

export function ResourceProvenanceContent({ data, labels }: WorkspaceCanvasNodeRendererProps) {
  const resource = data.resourceDetails?.resource
  if (!resource) return null
  const provenance = resource.materialization?.provenance ?? resource.pendingGeneration
  const inputs = resource.materialization?.inputs ?? resource.pendingGeneration?.inputs ?? []
  if (!provenance) return null
  return (
    <div className="space-y-2">
      {provenance.prompt
        ? renderSection(labels('generationPrompt'), (
            <p className={`${SELECTABLE_TEXT_CLASS} whitespace-pre-wrap break-words text-xs leading-5 text-slate-700`}>
              {provenance.prompt}
            </p>
          ))
        : null}
      {provenance.modelKey
        ? renderSection(labels('generationModel'), (
            <p className={`${SELECTABLE_TEXT_CLASS} break-all text-xs text-slate-700`}>{provenance.modelKey}</p>
          ))
        : null}
      {inputs.length > 0
        ? renderSection(labels('generationReferences'), (
            <div className="flex flex-wrap gap-1.5">
              {inputs.map((reference) => (
                <span key={`${reference.role}:${reference.position}`} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-600">
                  {reference.role} · {reference.resourceId}
                </span>
              ))}
            </div>
          ))
        : null}
    </div>
  )
}

export function ResourceCardContent(props: WorkspaceCanvasNodeRendererProps) {
  const { data, labels, expanded } = props
  const details = data.resourceDetails
  if (!details) return null
  const summaryByResourceId = new Map(
    details.candidates?.summaries.map((entry) => [entry.resourceId, entry.summary]) ?? [],
  )
  const items = details.candidates?.resources.map((resource) => {
    const summary = summaryByResourceId.get(resource.resourceId)
    if (!summary) {
      throw new Error(`CREATIVE_RESOURCE_CANDIDATE_SUMMARY_MISSING:${resource.resourceId}`)
    }
    return { resource, summary }
  }) ?? [{
    resource: details.resource,
    summary: details.presentation.summary,
  }]
  const displayed = expanded ? items : items.slice(0, 3)
  return (
    <div className="space-y-4">
      <div className={displayed.length > 1 ? 'grid grid-cols-1 gap-3 sm:grid-cols-2' : ''}>
        {displayed.map(({ resource, summary }) => (
          <div key={resource.resourceId} className="space-y-2 rounded-[18px] border border-slate-100 p-3">
            {displayed.length > 1 ? (
              <p className={`${SELECTABLE_TEXT_CLASS} text-xs font-semibold text-slate-500`}>
                {labels('candidateIndex', { index: (resource.candidateIndex ?? 0) + 1 })}
              </p>
            ) : null}
            {expanded
              ? <ResourceOutput resource={resource} />
              : <ResourceSummary resource={resource} summary={summary} labels={labels} />}
          </div>
        ))}
      </div>
      {details.candidates && items.length > displayed.length ? (
        <p className={`${SELECTABLE_TEXT_CLASS} text-xs text-slate-500`}>
          {labels('moreItems', { count: items.length - displayed.length })}
        </p>
      ) : null}
      {expanded ? <ResourceProvenanceContent {...props} /> : null}
    </div>
  )
}
