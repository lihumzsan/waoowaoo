import { detectAll } from 'tinyld'
import type {
  VideoInputMode,
  VideoPromptProfile,
} from '@/lib/ai-registry/types'
import {
  countReferenceSentences,
  findLastReferenceSentenceBoundary,
  hasReferenceAudioAnaphoricBridge,
  hasReferenceCompoundAudioPair,
  hasReferenceSingleAudioPair,
  hasReferenceUnboundAudioApplication,
  parseReferenceSpeakerNumbers,
  type H3ReferenceAudioBinding,
} from './h3-reference-audio'
import {
  assertReferenceDialogueTransitions,
  maskReferenceDialogueBlocks,
  maskReferenceVisibleTextLiterals,
  normalizeReferenceDialoguePayload,
  parseReferenceDialogueBlocks,
  parseReferenceDialogueEvents,
} from './h3-reference-dialogue'
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
const REQUIRED_VISIBLE_TEXT_POLICY = 'Spoken dialogue is audio only and must never appear as visible text. Do not add subtitles or captions under any circumstances. Do not add title cards, watermarks, or interface overlays unless detailed_description explicitly requests that exact visible text.'
const DIALOGUE_TAG = /<\/?d>/u
const DIALOGUE_CUTOFF_TAG = /<cutoff>/u
const DIALOGUE_BLOCK = /<d>[\s\S]*?<\/d>/gu
const QUOTED_TEXT_LITERAL = /"(?:\\.|[^"\\\r\n])*"/gu
const SUBTITLE_VISIBLE_TEXT = /\b(?:subtitles?|captions?)\b/iu
const REFERENCE_ENTITY_TOKEN = /<(?:Subject|Picture|Video|Audio)\s+\d+>/gu
const REFERENCE_SUBJECT_TOKEN = /<Subject\s+\d+>/gu
const REFERENCE_SUBJECT_LINE_START = /^<Subject\s+(\d+)>/u
const REFERENCE_SUBJECT_DEFINITION_CLAIM = /<Subject\s+(\d+)>(?:\s+\(S\d+(?:\s*,\s*S\d+)*\))?(?=\s+is\b|\s*:)/gu
const REFERENCE_PLAYBACK_SUBJECT_DEFINITION_PREFIX = /^<Subject\s+(\d+)>\s+is\s+a\s+(source-backed|target-visible)\s+in-scene\s+playback\s+entity\b/iu
const REFERENCE_SOURCE_BACKED_PLAYBACK_SUBJECT_DEFINITION = /^<Subject\s+(\d+)>\s+is\s+a\s+source-backed\s+in-scene\s+playback\s+entity\s+from\s+<Picture\s+\d+>:\s+\S/iu
const REFERENCE_TARGET_VISIBLE_PLAYBACK_SUBJECT_DEFINITION = /^<Subject\s+(\d+)>\s+is\s+a\s+target-visible\s+in-scene\s+playback\s+entity:\s+\S/iu
const REFERENCE_PLAYBACK_SUBJECT_AUDIENCE_CONFLICT = /\b(?:audience-only|non-diegetic)\b|\b(?:background|audience)\s+(?:music|score|soundtrack)\b|\b(?:music|score|soundtrack)\b[^.!?\n]{0,32}\bfor\s+(?:[\p{L}'-]+\s+){0,3}(?:audiences?|listeners?|viewers?)\b/iu
const REFERENCE_SPEAKER_TOKEN = /\(S\d+(?:\s*,\s*S\d+)*\)/gu
const REFERENCE_TASK_PREFIX = /\[(?:reference generation|audio reference|audio reuse)(?: \+ (?:reference generation|audio reference|audio reuse))*\]/gu
const SHOT_MARKER = /\[Shot (\d+)\]/gu
const SHOT_TRANSITION = /^\[Shot (\d+)\] At (\d{2}):(\d{2}\.\d{3}), the camera (?:cuts|dissolves|fades|wipes)\b/u
const CAMERA_TRANSITION = /\bthe camera (?:cuts|dissolves|fades|wipes)\b/gu
const TIMED_EVENT = /\bAt (\d{2}):(\d{2}\.\d{3})\b/gu
const CLOCK_LIKE_TIME = /\b\d+\s*:\s*\d+(?:\s*[.,]\s*\d+)*\b/gu
const CANONICAL_CLOCK_TIMED_EVENT = /^At \d{2}:\d{2}\.\d{3}$/u
const UNIT_TIMED_EVENT = /(?:\b\d+(?:\.\d*)?|\.\d+)\s*(?:milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|hours?|hrs?)\b/iu
const PICTURE_ANCHOR = /<Picture\s+\d+>/u
const MEDIA_REFERENCE = /<(Picture|Audio)\s+(\d+)>/gu
const VIDEO_REFERENCE = /<Video\s+(\d+)>/gu
const SUBJECT_SPEAKER = /<Subject\s+(\d+)>\s*\(S(\d+)\)/gu
const REFERENCE_SINGLE_SPEAKER_TOKEN = /\(S(\d+)\)/gu
const REFERENCE_SUMMARY_PREFIX = /^\[([^\]\r\n]+)\]\s+\S/u
const REFERENCE_RETENTION_ENTRY = /^<(Subject|Picture|Video|Audio)\s+([1-9]\d*)>[^:\n]*:\s*([a-z_]+)\s+-\s+\S/u
const REFERENCE_RETENTION_SPEAKER = /\(S\d+(?:\s*,\s*S\d+)*\)/u
const REFERENCE_VISUAL_RELATIONSHIPS = new Set([
  'fully_preserved',
  'partially_preserved',
  'attribute_transfer',
  'weak_reference',
])
const REFERENCE_AUDIO_RELATIONSHIPS = new Set([
  'fully_copy',
  'partially_copy',
  'reference',
  'weak_reference',
])
const REFERENCE_ENGLISH_FUNCTION_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'he', 'her',
  'his', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'she', 'that', 'the',
  'their', 'this', 'to', 'was', 'while', 'who', 'whose', 'with',
])
const REFERENCE_STRONG_ENGLISH_SYNTAX_WORDS = new Set([
  'and', 'from', 'shown', 'that', 'the', 'this', 'through', 'uses', 'while', 'whose', 'with',
])
export type H3PromptReferenceManifest = {
  readonly pictureCount: number
  readonly audioCount: number
}

function invalid(reason: string): Error {
  return new Error('VIDEO_PROMPT_PROFILE_INVALID:' + reason)
}

function containsNonLatinScriptLetter(input: string): boolean {
  return Array.from(input).some((character) => (
    /\p{L}/u.test(character) && !/\p{Script=Latin}/u.test(character)
  ))
}

function containsClearlyNonEnglishLatinProse(input: string): boolean {
  const letterCount = Array.from(input).filter((character) => /\p{L}/u.test(character)).length
  if (letterCount < 24) return false
  const candidates = detectAll(input)
  const strongest = candidates[0]
  const english = candidates.find((candidate) => candidate.lang === 'en')
  const englishSignalCount = Array.from(
    new Set(Array.from(input.toLowerCase().matchAll(/\b[a-z]+\b/gu)).map((match) => match[0])),
  ).filter((word) => REFERENCE_ENGLISH_FUNCTION_WORDS.has(word)).length
  const strongEnglishSyntaxCount = Array.from(
    new Set(Array.from(input.toLowerCase().matchAll(/\b[a-z]+\b/gu)).map((match) => match[0])),
  ).filter((word) => REFERENCE_STRONG_ENGLISH_SYNTAX_WORDS.has(word)).length
  if (strongEnglishSyntaxCount >= 2) return false
  return strongest !== undefined
    && strongest.lang !== 'en'
    && strongest.accuracy > (english?.accuracy ?? 0) * 3
    && (
      strongest.accuracy >= 0.6
      || (strongest.accuracy >= 0.4 && englishSignalCount === 0)
    )
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

function maskRequiredVisibleTextPolicy(input: string): string {
  return input.replaceAll(
    REQUIRED_VISIBLE_TEXT_POLICY,
    (policy) => ' '.repeat(policy.length),
  )
}

function assertVisibleTextPolicy(
  sections: Readonly<Record<MinimaxH3PromptSection, string>>,
): void {
  if (!sections.summary.split('\n').includes(REQUIRED_VISIBLE_TEXT_POLICY)) {
    throw invalid('VISIBLE_TEXT_POLICY_REQUIRED')
  }
  const promptProse = MINIMAX_H3_PROMPT_SECTIONS
    .map((section) => sections[section])
    .join('\n')
  const promptProseWithoutPolicy = maskRequiredVisibleTextPolicy(promptProse)
    .replace(DIALOGUE_BLOCK, (dialogue) => ' '.repeat(dialogue.length))
    .replace(QUOTED_TEXT_LITERAL, (literal) => ' '.repeat(literal.length))
  if (SUBTITLE_VISIBLE_TEXT.test(promptProseWithoutPolicy)) {
    throw invalid('SUBTITLE_VISIBLE_TEXT_FORBIDDEN')
  }
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
  inputMode: VideoInputMode,
  timelineOriginSeconds: number,
  timelineEndSeconds: number,
): void {
  for (const section of MINIMAX_H3_PROMPT_SECTIONS) {
    const body = sections[section]
    if (DIALOGUE_CUTOFF_TAG.test(body)) {
      if (inputMode !== 'reference') throw invalid('DIALOGUE_CUTOFF_UNSUPPORTED')
      if (section !== 'detailed_description') throw invalid('DIALOGUE_CUTOFF_SECTION_INVALID')
    }
    if (section !== 'detailed_description' && DIALOGUE_TAG.test(body)) {
      throw invalid('DIALOGUE_TAG_SECTION_INVALID:' + section)
    }
  }

  const detailedDescription = sections.detailed_description
  const firstShotIndex = detailedDescription.indexOf('[Shot 1]')
  if (firstShotIndex < 0) {
    throw invalid('DETAILED_DESCRIPTION_SHOT_1_REQUIRED')
  }
  if (inputMode === 'reference') {
    if (firstShotIndex === 0) throw invalid('REFERENCE_STYLE_OPENING_REQUIRED')
    const styleOpening = detailedDescription.slice(0, firstShotIndex).trim()
    const styleSentenceCount = countReferenceSentences(styleOpening)
    if (
      styleSentenceCount < 1
      || styleSentenceCount > 2
      || !/[A-Za-z]/u.test(styleOpening)
      || !/[.!?]$/u.test(styleOpening)
      || DIALOGUE_TAG.test(styleOpening)
      || containsNonLatinScriptLetter(styleOpening)
    ) {
      throw invalid('REFERENCE_STYLE_OPENING_INVALID')
    }
  } else if (firstShotIndex !== 0) {
    throw invalid('DETAILED_DESCRIPTION_SHOT_1_REQUIRED')
  }

  const structuralDescription = inputMode === 'reference'
    ? maskReferenceVisibleTextLiterals(
        maskReferenceDialogueBlocks(
          detailedDescription,
          parseReferenceDialogueBlocks(detailedDescription),
        ),
      )
    : detailedDescription.replace(
        DIALOGUE_BLOCK,
        (dialogue) => ' '.repeat(dialogue.length),
      )
  if (DIALOGUE_CUTOFF_TAG.test(structuralDescription)) {
    throw invalid('DIALOGUE_CUTOFF_SECTION_INVALID')
  }
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

function maskReferenceProtocolMetadata(input: string): string {
  return input
    .replace(REFERENCE_ENTITY_TOKEN, (token) => ' '.repeat(token.length))
    .replace(REFERENCE_SPEAKER_TOKEN, (token) => ' '.repeat(token.length))
    .replace(REFERENCE_TASK_PREFIX, (prefix) => ' '.repeat(prefix.length))
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function containsBoundaryAwareText(input: string, text: string): boolean {
  if (Array.from(text).length === 1 && /[\p{L}\p{N}]/u.test(text)) {
    const literal = escapeRegExp(text)
    return new RegExp(`(?:"\\s*${literal}\\s*"|“\\s*${literal}\\s*”)`, 'u').test(input)
  }
  const leftBoundary = /^[\p{L}\p{N}]/u.test(text) ? String.raw`(?<![\p{L}\p{N}])` : ''
  const rightBoundary = /[\p{L}\p{N}]$/u.test(text) ? String.raw`(?![\p{L}\p{N}])` : ''
  return new RegExp(leftBoundary + escapeRegExp(text) + rightBoundary, 'u').test(input)
}

function assertReferenceDialoguePlacement(
  sections: Readonly<Record<MinimaxH3PromptSection, string>>,
): void {
  const dialogueBlocks = parseReferenceDialogueBlocks(sections.detailed_description)
  const dialoguePayloads = dialogueBlocks
    .map((block) => normalizeReferenceDialoguePayload(block.content).normalize('NFC'))
    .filter((payload) => payload.length > 0)
  const detailedOutsideDialogue = maskReferenceVisibleTextLiterals(
    maskReferenceDialogueBlocks(
      sections.detailed_description,
      dialogueBlocks,
    ),
  )
  if (dialoguePayloads.length === 0) return
  const textOutsideLiteralBlocks = maskRequiredVisibleTextPolicy(maskReferenceProtocolMetadata([
    ...MINIMAX_H3_PROMPT_SECTIONS
      .filter((section) => section !== 'detailed_description' && section !== 'non_diegetic_music')
      .map((section) => sections[section]),
    detailedOutsideDialogue,
  ].join('\n'))).normalize('NFC')
  if (dialoguePayloads.some((payload) => containsBoundaryAwareText(
    textOutsideLiteralBlocks,
    payload,
  ))) {
    throw invalid('REFERENCE_DIALOGUE_OUTSIDE_TAG')
  }
}

function assertH3ReferencePrompt(
  sections: Readonly<Record<MinimaxH3PromptSection, string>>,
  references: H3PromptReferenceManifest,
): void {
  assertReferenceDialoguePlacement(sections)
  const proseSections: string[] = []
  for (const section of MINIMAX_H3_PROMPT_SECTIONS) {
    const bodyWithoutDialogue = section === 'detailed_description'
      ? maskReferenceDialogueBlocks(
          sections[section],
          parseReferenceDialogueBlocks(sections[section]),
        )
      : sections[section]
    const prose = maskRequiredVisibleTextPolicy(maskReferenceProtocolMetadata(
      maskReferenceVisibleTextLiterals(bodyWithoutDialogue),
    ))
    if (containsNonLatinScriptLetter(prose)) {
      throw invalid('REFERENCE_NON_ENGLISH_TEXT_INVALID')
    }
    if (section !== 'non_diegetic_music') proseSections.push(prose)
  }
  if (containsClearlyNonEnglishLatinProse(proseSections.join('\n'))) {
    throw invalid('REFERENCE_NON_ENGLISH_TEXT_INVALID')
  }
  assertReferenceDialogueTransitions(
    sections.detailed_description,
    parseReferenceDialogueBlocks(sections.detailed_description),
  )
  const requiredTaskTypes = new Set(['reference generation'])
  for (const line of sections.retention_analysis.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (REFERENCE_RETENTION_SPEAKER.test(trimmed)) {
      throw invalid('REFERENCE_RETENTION_SPEAKER_FORBIDDEN')
    }
    const entry = REFERENCE_RETENTION_ENTRY.exec(trimmed)
    if (!entry) throw invalid('REFERENCE_RETENTION_ENTRY_INVALID')
    const modality = entry[1]!
    const number = entry[2]!
    const relationship = entry[3]!
    const legalRelationships = modality === 'Audio'
      ? REFERENCE_AUDIO_RELATIONSHIPS
      : REFERENCE_VISUAL_RELATIONSHIPS
    if (!legalRelationships.has(relationship)) {
      throw invalid(`REFERENCE_RETENTION_RELATION_INVALID:${modality}:${number}`)
    }
    if (modality === 'Audio') {
      requiredTaskTypes.add(
        relationship === 'fully_copy' || relationship === 'partially_copy'
          ? 'audio reuse'
          : 'audio reference',
      )
    }
  }

  const summaryPrefix = REFERENCE_SUMMARY_PREFIX.exec(sections.summary)
  const declaredTaskTypes = summaryPrefix?.[1].split(' + ') ?? []
  const summaryTaskTypesAreCheckable = references.audioCount === 0 || requiredTaskTypes.size > 1
  if (summaryTaskTypesAreCheckable && (
    declaredTaskTypes.length !== requiredTaskTypes.size
    || new Set(declaredTaskTypes).size !== declaredTaskTypes.length
    || declaredTaskTypes.some((taskType) => !requiredTaskTypes.has(taskType))
  )) {
    throw invalid('REFERENCE_SUMMARY_PREFIX_REQUIRED')
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

function assertReferenceSubjectClosure(
  sections: Readonly<Record<MinimaxH3PromptSection, string>>,
): ReadonlySet<number> {
  const definedSubjectNumbers = new Set<number>()
  const playbackSubjectNumbers = new Set<number>()
  for (const line of sections.subject_definitions.split('\n').map((entry) => entry.trim())) {
    const lineSubjectNumber = Number(REFERENCE_SUBJECT_LINE_START.exec(line)?.[1])
    if (!Number.isSafeInteger(lineSubjectNumber) || lineSubjectNumber < 1) continue
    const definitionClaims = Array.from(line.matchAll(REFERENCE_SUBJECT_DEFINITION_CLAIM))
    if (
      definitionClaims.length !== 1
      || Number(definitionClaims[0]?.[1]) !== lineSubjectNumber
    ) {
      throw invalid(`REFERENCE_SUBJECT_DEFINITION_INVALID:${String(lineSubjectNumber)}`)
    }
    if (definedSubjectNumbers.has(lineSubjectNumber)) {
      throw invalid(`REFERENCE_SUBJECT_DEFINITION_DUPLICATE:${String(lineSubjectNumber)}`)
    }
    definedSubjectNumbers.add(lineSubjectNumber)

    const playbackDefinition = REFERENCE_PLAYBACK_SUBJECT_DEFINITION_PREFIX.exec(line)
    if (!playbackDefinition) continue
    const exactDefinition = playbackDefinition[2] === 'source-backed'
      ? REFERENCE_SOURCE_BACKED_PLAYBACK_SUBJECT_DEFINITION.exec(line)
      : REFERENCE_TARGET_VISIBLE_PLAYBACK_SUBJECT_DEFINITION.exec(line)
    const targetVisibleHasPicture = playbackDefinition[2] === 'target-visible'
      && Array.from(line.matchAll(MEDIA_REFERENCE)).some((reference) => reference[1] === 'Picture')
    if (Number(exactDefinition?.[1]) !== lineSubjectNumber || targetVisibleHasPicture) {
      throw invalid(`REFERENCE_PLAYBACK_SUBJECT_DEFINITION_INVALID:${String(lineSubjectNumber)}`)
    }
    if (REFERENCE_PLAYBACK_SUBJECT_AUDIENCE_CONFLICT.test(line)) {
      throw invalid(`REFERENCE_PLAYBACK_SUBJECT_AUDIENCE_CONFLICT:${String(lineSubjectNumber)}`)
    }
    playbackSubjectNumbers.add(lineSubjectNumber)
  }

  for (const section of MINIMAX_H3_PROMPT_SECTIONS) {
    const protocolBody = section === 'detailed_description'
      ? maskReferenceVisibleTextLiterals(maskReferenceDialogueBlocks(
          sections[section],
          parseReferenceDialogueBlocks(sections[section]),
        ))
      : sections[section]
    for (const match of protocolBody.matchAll(REFERENCE_SUBJECT_TOKEN)) {
      const subjectNumber = Number(match[0].match(/\d+/u)?.[0])
      if (!Number.isSafeInteger(subjectNumber) || !definedSubjectNumbers.has(subjectNumber)) {
        throw invalid(`REFERENCE_SUBJECT_UNDEFINED:${String(subjectNumber)}`)
      }
    }
  }
  return playbackSubjectNumbers
}

function assertH3ReferenceManifest(
  sections: Readonly<Record<MinimaxH3PromptSection, string>>,
  references: H3PromptReferenceManifest,
  inputMode: VideoInputMode,
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
    const sectionProtocol = inputMode === 'reference' && section === 'detailed_description'
      ? maskReferenceVisibleTextLiterals(
          maskReferenceDialogueBlocks(
            sections[section],
            parseReferenceDialogueBlocks(sections[section]),
          ),
        )
      : sections[section]
    if (inputMode === 'reference') {
      const videoReference = Array.from(sectionProtocol.matchAll(VIDEO_REFERENCE))[0]
      if (videoReference?.[1]) {
        throw invalid(`VIDEO_REFERENCE_UNSUPPORTED:${videoReference[1]}`)
      }
    }
    for (const match of sectionProtocol.matchAll(MEDIA_REFERENCE)) {
      const modality = match[1]!
      const number = Number(match[2])
      const limit = modality === 'Picture' ? references.pictureCount : references.audioCount
      if (!Number.isSafeInteger(number) || number < 1 || number > limit) {
        throw invalid(`MEDIA_REFERENCE_INDEX_OUT_OF_RANGE:${modality}:${String(number)}`)
      }
    }
  }
  const playbackSubjectNumbers = inputMode === 'reference'
    ? assertReferenceSubjectClosure(sections)
    : new Set<number>()
  const audioBindings: H3ReferenceAudioBinding[] = []
  const unboundAudioNumbers: number[] = []
  for (let audioNumber = 1; audioNumber <= references.audioCount; audioNumber += 1) {
    const audioToken = `<Audio ${String(audioNumber)}>`
    const allDefinitionLines = sections.subject_definitions
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    const linesReferencingAudio = allDefinitionLines.filter((line) => line.includes(audioToken))
    if (linesReferencingAudio.length === 0) {
      throw invalid(`AUDIO_REFERENCE_MISSING:${String(audioNumber)}`)
    }
    const definitionLines = allDefinitionLines.filter((line) => line.startsWith(audioToken))
    const definitionAudioTokens = definitionLines.length === 1
      ? Array.from(definitionLines[0]!.matchAll(MEDIA_REFERENCE))
        .filter((reference) => reference[1] === 'Audio')
      : []
    if (
      definitionLines.length !== 1
      || definitionAudioTokens.length !== 1
      || Number(definitionAudioTokens[0]?.[2]) !== audioNumber
    ) {
      throw invalid(`AUDIO_SPEAKER_BINDING_INVALID:${String(audioNumber)}`)
    }
    const definitionLine = definitionLines[0]!
    const bindings = Array.from(definitionLine.matchAll(SUBJECT_SPEAKER))
    const definitionSpeakers = Array.from(definitionLine.matchAll(REFERENCE_SPEAKER_TOKEN))
    const definitionSubjects = Array.from(definitionLine.matchAll(REFERENCE_SUBJECT_TOKEN))
    const allAudioSpeakerBindings = linesReferencingAudio.flatMap((line) => (
      Array.from(line.matchAll(SUBJECT_SPEAKER))
    ))
    const allAudioSubjects = linesReferencingAudio.flatMap((line) => (
      Array.from(line.matchAll(REFERENCE_SUBJECT_TOKEN))
    ))
    const allAudioSpeakers = linesReferencingAudio.flatMap((line) => (
      Array.from(line.matchAll(REFERENCE_SPEAKER_TOKEN))
    ))
    if (
      definitionSpeakers.length > 1
      || definitionSubjects.length > 1
      || allAudioSpeakerBindings.length !== bindings.length
      || allAudioSubjects.length !== definitionSubjects.length
      || allAudioSpeakers.length !== definitionSpeakers.length
      || (definitionSubjects.length === 1 && bindings.length !== 1)
    ) {
      throw invalid(`AUDIO_SPEAKER_BINDING_INVALID:${String(audioNumber)}`)
    }
    if (definitionSpeakers.length === 1) {
      const simpleSpeaker = Array.from(
        definitionSpeakers[0]![0].matchAll(REFERENCE_SINGLE_SPEAKER_TOKEN),
      )
      const subjectNumber = bindings.length === 1 ? Number(bindings[0]![1]) : null
      const speakerNumber = Number(simpleSpeaker[0]?.[1])
      if (
        simpleSpeaker.length !== 1
        || (subjectNumber !== null && (!Number.isSafeInteger(subjectNumber) || subjectNumber < 1))
        || !Number.isSafeInteger(speakerNumber)
        || speakerNumber < 1
      ) {
        throw invalid(`AUDIO_SPEAKER_BINDING_INVALID:${String(audioNumber)}`)
      }
      audioBindings.push({
        audioNumber,
        subjectNumber,
        speakerNumber,
      })
    } else {
      unboundAudioNumbers.push(audioNumber)
    }
    const retentionLines = sections.retention_analysis
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    const retained = retentionLines.filter((line) => {
      const entry = REFERENCE_RETENTION_ENTRY.exec(line)
      return entry?.[1] === 'Audio' && Number(entry[2]) === audioNumber
    })
    const audioTokenAppearsInRetention = sections.retention_analysis.includes(audioToken)
    if (retained.length === 0 && !audioTokenAppearsInRetention) {
      throw invalid(`AUDIO_REFERENCE_RETENTION_MISSING:${String(audioNumber)}`)
    }
    const retainedAudioReferences = retained.length === 1
      ? Array.from(retained[0]!.matchAll(MEDIA_REFERENCE))
        .filter((reference) => reference[1] === 'Audio')
      : []
    if (
      retained.length !== 1
      || retainedAudioReferences.length === 0
      || retainedAudioReferences.some((reference) => Number(reference[2]) !== audioNumber)
    ) {
      throw invalid(`AUDIO_REFERENCE_RETENTION_INVALID:${String(audioNumber)}`)
    }
  }
  if (unboundAudioNumbers.length > 0) {
    const detailedAudioApplication = maskReferenceVisibleTextLiterals(
      maskReferenceDialogueBlocks(
        sections.detailed_description,
        parseReferenceDialogueBlocks(sections.detailed_description),
      ),
    )
    const audibleApplicationSections = [
      { content: detailedAudioApplication, allowDiegeticPlayback: true },
      { content: sections.overall_soundscape, allowDiegeticPlayback: false },
      { content: sections.non_diegetic_music, allowDiegeticPlayback: false },
    ]
    for (const audioNumber of unboundAudioNumbers) {
      const audioToken = `<Audio ${String(audioNumber)}>`
      if (!audibleApplicationSections.some((section) => (
        hasReferenceUnboundAudioApplication(
          section.content,
          audioToken,
          section.allowDiegeticPlayback,
          playbackSubjectNumbers,
        )
      ))) {
        throw invalid(`AUDIO_REFERENCE_APPLICATION_MISSING:${String(audioNumber)}`)
      }
    }
  }
  if (audioBindings.length === 0) return

  const dialogueEvents = parseReferenceDialogueEvents(sections.detailed_description)
  const appliedAudioNumbers = new Set<number>()
  const speakersWithDialogue = new Set<number>()
  for (const event of dialogueEvents) {
    const owner = Array.from(event.speakerContext.matchAll(REFERENCE_SPEAKER_TOKEN)).at(-1)
    if (owner?.index === undefined) {
      continue
    }
    const ownerStart = owner.index
    const speakerNumbers = parseReferenceSpeakerNumbers(owner[0])
    const compoundSpeaker = speakerNumbers.length > 1
    for (const speakerNumber of speakerNumbers) speakersWithDialogue.add(speakerNumber)
    const ownerEnd = ownerStart + owner[0].length
    const subjectOwner = Array.from(event.speakerContext.matchAll(SUBJECT_SPEAKER))
      .filter((match) => match.index !== undefined && match.index + match[0].length === ownerEnd)
      .at(-1)
    const subjectNumber = subjectOwner ? Number(subjectOwner[1]) : null
    const ownerAudioBindings = audioBindings.filter((binding) => (
      speakerNumbers.includes(binding.speakerNumber)
      && (
        subjectNumber === null
        || binding.subjectNumber === null
        || binding.subjectNumber === subjectNumber
      )
    ))
    const eventSpeakers = Array.from(event.speakerContext.matchAll(REFERENCE_SPEAKER_TOKEN))
    const candidateAudioReferences = Array.from(event.speakerContext.matchAll(MEDIA_REFERENCE))
      .filter((reference) => reference[1] === 'Audio')
      .filter((reference) => {
        const referenceIndex = reference.index
        if (referenceIndex === undefined) return false
        const referenceEnd = referenceIndex + reference[0].length
        const afterReference = event.speakerContext.slice(referenceEnd)
        const lastSentenceBoundary = findLastReferenceSentenceBoundary(afterReference)
        const hasClearContinuation = lastSentenceBoundary < 0
          || hasReferenceAudioAnaphoricBridge(
            afterReference.slice(lastSentenceBoundary + 1),
          )
        if (!hasClearContinuation) return false
        if (referenceIndex >= ownerEnd) return true
        const speakerBeforeReference = eventSpeakers
          .filter((speaker) => speaker.index !== undefined && speaker.index < referenceIndex)
          .at(-1)
        const speakersBetweenReferenceAndOwner = eventSpeakers.filter((speaker) => (
          speaker.index !== undefined
          && speaker.index > referenceIndex
          && speaker.index <= ownerStart
        ))
        const belongsToOwner = (speaker: RegExpMatchArray): boolean => (
          parseReferenceSpeakerNumbers(speaker[0])
            .some((speakerNumber) => speakerNumbers.includes(speakerNumber))
        )
        return (
          (!speakerBeforeReference || belongsToOwner(speakerBeforeReference))
          && speakersBetweenReferenceAndOwner.every(belongsToOwner)
        )
      })
    const citedAudioNumbers: number[] = []
    for (const reference of candidateAudioReferences) {
      if (reference.index === undefined) continue
      const citedAudioNumber = Number(reference[2])
      const citedBinding = audioBindings.find((binding) => (
        binding.audioNumber === citedAudioNumber
      ))
      if (!citedBinding) continue
      const subjectMatches = subjectNumber === null
        || citedBinding.subjectNumber === null
        || citedBinding.subjectNumber === subjectNumber
      if (compoundSpeaker) {
        const appliesToBoundSpeaker = hasReferenceCompoundAudioPair({
          context: event.speakerContext,
          ownerStart,
          ownerEnd,
          binding: citedBinding,
        })
        const appliesToAnotherOwnerSpeaker = speakerNumbers.some((speakerNumber) => (
          speakerNumber !== citedBinding.speakerNumber
          && hasReferenceCompoundAudioPair({
              context: event.speakerContext,
              ownerStart,
              ownerEnd,
              binding: {
                ...citedBinding,
                speakerNumber,
              },
            })
        ))
        if (appliesToAnotherOwnerSpeaker || (appliesToBoundSpeaker && !subjectMatches)) {
          throw invalid(
            `AUDIO_REFERENCE_APPLICATION_INVALID:${String(citedAudioNumber)}`,
          )
        }
        if (appliesToBoundSpeaker && subjectMatches) {
          citedAudioNumbers.push(citedAudioNumber)
        }
        continue
      }
      const appliesToSingleSpeaker = hasReferenceSingleAudioPair({
        context: event.speakerContext,
        ownerStart,
        ownerEnd,
        referenceStart: reference.index,
        referenceEnd: reference.index + reference[0].length,
      })
      if (!appliesToSingleSpeaker) continue
      if (!speakerNumbers.includes(citedBinding.speakerNumber) || !subjectMatches) {
        throw invalid(
          `AUDIO_REFERENCE_APPLICATION_INVALID:${String(citedAudioNumber)}`,
        )
      }
      citedAudioNumbers.push(citedAudioNumber)
    }
    if (ownerAudioBindings.length === 0) continue
    const citedBindings = ownerAudioBindings.filter((binding) => (
      citedAudioNumbers.includes(binding.audioNumber)
    ))
    for (const binding of citedBindings) appliedAudioNumbers.add(binding.audioNumber)
  }
  for (const binding of audioBindings) {
    if (!speakersWithDialogue.has(binding.speakerNumber)) {
      throw invalid(`AUDIO_SPEAKER_DIALOGUE_MISSING:${String(binding.audioNumber)}`)
    }
    if (!appliedAudioNumbers.has(binding.audioNumber)) {
      throw invalid(`AUDIO_REFERENCE_APPLICATION_MISSING:${String(binding.audioNumber)}`)
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
  if (input.inputMode === 'reference') assertVisibleTextPolicy(sections)
  const timelineOriginSeconds = input.inputMode === 'continuation'
    ? H3_CONTINUATION_GUIDE_SECONDS
    : 0
  assertH3PromptStructure(
    sections,
    input.inputMode,
    timelineOriginSeconds,
    input.timelineDurationSeconds,
  )
  assertH3InputMode(input.inputMode, input.timelineDurationSeconds, sections)
  if (input.inputMode === 'reference') assertH3ReferencePrompt(sections, input.references)
  assertH3ReferenceManifest(sections, input.references, input.inputMode)
}

export function parseMinimaxH3Prompt(
  prompt: string,
): Readonly<Record<MinimaxH3PromptSection, string>> {
  return parseSections(prompt)
}
