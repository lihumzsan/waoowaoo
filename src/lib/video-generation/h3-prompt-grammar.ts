/**
 * Shared structural forms for the existing H3 text contract. These describe and
 * recognize syntax; they never accept project facts or compose a video prompt.
 * Recommended vocal forms do not replace the audio/dialogue relationship parsers.
 */
export const MINIMAX_H3_PROMPT_SECTIONS = [
  'subject_definitions',
  'summary',
  'retention_analysis',
  'detailed_description',
  'overall_soundscape',
  'non_diegetic_music',
] as const

export type MinimaxH3PromptSection = (typeof MINIMAX_H3_PROMPT_SECTIONS)[number]

type SyntaxPart =
  | { readonly kind: 'literal'; readonly text: string }
  | { readonly kind: 'slot'; readonly name: string; readonly pattern: string; readonly display: string; readonly numeric: boolean }

type SyntaxForm = {
  readonly title: string
  readonly parts: readonly SyntaxPart[]
  readonly boundary: 'exact' | 'prefix' | 'word'
  readonly flexibleWhitespace?: boolean
  readonly ignoreCase?: boolean
}

const literal = (text: string): SyntaxPart => ({ kind: 'literal', text })
const slot = (name: string, pattern: string, display: string, numeric = false): SyntaxPart => (
  { kind: 'slot', name, pattern, display, numeric }
)
const index = (name: string): SyntaxPart => slot(name, '\\d+', `{${name}}`, true)
const prose = (name: string): SyntaxPart => slot(name, '\\S[^\\r\\n]*', `{${name}}`)
const clock: readonly SyntaxPart[] = [
  slot('minutes', '\\d{2}', 'MM'), literal(':'), slot('seconds', '\\d{2}\\.\\d{3}', 'SS.mmm'),
]
const subject: readonly SyntaxPart[] = [literal('<Subject '), index('subject'), literal('>')]
const audio: readonly SyntaxPart[] = [literal('<Audio '), index('audio'), literal('>')]
const spoken: readonly SyntaxPart[] = [
  literal('<d>['), slot('language', '[^\\]\\r\\n]+', 'Language'), literal(']'),
  slot('dialogue', '[\\s\\S]+?', '{source line.}'), literal('</d>'),
]
const audibleContinuity = slot(
  'continuity',
  String.raw`(?:(?:(?:the|this|that|same|his|her|their)\s+){0,3}(?:dialogue|lyrics?|speech|voice|vocals?)|<Audio\s+\d+>)\s+(?:continues?\s+(?:seamlessly\s+across\s+the\s+cut|uninterrupted\s+into\s+the\s+next\s+shot)|carries?\s+over\s+from\s+the\s+previous\s+shot|remains?\s+audible\s+across\s+the\s+transition)\b`,
  'The same voice continues seamlessly across the cut',
)

export const H3_SYNTAX_FORMS = {
  time: {
    title: 'A time phase inside the current shot', boundary: 'exact',
    parts: [literal('At '), ...clock],
  },
  shotTransition: {
    title: 'A real cut starts the next shot (N is the next consecutive shot number)', boundary: 'prefix',
    parts: [literal('[Shot '), index('shot'), literal('] At '), ...clock,
      literal(', the camera '), slot('transition', '(?:cuts|dissolves|fades|wipes)', '{cuts|dissolves|fades|wipes}')],
  },
  sourceBackedPlayback: {
    title: 'A visible playback entity supplied by a reference picture', boundary: 'prefix',
    flexibleWhitespace: true, ignoreCase: true,
    parts: [...subject, literal(' is a source-backed in-scene playback entity from <Picture '),
      index('picture'), literal('>: '), prose('source-backed description and physical output')],
  },
  targetVisiblePlayback: {
    title: 'A source-authorized playback entity introduced in the target scene', boundary: 'prefix',
    flexibleWhitespace: true, ignoreCase: true,
    parts: [...subject, literal(' is a target-visible in-scene playback entity: '), prose('target description and physical output')],
  },
  mediaReference: {
    title: 'Frozen image/audio channel references', boundary: 'word', flexibleWhitespace: true,
    parts: [literal('<'), slot('media', '(?:Picture|Audio)', '{Picture|Audio}'), literal(' '), index('number'), literal('>')],
  },
  speakerToken: {
    title: 'One speaker or comma-separated unison speakers', boundary: 'word',
    parts: [slot('speakers', '\\(S\\d+(?:\\s*,\\s*S\\d+)*\\)', '(S1) or (S1, S2)')],
  },
  singleSpeaker: {
    title: 'Recommended single-speaker vocal event; keep all bindings in this event', boundary: 'exact',
    parts: [...subject, literal(' (S'), index('speaker'), literal('), using the voice timbre from '), ...audio,
      literal(', says '), ...spoken],
  },
  compoundSpeaker: {
    title: 'Recommended unison event: comma-separated IDs, explicit Audio mapping, one shared line', boundary: 'exact',
    parts: [slot('speakers', '\\(S\\d+(?:\\s*,\\s*S\\d+)+\\)', '(S1, S2)'),
      literal(', '), slot('audioMappings', '[^;\\r\\n]+', 'S1 using the voice timbre from <Audio 1> and S2 using the voice timbre from <Audio 2>'),
      literal(', say together '), ...spoken],
  },
  diegeticPlayback: {
    title: 'Audible playback by the defined visible entity, inside detailed_description', boundary: 'prefix',
    parts: [literal('The visible in-scene '), ...subject, literal(' plays '), ...audio,
      literal(' audibly through its physical output')],
  },
  dialogueContinuity: {
    title: 'Explicit audible continuity across a real cut', boundary: 'word', ignoreCase: true,
    parts: [audibleContinuity],
  },
  dialogueAcrossCut: {
    title: 'A single source utterance continuing across an actual cut; preserve its words', boundary: 'exact',
    parts: [literal('<d>['), slot('languageBefore', '[^\\]\\r\\n]+', 'Language'), literal(']'),
      slot('before', '[\\s\\S]*?', '{source words before the cut}'),
      literal('<scenetrans></d> '), audibleContinuity, literal('.\n[Shot '),
      index('nextShot'), literal('] At '), ...clock,
      literal(', the camera cuts to '), slot('framing', '[\\s\\S]+?', '{source-backed framing}'),
      literal('. '), slot('sameSpeaker', '[\\s\\S]+?', '{the same speaker and explicit Audio mapping}'),
      literal(' says <d>['), slot('languageAfter', '[^\\]\\r\\n]+', 'Language'), literal(']<scenetrans>'),
      slot('after', '[\\s\\S]+?', '{remaining source words with terminal punctuation}'), literal('</d>')],
  },
} as const satisfies Record<string, SyntaxForm>

export type H3SyntaxFormId = keyof typeof H3_SYNTAX_FORMS

function escapePattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/** Captures retain declaration order for the existing clock/shot consumers. */
export function createH3SyntaxMatcher(
  formId: H3SyntaxFormId,
  scope?: 'exact' | 'prefix' | 'scan',
): RegExp {
  const form: SyntaxForm = H3_SYNTAX_FORMS[formId]
  const body = form.parts.map((part) => {
    if (part.kind === 'slot') return `(${part.pattern})`
    const escaped = escapePattern(part.text)
    return form.flexibleWhitespace ? escaped.replace(/\s+/gu, '\\s+') : escaped
  }).join('')
  const boundary = scope ?? form.boundary
  const start = boundary === 'scan' ? (formId === 'time' ? '\\b' : '') : boundary === 'word' ? '' : '^'
  const end = boundary === 'exact' ? '$' : formId === 'time' || formId === 'shotTransition' ? '\\b' : ''
  return new RegExp(start + body + end, `${boundary === 'scan' ? 'g' : ''}${form.ignoreCase ? 'i' : ''}u`)
}

export function matchH3SyntaxForm(
  formId: H3SyntaxFormId,
  text: string,
): Readonly<Record<string, string | number>> | null {
  const matched = createH3SyntaxMatcher(formId).exec(text)
  if (!matched) return null
  const slots = H3_SYNTAX_FORMS[formId].parts.filter((part) => part.kind === 'slot')
  return Object.fromEntries(slots.map((part, offset) => [
    part.name, part.numeric ? Number(matched[offset + 1]) : matched[offset + 1]!,
  ]))
}

function describeForm(formId: H3SyntaxFormId): string {
  return H3_SYNTAX_FORMS[formId].parts.map((part) => part.kind === 'literal' ? part.text : part.display).join('')
}

export function describeH3SyntaxForms(
  formIds: readonly H3SyntaxFormId[] = Object.keys(H3_SYNTAX_FORMS) as H3SyntaxFormId[],
): string {
  return [
    '## H3 structural syntax reference',
    'These forms come from the application contract used by validation. They are syntax, not project content or a claim about every expression the H3 model can understand.',
    `Use exactly these section headings in this order, each once on its own line:\n\n\`\`\`text\n${MINIMAX_H3_PROMPT_SECTIONS.map((section) => `${section}:`).join('\n')}\n\`\`\``,
    'Replace placeholders with the current source-backed facts. Indices are positive and follow the frozen channel order. Recommended vocal forms illustrate a clear binding; the existing parser also accepts its documented natural-language forms.',
    ...formIds.map((formId) => `${H3_SYNTAX_FORMS[formId].title}:\n\n\`\`\`text\n${describeForm(formId)}\n\`\`\``),
    'For three or more unison speakers, extend the comma-separated ID and explicitly map every speaker to its Audio; keep one shared <d> block. For different overlapping lines, use a separate speaker event and <d> for each line.',
    'The single-speaker form uses Subject only when that speaker has a real defined picture source. Otherwise substitute the source-established stable voice description before (Sx). Include an Audio mapping only for the actual selected reference; dialogue without a reference Audio needs no invented mapping.',
    'These are fragments of the same six-section prompt. Keep dialogue literal, choose actual shot/time boundaries, and apply each reference in its real event. Do not add speech or invent a picture to satisfy a fragment.',
  ].join('\n\n')
}

export function describeH3SyntaxCorrection(
  formIds: readonly H3SyntaxFormId[],
): string {
  return [
    ...formIds.map(describeForm),
    'Use actual IDs; preserve source words.',
  ].join('\n')
}
