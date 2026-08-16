import type { VideoPromptProfile } from '@/lib/ai-registry/types'

export const MINIMAX_H3_REFERENCE_PROMPT_SECTIONS = [
  'subject_definitions',
  'summary',
  'retention_analysis',
  'detailed_description',
  'overall_soundscape',
  'non_diegetic_music',
] as const

export type MinimaxH3ReferencePromptSections = (typeof MINIMAX_H3_REFERENCE_PROMPT_SECTIONS)[number]

const SECTION_HEADING = /^([a-z][a-z0-9_]*)\s*:\s*$/u
const NO_BACKGROUND_MUSIC = 'Do not generate background music or musical score.'
const PERMITTED_AUDIO = 'Retain only dialogue, environmental ambience and action sound effects.'

function invalid(reason: string): Error {
  return new Error(`VIDEO_PROMPT_PROFILE_INVALID:${reason}`)
}

function parseSections(prompt: string): Record<MinimaxH3ReferencePromptSections, string> {
  const lines = prompt.replace(/\r\n?/gu, '\n').split('\n')
  const headings: Array<{ name: string; index: number }> = []
  lines.forEach((line, index) => {
    const match = SECTION_HEADING.exec(line)
    if (match?.[1]) headings.push({ name: match[1], index })
  })
  if (headings.length !== MINIMAX_H3_REFERENCE_PROMPT_SECTIONS.length) throw invalid('SECTION_COUNT')
  for (let index = 0; index < headings.length; index += 1) {
    const expected = MINIMAX_H3_REFERENCE_PROMPT_SECTIONS[index]
    if (headings[index]?.name !== expected) throw invalid(`SECTION_ORDER:${String(expected)}`)
  }
  const result = {} as Record<MinimaxH3ReferencePromptSections, string>
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index]!
    const end = headings[index + 1]?.index ?? lines.length
    const body = lines.slice(heading.index + 1, end).join('\n').trim()
    if (!body) throw invalid(`SECTION_EMPTY:${heading.name}`)
    result[heading.name as MinimaxH3ReferencePromptSections] = body
  }
  const last = result.non_diegetic_music
  if (!last.includes(NO_BACKGROUND_MUSIC)) throw invalid('BACKGROUND_MUSIC_FORBIDDEN')
  if (!last.includes(PERMITTED_AUDIO)) throw invalid('PERMITTED_AUDIO_CONTRACT_MISSING')
  return result
}

export function assertVideoPromptMatchesProfile(input: {
  readonly profile: VideoPromptProfile
  readonly prompt: string
}): void {
  if (input.profile === 'generic_v1') return
  if (input.profile !== 'minimax_h3_reference_v2') throw invalid('PROFILE_UNKNOWN')
  if (!input.prompt.trim()) throw invalid('PROMPT_EMPTY')
  parseSections(input.prompt)
}

export function parseMinimaxH3ReferencePrompt(prompt: string): Readonly<Record<MinimaxH3ReferencePromptSections, string>> {
  return parseSections(prompt)
}
