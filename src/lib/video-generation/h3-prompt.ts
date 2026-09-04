import type {
  VideoInputMode,
  VideoPromptProfile,
} from '@/lib/ai-registry/types'

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

function assertH3PromptStructure(
  sections: Readonly<Record<MinimaxH3PromptSection, string>>,
  timelineDurationSeconds: number,
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
  const shots = Array.from(structuralDescription.matchAll(SHOT_MARKER))
  let previousShotTime = 0
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
      || !Number.isFinite(timelineDurationSeconds)
      || shotTime >= timelineDurationSeconds
    ) {
      throw invalid('SHOT_TIME_OUT_OF_RANGE:' + String(expectedShotNumber))
    }
    previousShotTime = shotTime
  }

  const transitionCount = Array.from(structuralDescription.matchAll(CAMERA_TRANSITION)).length
  if (transitionCount !== shots.length - 1) throw invalid('SHOT_TRANSITION_ORPHANED')
}

function assertH3InputMode(
  inputMode: VideoInputMode,
  timelineDurationSeconds: number,
  sections: Readonly<Record<MinimaxH3PromptSection, string>>,
): void {
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

export function assertVideoPromptMatchesProfile(input: {
  readonly profile: VideoPromptProfile
  readonly prompt: string
  readonly inputMode: VideoInputMode
  readonly timelineDurationSeconds: number
}): void {
  if (input.profile === 'generic_v1') return
  if (!input.prompt.trim()) throw invalid('PROMPT_EMPTY')
  const sections = parseSections(input.prompt)
  if (input.profile !== 'minimax_h3_multimodal_v3') throw invalid('PROFILE_UNKNOWN')
  assertH3PromptStructure(sections, input.timelineDurationSeconds)
  assertH3InputMode(input.inputMode, input.timelineDurationSeconds, sections)
}

export function parseMinimaxH3Prompt(
  prompt: string,
): Readonly<Record<MinimaxH3PromptSection, string>> {
  return parseSections(prompt)
}
