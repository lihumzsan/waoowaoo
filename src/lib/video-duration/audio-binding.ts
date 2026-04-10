export type VideoDurationMode = 'manual' | 'match_audio'

export type VideoDurationBinding = {
  mode?: VideoDurationMode
  voiceLineIds?: string[]
}

export type AudioDurationCandidate = {
  id: string
  audioDuration?: number | null
}

export type VideoTimingProfile = {
  fps: number
  maxDurationSeconds: number | null
}

export type ResolvedAudioDrivenVideoTiming = {
  mode: 'match_audio'
  selectedVoiceLineIds: string[]
  matchedVoiceLineIds: string[]
  sourceDurationMs: number
  targetDurationSeconds: number
  targetFrameCount: number
  fps: number
  maxDurationSeconds: number | null
  capped: boolean
}

export const COMFYUI_LTX23_DEFAULT_FPS = 25
export const COMFYUI_LTX23_MAX_DURATION_SECONDS = 6

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeVoiceLineIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const next: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const normalized = item.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    next.push(normalized)
  }
  return next
}

export function normalizeVideoDurationBinding(value: unknown): VideoDurationBinding {
  if (!isRecord(value)) return { mode: 'manual', voiceLineIds: [] }
  const mode = value.mode === 'match_audio' ? 'match_audio' : 'manual'
  return {
    mode,
    voiceLineIds: normalizeVoiceLineIds(value.voiceLineIds),
  }
}

export function parseVideoDurationBinding(value: unknown): VideoDurationBinding {
  if (typeof value === 'string') {
    try {
      return normalizeVideoDurationBinding(JSON.parse(value) as unknown)
    } catch {
      return { mode: 'manual', voiceLineIds: [] }
    }
  }
  return normalizeVideoDurationBinding(value)
}

export function getVideoTimingProfile(modelKey: string | null | undefined): VideoTimingProfile {
  const normalized = typeof modelKey === 'string' ? modelKey.trim().toLowerCase() : ''
  if (normalized.includes('ltx2.3') || normalized.includes('ltx-2.3') || normalized.includes('/ltx')) {
    return {
      fps: COMFYUI_LTX23_DEFAULT_FPS,
      maxDurationSeconds: COMFYUI_LTX23_MAX_DURATION_SECONDS,
    }
  }

  return {
    fps: COMFYUI_LTX23_DEFAULT_FPS,
    maxDurationSeconds: null,
  }
}

export function resolveAudioDrivenVideoTiming(params: {
  binding: VideoDurationBinding
  candidates: AudioDurationCandidate[]
  modelKey?: string | null
}): ResolvedAudioDrivenVideoTiming | null {
  const binding = normalizeVideoDurationBinding(params.binding)
  if (binding.mode !== 'match_audio') return null

  const selectedVoiceLineIds = normalizeVoiceLineIds(binding.voiceLineIds)
  if (selectedVoiceLineIds.length === 0) return null

  const candidateMap = new Map(
    params.candidates.map((candidate) => [candidate.id, candidate]),
  )
  const matchedVoiceLineIds: string[] = []
  let sourceDurationMs = 0

  for (const voiceLineId of selectedVoiceLineIds) {
    const candidate = candidateMap.get(voiceLineId)
    if (!candidate) continue
    if (typeof candidate.audioDuration !== 'number' || !Number.isFinite(candidate.audioDuration) || candidate.audioDuration <= 0) {
      continue
    }
    matchedVoiceLineIds.push(voiceLineId)
    sourceDurationMs += Math.round(candidate.audioDuration)
  }

  if (matchedVoiceLineIds.length === 0 || sourceDurationMs <= 0) return null

  const profile = getVideoTimingProfile(params.modelKey)
  const rawDurationSeconds = sourceDurationMs / 1000
  const cappedDurationSeconds = profile.maxDurationSeconds === null
    ? rawDurationSeconds
    : Math.min(rawDurationSeconds, profile.maxDurationSeconds)
  const targetDurationSeconds = Math.max(0.4, Number(cappedDurationSeconds.toFixed(2)))
  const targetFrameCount = Math.max(1, Math.round(targetDurationSeconds * profile.fps))

  return {
    mode: 'match_audio',
    selectedVoiceLineIds,
    matchedVoiceLineIds,
    sourceDurationMs,
    targetDurationSeconds,
    targetFrameCount,
    fps: profile.fps,
    maxDurationSeconds: profile.maxDurationSeconds,
    capped: profile.maxDurationSeconds !== null && rawDurationSeconds > profile.maxDurationSeconds,
  }
}
