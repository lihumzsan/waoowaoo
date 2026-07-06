'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { useConfirmProjectEditBible, useReviseProjectEditBible } from '@/lib/query/hooks'
import type { ProjectEditBible, ProjectEditChapter } from '@/types/project'

interface BibleReviewPanelProps {
  readonly projectId: string | null
  readonly episodeId: string | null
  readonly editBible?: ProjectEditBible | null
  readonly onSelectChapter?: (chapterId: string) => void
}

interface EntitySummary {
  readonly entityId: string
  readonly name: string
  readonly summary: string
}

interface BibleDrafts {
  readonly bible: string
  readonly beatSheet: string
  readonly ledger: string
  readonly emotionalCurve: string
}

interface BibleRevisionPatch {
  readonly bible?: unknown
  readonly beatSheet?: unknown
  readonly ledger?: unknown
  readonly emotionalCurve?: unknown
}

type DraftKey = keyof BibleDrafts

const DRAFT_KEYS: readonly DraftKey[] = ['bible', 'beatSheet', 'ledger', 'emotionalCurve']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function formatJson(value: unknown): string {
  if (value === null || value === undefined) return ''
  return JSON.stringify(value, null, 2)
}

function buildDrafts(editBible?: ProjectEditBible | null): BibleDrafts {
  return {
    bible: formatJson(editBible?.bible),
    beatSheet: formatJson(editBible?.beatSheet),
    ledger: formatJson(editBible?.ledger),
    emotionalCurve: formatJson(editBible?.emotionalCurve),
  }
}

function hasDraftChanges(left: BibleDrafts, right: BibleDrafts): boolean {
  return DRAFT_KEYS.some((key) => left[key].trim() !== right[key].trim())
}

function parseDraftJson(label: string, raw: string): unknown {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error(`${label}: JSON_REQUIRED`)
  const parsed = JSON.parse(trimmed) as unknown
  if (!isRecord(parsed)) throw new Error(`${label}: JSON_OBJECT_REQUIRED`)
  return parsed
}

function buildRevisionPatch(initialDrafts: BibleDrafts, drafts: BibleDrafts, labels: Record<DraftKey, string>): BibleRevisionPatch {
  const patch: {
    bible?: unknown
    beatSheet?: unknown
    ledger?: unknown
    emotionalCurve?: unknown
  } = {}
  DRAFT_KEYS.forEach((key) => {
    if (drafts[key].trim() === initialDrafts[key].trim()) return
    patch[key] = parseDraftJson(labels[key], drafts[key])
  })
  if (Object.keys(patch).length === 0) throw new Error('EDIT_BIBLE_REVISION_EMPTY')
  return patch
}

function readEntities(value: unknown): EntitySummary[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): EntitySummary[] => {
    if (!isRecord(item)) return []
    const name = readString(item.name)
    const summary = readString(item.summary)
    if (!name || !summary) return []
    return [{
      entityId: readString(item.entityId) ?? name,
      name,
      summary,
    }]
  })
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): string[] => {
    const text = readString(item)
    return text ? [text] : []
  })
}

function countArrayField(record: unknown, field: string): number {
  return isRecord(record) && Array.isArray(record[field]) ? record[field].length : 0
}

function BibleEntityList(props: {
  readonly title: string
  readonly items: readonly EntitySummary[]
  readonly emptyLabel: string
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-normal text-[var(--glass-text-tertiary)]">{props.title}</h3>
      {props.items.length > 0 ? (
        <div className="mt-2 space-y-2">
          {props.items.slice(0, 8).map((item) => (
            <div key={item.entityId} className="rounded-lg border border-[var(--glass-stroke-soft)] bg-white/70 px-3 py-2">
              <div className="truncate text-sm font-semibold text-[var(--glass-text-primary)]">{item.name}</div>
              <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-[var(--glass-text-secondary)]">{item.summary}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 rounded-lg border border-dashed border-[var(--glass-stroke-base)] px-3 py-3 text-xs text-[var(--glass-text-tertiary)]">{props.emptyLabel}</p>
      )}
    </div>
  )
}

function BibleChapterList(props: {
  readonly chapters: readonly ProjectEditChapter[]
  readonly onSelectChapter?: (chapterId: string) => void
  readonly labels: {
    readonly title: string
    readonly duration: (value: number) => string
    readonly empty: string
  }
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-normal text-[var(--glass-text-tertiary)]">{props.labels.title}</h3>
      {props.chapters.length > 0 ? (
        <div className="mt-2 grid gap-2">
          {props.chapters.map((chapter) => (
            <button
              key={chapter.id}
              type="button"
              className="flex min-w-0 items-start gap-3 rounded-lg border border-[var(--glass-stroke-soft)] bg-white/70 px-3 py-2 text-left transition hover:border-[var(--glass-stroke-base)] hover:bg-white"
              onClick={() => props.onSelectChapter?.(chapter.id)}
            >
              <span className="mt-0.5 flex h-6 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--glass-bg-muted)] text-[11px] font-semibold text-[var(--glass-text-secondary)]">
                {String(chapter.chapterIndex + 1).padStart(2, '0')}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-[var(--glass-text-primary)]">{chapter.title}</span>
                <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-[var(--glass-text-secondary)]">{chapter.summary}</span>
                <span className="mt-1 block text-[10px] text-[var(--glass-text-tertiary)]">{props.labels.duration(chapter.targetDurationSec)}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-2 rounded-lg border border-dashed border-[var(--glass-stroke-base)] px-3 py-3 text-xs text-[var(--glass-text-tertiary)]">{props.labels.empty}</p>
      )}
    </div>
  )
}

export default function BibleReviewPanel({
  projectId,
  episodeId,
  editBible,
  onSelectChapter,
}: BibleReviewPanelProps) {
  const t = useTranslations('projectWorkflow.bibleReview')
  const confirmBible = useConfirmProjectEditBible(projectId)
  const reviseBible = useReviseProjectEditBible(projectId)
  const initialDrafts = useMemo(() => buildDrafts(editBible), [editBible])
  const [drafts, setDrafts] = useState<BibleDrafts>(initialDrafts)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  useEffect(() => {
    setDrafts(initialDrafts)
    setErrorMessage(null)
    setSuccessMessage(null)
  }, [initialDrafts])

  const bibleRecord = isRecord(editBible?.bible) ? editBible.bible : null
  const title = readString(bibleRecord?.title) ?? t('untitled')
  const logline = readString(bibleRecord?.logline)
  const synopsis = readString(bibleRecord?.synopsis)
  const characters = readEntities(bibleRecord?.characters)
  const locations = readEntities(bibleRecord?.locations)
  const worldRules = readStringList(bibleRecord?.worldRules)
  const chapters = editBible?.chapters ?? []
  const beatCount = countArrayField(editBible?.beatSheet, 'beats')
  const ledgerEventCount = countArrayField(editBible?.ledger, 'events')
  const emotionalCueCount = countArrayField(editBible?.emotionalCurve, 'cues')
  const canConfirm = Boolean(episodeId && editBible && editBible.status === 'ready_for_review')
  const canRevise = Boolean(episodeId && editBible && editBible.status !== 'confirmed' && !editBible.lockedAt && hasDraftChanges(initialDrafts, drafts))
  const submitting = confirmBible.isPending || reviseBible.isPending

  const draftLabels: Record<DraftKey, string> = {
    bible: t('draft.bible'),
    beatSheet: t('draft.beatSheet'),
    ledger: t('draft.ledger'),
    emotionalCurve: t('draft.emotionalCurve'),
  }

  const submitConfirm = async () => {
    if (!episodeId || !canConfirm || submitting) return
    setErrorMessage(null)
    setSuccessMessage(null)
    try {
      await confirmBible.mutateAsync({ episodeId })
      setSuccessMessage(t('confirmSuccess'))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const submitRevision = async () => {
    if (!episodeId || !canRevise || submitting) return
    setErrorMessage(null)
    setSuccessMessage(null)
    try {
      const patch = buildRevisionPatch(initialDrafts, drafts, draftLabels)
      await reviseBible.mutateAsync({
        episodeId,
        ...patch,
      })
      setSuccessMessage(t('revisionSuccess'))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }

  if (!editBible) {
    return (
      <section className="w-[min(720px,calc(100vw-520px))] max-w-full rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)]/95 px-4 py-6 text-sm text-[var(--glass-text-secondary)] shadow-xl backdrop-blur-2xl">
        <div className="flex items-center gap-2 font-semibold text-[var(--glass-text-primary)]">
          <AppIcon name="bookOpen" className="h-4 w-4 text-[var(--glass-tone-info-fg)]" />
          {t('title')}
        </div>
        <p className="mt-2 text-xs leading-5 text-[var(--glass-text-tertiary)]">{t('empty')}</p>
      </section>
    )
  }

  return (
    <section className="flex max-h-[calc(100vh-220px)] w-[min(760px,calc(100vw-520px))] max-w-full flex-col overflow-hidden rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)]/95 shadow-xl backdrop-blur-2xl">
      <div className="border-b border-[var(--glass-stroke-soft)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <AppIcon name="bookOpen" className="h-4 w-4 shrink-0 text-[var(--glass-tone-info-fg)]" />
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--glass-text-primary)]">{t('title')}</h2>
          <span className="rounded-full border border-[var(--glass-stroke-base)] px-2 py-0.5 text-[11px] font-medium text-[var(--glass-text-tertiary)]">
            {t('status', { status: editBible.status })}
          </span>
          {editBible.version ? (
            <span className="rounded-full border border-[var(--glass-stroke-base)] px-2 py-0.5 text-[11px] font-medium text-[var(--glass-text-tertiary)]">
              {t('version', { version: editBible.version })}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-xs leading-5 text-[var(--glass-text-secondary)]">{t('description')}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-5">
          <div>
            <h3 className="text-base font-semibold text-[var(--glass-text-primary)]">{title}</h3>
            {logline ? <p className="mt-1 text-xs leading-5 text-[var(--glass-text-secondary)]">{logline}</p> : null}
            {synopsis ? <p className="mt-2 text-sm leading-6 text-[var(--glass-text-primary)]">{synopsis}</p> : null}
            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
              <span className="rounded-full bg-[var(--glass-bg-muted)] px-2.5 py-1 text-[var(--glass-text-secondary)]">{t('stats.chapters', { count: chapters.length })}</span>
              <span className="rounded-full bg-[var(--glass-bg-muted)] px-2.5 py-1 text-[var(--glass-text-secondary)]">{t('stats.beats', { count: beatCount })}</span>
              <span className="rounded-full bg-[var(--glass-bg-muted)] px-2.5 py-1 text-[var(--glass-text-secondary)]">{t('stats.ledgerEvents', { count: ledgerEventCount })}</span>
              <span className="rounded-full bg-[var(--glass-bg-muted)] px-2.5 py-1 text-[var(--glass-text-secondary)]">{t('stats.emotionalCues', { count: emotionalCueCount })}</span>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <BibleEntityList title={t('characters')} items={characters} emptyLabel={t('emptyCharacters')} />
            <BibleEntityList title={t('locations')} items={locations} emptyLabel={t('emptyLocations')} />
          </div>

          {worldRules.length > 0 ? (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-normal text-[var(--glass-text-tertiary)]">{t('worldRules')}</h3>
              <ul className="mt-2 space-y-1.5 text-xs leading-5 text-[var(--glass-text-secondary)]">
                {worldRules.map((rule) => (
                  <li key={rule} className="rounded-lg border border-[var(--glass-stroke-soft)] bg-white/70 px-3 py-2">{rule}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <BibleChapterList
            chapters={chapters}
            onSelectChapter={onSelectChapter}
            labels={{
              title: t('chapters'),
              duration: (duration) => t('chapterDuration', { duration: duration }),
              empty: t('emptyChapters'),
            }}
          />

          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-normal text-[var(--glass-text-tertiary)]">{t('structuredDrafts')}</h3>
            {DRAFT_KEYS.map((key) => (
              <label key={key} className="block">
                <span className="mb-1.5 block text-xs font-semibold text-[var(--glass-text-secondary)]">{draftLabels[key]}</span>
                <textarea
                  value={drafts[key]}
                  onChange={(event) => {
                    const value = event.target.value
                    setDrafts((current) => ({
                      ...current,
                      [key]: value,
                    }))
                    setErrorMessage(null)
                    setSuccessMessage(null)
                  }}
                  disabled={submitting || editBible.status === 'confirmed' || Boolean(editBible.lockedAt)}
                  spellCheck={false}
                  className="min-h-36 w-full resize-y rounded-lg border border-[var(--glass-stroke-base)] bg-white/85 px-3 py-2 font-mono text-[11px] leading-5 text-[var(--glass-text-primary)] outline-none transition focus:border-[var(--glass-stroke-strong)] disabled:cursor-not-allowed disabled:opacity-60"
                />
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-[var(--glass-stroke-soft)] px-4 py-3">
        {errorMessage ? <div className="mb-2 text-xs leading-5 text-[var(--glass-tone-danger-fg)]">{t('submitFailed', { error: errorMessage })}</div> : null}
        {successMessage ? <div className="mb-2 text-xs leading-5 text-[var(--glass-tone-success-fg)]">{successMessage}</div> : null}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            onClick={() => { void submitConfirm() }}
            disabled={!canConfirm || submitting}
          >
            <AppIcon name="check" className="h-4 w-4" />
            {submitting && confirmBible.isPending ? t('submitting') : t('confirm')}
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--glass-stroke-base)] bg-white/85 px-3 py-2 text-sm font-medium text-[var(--glass-text-primary)] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => { void submitRevision() }}
            disabled={!canRevise || submitting}
          >
            <AppIcon name="edit" className="h-4 w-4" />
            {submitting && reviseBible.isPending ? t('submitting') : t('submitRevision')}
          </button>
          <span className="text-xs text-[var(--glass-text-tertiary)]">{t('lockedHint')}</span>
        </div>
      </div>
    </section>
  )
}
