import type {
  VideoInputMode,
  VideoPromptProfile,
} from '@/lib/ai-registry/types'
import { H3_CONTINUATION_GUIDE_SECONDS } from './h3-timeline'

export const MINIMAX_H3_PROMPT_SECTIONS = [
  'subject_definitions',
  'summary',
  'retention_analysis',
  'detailed_description',
  'overall_soundscape',
  'non_diegetic_music',
] as const

export type MinimaxH3PromptSection = (typeof MINIMAX_H3_PROMPT_SECTIONS)[number]

const SECTION_HEADING = /^([a-z][a-z0-9_]*)\s*:\s*$/u
const TIME_EXPRESSION = /(\d+(?:\.\d+)?)\s*(?:s|sec(?:ond)?s?)\b/giu
const FIXED_NON_DIEGETIC_MUSIC = 'N/A'
const DIALOGUE_TAG = /<\/?d>/u
const DIALOGUE_CUTOFF_TAG = /<cutoff>/u
const DIALOGUE_BLOCK = /<d>[\s\S]*?<\/d>/gu
const SHOT_MARKER = /\[Shot (\d+)\]/gu
const SHOT_TRANSITION = /^\[Shot (\d+)\] At (\d{2}):(\d{2}\.\d{3}), the camera (?:cuts|dissolves|fades|wipes)\b/u
const CAMERA_TRANSITION = /\bthe camera (?:cuts|dissolves|fades|wipes)\b/gu
const TIMED_EVENT = /\bAt (\d{2}):(\d{2}\.\d{3})\b/gu
const CLOCK_LIKE_TIME = /\b\d+\s*:\s*\d+(?:\s*[.,]\s*\d+)*\b/gu
const CANONICAL_CLOCK_TIMED_EVENT = /^At \d{2}:\d{2}\.\d{3}$/u
const UNIT_TIMED_EVENT = /(?:\b\d+(?:\.\d*)?|\.\d+)\s*(?:milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|hours?|hrs?)\b/iu
const PICTURE_ANCHOR = /<Picture\s+\d+>/u
const MEDIA_REFERENCE = /<(Picture|Audio)\s+(\d+)>/gu
const SUBJECT_SPEAKER = /<Subject\s+(\d+)>\s*\(S(\d+)\)/gu
const DIALOGUE_BLOCK_PRESENT = /<d>[\s\S]*?<\/d>/u

export type H3PromptReferenceManifest = {
  readonly pictureCount: number
  readonly audioCount: number
}

function invalid(reason: string): Error {
  return new Error('VIDEO_PROMPT_PROFILE_INVALID:' + reason)
}
function parseSections(prompt: string): Record<MinimaxH3PromptSection, string> {
  const lines = prompt.replace(/\r\n?/gu, '\n').split('\n')
  const headings: Array<{ name: string; index: number }> = []
  lines.forEach((line, index) => {
    const match = SECTION_HEADING.exec(line)
    if (match?.[1]) headings.push({ name: match[1], index })
  })
  if (headings.length !== MINIMAX_H3_PROMPT_SECTIONS.length) throw invalid('SECTION_COUNT')
  for (let index = 0; index < headings.length; index += 1) {
    const expected = MINIMAX_H3_PROMPT_SECTIONS[index]
    if (headings[index]?.name !== expected) throw invalid('SECTION_ORDER:' + String(expected))
  }
  const result = {} as Record<MinimaxH3PromptSection, string>
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index]!
    const end = headings[index + 1]?.index ?? lines.length
    const body = lines.slice(heading.index + 1, end).join('\n').trim()
    if (!body) throw invalid('SECTION_EMPTY:' + heading.name)
    result[heading.name as MinimaxH3PromptSection] = body
  }
  if (result.non_diegetic_music !== FIXED_NON_DIEGETIC_MUSIC) {
    throw invalid('NON_DIEGETIC_MUSIC_CONTRACT_INVALID')
  }
  return result
}

function hasPictureTimeAnchor(input: {
  readonly detailedDescription: string
  readonly pictureNumber: number
  readonly seconds: number
}): boolean {
  const picture = '<Picture ' + String(input.pictureNumber) + '>'
  const clauses = input.detailedDescription.split(/(?:\r?\n|(?<=[.!?])\s+)/u)
  return clauses.some((clause) => {
    if (!clause.includes(picture)) return false
    return Array.from(clause.matchAll(TIME_EXPRESSION)).some((match) => (
      match[1] !== undefined
      && Math.round(Number(match[1]) * 1000) === Math.round(input.seconds * 1000)
    ))
  })
}

function parseShotTime(minutesText: string, secondsText: string): number | null {
  const minutes = Number(minutesText)
  const seconds = Number(secondsText)
  if (!Number.isInteger(minutes) || minutes < 0 || !Number.isFinite(seconds) || seconds < 0 || seconds >= 60) {
    return null
  }
  return minutes * 60 + seconds
}

function isCanonicalClockTimedEvent(
  input: string,
  clockIndex: number,
  clockText: string,
): boolean {
  const prefixIndex = clockIndex - 3
  if (prefixIndex < 0 || input.slice(prefixIndex, clockIndex) !== 'At ') return false
  if (prefixIndex > 0 && /[A-Za-z0-9_]/u.test(input[prefixIndex - 1]!)) return false
  return CANONICAL_CLOCK_TIMED_EVENT.test(input.slice(prefixIndex, clockIndex + clockText.length))
}

function assertH3PromptStructure(
  sections: Readonly<Record<MinimaxH3PromptSection, string>>,
  timelineOriginSeconds: number,
  timelineEndSeconds: number,
): void {
  for (const section of MINIMAX_H3_PROMPT_SECTIONS) {
    const body = sections[section]
    if (DIALOGUE_CUTOFF_TAG.test(body)) throw invalid('DIALOGUE_CUTOFF_UNSUPPORTED')
    if (section !== 'detailed_description' && DIALOGUE_TAG.test(body)) {
      throw invalid('DIALOGUE_TAG_SECTION_INVALID:' + section)
    }
  }

  const detailedDescription = sections.detailed_description
  if (!detailedDescription.startsWith('[Shot 1]')) {
    throw invalid('DETAILED_DESCRIPTION_SHOT_1_REQUIRED')
  }

  const structuralDescription = detailedDescription.replace(
    DIALOGUE_BLOCK,
    (dialogue) => ' '.repeat(dialogue.length),
  )
  if (timelineOriginSeconds > 0) {
    for (const section of MINIMAX_H3_PROMPT_SECTIONS) {
      if (section === 'detailed_description') continue
      const body = sections[section]
      if (UNIT_TIMED_EVENT.test(body) || Array.from(body.matchAll(CLOCK_LIKE_TIME)).length > 0) {
        throw invalid(`CONTINUATION_TIME_SECTION_INVALID:${section}`)
      }
    }
  }
  if (
    timelineOriginSeconds > 0
    && (
      UNIT_TIMED_EVENT.test(structuralDescription)
      || Array.from(structuralDescription.matchAll(CLOCK_LIKE_TIME)).some((match) => (
        !isCanonicalClockTimedEvent(structuralDescription, match.index, match[0])
      ))
    )
  ) {
    throw invalid('CONTINUATION_TIME_FORMAT_INVALID')
  }
  const shots = Array.from(structuralDescription.matchAll(SHOT_MARKER))
  let previousShotTime = timelineOriginSeconds
  for (let index = 0; index < shots.length; index += 1) {
    const shot = shots[index]!
    const expectedShotNumber = index + 1
    if (Number(shot[1]) !== expectedShotNumber) {
      throw invalid('SHOT_SEQUENCE_INVALID:' + String(expectedShotNumber))
    }
    if (index === 0) continue

    const transition = SHOT_TRANSITION.exec(structuralDescription.slice(shot.index))
    if (!transition || Number(transition[1]) !== expectedShotNumber) {
      throw invalid('SHOT_TRANSITION_INVALID:' + String(expectedShotNumber))
    }
    const shotTime = parseShotTime(transition[2]!, transition[3]!)
    if (
      shotTime === null
      || shotTime <= previousShotTime
      || shotTime >= timelineEndSeconds
    ) {
      throw invalid('SHOT_TIME_OUT_OF_RANGE:' + String(expectedShotNumber))
    }
    previousShotTime = shotTime
  }

  const transitionCount = Array.from(structuralDescription.matchAll(CAMERA_TRANSITION)).length
  if (transitionCount !== shots.length - 1) throw invalid('SHOT_TRANSITION_ORPHANED')

  for (const match of structuralDescription.matchAll(TIMED_EVENT)) {
    const eventTime = parseShotTime(match[1]!, match[2]!)
    if (
      eventTime === null
      || eventTime < timelineOriginSeconds
      || eventTime >= timelineEndSeconds
    ) {
      throw invalid(`TIMED_EVENT_OUT_OF_RANGE:${match[1]}:${match[2]}`)
    }
  }
}

function assertH3InputMode(
  inputMode: VideoInputMode,
  timelineDurationSeconds: number,
  sections: Readonly<Record<MinimaxH3PromptSection, string>>,
): void {
  if (inputMode === 'continuation') {
    if (Object.values(sections).some((section) => PICTURE_ANCHOR.test(section))) {
      throw invalid('CONTINUATION_PICTURE_ANCHOR_FORBIDDEN')
    }
    return
  }
  if (inputMode === 'reference') return
  if (inputMode !== 'first_frame' && inputMode !== 'first_last_frame') {
    throw invalid('INPUT_MODE_UNSUPPORTED')
  }
  if (!Number.isFinite(timelineDurationSeconds) || timelineDurationSeconds <= 0) {
    throw invalid('DURATION_INVALID')
  }
  if (!hasPictureTimeAnchor({
    detailedDescription: sections.detailed_description,
    pictureNumber: 1,
    seconds: 0,
  })) {
    throw invalid('FIRST_FRAME_ANCHOR_REQUIRED')
  }
  if (
    inputMode === 'first_last_frame'
    && !hasPictureTimeAnchor({
      detailedDescription: sections.detailed_description,
      pictureNumber: 2,
      seconds: timelineDurationSeconds,
    })
  ) {
    throw invalid('LAST_FRAME_ANCHOR_REQUIRED')
  }
}

function assertH3ReferenceManifest(
  sections: Readonly<Record<MinimaxH3PromptSection, string>>,
  references: H3PromptReferenceManifest,
): void {
  if (
    !Number.isSafeInteger(references.pictureCount)
    || references.pictureCount < 0
    || !Number.isSafeInteger(references.audioCount)
    || references.audioCount < 0
  ) {
    throw invalid('REFERENCE_MANIFEST_INVALID')
  }
  for (const section of MINIMAX_H3_PROMPT_SECTIONS) {
    for (const match of sections[section].matchAll(MEDIA_REFERENCE)) {
      const modality = match[1]!
      const number = Number(match[2])
      const limit = modality === 'Picture' ? references.pictureCount : references.audioCount
      if (!Number.isSafeInteger(number) || number < 1 || number > limit) {
        throw invalid(`MEDIA_REFERENCE_INDEX_OUT_OF_RANGE:${modality}:${String(number)}`)
      }
    }
  }
  for (let audioNumber = 1; audioNumber <= references.audioCount; audioNumber += 1) {
    const audioToken = `<Audio ${String(audioNumber)}>`
    const definitionLines = sections.subject_definitions
      .split('\n')
      .filter((line) => line.includes(audioToken))
    if (definitionLines.length === 0) {
      throw invalid(`AUDIO_REFERENCE_MISSING:${String(audioNumber)}`)
    }
    if (definitionLines.length !== 1) {
      throw invalid(`AUDIO_SPEAKER_BINDING_INVALID:${String(audioNumber)}`)
    }
    const bindings = Array.from(definitionLines[0]!.matchAll(SUBJECT_SPEAKER))
    if (bindings.length !== 1) {
      throw invalid(`AUDIO_SPEAKER_BINDING_INVALID:${String(audioNumber)}`)
    }
    const subjectNumber = Number(bindings[0]![1])
    const speakerNumber = Number(bindings[0]![2])
    if (
      !Number.isSafeInteger(subjectNumber)
      || subjectNumber < 1
      || !Number.isSafeInteger(speakerNumber)
      || speakerNumber < 1
    ) {
      throw invalid(`AUDIO_SPEAKER_BINDING_INVALID:${String(audioNumber)}`)
    }
    const subjectSpeaker = `<Subject ${String(subjectNumber)}> (S${String(speakerNumber)})`
    const retained = sections.retention_analysis
      .split('\n')
      .some((line) => line.includes(audioToken) && line.includes(subjectSpeaker))
    if (!retained) {
      throw invalid(`AUDIO_SPEAKER_RETENTION_MISSING:${String(audioNumber)}`)
    }
    if (
      !sections.detailed_description.includes(subjectSpeaker)
      || !DIALOGUE_BLOCK_PRESENT.test(sections.detailed_description)
    ) {
      throw invalid(`AUDIO_SPEAKER_DIALOGUE_MISSING:${String(audioNumber)}`)
    }
  }
}

export function assertVideoPromptMatchesProfile(input: {
  readonly profile: VideoPromptProfile
  readonly prompt: string
  readonly inputMode: VideoInputMode
  readonly timelineDurationSeconds: number
  readonly references: H3PromptReferenceManifest
}): void {
  if (input.profile === 'generic_v1') return
  if (!input.prompt.trim()) throw invalid('PROMPT_EMPTY')
  if (!Number.isFinite(input.timelineDurationSeconds) || input.timelineDurationSeconds <= 0) {
    throw invalid('DURATION_INVALID')
  }
  const sections = parseSections(input.prompt)
  if (input.profile !== 'minimax_h3_multimodal_v3') throw invalid('PROFILE_UNKNOWN')
  const timelineOriginSeconds = input.inputMode === 'continuation'
    ? H3_CONTINUATION_GUIDE_SECONDS
    : 0
  assertH3PromptStructure(
    sections,
    timelineOriginSeconds,
    input.timelineDurationSeconds,
  )
  assertH3InputMode(input.inputMode, input.timelineDurationSeconds, sections)
  assertH3ReferenceManifest(sections, input.references)
}

export function parseMinimaxH3Prompt(
  prompt: string,
): Readonly<Record<MinimaxH3PromptSection, string>> {
  return parseSections(prompt)
}
