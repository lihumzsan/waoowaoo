'use client'

import type { CreativeResourceView } from '@/lib/creative-resource/contracts'
import type { WorkspaceCanvasNodeRendererProps } from './types'
import { PreviewableImage, SELECTABLE_TEXT_CLASS, renderSection } from './renderer-shared'

function formatStructured(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ''
  }
}

function ResourceOutput({ resource }: { readonly resource: CreativeResourceView }) {
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
  const revision = data.resourceDetails?.resource.headRevision
  if (!revision) return null
  return (
    <div className="space-y-2">
      {revision.provenance.prompt
        ? renderSection(labels('generationPrompt'), (
            <p className={`${SELECTABLE_TEXT_CLASS} whitespace-pre-wrap break-words text-xs leading-5 text-slate-700`}>
              {revision.provenance.prompt}
            </p>
          ))
        : null}
      {revision.provenance.modelKey
        ? renderSection(labels('generationModel'), (
            <p className={`${SELECTABLE_TEXT_CLASS} break-all text-xs text-slate-700`}>{revision.provenance.modelKey}</p>
          ))
        : null}
      {revision.inputs.length > 0
        ? renderSection(labels('generationReferences'), (
            <div className="flex flex-wrap gap-1.5">
              {revision.inputs.map((reference) => (
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
            <ResourceOutput resource={resource} />
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
