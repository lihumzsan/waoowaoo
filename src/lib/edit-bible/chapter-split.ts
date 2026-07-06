import { assertEditSourceRange } from '@/lib/edit-source-document'
import { collectLedgerEventsInRange, type Ledger } from '@/lib/edit-ledger'
import { EDIT_BIBLE_CHAPTER_LIMITS } from './constraints'
import { editBibleChapterPlanSchema, type EditBibleBeat, type EditBibleBundle, type EditBibleChapterPlan } from './schemas'

type ChapterBeatGroup = {
  readonly beats: readonly EditBibleBeat[]
}

interface ChapterCutCandidate {
  readonly endExclusive: number
  readonly beats: readonly EditBibleBeat[]
  readonly score: number
}

function beatSourceLength(beat: EditBibleBeat): number {
  return beat.sourceEnd - beat.sourceStart
}

function beatGroupSourceLength(beats: readonly EditBibleBeat[]): number {
  const first = beats[0]
  const last = beats[beats.length - 1]
  if (!first || !last) return 0
  return last.sourceEnd - first.sourceStart
}

function beatGroupDuration(beats: readonly EditBibleBeat[]): number {
  return beats.reduce((sum, beat) => sum + beat.estimatedDurationSec, 0)
}

function resolveAdaptiveChapterTargetDurationSec(beats: readonly EditBibleBeat[]): number {
  const totalDurationSec = beatGroupDuration(beats)
  if (totalDurationSec <= EDIT_BIBLE_CHAPTER_LIMITS.maxDurationSec) return totalDurationSec
  const chapterCount = Math.ceil(totalDurationSec / EDIT_BIBLE_CHAPTER_LIMITS.maxDurationSec)
  return totalDurationSec / chapterCount
}

function assertBeatCanBeChapter(beat: EditBibleBeat) {
  if (beatSourceLength(beat) > EDIT_BIBLE_CHAPTER_LIMITS.maxSourceChars) {
    throw new Error(
      `EDIT_BIBLE_BEAT_SOURCE_RANGE_EXCEEDS_CHAPTER_LIMIT:${beat.beatId}:length=${String(beatSourceLength(beat))}:max=${String(EDIT_BIBLE_CHAPTER_LIMITS.maxSourceChars)}`,
    )
  }
  if (beat.estimatedDurationSec > EDIT_BIBLE_CHAPTER_LIMITS.maxDurationSec) {
    throw new Error(
      `EDIT_BIBLE_BEAT_DURATION_EXCEEDS_CHAPTER_LIMIT:${beat.beatId}:duration=${String(beat.estimatedDurationSec)}:max=${String(EDIT_BIBLE_CHAPTER_LIMITS.maxDurationSec)}`,
    )
  }
}

function groupExceedsHardLimits(beats: readonly EditBibleBeat[]): boolean {
  return (
    beatGroupSourceLength(beats) > EDIT_BIBLE_CHAPTER_LIMITS.maxSourceChars
    || beatGroupDuration(beats) > EDIT_BIBLE_CHAPTER_LIMITS.maxDurationSec
  )
}

function cutCrossesLedgerEvent(input: {
  readonly ledger: Ledger
  readonly sourceOffset: number
}): boolean {
  return input.ledger.events.some((event) => (
    event.sourceStart < input.sourceOffset && event.sourceEnd > input.sourceOffset
  ))
}

function scoreCutCandidate(input: {
  readonly beats: readonly EditBibleBeat[]
  readonly allBeats: readonly EditBibleBeat[]
  readonly startIndex: number
  readonly endExclusive: number
  readonly ledger: Ledger
  readonly targetDurationSec: number
}): number {
  const duration = beatGroupDuration(input.beats)
  const sourceLength = beatGroupSourceLength(input.beats)
  const targetPenalty = Math.abs(duration - input.targetDurationSec)
  const shortPenalty = duration < EDIT_BIBLE_CHAPTER_LIMITS.minDurationSec
    ? (EDIT_BIBLE_CHAPTER_LIMITS.minDurationSec - duration) * 8
    : 0
  const sourceTarget = EDIT_BIBLE_CHAPTER_LIMITS.maxSourceChars * 0.5
  const sourcePenalty = Math.abs(sourceLength - sourceTarget) / 200
  const remainingBeats = input.allBeats.slice(input.endExclusive)
  const remainingDuration = beatGroupDuration(remainingBeats)
  const thinTailPenalty = remainingBeats.length > 0 && remainingDuration < EDIT_BIBLE_CHAPTER_LIMITS.minDurationSec
    ? 200 + (EDIT_BIBLE_CHAPTER_LIMITS.minDurationSec - remainingDuration) * 4
    : 0
  const last = input.beats[input.beats.length - 1]
  const crossesEventPenalty = last
    && input.endExclusive < input.allBeats.length
    && cutCrossesLedgerEvent({ ledger: input.ledger, sourceOffset: last.sourceEnd })
    ? 1_000
    : 0
  const beatCountPenalty = Math.max(0, input.beats.length - 3) * 3
  return targetPenalty + shortPenalty + sourcePenalty + thinTailPenalty + crossesEventPenalty + beatCountPenalty
}

function chooseNextBeatGroup(input: {
  readonly beats: readonly EditBibleBeat[]
  readonly startIndex: number
  readonly ledger: Ledger
  readonly targetDurationSec: number
}): ChapterBeatGroup {
  const candidates: ChapterCutCandidate[] = []
  for (let endExclusive = input.startIndex + 1; endExclusive <= input.beats.length; endExclusive += 1) {
    const candidateBeats = input.beats.slice(input.startIndex, endExclusive)
    if (groupExceedsHardLimits(candidateBeats)) break
    candidates.push({
      endExclusive,
      beats: candidateBeats,
      score: scoreCutCandidate({
        beats: candidateBeats,
        allBeats: input.beats,
        startIndex: input.startIndex,
        endExclusive,
        ledger: input.ledger,
        targetDurationSec: input.targetDurationSec,
      }),
    })
  }
  const best = candidates.sort((left, right) => {
    if (left.score !== right.score) return left.score - right.score
    return right.endExclusive - left.endExclusive
  })[0]
  if (!best) {
    const beat = input.beats[input.startIndex]
    throw new Error(`EDIT_BIBLE_CHAPTER_CUT_NOT_FOUND:${beat?.beatId ?? String(input.startIndex)}`)
  }
  return { beats: best.beats }
}

function groupBeatsIntoChapters(input: {
  readonly beats: readonly EditBibleBeat[]
  readonly ledger: Ledger
}): readonly ChapterBeatGroup[] {
  const groups: ChapterBeatGroup[] = []
  let startIndex = 0
  for (const beat of input.beats) {
    assertBeatCanBeChapter(beat)
  }
  const targetDurationSec = resolveAdaptiveChapterTargetDurationSec(input.beats)
  while (startIndex < input.beats.length) {
    const group = chooseNextBeatGroup({
      beats: input.beats,
      startIndex,
      ledger: input.ledger,
      targetDurationSec,
    })
    groups.push(group)
    startIndex += group.beats.length
  }

  const last = groups[groups.length - 1]
  const previous = groups[groups.length - 2]
  if (
    groups.length > 1
    && last
    && previous
    && beatGroupSourceLength(last.beats) < EDIT_BIBLE_CHAPTER_LIMITS.minSourceChars
  ) {
    const merged = [...previous.beats, ...last.beats]
    if (
      beatGroupSourceLength(merged) <= EDIT_BIBLE_CHAPTER_LIMITS.maxSourceChars
      && beatGroupDuration(merged) <= EDIT_BIBLE_CHAPTER_LIMITS.maxDurationSec
    ) {
      groups.splice(groups.length - 2, 2, { beats: merged })
    }
  }
  return groups
}

function buildChapterTitle(beats: readonly EditBibleBeat[]): string {
  const first = beats[0]
  const last = beats[beats.length - 1]
  if (!first || !last) throw new Error('EDIT_BIBLE_CHAPTER_BEATS_EMPTY')
  return first.beatId === last.beatId ? first.title : `${first.title} / ${last.title}`
}

function buildChapterSummary(beats: readonly EditBibleBeat[]): string {
  return beats.map((beat) => beat.summary).join('\n')
}

function buildChapterPlan(input: {
  readonly chapterIndex: number
  readonly beats: readonly EditBibleBeat[]
  readonly ledger: Ledger
  readonly sourceText: string
}): EditBibleChapterPlan {
  const first = input.beats[0]
  const last = input.beats[input.beats.length - 1]
  if (!first || !last) throw new Error('EDIT_BIBLE_CHAPTER_BEATS_EMPTY')
  const sourceStart = first.sourceStart
  const sourceEnd = last.sourceEnd
  assertEditSourceRange(input.sourceText, { sourceStart, sourceEnd })
  const events = collectLedgerEventsInRange({
    ledger: input.ledger,
    sourceStart,
    sourceEnd,
  })
  return editBibleChapterPlanSchema.parse({
    chapterIndex: input.chapterIndex,
    title: buildChapterTitle(input.beats),
    summary: buildChapterSummary(input.beats),
    sourceStart,
    sourceEnd,
    targetDurationSec: beatGroupDuration(input.beats),
    beatIds: input.beats.map((beat) => beat.beatId),
    eventIds: events.map((event) => event.eventId),
  })
}

function assertLedgerEventsCoveredByOneChapter(input: {
  readonly ledger: Ledger
  readonly chapters: readonly EditBibleChapterPlan[]
}): void {
  for (const event of input.ledger.events) {
    const containingChapters = input.chapters.filter((chapter) =>
      event.sourceStart >= chapter.sourceStart && event.sourceEnd <= chapter.sourceEnd)
    if (containingChapters.length !== 1) {
      throw new Error(`EDIT_BIBLE_LEDGER_EVENT_NOT_CONTAINED_BY_SINGLE_CHAPTER:${event.eventId}:${String(containingChapters.length)}`)
    }
  }
}

export function splitEditBibleIntoChapterPlans(input: {
  readonly bundle: EditBibleBundle
  readonly sourceText: string
}): readonly EditBibleChapterPlan[] {
  const groups = groupBeatsIntoChapters({
    beats: input.bundle.beatSheet.beats,
    ledger: input.bundle.ledger,
  })
  const chapters = groups.map((group, index) => buildChapterPlan({
    chapterIndex: index,
    beats: group.beats,
    ledger: input.bundle.ledger,
    sourceText: input.sourceText,
  }))
  assertLedgerEventsCoveredByOneChapter({
    ledger: input.bundle.ledger,
    chapters,
  })
  return chapters
}
