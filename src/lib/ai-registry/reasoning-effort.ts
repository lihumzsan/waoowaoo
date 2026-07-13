export const REASONING_EFFORT_VALUES = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const

export type ReasoningEffort = (typeof REASONING_EFFORT_VALUES)[number]

export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'high'

const REASONING_EFFORT_SET = new Set<string>(REASONING_EFFORT_VALUES)

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && REASONING_EFFORT_SET.has(value)
}

export function parseReasoningEffort(value: unknown, context: string): ReasoningEffort {
  if (isReasoningEffort(value)) return value
  throw new Error(`REASONING_EFFORT_INVALID:${context}:${String(value)}`)
}
