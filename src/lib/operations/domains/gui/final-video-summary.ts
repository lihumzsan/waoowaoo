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

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
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

export function normalizeSoundscapeSummary(value: unknown) {
  const soundscape = toObject(value)
  const status = normalizeString(soundscape.status)
  if (!status) return null
  const plan = toObject(soundscape.planJson)
  const diagnostics = toObject(soundscape.diagnosticsJson)
  const decision = plan.decision === 'soundscape' || plan.decision === 'none_needed'
    ? plan.decision
    : null
  return {
    id: normalizeNullableString(soundscape.id),
    status,
    version: typeof soundscape.version === 'number' ? soundscape.version : null,
    taskId: normalizeNullableString(soundscape.taskId),
    timelineSignature: normalizeNullableString(soundscape.timelineSignature),
    soundEffectModel: normalizeNullableString(soundscape.soundEffectModel),
    decision,
    sourceCount: arrayLength(plan.sources),
    sectionCount: arrayLength(plan.sections),
    plan: soundscape.planJson ?? null,
    sources: soundscape.sourcesJson ?? null,
    mix: soundscape.mixJson ?? null,
    diagnostics: soundscape.diagnosticsJson ?? null,
    errorMessage: normalizeNullableString(diagnostics.errorMessage),
    updatedAt: soundscape.updatedAt instanceof Date
      ? soundscape.updatedAt.toISOString()
      : normalizeNullableString(soundscape.updatedAt),
  }
}

export function normalizeFinalVideoSummary(value: unknown, musicScore?: unknown, soundscape?: unknown) {
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
    soundscape: normalizeSoundscapeSummary(soundscape),
    updatedAt: record.updatedAt instanceof Date
      ? record.updatedAt.toISOString()
      : normalizeNullableString(record.updatedAt),
  }
}
