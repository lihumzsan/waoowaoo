import {
  BGM_SCORE_STATUS,
  bgmScorePlanSchema,
  type BgmScoreMix,
  type BgmScorePlan,
} from '@/lib/bgm-score/types'

export type PersistedMusicScoreRecord = {
  readonly status?: string | null
  readonly cuesJson?: unknown
  readonly mixJson?: unknown
  readonly timelineSignature?: string | null
}

export function isMusicScoreRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseRecord(value: unknown): Record<string, unknown> | null {
  if (!value) return null
  if (isMusicScoreRecord(value)) return value
  if (typeof value !== 'string') return null
  if (!value.trim()) return null
  const parsed = JSON.parse(value) as unknown
  return isMusicScoreRecord(parsed) ? parsed : null
}

export function readMusicScoreStatus(score: PersistedMusicScoreRecord | null | undefined): string | null {
  if (!score) return null
  return readString(score.status) || null
}

export function readMusicScoreTimelineSignature(score: PersistedMusicScoreRecord | null | undefined): string | null {
  if (!score) return null
  return readString(score.timelineSignature) || null
}

export function readPersistedMusicScorePlan(score: PersistedMusicScoreRecord | null | undefined): BgmScorePlan | null {
  if (!score) return null
  const data = parseRecord(score.cuesJson)
  const result = bgmScorePlanSchema.safeParse(data?.plan)
  return result.success ? result.data : null
}

export function readCompletedMusicScoreMix(score: PersistedMusicScoreRecord | null | undefined): BgmScoreMix | null {
  if (!score || score.status !== BGM_SCORE_STATUS.COMPLETED) return null
  const mix = parseRecord(score.mixJson)
  if (!mix) return null

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
