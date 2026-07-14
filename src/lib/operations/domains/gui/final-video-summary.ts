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
    taskId: normalizeNullableString(score.taskId),
    planTaskId: normalizeNullableString(score.planTaskId),
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

export function normalizeAmbientSoundSummary(value: unknown) {
  const ambientSound = toObject(value)
  const status = normalizeString(ambientSound.status)
  if (!status) return null
  const plan = toObject(ambientSound.planJson)
  const diagnostics = toObject(ambientSound.diagnosticsJson)
  const decision = plan.decision === 'ambient_sound' || plan.decision === 'none_needed'
    ? plan.decision
    : null
  return {
    id: normalizeNullableString(ambientSound.id),
    status,
    taskId: normalizeNullableString(ambientSound.taskId),
    planTaskId: normalizeNullableString(ambientSound.planTaskId),
    timelineSignature: normalizeNullableString(ambientSound.timelineSignature),
    soundEffectModel: normalizeNullableString(ambientSound.soundEffectModel),
    decision,
    sourceCount: arrayLength(plan.sources),
    sectionCount: arrayLength(plan.sections),
    plan: ambientSound.planJson ?? null,
    sources: ambientSound.sourcesJson ?? null,
    mix: ambientSound.mixJson ?? null,
    diagnostics: ambientSound.diagnosticsJson ?? null,
    errorMessage: normalizeNullableString(diagnostics.errorMessage),
    updatedAt: ambientSound.updatedAt instanceof Date
      ? ambientSound.updatedAt.toISOString()
      : normalizeNullableString(ambientSound.updatedAt),
  }
}

export function normalizeFinalVideoSummary(value: unknown, musicScore?: unknown, ambientSound?: unknown) {
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
    ambientSound: normalizeAmbientSoundSummary(ambientSound),
    updatedAt: record.updatedAt instanceof Date
      ? record.updatedAt.toISOString()
      : normalizeNullableString(record.updatedAt),
  }
}
