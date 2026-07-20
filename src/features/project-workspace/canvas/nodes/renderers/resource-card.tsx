'use client'

import type { CreativeResourceView } from '@/lib/creative-resource/contracts'
import { CREATIVE_RESOURCE_SCHEMA } from '@/lib/creative-resource/schema-registry'
import type { WorkspaceCanvasNodeRendererProps } from './types'
import { PreviewableImage, SELECTABLE_TEXT_CLASS, renderSection } from './renderer-shared'

function formatStructured(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ''
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function renderStyleBibleOutput({
  data,
  labels,
}: {
  readonly data: unknown
  readonly labels: WorkspaceCanvasNodeRendererProps['labels']
}) {
  if (!isRecord(data)) return null
  const styleSummary = readString(data, 'styleSummary')
  const visualStyle = readString(data, 'visualStyle')
  const assetImageStyle = isRecord(data.assetImageStyle) ? data.assetImageStyle : null
  if (!styleSummary || !visualStyle || !assetImageStyle) return null
  const lighting = readString(assetImageStyle, 'lighting')
  const texture = readString(assetImageStyle, 'texture')
  const composition = readString(assetImageStyle, 'composition')
  if (!lighting || !texture || !composition) return null
  return (
    <div className={`${SELECTABLE_TEXT_CLASS} space-y-4 rounded-2xl bg-slate-50 p-4 text-slate-700`}>
      <div>
        <p className="text-[11px] font-medium text-slate-400">{labels('styleSummary')}</p>
        <p className="mt-1 text-sm font-semibold leading-6">{styleSummary}</p>
      </div>
      <div>
        <p className="text-[11px] font-medium text-slate-400">{labels('visualStyle')}</p>
        <p className="mt-1 whitespace-pre-wrap text-xs leading-5">{visualStyle}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {([
          ['styleLighting', lighting],
          ['styleTexture', texture],
          ['styleComposition', composition],
        ] as const).map(([label, value]) => (
          <div key={label} className="rounded-xl bg-white p-3">
            <p className="text-[11px] font-medium text-slate-400">{labels(label)}</p>
            <p className="mt-1 text-xs leading-5">{value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function ResourceOutput({
  resource,
  labels,
}: {
  readonly resource: CreativeResourceView
  readonly labels: WorkspaceCanvasNodeRendererProps['labels']
}) {
  const content = resource.headRevision?.content ?? null
  if (!content) {
    return <div className="flex h-40 items-center justify-center rounded-2xl bg-slate-50 text-sm text-slate-400">—</div>
  }
  if (content.kind === 'media') {
    if (resource.mediaType === 'image') {
      return content.url ? (
        <PreviewableImage
          sourceImageUrl={content.url}
          alt={resource.name}
          buttonClassName="w-full"
          imageClassName="max-h-72 w-full rounded-2xl bg-slate-100 object-contain"
        />
      ) : null
    }
    if (resource.mediaType === 'video') {
      return <video src={content.url} aria-label={resource.name} controls preload="metadata" className="max-h-72 w-full rounded-2xl bg-black object-contain" />
    }
    if (resource.mediaType === 'audio') {
      return <audio src={content.url} aria-label={resource.name} controls preload="metadata" className="w-full" />
    }
  }
  if (
    resource.schemaId === CREATIVE_RESOURCE_SCHEMA.STYLE_BIBLE
    && content.kind === 'structured'
  ) {
    const styleBible = renderStyleBibleOutput({ data: content.data, labels })
    if (styleBible) return styleBible
  }
  const text = content.kind === 'text'
    ? content.text
    : content.kind === 'structured'
      ? formatStructured(content.data)
      : content.kind === 'domain_snapshot'
        ? formatStructured(content.snapshot)
        : ''
  return (
    <pre className={`${SELECTABLE_TEXT_CLASS} max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-slate-50 p-4 text-xs leading-5 text-slate-700`}>
      {text}
    </pre>
  )
}

export function ResourceProvenanceContent({ data, labels }: WorkspaceCanvasNodeRendererProps) {
  const resource = data.resourceDetails?.resource
  if (!resource) return null
  const provenance = resource.headRevision?.provenance ?? resource.pendingGeneration
  const inputs = resource.headRevision?.inputs ?? resource.pendingGeneration?.inputs ?? []
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
                  {reference.role} · {reference.resourceId.slice(0, 8)}
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
  const resources = details.candidates?.resources ?? [details.resource]
  const displayed = expanded ? resources : resources.slice(0, 3)
  return (
    <div className="space-y-4">
      <div className={displayed.length > 1 ? 'grid grid-cols-1 gap-3 sm:grid-cols-2' : ''}>
        {displayed.map((resource) => (
          <div key={resource.resourceId} className="space-y-2 rounded-[18px] border border-slate-100 p-3">
            {displayed.length > 1 ? (
              <p className={`${SELECTABLE_TEXT_CLASS} text-xs font-semibold text-slate-500`}>
                {labels('candidateIndex', { index: (resource.candidateIndex ?? 0) + 1 })}
              </p>
            ) : null}
            <ResourceOutput resource={resource} labels={labels} />
          </div>
        ))}
      </div>
      {details.candidates && resources.length > displayed.length ? (
        <p className={`${SELECTABLE_TEXT_CLASS} text-xs text-slate-500`}>
          {labels('moreItems', { count: resources.length - displayed.length })}
        </p>
      ) : null}
      <ResourceProvenanceContent {...props} />
    </div>
  )
}
