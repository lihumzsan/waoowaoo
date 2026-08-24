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
      match[1] !== undefined && Number(match[1]) === input.seconds
    ))
  })
}

function assertH3InputMode(
  inputMode: VideoInputMode,
  durationSeconds: number,
  sections: Readonly<Record<MinimaxH3PromptSection, string>>,
): void {
  if (inputMode === 'reference') return
  if (inputMode !== 'first_frame' && inputMode !== 'first_last_frame') {
    throw invalid('INPUT_MODE_UNSUPPORTED')
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
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
      seconds: durationSeconds,
    })
  ) {
    throw invalid('LAST_FRAME_ANCHOR_REQUIRED')
  }
}

export function assertVideoPromptMatchesProfile(input: {
  readonly profile: VideoPromptProfile
  readonly prompt: string
  readonly inputMode: VideoInputMode
  readonly durationSeconds: number
}): void {
  if (input.profile === 'generic_v1') return
  if (!input.prompt.trim()) throw invalid('PROMPT_EMPTY')
  const sections = parseSections(input.prompt)
  if (input.profile === 'minimax_h3_reference_v2') {
    if (input.inputMode !== 'reference') throw invalid('INPUT_MODE_UNSUPPORTED')
    return
  }
  if (input.profile !== 'minimax_h3_multimodal_v3') throw invalid('PROFILE_UNKNOWN')
  assertH3InputMode(input.inputMode, input.durationSeconds, sections)
}

export function parseMinimaxH3Prompt(
  prompt: string,
): Readonly<Record<MinimaxH3PromptSection, string>> {
  return parseSections(prompt)
}
