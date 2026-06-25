import { BGM_SCORE_STATUS, type BgmScoreMix } from './types'

export function isBgmScoreRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function parseBgmScoreJson(value: unknown): Record<string, unknown> | null {
  if (!value) return null
  if (isBgmScoreRecord(value)) return value
  if (typeof value !== 'string') return null
  if (!value.trim()) return null
  const parsed = JSON.parse(value) as unknown
  return isBgmScoreRecord(parsed) ? parsed : null
}

export function readCompletedBgmScoreMix(bgmScoreJson: unknown): BgmScoreMix | null {
  const bgmScore = parseBgmScoreJson(bgmScoreJson)
  if (!bgmScore || bgmScore.status !== BGM_SCORE_STATUS.COMPLETED) return null
  const mix = bgmScore.mix
  if (!isBgmScoreRecord(mix)) return null

  const mediaId = readString(mix.mediaId)
  const url = readString(mix.url)
  const storageKey = readString(mix.storageKey)
  const mimeType = readString(mix.mimeType)
  const durationMs = readNumber(mix.durationMs)
  if (!mediaId || !url || !storageKey || !mimeType || durationMs === null || durationMs <= 0) return null

  return {
    mediaId,
    url,
    storageKey,
    mimeType,
    durationMs,
  }
}
