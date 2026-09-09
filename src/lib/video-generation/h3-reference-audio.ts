const MEDIA_REFERENCE = /<(Picture|Audio)\s+(\d+)>/gu
const REFERENCE_AUDIO_ANAPHORIC_BRIDGE = /\b(?:uses?|using|with)\s+(?:that|this|the same)\s+(?:voice|timbre|audio(?:\s+reference)?)\b/iu
const REFERENCE_SPEAKER_TO_AUDIO_CUE = /(?:\b(?:uses?|using|follows?|following|references?|referencing)(?:\s+(?:(?:the|this|that|same)\s+)?(?:[\p{L}-]+\s+){0,6}(?:accent|audio|cadence|delivery|emotion|pacing|rhythm|timing|timbre|vocal|voice)(?:\s+and\s+(?:(?:the|this|that|same)\s+)?(?:[\p{L}-]+\s+){0,4}(?:accent|audio|cadence|delivery|emotion|pacing|rhythm|timing|timbre|vocal|voice))?\s+(?:referenced\s+from|of|from))?|\b(?:draws?|drawing|derives?|deriving)\s+(?:(?:the|this|that|same)\s+)?(?:accent|audio|cadence|delivery|emotion|pacing|rhythm|timing|timbre|vocal|voice)(?:\s+(?:accent|audio|cadence|delivery|emotion|pacing|rhythm|timing|timbre|vocal|voice))?\s+from|\b(?:(?:whose|his|her|their|the|this|that|same)\s+)?(?:[\p{L}-]+\s+){0,4}(?:accent|audio|cadence|delivery|emotion|pacing|rhythm|timing|timbre|vocal|voice)(?:\s+(?:accent|audio|cadence|delivery|emotion|pacing|rhythm|timing|timbre|vocal|voice)){0,2}\s+(?:(?:comes?|is\s+coming)|(?:is\s+)?(?:borrowed|derived|drawn|sourced|taken))\s+from|\bwith\s+(?:(?:the|this|that|same)\s+)?(?:(?:accent|audio|cadence|delivery|emotion|pacing|rhythm|timing|timbre|vocal|voice)\s+){1,3}(?:referenced\s+)?from|\b(?:asks?|exclaims?|replies?|responds?|says?|sings?|speaks?|whispers?)\s+in\s+(?:(?:the|this|that|same)\s+)?(?:[\p{L}-]+\s+){0,6}(?:accent|audio|cadence|delivery|emotion|pacing|rhythm|timing|timbre|vocal|voice)(?:\s+(?:accent|audio|cadence|delivery|emotion|pacing|rhythm|timing|timbre|vocal|voice)){0,2}\s+referenced\s+from|\bin\s+(?:(?:the|this|that|same)\s+)?(?:[\p{L}-]+\s+){0,6}(?:accent|audio|cadence|delivery|emotion|pacing|rhythm|timing|timbre|vocal|voice)(?:\s+(?:accent|audio|cadence|delivery|emotion|pacing|rhythm|timing|timbre|vocal|voice)){0,2}\s+referenced\s+from|\bguided\s+by|\b(?:speaks?|speaking)\s+in\s+(?:(?:the|this|that|same)\s+)?(?:timbre|voice)\s+of)\s*$/iu
const REFERENCE_AUDIO_TO_SPEAKER_CUE = /(?:\b(?:applied\s+to|assigned\s+to|guides?|guiding|used\s+by)|\bis\s+(?:(?:the|this|that|same)\s+)?(?:(?:accent|audio|cadence|delivery|emotion|pacing|rhythm|timing|timbre|vocal|voice)\s+){1,3}reference\s+for)(?:\s+<Subject\s+\d+>)?\s*$/iu
const REFERENCE_AUDIO_CUE_NEGATION = /\b(?:neither|never|no|none|nor|not|nothing|nowhere|without)\b|\b(?:doesn['’]t|don['’]t|didn['’]t|isn['’]t|aren['’]t|wasn['’]t|weren['’]t|hasn['’]t|haven['’]t|hadn['’]t|won['’]t|wouldn['’]t|can['’]t|couldn['’]t|shouldn['’]t|mustn['’]t|avoids?|avoided|fails?|failed|refuses?|refused)\b|\b(?:instead\s+of|other\s+than|rather\s+than)\b/iu
const REFERENCE_AUDIO_CUE_CLAUSE_BOUNDARY = /[,;]|\b(?:and|but|then|while)\b/giu
const REFERENCE_AUDIO_POSITIVE_CONTINUATION = /^\s*(?:and|plus)\s+(?:(?:the\s+)?(?:accent|cadence|delivery|emotion|pacing|rhythm|timing|timbre|voice)(?:\s+(?:of|from))?\s*)?$/iu
const REFERENCE_LEADING_AUDIO_OWNER_GAP = /^\s*,?\s*(?:<Subject\s+\d+>\s*)?$/u
const REFERENCE_AUDIO_RELATIVE_SUBJECT = /\b(?:who|which)\b|\bthat\s+(?!(?:[\p{L}-]+\s+){0,4}(?:accent|audio|cadence|delivery|emotion|pacing|rhythm|timing|timbre|vocal|voice)\b)/giu
const REFERENCE_LEADING_OWNER_RELATIVE = /^(\s*,?\s*)(?:that|who|which)(?:\s+is)?\s+/iu
const REFERENCE_AUDIO_WHOSE = /\bwhose\b/giu
const REFERENCE_AUDIO_ATTRIBUTE_START = /^\s+(?:[\p{L}-]+\s+){0,4}(?:accent|audio|cadence|delivery|emotion|pacing|rhythm|timing|timbre|vocal|voice)\b/iu
const REFERENCE_UNBOUND_AUDIO_SOURCE_CUE = /^\s*(?:(?:a|an|the)\s+)?(?:(?!(?:display|icon|monitor|screen|silent|visual|waveform)\b)[\p{L}-]+\s+){0,4}(?:ambience|beat|dialogue|effects?|lyrics|music|rhythm|score|sounds?|soundscape|soundtrack|voice|vocals?)(?:\s+(?:layer|signal|style|texture|track)){0,3}\s+from\s*$/iu
const REFERENCE_UNBOUND_AUDIO_SOURCE_EFFECT = /^\s*(?:fills?\s+(?:(?:a|the)\s+)?(?:air|room|scene|soundscape|space|video)\b|plays?(?:\s+(?:audibly|softly|throughout)\b|\s+through\s+(?:the\s+)?(?:headphones?|speakers?)\b|(?=\s*(?:[.,;]|$)))|runs?\s+(?:through|throughout)\b|sounds?\b|continues?(?=\s*(?:[.,;]|$|\bthroughout\b|\bwith\b|\bwithout\b))|is\s+(?:audible|heard)\b|remains?\s+(?:audible|heard)\b)/iu
const REFERENCE_UNBOUND_AUDIO_DIRECT_CUE = /^\s*(?:plays?(?:\s+(?:audibly|softly|throughout)\b|\s+through\s+(?:the\s+)?(?:headphones?|speakers?)\b|\s+as\s+(?:(?:a|an|the)\s+)?(?:[\p{L}-]+\s+){0,4}(?:ambience|dialogue|effects?|music|score|sounds?|soundscape|soundtrack|track|vocals?)(?=\s*(?:[.,;]|$|\band\b|\bfor\b|\bin\b|\bon\b|\bthroughout\b|\bwith\b|\bwithout\b))|(?=\s*(?:[.,;]|$)))|(?:begins?|continues?|enters?|returns?)\s+(?:audibly\b|as\s+(?:(?:a|an|the)\s+)?(?:[\p{L}-]+\s+){0,4}(?:ambience|music|score|sounds?|soundtrack|track|vocals?)(?=\s*(?:[.,;]|$|\band\b|\bfor\b|\bin\b|\bon\b|\bthroughout\b|\bwith\b|\bwithout\b)))|sounds?\b|reaches?\s+the\s+phrase\b|is\s+(?:(?:directly|fully|partially)\s+)?(?:(?:audible|heard)\b|(?:copied|referenced|reused|used)\s+as\s+(?:[\p{L}-]+\s+){0,5}(?:ambience|dialogue|effects?|music|score|sounds?|soundscape|soundtrack|track|vocals?)(?=\s*(?:[.,;]|$|\band\b|\bfor\b|\bin\b|\bon\b|\bthroughout\b|\bwith\b|\bwithout\b)))|remains?\s+(?:audible|heard)\b)/iu
const REFERENCE_UNBOUND_AUDIO_NEGATED_PREFIX = /(?:\b(?:no|none)\s+(?:(?:part|portion|segment)\s+)?of|\bnone\s+of\b[^,;.!?]{0,80}\bfrom|\b(?:no|zero)\s+(?:audible\s+)?(?:audio|sound|output)\s+from|\bnothing\s+from|\b(?:did|do|does)\s+not\s+(?:copy|reference|reuse|use)|\bwithout(?:\s+(?:copying|referencing|reusing|using))?)\s*$/iu
const REFERENCE_AUDIO_NON_NEGATING_WITHOUT = /\bwithout\s+(?:(?:any\s+)?(?:interruption|pause|stopping)|(?:a\s+)?break|(?:any\s+)?(?:audio\s+)?distortion|(?:any\s+)?added\s+(?:audio|sound)|(?:copying|reproducing)\s+(?:the\s+)?(?:original|source)\s+signal)\b/giu
const REFERENCE_UNBOUND_AUDIO_AUDIBILITY_DENIAL = /\b(?:never|not|no\s+longer)\s+(?:audible|heard)\b|\b(?:cannot|can\s+not|can't|could\s+not|couldn't)\s+be\s+heard\b|\b(?:is|becomes?|remains?|sounds?)\s+(?:completely\s+|fully\s+)?inaudible\b|\b(?:audio|score|sound|soundtrack|track)\s+(?:is|becomes?|remains?)\s+(?:completely\s+|fully\s+)?(?:inaudible|muted|silent)\b|\bnone\s+of\s+(?:it|this\s+audio|that\s+audio)\s+(?:(?:is|remains?)\s+(?:audible|heard)|can(?:not)?\s+be\s+heard)\b|\b(?:and|although|but|though|yet)\s+(?:(?:it|this\s+audio|that\s+audio)\s+|its\s+(?:audio\s+)?output\s+)(?:is|becomes?|remains?)\s+(?:completely\s+|fully\s+)?(?:inaudible|muted|silent)\b|\bwithout\s+(?:any\s+)?(?:audible\s+(?:audio|sound|output)|(?:audio|sound)\s+output|sound)(?=\s*(?:[.,;!?]|$|\b(?:and|but|or|while)\b))|\bwithout\b[^,;.!?]{0,60}\b(?:or|nor)\s+(?:any\s+)?audible\s+(?:audio|sound|output)(?=\s*(?:[.,;!?]|$|\b(?:and|but|or|while)\b))/iu
const REFERENCE_UNBOUND_AUDIO_NON_AUDIBLE_DIRECT_CUE = /^\s*(?:(?:begins?|continues?|enters?|plays?|returns?)\s+as|is\s+(?:(?:directly|fully|partially)\s+)?(?:copied|referenced|reused|used)\s+as)\s+(?:(?:a|an|the)\s+)?(?:(?!(?:and|but|for|while|with)\b)[\p{L}-]+\s+){0,4}(?:muted|silent|visual|waveform)\b/iu
const REFERENCE_UNBOUND_AUDIO_AUDIENCE_MUSIC_SOURCE = /\b(?:music|score|soundtrack)(?:\s+(?:layer|signal|style|texture|track)){0,3}\s+from\s*$/iu
const REFERENCE_UNBOUND_AUDIO_AUDIENCE_MUSIC_DIRECT_CUE = /^\s*(?:(?:begins?|continues?|enters?|plays?|returns?)\s+as|is\s+(?:(?:directly|fully|partially)\s+)?(?:copied|referenced|reused|used)\s+as)\s+(?:(?:a|an|the)\s+)?(?:[\p{L}-]+\s+){0,4}(?:music|score|soundtrack)\b/iu
const REFERENCE_UNBOUND_AUDIO_AUDIENCE_MUSIC_DESTINATION = /\b(?:audience-only|background|non-diegetic)\s+(?:music|score|soundtrack)\b|\b(?:music|score|soundtrack)\s+(?:for|to)\s+(?:the\s+)?audience\b/iu
const REFERENCE_AUDIENCE_MUSIC_CONTEXT = /\b(?:audience-only|non-diegetic)\b[^.!?\n]{0,48}\b(?:music|score|soundtrack)\b|\b(?:background|dramatic\s+background)\s+(?:music|score|soundtrack)\b|\b(?:music|score|soundtrack)\b[^.!?\n]{0,32}\bfor\s+(?:the\s+)?audience\b|\bfor\s+(?:[\p{L}'-]+\s+){0,3}(?:audiences?|listeners?|viewers?)\b/iu
const REFERENCE_UNBOUND_AUDIO_DIEGETIC_SOURCE_CUE = /^\s*(?:the\s+)?visible\s+in-scene\s+<Subject\s+(\d+)>\s+(?:broadcasts?|emits?|plays?|streams?)\s+(?:(?:(?:the|this|that)\s+)?(?:audio|music|song|sound)(?:\s+track)?\s+from\s*)?$/iu
const REFERENCE_UNBOUND_AUDIO_DIEGETIC_EFFECT = /^\s*audibly\s+(?:from|through)\s+its\s+physical\s+output\b/iu
const REFERENCE_DIEGETIC_LEADING_METADATA = /^\s*\[Shot\s+\d+\](?:\s+At\s+\d{2}:\d{2}\.\d{3},?)?\s*/iu
const REFERENCE_AUDIO_VOCAL_ATTRIBUTE = /\b(?:accent|cadence|delivery|emotion|pacing|rhythm|timing|timbre|vocal|voice)\b/iu
const REFERENCE_AUDIO_COMPACT_SUFFIX = /^\s*(?:$|,\s*(?!(?:as|for|only|to)\b)|(?:and|while)\b|but\s+not\s+(?=<Audio\s+\d+>))/iu
const REFERENCE_TITLE_ABBREVIATIONS = new Set([
  'capt', 'cmdr', 'col', 'dr', 'gen', 'gov', 'hon', 'jr', 'lt', 'mr', 'mrs', 'ms',
  'pres', 'prof', 'rep', 'rev', 'sen', 'sgt', 'sr', 'st',
])
const REFERENCE_INLINE_ABBREVIATIONS = new Set([
  'approx', 'dept', 'e.g', 'etc', 'fig', 'i.e', 'no', 'vs',
])
const REFERENCE_SENTENCE_STARTERS = new Set([
  'a', 'after', 'an', 'before', 'he', 'i', 'it', 'meanwhile', 'next', 'she',
  'that', 'the', 'then', 'these', 'they', 'this', 'those', 'we',
])

export type H3ReferenceAudioBinding = {
  readonly audioNumber: number
  readonly subjectNumber: number | null
  readonly speakerNumber: number
}

type ReferenceCueStartScope = 'any' | 'clause' | 'input'

export function parseReferenceSpeakerNumbers(token: string): readonly number[] {
  return Array.from(token.matchAll(/S(\d+)/gu))
    .map((match) => Number(match[1]))
    .filter((speakerNumber) => Number.isSafeInteger(speakerNumber) && speakerNumber > 0)
}

export function findLastReferenceSentenceBoundary(
  input: string,
  semicolonIsBoundary = true,
): number {
  let lastBoundaryIndex = -1
  for (let index = 0; index < input.length; index += 1) {
    if (isReferenceSentenceBoundary(input, index, semicolonIsBoundary)) {
      lastBoundaryIndex = index
    }
  }
  return lastBoundaryIndex
}

export function isReferenceSentenceBoundary(
  input: string,
  index: number,
  semicolonIsBoundary = true,
): boolean {
  const character = input[index]
  if (/[!?。！？]/u.test(character ?? '') || (semicolonIsBoundary && character === ';')) {
    return true
  }
  if (character !== '.') return false
  const previousCharacter = input[index - 1]
  const nextCharacter = input[index + 1]
  if (/\d/u.test(nextCharacter ?? '') && !/\p{L}/u.test(previousCharacter ?? '')) return false
  if (/[A-Za-z]/u.test(previousCharacter ?? '') && /[A-Za-z]/u.test(nextCharacter ?? '')) return false
  const precedingWord = input.slice(0, index).match(/([A-Za-z][A-Za-z.]*)$/u)?.[1]
  const followingWord = input.slice(index + 1).match(/^\s+([A-Za-z]+)/u)?.[1]
  const nextNonWhitespace = input.slice(index + 1).match(/^\s*(.)/u)?.[1]
  if (nextNonWhitespace === undefined) return true
  const normalizedWord = precedingWord?.toLowerCase()
  if (normalizedWord && /^[a-z](?:\.[a-z])+$/u.test(normalizedWord)) {
    return followingWord !== undefined
      && REFERENCE_SENTENCE_STARTERS.has(followingWord.toLowerCase())
  }
  if (normalizedWord && followingWord && /[A-Z]/u.test(followingWord)
    && REFERENCE_TITLE_ABBREVIATIONS.has(normalizedWord)) return false
  if (normalizedWord && REFERENCE_INLINE_ABBREVIATIONS.has(normalizedWord)
    && (nextNonWhitespace === ',' || /^[a-z]/u.test(followingWord ?? '') || /\d/u.test(nextNonWhitespace))) {
    return false
  }
  return true
}

export function countReferenceSentences(input: string): number {
  let sentenceCount = 0
  for (let index = 0; index < input.length; index += 1) {
    if (isReferenceSentenceBoundary(input, index, false)) sentenceCount += 1
  }
  return sentenceCount
}

function hasAffirmativeReferenceCue(
  input: string,
  cue: RegExp,
  startScope: ReferenceCueStartScope = 'any',
): boolean {
  const flags = cue.flags.includes('g') ? cue.flags : cue.flags + 'g'
  const matcher = new RegExp(cue.source, flags)
  const clauseBoundaries = Array.from(input.matchAll(REFERENCE_AUDIO_CUE_CLAUSE_BOUNDARY))
  for (const match of input.matchAll(matcher)) {
    if (match.index === undefined) continue
    const matchIndex = match.index
    const cueEnd = matchIndex + match[0].length
    const lastClauseBoundary = clauseBoundaries.filter((boundary) => (
      boundary.index !== undefined && boundary.index + boundary[0].length <= matchIndex
    )).at(-1)
    const nextClauseBoundary = clauseBoundaries.find((boundary) => (
      boundary.index !== undefined && boundary.index >= cueEnd
    ))
    const localClause = input.slice(
      lastClauseBoundary?.index === undefined ? 0 : lastClauseBoundary.index + lastClauseBoundary[0].length,
      nextClauseBoundary?.index,
    )
    const cuePrefix = input.slice(
      startScope === 'input'
        ? 0
        : lastClauseBoundary?.index === undefined
          ? 0
          : lastClauseBoundary.index + lastClauseBoundary[0].length,
      matchIndex,
    )
    if (startScope !== 'any' && /[\p{L}\p{N}]/u.test(cuePrefix)) continue
    const normalizedClause = localClause.replace(/\bnot\s+only\b/giu, '')
    if (!REFERENCE_AUDIO_CUE_NEGATION.test(normalizedClause)) return true
  }
  return false
}

export function hasReferenceAudioAnaphoricBridge(input: string): boolean {
  return hasAffirmativeReferenceCue(input, REFERENCE_AUDIO_ANAPHORIC_BRIDGE)
}

function hasAffirmativeSpeakerToAudioSequence(
  input: string,
  firstCueStartScope: Exclude<ReferenceCueStartScope, 'any'>,
): boolean {
  const priorAudioReferences = Array.from(input.matchAll(MEDIA_REFERENCE))
    .filter((reference) => reference[1] === 'Audio' && reference.index !== undefined)
  let cursor = 0
  let previousAudioWasAffirmative = false
  let isFirstAudio = true
  for (const reference of priorAudioReferences) {
    if (reference.index === undefined) continue
    const referenceIndex = reference.index
    const association = input.slice(cursor, referenceIndex)
    previousAudioWasAffirmative = hasAffirmativeReferenceCue(
      association,
      REFERENCE_SPEAKER_TO_AUDIO_CUE,
      isFirstAudio ? firstCueStartScope : 'clause',
    ) || (previousAudioWasAffirmative && REFERENCE_AUDIO_POSITIVE_CONTINUATION.test(association))
    cursor = referenceIndex + reference[0].length
    isFirstAudio = false
  }
  const targetAssociation = input.slice(cursor)
  return hasAffirmativeReferenceCue(
    targetAssociation,
    REFERENCE_SPEAKER_TO_AUDIO_CUE,
    isFirstAudio ? firstCueStartScope : 'clause',
  ) || (previousAudioWasAffirmative && REFERENCE_AUDIO_POSITIVE_CONTINUATION.test(targetAssociation))
}

function hasReferenceVocalAudioPurpose(association: string, suffix: string): boolean {
  return REFERENCE_AUDIO_VOCAL_ATTRIBUTE.test(association)
    || REFERENCE_AUDIO_COMPACT_SUFFIX.test(suffix)
}

function hasReferenceAudioSubjectShift(association: string): boolean {
  for (const relative of association.matchAll(REFERENCE_AUDIO_RELATIVE_SUBJECT)) {
    if (relative.index !== undefined && /[\p{L}\p{N}]/u.test(association.slice(0, relative.index))) return true
  }
  for (const relative of association.matchAll(REFERENCE_AUDIO_WHOSE)) {
    if (relative.index === undefined) continue
    const prefix = association.slice(0, relative.index)
    const suffix = association.slice(relative.index + relative[0].length)
    if (/[\p{L}\p{N}]/u.test(prefix) || !REFERENCE_AUDIO_ATTRIBUTE_START.test(suffix)) return true
  }
  return false
}

export function hasReferenceSingleAudioPair(input: {
  readonly context: string
  readonly ownerStart: number
  readonly ownerEnd: number
  readonly referenceStart: number
  readonly referenceEnd: number
}): boolean {
  if (input.referenceStart >= input.ownerEnd) {
    const association = input.context.slice(input.ownerEnd, input.referenceStart)
    const ownerAssociation = association.replace(REFERENCE_LEADING_OWNER_RELATIVE, '$1')
    return findLastReferenceSentenceBoundary(association) < 0
      && !hasReferenceAudioSubjectShift(association)
      && hasReferenceVocalAudioPurpose(ownerAssociation, input.context.slice(input.referenceEnd))
      && hasAffirmativeSpeakerToAudioSequence(ownerAssociation, 'clause')
  }
  const beforeReference = input.context.slice(0, input.referenceStart)
  const afterReference = input.context.slice(input.referenceEnd, input.ownerStart)
  const afterReferenceToDialogue = input.context.slice(input.referenceEnd)
  const lastBoundaryBeforeReference = findLastReferenceSentenceBoundary(beforeReference)
  const leadingAssociation = beforeReference.slice(lastBoundaryBeforeReference + 1)
  const lastBoundaryAfterReference = findLastReferenceSentenceBoundary(afterReferenceToDialogue)
  if (lastBoundaryAfterReference >= 0) {
    const continuation = afterReferenceToDialogue.slice(lastBoundaryAfterReference + 1)
    const ownerOffset = input.ownerStart - input.referenceEnd
    const ownerGap = afterReferenceToDialogue.slice(lastBoundaryAfterReference + 1, ownerOffset)
    return hasAffirmativeSpeakerToAudioSequence(leadingAssociation, 'input')
      && REFERENCE_LEADING_AUDIO_OWNER_GAP.test(ownerGap)
      && hasReferenceVocalAudioPurpose(leadingAssociation + ownerGap, input.context.slice(input.referenceEnd))
      && hasAffirmativeReferenceCue(continuation, REFERENCE_AUDIO_ANAPHORIC_BRIDGE)
  }
  return (
    hasAffirmativeSpeakerToAudioSequence(leadingAssociation, 'input')
      && REFERENCE_LEADING_AUDIO_OWNER_GAP.test(afterReference)
      && hasReferenceVocalAudioPurpose(leadingAssociation + afterReference, input.context.slice(input.referenceEnd))
  ) || (
    !hasReferenceAudioSubjectShift(afterReference)
      && hasReferenceVocalAudioPurpose(afterReference, input.context.slice(input.referenceEnd))
      && hasAffirmativeReferenceCue(afterReference, REFERENCE_AUDIO_TO_SPEAKER_CUE)
  )
}

export function hasReferenceUnboundAudioApplication(
  input: string,
  audioToken: string,
  allowDiegeticPlayback: boolean,
  playbackSubjectNumbers: ReadonlySet<number>,
): boolean {
  if (REFERENCE_AUDIENCE_MUSIC_CONTEXT.test(input)) return false
  let cursor = 0
  while (cursor < input.length) {
    const referenceStart = input.indexOf(audioToken, cursor)
    if (referenceStart < 0) return false
    const referenceEnd = referenceStart + audioToken.length
    const sentenceStart = findLastReferenceSentenceBoundary(input.slice(0, referenceStart)) + 1
    let sentenceEnd = input.length
    for (let index = referenceEnd; index < input.length; index += 1) {
      if (isReferenceSentenceBoundary(input, index)) {
        sentenceEnd = index
        break
      }
    }
    const beforeReference = input.slice(sentenceStart, referenceStart)
    const afterReference = input.slice(referenceEnd, sentenceEnd)
    const lastSourceBoundary = Array.from(beforeReference.matchAll(REFERENCE_AUDIO_CUE_CLAUSE_BOUNDARY)).at(-1)
    const sourceAssociation = beforeReference.slice(
      lastSourceBoundary?.index === undefined ? 0 : lastSourceBoundary.index + lastSourceBoundary[0].length,
    )
    const normalizedAfterReference = afterReference.replace(REFERENCE_AUDIO_NON_NEGATING_WITHOUT, '')
    const audienceMusicSource = REFERENCE_UNBOUND_AUDIO_AUDIENCE_MUSIC_SOURCE.test(sourceAssociation)
    if (
      !REFERENCE_UNBOUND_AUDIO_AUDIBILITY_DENIAL.test(afterReference)
      && !REFERENCE_UNBOUND_AUDIO_NON_AUDIBLE_DIRECT_CUE.test(afterReference)
      && !REFERENCE_UNBOUND_AUDIO_AUDIENCE_MUSIC_DIRECT_CUE.test(afterReference)
      && !REFERENCE_UNBOUND_AUDIO_AUDIENCE_MUSIC_DESTINATION.test(afterReference)
      && (
        (
          !audienceMusicSource
          && hasAffirmativeReferenceCue(sourceAssociation, REFERENCE_UNBOUND_AUDIO_SOURCE_CUE, 'input')
          && hasAffirmativeReferenceCue(normalizedAfterReference, REFERENCE_UNBOUND_AUDIO_SOURCE_EFFECT)
        )
        || (
          !audienceMusicSource
          && !REFERENCE_UNBOUND_AUDIO_NEGATED_PREFIX.test(beforeReference)
          && hasAffirmativeReferenceCue(normalizedAfterReference, REFERENCE_UNBOUND_AUDIO_DIRECT_CUE)
        )
        || (
          allowDiegeticPlayback
          && !REFERENCE_AUDIO_CUE_NEGATION.test(sourceAssociation)
          && hasReferenceDiegeticAudioSource(sourceAssociation, playbackSubjectNumbers)
          && REFERENCE_UNBOUND_AUDIO_DIEGETIC_EFFECT.test(normalizedAfterReference)
        )
      )
    ) return true
    cursor = referenceEnd
  }
  return false
}

function hasReferenceDiegeticAudioSource(
  input: string,
  playbackSubjectNumbers: ReadonlySet<number>,
): boolean {
  const subjectNumber = Number(REFERENCE_UNBOUND_AUDIO_DIEGETIC_SOURCE_CUE.exec(
    input.replace(REFERENCE_DIEGETIC_LEADING_METADATA, ''),
  )?.[1])
  return Number.isSafeInteger(subjectNumber) && playbackSubjectNumbers.has(subjectNumber)
}

export function hasReferenceCompoundAudioPair(input: {
  readonly context: string
  readonly ownerStart: number
  readonly ownerEnd: number
  readonly binding: H3ReferenceAudioBinding
}): boolean {
  const withoutOwner = input.context.slice(0, input.ownerStart)
    + ' '.repeat(input.ownerEnd - input.ownerStart)
    + input.context.slice(input.ownerEnd)
  const tokens = Array.from(withoutOwner.matchAll(/\bS(\d+)\b|<Audio\s+(\d+)>/gu))
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    if (token.index === undefined) continue
    const tokenSpeaker = token[1] === undefined ? null : Number(token[1])
    const tokenAudio = token[2] === undefined ? null : Number(token[2])
    if (tokenSpeaker === input.binding.speakerNumber) {
      for (let audioIndex = index + 1; audioIndex < tokens.length; audioIndex += 1) {
        const audioToken = tokens[audioIndex]!
        if (audioToken[1] !== undefined || audioToken.index === undefined) break
        if (Number(audioToken[2]) !== input.binding.audioNumber) continue
        const association = withoutOwner.slice(token.index + token[0].length, audioToken.index)
        const ownerAssociation = association.replace(REFERENCE_LEADING_OWNER_RELATIVE, '$1')
        if (
          findLastReferenceSentenceBoundary(association) < 0
          && !hasReferenceAudioSubjectShift(association)
          && hasReferenceVocalAudioPurpose(ownerAssociation, withoutOwner.slice(audioToken.index + audioToken[0].length))
          && hasAffirmativeSpeakerToAudioSequence(ownerAssociation, 'clause')
        ) return true
      }
    }
    const next = tokens[index + 1]
    if (
      tokenAudio === input.binding.audioNumber
      && next?.[1] !== undefined
      && Number(next[1]) === input.binding.speakerNumber
      && next.index !== undefined
    ) {
      const association = withoutOwner.slice(token.index + token[0].length, next.index)
      if (
        findLastReferenceSentenceBoundary(association) < 0
        && !hasReferenceAudioSubjectShift(association)
        && hasReferenceVocalAudioPurpose(association, withoutOwner.slice(token.index + token[0].length))
        && hasAffirmativeReferenceCue(association, REFERENCE_AUDIO_TO_SPEAKER_CUE)
      ) return true
    }
  }
  return false
}
