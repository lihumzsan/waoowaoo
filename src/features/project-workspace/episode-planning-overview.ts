import type {
  EditFirstWorkflowStatusKind,
  EditFirstWorkflowStep,
  EditFirstWorkflowView,
} from '@/lib/project-workflow/edit-first-view'
import type { ProjectEditChapter } from '@/types/project'

export interface EpisodePlanningBibleSource {
  readonly status?: string | null
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
  readonly status: string
  readonly renderStatus: string | null
  readonly outputMediaId: string | null
}

export interface EpisodePlanningOverview {
  readonly workflowStep: EditFirstWorkflowStep
  readonly workflowStatus: EditFirstWorkflowStatusKind
  readonly bibleStatus: string | null
  readonly bible: EpisodePlanningBibleStats
  readonly chapterCount: number
  readonly targetDurationSec: number
  readonly confirmedChapterCount: number
  readonly renderedChapterCount: number
  readonly failedChapterCount: number
  readonly processingChapterCount: number
  readonly chapters: readonly EpisodePlanningChapterOverview[]
}

export interface BuildEpisodePlanningOverviewInput {
  readonly editBible?: EpisodePlanningBibleSource | null
  readonly chapters?: readonly ProjectEditChapter[] | null
  readonly workflow?: EditFirstWorkflowView | null
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

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
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
  const minutes = Math.floor(safeSeconds / 60)
  const remainingSeconds = safeSeconds % 60
  return `${String(minutes)}:${String(remainingSeconds).padStart(2, '0')}`
}

function isConfirmedChapter(chapter: ProjectEditChapter): boolean {
  return chapter.status === 'confirmed'
}

function isRenderedChapter(chapter: ProjectEditChapter): boolean {
  return chapter.renderStatus === 'completed'
}

function isFailedChapter(chapter: ProjectEditChapter): boolean {
  return chapter.status === 'failed' || chapter.renderStatus === 'failed'
}

function isProcessingChapter(chapter: ProjectEditChapter): boolean {
  return chapter.status === 'generating' || chapter.renderStatus === 'processing'
}

export function buildEpisodePlanningOverview(input: BuildEpisodePlanningOverviewInput): EpisodePlanningOverview {
  const chapters = input.chapters ?? input.editBible?.chapters ?? []
  const bible = readEpisodePlanningBibleStats(input.editBible)

  return {
    workflowStep: input.workflow?.step ?? 'unavailable',
    workflowStatus: input.workflow?.status.kind ?? 'inactive',
    bibleStatus: input.editBible?.status ?? null,
    bible,
    chapterCount: chapters.length,
    targetDurationSec: chapters.reduce((total, chapter) => total + readNumber(chapter.targetDurationSec), 0),
    confirmedChapterCount: chapters.filter(isConfirmedChapter).length,
    renderedChapterCount: chapters.filter(isRenderedChapter).length,
    failedChapterCount: chapters.filter(isFailedChapter).length,
    processingChapterCount: chapters.filter(isProcessingChapter).length,
    chapters: chapters.map((chapter) => ({
      id: chapter.id,
      chapterIndex: chapter.chapterIndex,
      title: chapter.title,
      summary: chapter.summary,
      targetDurationSec: readNumber(chapter.targetDurationSec),
      status: chapter.status,
      renderStatus: chapter.renderStatus ?? null,
      outputMediaId: chapter.outputMediaId ?? null,
    })),
  }
}
