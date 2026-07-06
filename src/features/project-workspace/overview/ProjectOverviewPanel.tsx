'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import type { ProjectEditBible, ProjectEditChapter } from '@/types/project'

interface ProjectOverviewPanelProps {
  readonly editBible?: ProjectEditBible | null
  readonly workflow?: EditFirstWorkflowState | null
  readonly onOpenBibleReview?: () => void
  readonly onSelectChapter?: (chapterId: string) => void
}

interface BibleStats {
  readonly title: string | null
  readonly characterCount: number
  readonly locationCount: number
  readonly worldRuleCount: number
  readonly ledgerEventCount: number
  readonly emotionalCueCount: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readArrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

function readBibleStats(editBible?: ProjectEditBible | null): BibleStats {
  const bible = isRecord(editBible?.bible) ? editBible.bible : null
  const ledger = isRecord(editBible?.ledger) ? editBible.ledger : null
  const emotionalCurve = isRecord(editBible?.emotionalCurve) ? editBible.emotionalCurve : null
  return {
    title: readString(bible?.title),
    characterCount: readArrayLength(bible?.characters),
    locationCount: readArrayLength(bible?.locations),
    worldRuleCount: readArrayLength(bible?.worldRules),
    ledgerEventCount: readArrayLength(ledger?.events),
    emotionalCueCount: readArrayLength(emotionalCurve?.cues),
  }
}

function countChaptersByStatus(chapters: readonly ProjectEditChapter[], status: string): number {
  return chapters.filter((chapter) => chapter.status === status).length
}

function countRenderedChapters(chapters: readonly ProjectEditChapter[]): number {
  return chapters.filter((chapter) => chapter.renderStatus === 'completed').length
}

function totalTargetDuration(chapters: readonly ProjectEditChapter[]): number {
  return chapters.reduce((total, chapter) => total + chapter.targetDurationSec, 0)
}

function formatDuration(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0
  const minutes = Math.floor(safeSeconds / 60)
  const remainingSeconds = safeSeconds % 60
  return `${String(minutes)}:${String(remainingSeconds).padStart(2, '0')}`
}

export default function ProjectOverviewPanel({
  editBible,
  workflow,
  onOpenBibleReview,
  onSelectChapter,
}: ProjectOverviewPanelProps) {
  const t = useTranslations('projectWorkflow.overviewPanel')
  const chapters = editBible?.chapters ?? []
  const stats = useMemo(() => readBibleStats(editBible), [editBible])
  const confirmedChapterCount = countChaptersByStatus(chapters, 'confirmed')
  const renderedChapterCount = countRenderedChapters(chapters)
  const durationLabel = formatDuration(totalTargetDuration(chapters))
  const workflowStage = workflow?.stage ?? 'not_started'

  return (
    <section className="w-[min(640px,calc(100vw-520px))] max-w-full overflow-hidden rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)]/95 shadow-xl backdrop-blur-2xl">
      <div className="border-b border-[var(--glass-stroke-soft)] px-4 py-3">
        <div className="flex items-center gap-2">
          <AppIcon name="grid" className="h-4 w-4 text-[var(--glass-tone-info-fg)]" />
          <h2 className="text-sm font-semibold text-[var(--glass-text-primary)]">{t('title')}</h2>
          <span className="ml-auto rounded-full border border-[var(--glass-stroke-base)] px-2 py-0.5 text-[11px] font-medium text-[var(--glass-text-tertiary)]">
            {t('stage', { stage: workflowStage })}
          </span>
        </div>
        <p className="mt-1 text-xs leading-5 text-[var(--glass-text-secondary)]">
          {stats.title ? t('subtitleWithTitle', { title: stats.title }) : t('subtitle')}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-px bg-[var(--glass-stroke-soft)] text-xs md:grid-cols-4">
        <div className="bg-[var(--glass-bg-surface)] px-4 py-3">
          <div className="text-[var(--glass-text-tertiary)]">{t('chapters')}</div>
          <div className="mt-1 text-lg font-semibold text-[var(--glass-text-primary)]">{chapters.length}</div>
        </div>
        <div className="bg-[var(--glass-bg-surface)] px-4 py-3">
          <div className="text-[var(--glass-text-tertiary)]">{t('targetDuration')}</div>
          <div className="mt-1 text-lg font-semibold text-[var(--glass-text-primary)]">{durationLabel}</div>
        </div>
        <div className="bg-[var(--glass-bg-surface)] px-4 py-3">
          <div className="text-[var(--glass-text-tertiary)]">{t('confirmed')}</div>
          <div className="mt-1 text-lg font-semibold text-[var(--glass-text-primary)]">{confirmedChapterCount}</div>
        </div>
        <div className="bg-[var(--glass-bg-surface)] px-4 py-3">
          <div className="text-[var(--glass-text-tertiary)]">{t('rendered')}</div>
          <div className="mt-1 text-lg font-semibold text-[var(--glass-text-primary)]">{renderedChapterCount}</div>
        </div>
      </div>

      <div className="space-y-3 px-4 py-3">
        <div className="flex flex-wrap gap-2 text-[11px]">
          <span className="rounded-full bg-[var(--glass-bg-muted)] px-2.5 py-1 text-[var(--glass-text-secondary)]">
            {t('characters', { count: stats.characterCount })}
          </span>
          <span className="rounded-full bg-[var(--glass-bg-muted)] px-2.5 py-1 text-[var(--glass-text-secondary)]">
            {t('locations', { count: stats.locationCount })}
          </span>
          <span className="rounded-full bg-[var(--glass-bg-muted)] px-2.5 py-1 text-[var(--glass-text-secondary)]">
            {t('ledgerEvents', { count: stats.ledgerEventCount })}
          </span>
          <span className="rounded-full bg-[var(--glass-bg-muted)] px-2.5 py-1 text-[var(--glass-text-secondary)]">
            {t('emotionalCues', { count: stats.emotionalCueCount })}
          </span>
          <span className="rounded-full bg-[var(--glass-bg-muted)] px-2.5 py-1 text-[var(--glass-text-secondary)]">
            {t('worldRules', { count: stats.worldRuleCount })}
          </span>
        </div>

        <div className="max-h-60 overflow-y-auto pr-1">
          {chapters.length > 0 ? (
            <div className="space-y-2">
              {chapters.map((chapter) => (
                <button
                  key={chapter.id}
                  type="button"
                  className="flex w-full min-w-0 items-start gap-3 rounded-lg border border-[var(--glass-stroke-soft)] bg-white/70 px-3 py-2 text-left transition hover:border-[var(--glass-stroke-base)] hover:bg-white"
                  onClick={() => onSelectChapter?.(chapter.id)}
                >
                  <span className="mt-0.5 flex h-6 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--glass-bg-muted)] text-[11px] font-semibold text-[var(--glass-text-secondary)]">
                    {String(chapter.chapterIndex + 1).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-[var(--glass-text-primary)]">{chapter.title}</span>
                    <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-[var(--glass-text-secondary)]">{chapter.summary}</span>
                    <span className="mt-1 flex flex-wrap gap-2 text-[10px] text-[var(--glass-text-tertiary)]">
                      <span>{t('chapterDuration', { duration: chapter.targetDurationSec })}</span>
                      <span>{t('chapterStatus', { status: chapter.status })}</span>
                      <span>{t('chapterRenderStatus', { status: chapter.renderStatus ?? '-' })}</span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-[var(--glass-stroke-base)] px-3 py-6 text-center text-xs text-[var(--glass-text-tertiary)]">
              {t('emptyChapters')}
            </div>
          )}
        </div>

        <button
          type="button"
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--glass-stroke-base)] bg-white/85 px-3 py-2 text-sm font-medium text-[var(--glass-text-primary)] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onOpenBibleReview}
          disabled={!editBible}
        >
          <AppIcon name="bookOpen" className="h-4 w-4" />
          {t('openBibleReview')}
        </button>
      </div>
    </section>
  )
}
