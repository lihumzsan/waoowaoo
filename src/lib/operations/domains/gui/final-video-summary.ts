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

export function normalizeMusicScoreSummary(value: unknown) {
  const score = toObject(value)
  const status = normalizeString(score.status)
  if (!status) return null
  const cues = toObject(score.cuesJson)
  const diagnostics = toObject(score.diagnosticsJson)
  return {
    id: normalizeNullableString(score.id),
    status,
    version: typeof score.version === 'number' ? score.version : null,
    taskId: normalizeNullableString(score.taskId),
    timelineSignature: normalizeNullableString(score.timelineSignature),
    musicModel: normalizeNullableString(score.musicModel),
    durationSeconds: typeof cues.durationSeconds === 'number' ? cues.durationSeconds : null,
    plan: cues.plan ?? null,
    cues: score.cuesJson ?? null,
    mix: score.mixJson ?? cues.mix ?? null,
    diagnostics: score.diagnosticsJson ?? null,
    errorMessage: normalizeNullableString(diagnostics.errorMessage) ?? normalizeNullableString(cues.errorMessage),
    updatedAt: score.updatedAt instanceof Date
      ? score.updatedAt.toISOString()
      : normalizeNullableString(score.updatedAt),
  }
}

export function normalizeFinalVideoSummary(value: unknown, musicScore?: unknown) {
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
    musicScore: normalizeMusicScoreSummary(musicScore),
    updatedAt: record.updatedAt instanceof Date
      ? record.updatedAt.toISOString()
      : normalizeNullableString(record.updatedAt),
  }
}
