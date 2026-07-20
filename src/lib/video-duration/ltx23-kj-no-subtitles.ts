const CHINESE_LITERAL_SPEECH_PATTERN = /(说(?:道|着|出)?|开口(?:说(?:道|着|出)?)?|问(?:道)?|回答(?:道)?|喊(?:道)?|低声(?:说(?:道)?)?|耳语|发言|念(?:道)?|唱(?:道)?)(\s*)[：:,，]?\s*[“「『"]([^”」』"\r\n]+)[”」』"]/gu

const ENGLISH_LITERAL_SPEECH_PATTERN = /\b(says?|speaks?|asks?|answers?|replies?|shouts?|whispers?|utters?|sings?)(\s+(?:softly|quietly|calmly|aloud))?\s*[,：:]?\s*["“]([^"”\r\n]+)["”]/giu

const ENGLISH_EXACT_TRANSCRIPT_PATTERN = /\b(?:the\s+)?(?:spoken\s+dialogue|spoken\s+words?|exact\s+transcript)\s+must\s+[^.!?\r\n]*(?:["“][^"”\r\n]+["”])[^.!?\r\n]*[.!?]?/giu

const CHINESE_TEXT_ARTIFACT_PROHIBITION_PATTERN = /(?:不要|不得|禁止|避免|切勿)[^。；;\r\n]*(?:字幕|标题|文字叠加|文本叠加|可读文字|可读文本|水印|中文字符|英文字符|对白文字|台词文字)[^。；;\r\n]*[。；;]?/gu

const ENGLISH_TEXT_ARTIFACT_PROHIBITION_PATTERN = /\b(?:do\s+not|don't|never|avoid|without)\b[^.!?;\r\n]*(?:subtitles?|captions?|closed\s+captions?|burned-in\s+text|text\s+overlays?|readable\s+text|watermarks?|Chinese\s+characters?|English\s+letters?|dialogue\s+text|speech\s+text)[^.!?;\r\n]*[.!?;]?/giu

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
export function sanitizeLtx23KjNoSubtitlesPrompt(value: string): string {
  const sanitized = value
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
    .replace(CHINESE_TEXT_ARTIFACT_PROHIBITION_PATTERN, '')
    .replace(ENGLISH_TEXT_ARTIFACT_PROHIBITION_PATTERN, '')

  return normalizeSanitizedPrompt(sanitized)
}
