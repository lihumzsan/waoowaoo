import type { Locale } from '@/i18n/routing'
import type { EditScriptVideoRatio } from './types'

export const EDIT_FIRST_DURATION_TIERS = ['short', 'medium', 'long'] as const
export type EditFirstDurationTier = (typeof EDIT_FIRST_DURATION_TIERS)[number]

export interface EditFirstDurationSpec {
  readonly tier: EditFirstDurationTier
  readonly targetSeconds: number
  readonly minSeconds: number
  readonly maxSeconds: number
  readonly zhLabel: string
  readonly enLabel: string
  readonly zhGuidance: string
  readonly enGuidance: string
}

const EDIT_FIRST_DURATION_SPECS: Record<EditFirstDurationTier, EditFirstDurationSpec> = {
  short: {
    tier: 'short',
    targetSeconds: 30,
    minSeconds: 20,
    maxSeconds: 40,
    zhLabel: '短',
    enLabel: 'Short',
    zhGuidance: '短时长档位，约 30 秒。以紧凑单一事件为主，最终总时长可按叙事自然落在约 20-40 秒，不要机械凑满固定秒数。',
    enGuidance: 'Short duration tier, around 30 seconds. Keep it to one compact event; the final total duration may naturally land around 20-40 seconds instead of mechanically matching an exact second count.',
  },
  medium: {
    tier: 'medium',
    targetSeconds: 60,
    minSeconds: 45,
    maxSeconds: 75,
    zhLabel: '中',
    enLabel: 'Medium',
    zhGuidance: '中时长档位，约 60 秒。允许完整起承转合，最终总时长可按叙事自然落在约 45-75 秒，不要机械凑满固定秒数。',
    enGuidance: 'Medium duration tier, around 60 seconds. Allow a complete beginning, turn, and ending; the final total duration may naturally land around 45-75 seconds instead of mechanically matching an exact second count.',
  },
  long: {
    tier: 'long',
    targetSeconds: 120,
    minSeconds: 90,
    maxSeconds: 120,
    zhLabel: '长',
    enLabel: 'Long',
    zhGuidance: '长时长档位，约 120 秒，硬上限 120 秒。允许更充分铺垫和结尾回响，但最终总时长不得超过 120 秒，不要为了凑时长填充冗余情节。',
    enGuidance: 'Long duration tier, around 120 seconds with a hard 120-second cap. Allow fuller setup and ending resonance, but the final total duration must not exceed 120 seconds and must not add filler just to use time.',
  },
}

const STRUCTURED_PARAMETER_PREFIXES = [
  '短片结构化参数：',
  'Structured short-film parameters:',
] as const

function parseNumberedDurationSeconds(text: string): number | null {
  const normalized = text.trim().toLowerCase()
  if (!normalized) return null

  if (/半分钟/.test(normalized)) return 30
  if (/一分钟/.test(normalized)) return 60
  if (/(两分钟|二分钟)/.test(normalized)) return 120

  const durationMatch = normalized.match(/([0-9]+(?:\.[0-9]+)?)\s*(秒|s|sec|secs|second|seconds|分钟|minute|minutes|min|mins)/i)
  if (!durationMatch) return null
  const rawValue = Number(durationMatch[1])
  if (!Number.isFinite(rawValue) || rawValue <= 0) return null
  const unit = durationMatch[2] ?? ''
  const seconds = /分钟|minute|minutes|min|mins/i.test(unit)
    ? rawValue * 60
    : rawValue
  return Math.round(seconds)
}

function durationSecondsToTier(seconds: number): EditFirstDurationTier | null {
  if (!Number.isInteger(seconds) || seconds <= 0) return null
  if (seconds <= 45) return 'short'
  if (seconds < 90) return 'medium'
  if (seconds <= 120) return 'long'
  return null
}

export function isEditFirstDurationTier(value: unknown): value is EditFirstDurationTier {
  return value === 'short' || value === 'medium' || value === 'long'
}

export function resolveEditFirstDurationSpec(tier: EditFirstDurationTier): EditFirstDurationSpec {
  return EDIT_FIRST_DURATION_SPECS[tier]
}

export function readEditFirstDurationTierFromText(text: string): EditFirstDurationTier | null {
  const normalized = text.trim().toLowerCase()
  if (!normalized) return null

  const structuredMatches = Array.from(normalized.matchAll(/(?:时长档位|duration tier)\s*[:：]?\s*(short|medium|long)\b/g))
  const latestStructured = structuredMatches[structuredMatches.length - 1]?.[1]
  if (isEditFirstDurationTier(latestStructured)) return latestStructured

  if (/(短时长|短档|短版|选短|短一点|short duration|short tier)/i.test(normalized)) return 'short'
  if (/(中时长|中档|中等时长|中等档|选中|medium duration|medium tier)/i.test(normalized)) return 'medium'
  if (/(长时长|长档|长版|选长|长一点|long duration|long tier)/i.test(normalized)) return 'long'

  const seconds = parseNumberedDurationSeconds(normalized)
  return seconds === null ? null : durationSecondsToTier(seconds)
}

export function requireEditFirstDurationSpecFromPrompt(userPrompt: string): EditFirstDurationSpec {
  const tier = readEditFirstDurationTierFromText(userPrompt)
  if (!tier) throw new Error('EDIT_FIRST_DURATION_TIER_REQUIRED')
  return resolveEditFirstDurationSpec(tier)
}

export function stripEditFirstStructuredParameters(text: string): string {
  return text
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      return !STRUCTURED_PARAMETER_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
    })
    .join('\n')
    .trim()
}

export function buildEditFirstStructuredUserPrompt(input: {
  readonly prompt: string
  readonly durationTier: EditFirstDurationTier
  readonly aspectRatio: EditScriptVideoRatio
  readonly locale: Locale
}): string {
  const basePrompt = stripEditFirstStructuredParameters(input.prompt)
  const spec = resolveEditFirstDurationSpec(input.durationTier)
  const structuredLine = input.locale === 'en'
    ? `Structured short-film parameters: duration tier ${spec.tier} (${spec.enLabel}, around ${String(spec.targetSeconds)} seconds); final aspect ratio ${input.aspectRatio}.`
    : `短片结构化参数：时长档位 ${spec.tier}（${spec.zhLabel}，约 ${String(spec.targetSeconds)} 秒）；最终画面比例 ${input.aspectRatio}。`
  return [basePrompt, '', structuredLine].join('\n')
}

export function buildEditFirstDurationGuidance(spec: EditFirstDurationSpec, locale: Locale): string {
  return locale === 'en' ? spec.enGuidance : spec.zhGuidance
}
