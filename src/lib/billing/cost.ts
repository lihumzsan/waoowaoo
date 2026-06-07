/**
 * Product credit pricing.
 *
 * Billing no longer mirrors provider cost tables. Provider/model identifiers are
 * retained for audit metadata, while charged credits come from this product
 * pricing catalog.
 */

export const USD_TO_CNY = 7.2

export const MARKUP = {
  global: 1.0,
  text: 1.0,
  image: 1.0,
  video: 1.0,
  music: 1.0,
} as const

export type MarkupCategory = keyof typeof MARKUP
export type ApiType = 'text' | 'image' | 'video' | 'music'
export type UsageUnit = 'token' | 'image' | 'video' | 'second' | 'call'

export interface LlmCustomPricing {
  inputPerMillion?: number
  outputPerMillion?: number
}

export interface MediaCustomPricing {
  basePrice?: number
  optionPrices?: Record<string, Record<string, number>>
}

export interface ModelCustomPricing {
  llm?: LlmCustomPricing
  image?: MediaCustomPricing
  video?: MediaCustomPricing
  music?: MediaCustomPricing
}

export const PRODUCT_CREDIT_PRICING = {
  textPerThousandTokens: 0.01,
  imagePerUnit: 1,
  videoPerSecond: 1,
  videoMinimumPerClip: 5,
  musicPerSecond: 0.2,
} as const

type BillingMetadata = { [field: string]: unknown }

function normalizePositiveInteger(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

function normalizePositiveNumber(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, value)
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function resolveDurationSeconds(metadata?: BillingMetadata): number | null {
  const duration = readNumber(metadata?.duration)
  if (duration !== null && duration > 0) return duration
  const durationSeconds = readNumber(metadata?.durationSeconds)
  if (durationSeconds !== null && durationSeconds > 0) return durationSeconds
  return null
}

function roundCredits(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(Math.max(0, value) * 1_000_000) / 1_000_000
}

export function calcText(
  _model: string,
  inputTokens: number,
  outputTokens: number,
  _customPricing?: ModelCustomPricing | null,
): number {
  const totalTokens = normalizePositiveInteger(inputTokens) + normalizePositiveInteger(outputTokens)
  return roundCredits((totalTokens / 1000) * PRODUCT_CREDIT_PRICING.textPerThousandTokens)
}

export function calcImage(
  _model: string,
  quantity = 1,
  _metadata?: BillingMetadata,
  _customPricing?: ModelCustomPricing | null,
): number {
  const units = Math.max(1, normalizePositiveInteger(quantity))
  return roundCredits(units * PRODUCT_CREDIT_PRICING.imagePerUnit)
}

export function calcVideo(
  _model: string,
  _resolution = '720p',
  quantity = 1,
  metadata?: BillingMetadata,
  _customPricing?: ModelCustomPricing | null,
): number {
  const units = Math.max(1, normalizePositiveInteger(quantity))
  const duration = resolveDurationSeconds(metadata)
  const unitCost = duration === null
    ? PRODUCT_CREDIT_PRICING.videoMinimumPerClip
    : Math.max(PRODUCT_CREDIT_PRICING.videoMinimumPerClip, duration * PRODUCT_CREDIT_PRICING.videoPerSecond)
  return roundCredits(units * unitCost)
}

export function calcVideoByTokens(
  model: string,
  _totalTokens: number,
  metadata?: BillingMetadata,
): number {
  return calcVideo(model, typeof metadata?.resolution === 'string' ? metadata.resolution : '720p', 1, metadata)
}

export function calcMusic(
  _model: string,
  durationSeconds: number,
  _metadata?: BillingMetadata,
  _customPricing?: ModelCustomPricing | null,
): number {
  return roundCredits(normalizePositiveNumber(durationSeconds) * PRODUCT_CREDIT_PRICING.musicPerSecond)
}
