import { parseBgmScoreJson } from '@/lib/bgm-score/project-data'

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeNullableString(value: unknown): string | null {
  const normalized = normalizeString(value)
  return normalized.length > 0 ? normalized : null
}

export function normalizeBgmScoreSummary(bgmScoreJson: unknown) {
  const bgmScore = toObject(parseBgmScoreJson(bgmScoreJson))
  const status = normalizeString(bgmScore.status)
  if (!status) return null
  return bgmScore
}

export function normalizeFinalVideoSummary(value: unknown) {
  const record = toObject(value)
  const id = normalizeString(record.id)
  const episodeId = normalizeString(record.episodeId)
  if (!id || !episodeId) return null

  return {
    id,
    episodeId,
    renderStatus: normalizeNullableString(record.renderStatus),
    renderTaskId: normalizeNullableString(record.renderTaskId),
    outputUrl: normalizeNullableString(record.outputUrl),
    bgmScore: normalizeBgmScoreSummary(record.bgmScoreJson),
    updatedAt: record.updatedAt instanceof Date
      ? record.updatedAt.toISOString()
      : normalizeNullableString(record.updatedAt),
  }
}
