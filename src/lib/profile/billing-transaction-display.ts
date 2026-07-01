import { TASK_TYPE } from '@/lib/task/types'
import { getProfileTransactionKindTranslationKey, type ProfileTransactionKindTranslationKey } from './transaction-labels'

export type ProfileTranslationParams = Record<string, string | number | Date>

export type ProfileBillingDetailTranslationKey =
  | 'billingDetail.image'
  | 'billingDetail.imageWithRes'
  | 'billingDetail.video'
  | 'billingDetail.videoWithDuration'
  | 'billingDetail.videoWithDurationAndRes'
  | 'billingDetail.videoWithRes'
  | 'billingDetail.tokens'
  | 'billingDetail.tokensWithBreakdown'
  | 'billingDetail.seconds'
  | 'billingDetail.calls'
  | 'billingDetail.audioIncluded'

export type ProfileBillingDetailPart =
  | {
    kind: 'translation'
    key: ProfileBillingDetailTranslationKey
    params: ProfileTranslationParams
  }
  | {
    kind: 'text'
    text: string
  }

const LEGACY_PROFILE_ACTION_KEYS = [
  'regenerate_storyboard_text',
  'story_to_script_run',
  'script_to_storyboard_run',
  'clips_build',
  'screenplay_convert',
  'storyboard',
  'storyboard_candidate',
  'character',
  'location',
  'video',
  'analyze',
  'analyze_character',
  'analyze_location',
  'clips',
  'storyboard_text_plan',
  'storyboard_text_detail',
  'regenerate',
] as const

const PROFILE_ACTION_KEYS = new Set<string>([
  ...Object.values(TASK_TYPE),
  ...LEGACY_PROFILE_ACTION_KEYS,
])

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  return null
}

function toPositiveCount(value: unknown): number | null {
  const numeric = readNumber(value)
  if (numeric === null || numeric <= 0) return null
  return Math.max(1, Math.floor(numeric))
}

function compactTextParts(parts: Array<string | null>): string | null {
  const values = parts.filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
  return values.length > 0 ? values.join(' · ') : null
}

function buildImageSpec(meta: Record<string, unknown>): string | null {
  return compactTextParts([
    readString(meta.resolution),
    readString(meta.size),
    readString(meta.aspectRatio),
    readString(meta.quality),
  ])
}

export function getProfileTransactionActionTranslationKey(
  type: string,
  action: string | null | undefined,
): `actionTypes.${string}` | ProfileTransactionKindTranslationKey {
  if ((type === 'consume' || type === 'shadow_consume') && action && PROFILE_ACTION_KEYS.has(action)) {
    return `actionTypes.${action}`
  }
  return getProfileTransactionKindTranslationKey(type)
}

export function buildProfileBillingDetailParts(meta: Record<string, unknown> | null | undefined): ProfileBillingDetailPart[] {
  if (!meta) return []

  const quantity = toPositiveCount(meta.quantity)
  const unit = readString(meta.unit)
  const model = readString(meta.model)
  const parts: ProfileBillingDetailPart[] = []

  if (unit === 'image' && quantity !== null) {
    const imageSpec = buildImageSpec(meta)
    parts.push(imageSpec
      ? { kind: 'translation', key: 'billingDetail.imageWithRes', params: { count: quantity, resolution: imageSpec } }
      : { kind: 'translation', key: 'billingDetail.image', params: { count: quantity } })
  }

  if (unit === 'video' && quantity !== null) {
    const resolution = readString(meta.resolution)
    const duration = readNumber(meta.duration)
    if (duration !== null && resolution) {
      parts.push({ kind: 'translation', key: 'billingDetail.videoWithDurationAndRes', params: { count: quantity, duration, resolution } })
    } else if (duration !== null) {
      parts.push({ kind: 'translation', key: 'billingDetail.videoWithDuration', params: { count: quantity, duration } })
    } else if (resolution) {
      parts.push({ kind: 'translation', key: 'billingDetail.videoWithRes', params: { count: quantity, resolution } })
    } else {
      parts.push({ kind: 'translation', key: 'billingDetail.video', params: { count: quantity } })
    }
  }

  if (unit === 'token') {
    const inputTokens = readNumber(meta.inputTokens)
    const outputTokens = readNumber(meta.outputTokens)
    const tokenCount = quantity ?? readNumber(meta.quantity)
    if (inputTokens !== null || outputTokens !== null) {
      parts.push({
        kind: 'translation',
        key: 'billingDetail.tokensWithBreakdown',
        params: {
          input: Math.max(0, Math.floor(inputTokens ?? 0)),
          output: Math.max(0, Math.floor(outputTokens ?? 0)),
        },
      })
    } else if (tokenCount !== null) {
      parts.push({ kind: 'translation', key: 'billingDetail.tokens', params: { count: Math.max(0, Math.floor(tokenCount)) } })
    }
  }

  if (unit === 'second') {
    const seconds = readNumber(meta.duration) ?? readNumber(meta.quantity)
    if (seconds !== null) {
      parts.push({ kind: 'translation', key: 'billingDetail.seconds', params: { count: seconds } })
    }
  }

  if (unit === 'call' && quantity !== null) {
    parts.push({ kind: 'translation', key: 'billingDetail.calls', params: { count: quantity } })
  }

  if (readBoolean(meta.generateAudio) === true) {
    parts.push({ kind: 'translation', key: 'billingDetail.audioIncluded', params: {} })
  }

  if (model) {
    parts.push({ kind: 'text', text: model })
  }

  return parts
}
