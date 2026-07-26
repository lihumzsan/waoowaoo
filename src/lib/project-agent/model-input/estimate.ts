import type { AgentInputItem } from '@openai/agents'

/**
 * Token estimation for context budgeting.
 *
 * The legacy estimator divided character count by four, an English-text
 * figure. This product's context is predominantly Chinese, where a character
 * is roughly a token, so that rule underestimated real usage by more than
 * double — and it was the number a budget was being compared against.
 *
 * These estimates never decide correctness on their own. They pick when to
 * shed context; the provider's reported token count is the authority for what
 * actually happened, and the budget keeps headroom for the gap.
 */
export type ProjectAgentTextMeasurement = {
  readonly chars: number
  readonly cjkChars: number
}

const CJK_CHAR_PATTERN = /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/u

const EMPTY_MEASUREMENT: ProjectAgentTextMeasurement = { chars: 0, cjkChars: 0 }

/** Latin script averages about four characters per token. */
const LATIN_CHARS_PER_TOKEN = 4

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function collectStrings(value: unknown, sink: string[]): void {
  if (typeof value === 'string') {
    sink.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, sink)
    return
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) collectStrings(item, sink)
  }
}

export function measureProjectAgentText(value: string): ProjectAgentTextMeasurement {
  let cjkChars = 0
  for (const char of value) {
    if (CJK_CHAR_PATTERN.test(char)) cjkChars += 1
  }
  return { chars: value.length, cjkChars }
}

export function mergeProjectAgentMeasurements(
  measurements: readonly ProjectAgentTextMeasurement[],
): ProjectAgentTextMeasurement {
  return measurements.reduce<ProjectAgentTextMeasurement>((total, measurement) => ({
    chars: total.chars + measurement.chars,
    cjkChars: total.cjkChars + measurement.cjkChars,
  }), EMPTY_MEASUREMENT)
}

export function measureProjectAgentUnknown(value: unknown): ProjectAgentTextMeasurement {
  const strings: string[] = []
  collectStrings(value, strings)
  return mergeProjectAgentMeasurements(strings.map((text) => measureProjectAgentText(text)))
}

export function measureProjectAgentInputItems(
  items: readonly AgentInputItem[],
): ProjectAgentTextMeasurement {
  return measureProjectAgentUnknown(items)
}

export function estimateProjectAgentTokens(measurement: ProjectAgentTextMeasurement): number {
  const latinChars = Math.max(0, measurement.chars - measurement.cjkChars)
  return measurement.cjkChars + Math.ceil(latinChars / LATIN_CHARS_PER_TOKEN)
}

export function estimateProjectAgentTextTokens(value: string): number {
  return estimateProjectAgentTokens(measureProjectAgentText(value))
}

export function estimateProjectAgentUnknownTokens(value: unknown): number {
  return estimateProjectAgentTokens(measureProjectAgentUnknown(value))
}
