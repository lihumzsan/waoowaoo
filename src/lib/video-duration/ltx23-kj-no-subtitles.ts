const CHINESE_LITERAL_SPEECH_PATTERN = /(说(?:道|着|出)?|开口(?:说(?:道|着|出)?)?|问(?:道)?|回答(?:道)?|喊(?:道)?|低声(?:说(?:道)?)?|耳语|发言|念(?:道)?|唱(?:道)?)(\s*)[：:,，]?\s*[“「『"]([^”」』"\r\n]+)[”」』"]/gu

const ENGLISH_LITERAL_SPEECH_PATTERN = /\b(says?|speaks?|asks?|answers?|replies?|shouts?|whispers?|utters?|sings?)(\s+(?:softly|quietly|calmly|aloud))?\s*[,：:]?\s*["“]([^"”\r\n]+)["”]/giu

const ENGLISH_EMPTY_SPEECH_PATTERN = /\b(says?|speaks?|asks?|answers?|replies?|shouts?|whispers?|utters?|sings?)(\s+(?:softly|quietly|calmly|aloud))?\s*[,：:]?\s*["“]\s*["”]/giu

const ENGLISH_QUOTE_BEFORE_SPEAKER_PATTERN = /["“][^"”\r\n]+["”][,，]?\s+((?:the\s+)?[a-z][a-z' -]{0,40}\s+)?(says?|speaks?|asks?|answers?|replies?|shouts?|whispers?|utters?|sings?)\b/giu

const ENGLISH_UNQUOTED_MOUTHING_PATTERN = /\b(mouths|lip[-\s]?syncs?)(?:\s+the\s+words?)?\s+.+?(?=\s+(?:while|and)\b|[,，。.!?；;\r\n]|$)/giu

const ENGLISH_EXACT_TRANSCRIPT_PATTERN = /\b(?:the\s+)?(?:spoken\s+dialogue|spoken\s+words?|exact\s+transcript)\s+must\s+[^.!?\r\n]*(?:["“][^"”\r\n]+["”])[^.!?\r\n]*[.!?]?/giu

const CHINESE_TEXT_ARTIFACT_PROHIBITION_PATTERN = /(?:不要|不得|禁止|避免|切勿)[^。；;\r\n]*(?:字幕|标题|文字叠加|文本叠加|可读文字|可读文本|水印|中文字符|英文字符|对白文字|台词文字)[^。；;\r\n]*[。；;]?/gu

const ENGLISH_TEXT_ARTIFACT_PROHIBITION_PATTERN = /\b(?:do\s+not|don't|never|avoid|without)\b[^.!?;\r\n]*(?:subtitles?|captions?|closed\s+captions?|burned-in\s+text|text\s+overlays?|readable\s+text|watermarks?|Chinese\s+characters?|English\s+letters?|dialogue\s+text|speech\s+text)[^.!?;\r\n]*[.!?;]?/giu

const DIALOGUE_METADATA_LINE_PATTERN = /^\s*(?:subtitle\s*\/\s*dialogue\s+in\s+panel|dialogue\s+lines?)\s*:/iu
const KNOWN_DIALOGUE_CONTEXT_LINE_PATTERN = /^(\s*(?:source\s+text|creator\s+prompt\s+intent)\s*:\s*)(.*)$/iu

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function redactKnownDialogue(value: string, knownDialogue: readonly string[]): string {
  return knownDialogue.reduce((result, dialogue) => {
    const trimmed = dialogue.trim().replace(/\s+/gu, ' ')
    if (!trimmed) return result
    const literalPattern = trimmed
      .split(/\s+/u)
      .map((part) => escapeRegExp(part))
      .join('\\s+')
    const englishSpeechPattern = new RegExp(
      `\\b(says?|speaks?|asks?|answers?|replies?|shouts?|whispers?|utters?|sings?|mouths)\\b(\\s+(?:softly|quietly|calmly|aloud))?(?:\\s*[,：:]\\s*|\\s+)["“]?${literalPattern}["”]?`,
      'giu',
    )
    const chineseSpeechPattern = new RegExp(
      `(说(?:道|着|出)?|开口(?:说(?:道|着|出)?)?|问(?:道)?|回答(?:道)?|喊(?:道)?|低声(?:说(?:道)?)?|耳语|发言|念(?:道)?|唱(?:道)?)\\s*[：:,，]?\\s*[“「『"]?${literalPattern}[”」』"]?`,
      'gu',
    )

    return result
      .replace(
        englishSpeechPattern,
        (_match, verb: string, modifier: string | undefined) => (
          `${verb}${modifier ?? ''} naturally with rhythmic lip movement`
        ),
      )
      .replace(
        chineseSpeechPattern,
        (_match, verb: string) => `${verb}并自然呈现说话动作，嘴唇有节奏地开合`,
      )
  }, value)
}

function redactKnownDialogueFromContextValue(
  value: string,
  knownDialogue: readonly string[],
): string {
  return knownDialogue.reduce((result, dialogue) => {
    const trimmed = dialogue.trim().replace(/\s+/gu, ' ')
    if (!trimmed) return result
    const isSingleHanCharacter = /^\p{Script=Han}$/u.test(trimmed)
    if (isSingleHanCharacter) {
      const comparable = result
        .replace(/^.{1,40}[：:]/u, '')
        .replace(/^[\s"“「『]+|[\s"”」』.,，。!?！？]+$/gu, '')
      return comparable === trimmed ? '' : result
    }

    const literalPattern = trimmed
      .split(/\s+/u)
      .map((part) => escapeRegExp(part))
      .join('\\s+')
    return result.replace(
      new RegExp(`(^|[^\\p{L}\\p{N}_])${literalPattern}(?=$|[^\\p{L}\\p{N}_])`, 'giu'),
      '$1',
    )
  }, value)
}

function redactDialogueMetadataLines(value: string, knownDialogue: readonly string[]): string {
  return value
    .split(/\r?\n/u)
    .map((line) => {
      if (DIALOGUE_METADATA_LINE_PATTERN.test(line)) return ''
      const contextMatch = line.match(KNOWN_DIALOGUE_CONTEXT_LINE_PATTERN)
      if (!contextMatch) return line
      const redactedValue = redactKnownDialogueFromContextValue(contextMatch[2] ?? '', knownDialogue)
        .replace(/\s+/gu, ' ')
        .trim()
      return redactedValue ? `${contextMatch[1]}${redactedValue}` : ''
    })
    .join('\n')
}

function normalizeSanitizedPrompt(value: string): string {
  return value
    .split(/\r?\n/u)
    .map((line) => line
      .replace(/[ \t]+/gu, ' ')
      .replace(/\s+([,，。.!?；;])/gu, '$1')
      .trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

/**
 * Keeps PromptRelay timing and visible acting directions while removing text
 * that can encourage KJ LTX2.3 to render dialogue or subtitle-like glyphs.
 */
export function sanitizeLtx23KjNoSubtitlesPrompt(
  value: string,
  knownDialogue: readonly string[] = [],
): string {
  const performanceOnly = value
    .replace(
      ENGLISH_QUOTE_BEFORE_SPEAKER_PATTERN,
      (_match, subject: string | undefined, verb: string) => (
        `${subject ?? ''}${verb} naturally with rhythmic lip movement`
      ),
    )
    .replace(
      ENGLISH_UNQUOTED_MOUTHING_PATTERN,
      (_match, verb: string) => `${verb} naturally with rhythmic lip movement`,
    )

  const sanitized = redactKnownDialogue(redactDialogueMetadataLines(performanceOnly, knownDialogue), knownDialogue)
    .replace(ENGLISH_EXACT_TRANSCRIPT_PATTERN, '')
    .replace(
      CHINESE_LITERAL_SPEECH_PATTERN,
      (_match, verb: string) => `${verb}并自然呈现说话动作，嘴唇有节奏地开合`,
    )
    .replace(
      ENGLISH_LITERAL_SPEECH_PATTERN,
      (_match, verb: string, modifier: string | undefined) => (
        `${verb}${modifier ?? ''} naturally with rhythmic lip movement`
      ),
    )
    .replace(
      ENGLISH_EMPTY_SPEECH_PATTERN,
      (_match, verb: string, modifier: string | undefined) => (
        `${verb}${modifier ?? ''} naturally with rhythmic lip movement`
      ),
    )
    .replace(CHINESE_TEXT_ARTIFACT_PROHIBITION_PATTERN, '')
    .replace(ENGLISH_TEXT_ARTIFACT_PROHIBITION_PATTERN, '')
    .replace(/["“]\s*["”]/gu, '')

  return normalizeSanitizedPrompt(sanitized)
}
