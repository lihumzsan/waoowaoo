import type { ProjectEditChapter } from '@/types/project'

export interface EpisodePlanningBibleSource {
  readonly bible?: unknown | null
  readonly beatSheet?: unknown | null
  readonly ledger?: unknown | null
  readonly emotionalCurve?: unknown | null
  readonly chapters?: readonly ProjectEditChapter[] | null
}

export interface EpisodePlanningBibleStats {
  readonly title: string | null
  readonly characterCount: number
  readonly locationCount: number
  readonly worldRuleCount: number
  readonly beatCount: number
  readonly ledgerEventCount: number
  readonly emotionalCueCount: number
}

export interface EpisodePlanningChapterOverview {
  readonly id: string
  readonly chapterIndex: number
  readonly title: string
  readonly summary: string
  readonly targetDurationSec: number
}

export interface EpisodePlanningOverview {
  readonly hasBible: boolean
  readonly bible: EpisodePlanningBibleStats
  readonly chapterCount: number
  readonly targetDurationSec: number
  readonly chapters: readonly EpisodePlanningChapterOverview[]
}

export interface BuildEpisodePlanningOverviewInput {
  readonly editBible?: EpisodePlanningBibleSource | null
  readonly chapters?: readonly ProjectEditChapter[] | null
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

export function readEpisodePlanningBibleStats(editBible?: EpisodePlanningBibleSource | null): EpisodePlanningBibleStats {
  const bible = isRecord(editBible?.bible) ? editBible.bible : null
  const beatSheet = isRecord(editBible?.beatSheet) ? editBible.beatSheet : null
  const ledger = isRecord(editBible?.ledger) ? editBible.ledger : null
  const emotionalCurve = isRecord(editBible?.emotionalCurve) ? editBible.emotionalCurve : null
  return {
    title: readString(bible?.title),
    characterCount: readArrayLength(bible?.characters),
    locationCount: readArrayLength(bible?.locations),
    worldRuleCount: readArrayLength(bible?.worldRules),
    beatCount: readArrayLength(beatSheet?.beats),
    ledgerEventCount: readArrayLength(ledger?.events),
    emotionalCueCount: readArrayLength(emotionalCurve?.cues),
  }
}

export function formatEpisodePlanningDuration(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0
  return `${String(Math.floor(safeSeconds / 60))}:${String(safeSeconds % 60).padStart(2, '0')}`
}

export function buildEpisodePlanningOverview(input: BuildEpisodePlanningOverviewInput): EpisodePlanningOverview {
  const chapters = input.chapters ?? input.editBible?.chapters ?? []
  return {
    hasBible: Boolean(input.editBible),
    bible: readEpisodePlanningBibleStats(input.editBible),
    chapterCount: chapters.length,
    targetDurationSec: chapters.reduce((total, chapter) => total + chapter.targetDurationSec, 0),
    chapters: chapters.map((chapter) => ({
      id: chapter.id,
      chapterIndex: chapter.chapterIndex,
      title: chapter.title,
      summary: chapter.summary,
      targetDurationSec: chapter.targetDurationSec,
    })),
  }
}
