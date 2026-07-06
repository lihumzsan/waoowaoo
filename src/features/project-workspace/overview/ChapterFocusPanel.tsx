'use client'

import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import type { ProjectEditChapter } from '@/types/project'

interface ChapterFocusPanelProps {
  readonly chapter?: ProjectEditChapter | null
}

export default function ChapterFocusPanel({ chapter }: ChapterFocusPanelProps) {
  const t = useTranslations('projectWorkflow.chapterFocus')

  if (!chapter) {
    return (
      <section className="w-[min(520px,calc(100vw-2rem))] rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)]/95 px-4 py-5 text-sm text-[var(--glass-text-secondary)] shadow-xl backdrop-blur-2xl">
        <div className="flex items-center gap-2 font-semibold text-[var(--glass-text-primary)]">
          <AppIcon name="bookmark" className="h-4 w-4 text-[var(--glass-tone-info-fg)]" />
          {t('title')}
        </div>
        <p className="mt-2 text-xs leading-5 text-[var(--glass-text-tertiary)]">{t('empty')}</p>
      </section>
    )
  }

  return (
    <section className="w-[min(560px,calc(100vw-2rem))] rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)]/95 shadow-xl backdrop-blur-2xl">
      <div className="border-b border-[var(--glass-stroke-soft)] px-4 py-3">
        <div className="flex items-center gap-2">
          <AppIcon name="bookmark" className="h-4 w-4 text-[var(--glass-tone-info-fg)]" />
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--glass-text-primary)]">
            {t('heading', { index: chapter.chapterIndex + 1, title: chapter.title })}
          </h2>
        </div>
        <p className="mt-1 text-xs leading-5 text-[var(--glass-text-secondary)]">{chapter.summary}</p>
      </div>
      <div className="grid grid-cols-2 gap-px bg-[var(--glass-stroke-soft)] text-xs">
        <div className="bg-[var(--glass-bg-surface)] px-4 py-3">
          <div className="text-[var(--glass-text-tertiary)]">{t('targetDuration')}</div>
          <div className="mt-1 text-lg font-semibold text-[var(--glass-text-primary)]">{t('durationValue', { duration: chapter.targetDurationSec })}</div>
        </div>
        <div className="bg-[var(--glass-bg-surface)] px-4 py-3">
          <div className="text-[var(--glass-text-tertiary)]">{t('sourceRange')}</div>
          <div className="mt-1 text-lg font-semibold text-[var(--glass-text-primary)]">{chapter.sourceStart}-{chapter.sourceEnd}</div>
        </div>
        <div className="bg-[var(--glass-bg-surface)] px-4 py-3">
          <div className="text-[var(--glass-text-tertiary)]">{t('planStatus')}</div>
          <div className="mt-1 text-sm font-semibold text-[var(--glass-text-primary)]">{chapter.status}</div>
        </div>
        <div className="bg-[var(--glass-bg-surface)] px-4 py-3">
          <div className="text-[var(--glass-text-tertiary)]">{t('renderStatus')}</div>
          <div className="mt-1 text-sm font-semibold text-[var(--glass-text-primary)]">{chapter.renderStatus ?? '-'}</div>
        </div>
      </div>
      <div className="space-y-2 px-4 py-3 text-xs text-[var(--glass-text-secondary)]">
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-[var(--glass-bg-muted)] px-2.5 py-1">{t('beatCount', { count: chapter.beatIds.length })}</span>
          <span className="rounded-full bg-[var(--glass-bg-muted)] px-2.5 py-1">{t('eventCount', { count: chapter.eventIds.length })}</span>
          {chapter.outputMediaId ? <span className="rounded-full bg-[var(--glass-bg-muted)] px-2.5 py-1">{t('hasOutput')}</span> : null}
        </div>
      </div>
    </section>
  )
}
