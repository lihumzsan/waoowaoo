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
    timelineSignature: normalizeNullableString(score.timelineSignature),
    designSignature: normalizeNullableString(score.designSignature),
    musicModel: normalizeNullableString(score.musicModel),
    durationSeconds: typeof cues.durationSeconds === 'number' ? cues.durationSeconds : null,
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
  const diagnostics = toObject(ambientSound.diagnosticsJson)
  return {
    id: normalizeNullableString(ambientSound.id),
    status,
    taskId: normalizeNullableString(ambientSound.taskId),
    timelineSignature: normalizeNullableString(ambientSound.timelineSignature),
    designSignature: normalizeNullableString(ambientSound.designSignature),
    soundEffectModel: normalizeNullableString(ambientSound.soundEffectModel),
    sourceCount: arrayLength(ambientSound.sourcesJson),
    sectionCount: 0,
    sources: ambientSound.sourcesJson ?? null,
    mix: ambientSound.mixJson ?? null,
    diagnostics: ambientSound.diagnosticsJson ?? null,
    errorMessage: normalizeNullableString(diagnostics.errorMessage),
    updatedAt: ambientSound.updatedAt instanceof Date
      ? ambientSound.updatedAt.toISOString()
      : normalizeNullableString(ambientSound.updatedAt),
  }
}

export function normalizeAudioDesignSummary(value: unknown) {
  const design = toObject(value)
  const status = normalizeString(design.status)
  if (!status) return null
  return {
    id: normalizeNullableString(design.id),
    status,
    taskId: normalizeNullableString(design.taskId),
    timelineSignature: normalizeNullableString(design.timelineSignature),
    designSignature: normalizeNullableString(design.designSignature),
    analysisModel: normalizeNullableString(design.analysisModel),
    musicModel: normalizeNullableString(design.musicModel),
    soundEffectModel: normalizeNullableString(design.soundEffectModel),
    design: design.designJson ?? null,
    diagnostics: design.diagnosticsJson ?? null,
    updatedAt: design.updatedAt instanceof Date ? design.updatedAt.toISOString() : normalizeNullableString(design.updatedAt),
  }
}

export function normalizeFinalVideoSummary(value: unknown, musicScore?: unknown, ambientSound?: unknown, audioDesign?: unknown) {
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
    audioDesign: normalizeAudioDesignSummary(audioDesign),
    updatedAt: record.updatedAt instanceof Date
      ? record.updatedAt.toISOString()
      : normalizeNullableString(record.updatedAt),
  }
}
