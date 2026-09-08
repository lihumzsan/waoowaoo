import { findLastReferenceSentenceBoundary } from './h3-reference-audio'

const REFERENCE_DIALOGUE_TAG = /<\/?d>/gu
const REFERENCE_DIALOGUE_CUTOFF_TAG = /<cutoff>/gu
const REFERENCE_VISIBLE_TEXT_LITERAL = /\breading\s+"(?:\\.|[^"\\\r\n])*"/giu
const REFERENCE_READING_ALOUD = /\breading\s+"(?:\\.|[^"\\\r\n])*"\s+(?:aloud|out\s+loud)\b/iu
const REFERENCE_PROTOCOL_QUOTED_LITERAL = /"(?:\\.|[^"\\\r\n])*"|“[^”\r\n]*”/gu
const REFERENCE_UNSUPPORTED_QUOTE = /["“”]/u
const DIALOGUE_LANGUAGE_PREFIX = /^\[[^\]\r\n]+\]\s*/u
const REFERENCE_DIALOGUE_CONTENT_MARKER = /<(?:cutoff|scenetrans)>/gu
const REFERENCE_DIALOGUE_SCENETRANS_TAG = /<scenetrans>/gu
const REFERENCE_DIALOGUE_TERMINAL_PUNCTUATION = /[.!?。！？](?=(?:["”]\s*)?(?:<scenetrans>\s*)*$)/u
const REFERENCE_DIALOGUE_CONTINUITY = /(?:(?:(?:the|this|that|same|his|her|their)\s+){0,3}(?:dialogue|lyrics?|speech|voice|vocals?)|<Audio\s+\d+>)\s+(?:continues?\s+(?:seamlessly\s+across\s+the\s+cut|uninterrupted\s+into\s+the\s+next\s+shot)|carries?\s+over\s+from\s+the\s+previous\s+shot|remains?\s+audible\s+across\s+the\s+transition)\b/iu
const REFERENCE_VOCAL_EVENT_BOUNDARY = /;|\[Shot\s+\d+\]|\bAt\s+\d{2}:\d{2}\.\d{3},?/gu
const SHOT_MARKER = /\[Shot (\d+)\]/gu
const SHOT_TRANSITION = /^\[Shot (\d+)\] At (\d{2}):(\d{2}\.\d{3}), the camera (?:cuts|dissolves|fades|wipes)\b/u
const REFERENCE_VISIBLE_TEXT_DIRECT_CARRIER = /^(?:(?:a|an|the|this|that|these|those|his|her|its|their|our|your)\s+)?((?:[\p{L}\p{N}][\p{L}\p{N}'’-]*\s+){0,4})(?:banners?|labels?|signs?|subtitles?|texts?)\s*$/iu
const REFERENCE_VISIBLE_TEXT_NON_MODIFIER = /\b(?:a|an|and|are|as|at|beside|by|carries|carry|displays?|for|from|has|have|he|her|his|holds?|i|in|is|it|its|looks?|moves?|near|of|on|or|our|over|points?|reads?|she|sits?|stands?|that|the|their|these|they|this|those|to|under|walks?|was|we|wears?|were|which|while|who|whose|with|without|you|your)\b/iu
const REFERENCE_VISIBLE_TEXT_EXPLICIT_CARRIER = /\b(?:bears?|bearing|contains?|containing|displays?|displaying|has|shows?|showing|with)\s+(?:clearly\s+)?(?:visible|on-screen)\s+text\s*$/iu
const REFERENCE_LEADING_SHOT_METADATA = /^\s*\[Shot\s+\d+\](?:\s+At\s+\d{2}:\d{2}\.\d{3},?)?\s*/iu
const REFERENCE_LEADING_STYLE_TRANSITION = /^\s*(?:(?:then|next),?\s+|(?:the\s+)?(?:camera|shot)\s+(?:cuts?|transitions?|changes?|switches?)\s+to\s+)/iu

export type H3ReferenceDialogueBlock = {
  readonly start: number
  readonly end: number
  readonly content: string
}

export type H3ReferenceDialogueEvent = {
  readonly speakerContext: string
}

function invalid(reason: string): Error {
  return new Error('VIDEO_PROMPT_PROFILE_INVALID:' + reason)
}

function maskReferenceProtocolQuotedLiterals(input: string): string {
  return input.replace(
    REFERENCE_PROTOCOL_QUOTED_LITERAL,
    (literal) => ' '.repeat(literal.length),
  )
}

export function parseReferenceDialogueBlocks(
  input: string,
): readonly H3ReferenceDialogueBlock[] {
  const protocolInput = maskReferenceProtocolQuotedLiterals(input)
  const blocks: H3ReferenceDialogueBlock[] = []
  let totalCutoffCount = 0
  let cutoffBlockIndex: number | null = null
  let opening: { readonly index: number; readonly length: number } | null = null
  for (const tag of protocolInput.matchAll(REFERENCE_DIALOGUE_TAG)) {
    if (tag.index === undefined) throw invalid('REFERENCE_DIALOGUE_TAG_INVALID')
    if (tag[0] === '<d>') {
      if (opening !== null) throw invalid('REFERENCE_DIALOGUE_TAG_INVALID')
      opening = { index: tag.index, length: tag[0].length }
      continue
    }
    if (opening === null) throw invalid('REFERENCE_DIALOGUE_TAG_INVALID')
    const contentStart = opening.index + opening.length
    const content = input.slice(contentStart, tag.index)
    const protocolContent = protocolInput.slice(contentStart, tag.index)
    const cutoffTags = Array.from(protocolContent.matchAll(REFERENCE_DIALOGUE_CUTOFF_TAG))
    const dialogueText = normalizeReferenceDialoguePayload(content)
    if (
      !DIALOGUE_LANGUAGE_PREFIX.test(content)
      || !/[\p{L}\p{N}]/u.test(dialogueText)
      || (
        cutoffTags.length === 0
        && !/<scenetrans>\s*$/u.test(content)
        && !REFERENCE_DIALOGUE_TERMINAL_PUNCTUATION.test(content)
      )
    ) throw invalid('REFERENCE_DIALOGUE_CONTENT_INVALID')
    const cutoffTrailingContent = cutoffTags.length === 1 && cutoffTags[0]?.index !== undefined
      ? content.slice(cutoffTags[0].index + cutoffTags[0][0].length).trim()
      : ''
    totalCutoffCount += cutoffTags.length
    if (
      cutoffTags.length > 1
      || totalCutoffCount > 1
      || (cutoffTags.length === 1 && cutoffTrailingContent.length > 0)
    ) throw invalid('REFERENCE_DIALOGUE_CUTOFF_INVALID')
    if (cutoffTags.length === 1) cutoffBlockIndex = blocks.length
    blocks.push({
      start: opening.index,
      end: tag.index + tag[0].length,
      content,
    })
    opening = null
  }
  if (opening !== null) throw invalid('REFERENCE_DIALOGUE_TAG_INVALID')
  if (totalCutoffCount === 1) {
    const cutoffBlock = cutoffBlockIndex === null ? undefined : blocks[cutoffBlockIndex]
    const trailingContent = cutoffBlock ? input.slice(cutoffBlock.end).trim() : ''
    if (
      cutoffBlockIndex === null
      || cutoffBlockIndex !== blocks.length - 1
      || !/^[.!?。！？]*$/u.test(trailingContent)
    ) throw invalid('REFERENCE_DIALOGUE_CUTOFF_INVALID')
  }
  return blocks
}

export function normalizeReferenceDialoguePayload(content: string): string {
  return content
    .replace(DIALOGUE_LANGUAGE_PREFIX, '')
    .replace(REFERENCE_DIALOGUE_CONTENT_MARKER, '')
    .trim()
}

export function maskReferenceDialogueBlocks(
  input: string,
  blocks: readonly H3ReferenceDialogueBlock[],
): string {
  let cursor = 0
  let masked = ''
  for (const block of blocks) {
    masked += input.slice(cursor, block.start)
    const maskedBlock = Array<string>(block.end - block.start).fill(' ')
    const terminalPunctuation = REFERENCE_DIALOGUE_TERMINAL_PUNCTUATION.exec(block.content)
    if (terminalPunctuation?.index !== undefined) {
      maskedBlock['<d>'.length + terminalPunctuation.index] = terminalPunctuation[0]
    }
    masked += maskedBlock.join('')
    cursor = block.end
  }
  return masked + input.slice(cursor)
}

function maskReferenceVisibleTextSyntax(input: string): string {
  let masked = input
  for (const literal of input.matchAll(REFERENCE_VISIBLE_TEXT_LITERAL)) {
    if (literal.index === undefined || !hasReferenceVisibleTextCarrier(input, literal.index)) continue
    masked = masked.slice(0, literal.index)
      + ' '.repeat(literal[0].length)
      + masked.slice(literal.index + literal[0].length)
  }
  return masked
}

function hasReferenceVisibleTextCarrier(input: string, readingIndex: number): boolean {
  const prefix = input.slice(Math.max(0, readingIndex - 240), readingIndex)
  if (REFERENCE_VISIBLE_TEXT_EXPLICIT_CARRIER.test(prefix)) return true
  const lastSentenceBoundary = findLastReferenceSentenceBoundary(prefix)
  let clause = prefix.slice(lastSentenceBoundary + 1).trimStart()
    .replace(REFERENCE_LEADING_SHOT_METADATA, '')
  while (REFERENCE_LEADING_STYLE_TRANSITION.test(clause)) {
    clause = clause.replace(REFERENCE_LEADING_STYLE_TRANSITION, '')
  }
  const directCarrier = REFERENCE_VISIBLE_TEXT_DIRECT_CARRIER.exec(clause)
  return directCarrier !== null
    && !REFERENCE_VISIBLE_TEXT_NON_MODIFIER.test(directCarrier[1] ?? '')
}

export function maskReferenceVisibleTextLiterals(input: string): string {
  if (REFERENCE_READING_ALOUD.test(input)) throw invalid('REFERENCE_QUOTED_TEXT_CONTEXT_INVALID')
  const masked = maskReferenceVisibleTextSyntax(input)
  if (REFERENCE_UNSUPPORTED_QUOTE.test(masked)) {
    throw invalid('REFERENCE_QUOTED_TEXT_CONTEXT_INVALID')
  }
  return masked
}

export function assertReferenceDialogueTransitions(
  input: string,
  blocks: readonly H3ReferenceDialogueBlock[],
): void {
  const transitions = blocks.map((block) => {
    const dialogueText = block.content.replace(DIALOGUE_LANGUAGE_PREFIX, '').trim()
    const markerCount = Array.from(dialogueText.matchAll(REFERENCE_DIALOGUE_SCENETRANS_TAG)).length
    const leading = /^<scenetrans>/u.test(dialogueText)
    const trailing = /<scenetrans>$/u.test(dialogueText)
    if (markerCount !== Number(leading) + Number(trailing)) {
      throw invalid('REFERENCE_SCENETRANS_INVALID')
    }
    return { leading, trailing }
  })
  for (let index = 0; index < transitions.length; index += 1) {
    const current = transitions[index]!
    const previous = transitions[index - 1]
    const next = transitions[index + 1]
    if (current.leading !== (previous?.trailing ?? false)) throw invalid('REFERENCE_SCENETRANS_INVALID')
    if (current.trailing !== (next?.leading ?? false)) throw invalid('REFERENCE_SCENETRANS_INVALID')
    if (!current.trailing) continue
    const nextBlock = blocks[index + 1]
    if (!nextBlock) throw invalid('REFERENCE_SCENETRANS_INVALID')
    const transitionText = input.slice(blocks[index]!.end, nextBlock.start)
    const audibleTransitionText = maskReferenceVisibleTextLiterals(transitionText)
    const shotMarkers = Array.from(transitionText.matchAll(SHOT_MARKER))
    const shotMarker = shotMarkers[0]
    const shotTransition = shotMarker?.index === undefined
      ? null
      : SHOT_TRANSITION.exec(transitionText.slice(shotMarker.index))
    if (
      shotMarkers.length !== 1
      || shotTransition === null
      || !REFERENCE_DIALOGUE_CONTINUITY.test(audibleTransitionText)
    ) throw invalid('REFERENCE_SCENETRANS_INVALID')
  }
}

export function parseReferenceDialogueEvents(
  input: string,
): readonly H3ReferenceDialogueEvent[] {
  const dialogues = parseReferenceDialogueBlocks(input)
  return dialogues.map((dialogue, index) => {
    const context = maskReferenceVisibleTextLiterals(
      input.slice(dialogues[index - 1]?.end ?? 0, dialogue.start),
    )
    const eventBoundaries = Array.from(context.matchAll(REFERENCE_VOCAL_EVENT_BOUNDARY))
    const lastBoundary = eventBoundaries.at(-1)
    return {
      speakerContext: context.slice(
        lastBoundary?.index === undefined ? 0 : lastBoundary.index + lastBoundary[0].length,
      ),
    }
  })
}
