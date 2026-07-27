'use client'

import { useTranslations } from 'next-intl'
import type { DataMessagePartProps } from '@assistant-ui/react'
import { AppIcon } from '@/components/ui/icons'
import type { ProjectAgentWebSearchPartData } from '@/lib/project-agent/types'

/**
 * What the assistant actually looked at on the web.
 *
 * Research is otherwise invisible: a direction grounded in real sources and one
 * asserted from memory read identically. While the hosted search runs this
 * shows the live query, and on completion it becomes the source list the answer
 * rests on.
 *
 * Everything here is third-party content. Links open in a new tab with no
 * referrer, images are never treated as project material, and nothing in this
 * card is a state authority — the Operation result is.
 */

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function SearchingRow(props: { readonly label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm leading-5 text-[var(--glass-text-secondary)]">
      <AppIcon name="loader" className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
      <span className="min-w-0 truncate">{props.label}</span>
    </div>
  )
}

function SourceList(props: {
  readonly sources: ProjectAgentWebSearchPartData['sources']
}) {
  return (
    <ul className="mt-1.5 flex flex-col gap-1">
      {props.sources.map((source) => (
        <li key={source.url} className="min-w-0">
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer noopener"
            className="flex min-w-0 items-center gap-1.5 text-xs leading-5 text-[var(--glass-text-secondary)] hover:text-[var(--glass-text-primary)]"
          >
            <AppIcon name="externalLink" className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
            <span className="min-w-0 truncate">{source.title}</span>
            <span className="shrink-0 text-[var(--glass-text-tertiary)]">{hostOf(source.url)}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}

function ImageStrip(props: {
  readonly images: ProjectAgentWebSearchPartData['images']
  readonly t: ReturnType<typeof useTranslations<'assistantAgent'>>
}) {
  return (
    <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
      {props.images.map((image) => (
        <a
          key={image.imageUrl}
          href={image.sourceUrl ?? image.imageUrl}
          target="_blank"
          rel="noreferrer noopener"
          title={image.caption ?? undefined}
          className="block shrink-0"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- third-party
              evidence rendered as-is; it is deliberately not owned media and
              must not enter the project image pipeline. */}
          <img
            src={image.thumbnailUrl ?? image.imageUrl}
            alt={image.caption ?? props.t('webSearch.imageAlt')}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-20 w-20 rounded-lg border border-[var(--glass-stroke-base)] object-cover"
          />
        </a>
      ))}
    </div>
  )
}

export function WebSearchDataCard({ data }: DataMessagePartProps<ProjectAgentWebSearchPartData>) {
  const t = useTranslations('assistantAgent')
  if (data.phase === 'searching') {
    return (
      <SearchingRow
        label={data.activeQuery
          ? t('webSearch.searchingQuery', { query: data.activeQuery })
          : t('webSearch.searching', { brief: data.brief })}
      />
    )
  }
  if (data.sources.length === 0) return null
  return (
    <details className="rounded-xl border border-[var(--glass-stroke-base)] px-2.5 py-2 text-xs leading-5 text-[var(--glass-text-tertiary)]">
      <summary className="flex cursor-pointer list-none items-center gap-1.5">
        <AppIcon name="globe" className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
        <span className="min-w-0 truncate text-[var(--glass-text-secondary)]">
          {data.images.length > 0
            ? t('webSearch.resultWithImages', {
                sources: data.sources.length,
                images: data.images.length,
              })
            : t('webSearch.result', { sources: data.sources.length })}
        </span>
        <AppIcon
          name="chevronDown"
          className="h-3 w-3 shrink-0 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <SourceList sources={data.sources} />
      {data.images.length > 0 ? <ImageStrip images={data.images} t={t} /> : null}
    </details>
  )
}
