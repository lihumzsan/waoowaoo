import { getLtx23WorkflowProfile } from '@/lib/providers/comfyui/ltx23-workflow-profiles'

export type VideoDurationMode = 'manual' | 'match_audio'
export type VideoDurationSource = 'smart' | 'manual'

export type VideoDurationBinding = {
  mode?: VideoDurationMode
  voiceLineIds?: string[]
  targetDurationSeconds?: number | null
  recommendedDurationSeconds?: number
  durationSource?: VideoDurationSource
  recommendationConfidence?: number
  recommendationReason?: string
  recommendationFingerprint?: string
  recommendationAlgorithmVersion?: string
}

export type AudioDurationCandidate = {
  id: string
  speaker?: string | null
  content?: string | null
  audioDuration?: number | null
}

export type AudioDrivenVideoTimingContext = {
  shotType?: string | null
  cameraMove?: string | null
  description?: string | null
  sceneType?: string | null
  clipContent?: string | null
  srtSegment?: string | null
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
  audioDurationSeconds: number
  targetDurationSeconds: number
  targetFrameCount: number
  fps: number
  maxDurationSeconds: number | null
  preRollSeconds: number
  postRollSeconds: number
  dialogueStartSeconds: number
  dialogueEndSeconds: number
  timingStrategy: 'context_aware_audio'
  reason: string
  capped: boolean
  canGenerate: boolean
  blockedReason?: 'audio_exceeds_max_duration' | 'target_exceeds_max_duration'
}

export const COMFYUI_LTX23_DEFAULT_FPS = 25
export const PRODUCT_VIDEO_MAX_DURATION_SECONDS = 12
export const COMFYUI_LTX23_MAX_DURATION_SECONDS = PRODUCT_VIDEO_MAX_DURATION_SECONDS

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

function normalizeTargetDurationSeconds(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return Number(value.toFixed(2))
}

function normalizeDurationSource(value: unknown): VideoDurationSource | undefined {
  return value === 'smart' || value === 'manual' ? value : undefined
}

function normalizeConfidence(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) return undefined
  return Number(value.toFixed(2))
}

function normalizeShortString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maxLength) : undefined
}

export function normalizeVideoDurationBinding(value: unknown): VideoDurationBinding {
  if (!isRecord(value)) return { mode: 'manual', voiceLineIds: [] }
  const mode = value.mode === 'match_audio' ? 'match_audio' : 'manual'
  const targetDurationSeconds = normalizeTargetDurationSeconds(value.targetDurationSeconds)
  const recommendedDurationSeconds = normalizeTargetDurationSeconds(value.recommendedDurationSeconds)
  const durationSource = normalizeDurationSource(value.durationSource)
    ?? (mode === 'manual' && targetDurationSeconds !== null ? 'manual' : undefined)
  const recommendationConfidence = normalizeConfidence(value.recommendationConfidence)
  const recommendationReason = normalizeShortString(value.recommendationReason, 120)
  const recommendationFingerprint = normalizeShortString(value.recommendationFingerprint, 128)
  const recommendationAlgorithmVersion = normalizeShortString(value.recommendationAlgorithmVersion, 32)
  return {
    mode,
    voiceLineIds: normalizeVoiceLineIds(value.voiceLineIds),
    ...(targetDurationSeconds !== null ? { targetDurationSeconds } : {}),
    ...(recommendedDurationSeconds !== null ? { recommendedDurationSeconds } : {}),
    ...(durationSource ? { durationSource } : {}),
    ...(recommendationConfidence !== undefined ? { recommendationConfidence } : {}),
    ...(recommendationReason ? { recommendationReason } : {}),
    ...(recommendationFingerprint ? { recommendationFingerprint } : {}),
    ...(recommendationAlgorithmVersion ? { recommendationAlgorithmVersion } : {}),
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

function normalizeDurationOptions(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is number => typeof item === 'number' && Number.isFinite(item) && item > 0)
    .sort((left, right) => left - right)
}

function normalizeFpsOptions(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is number => typeof item === 'number' && Number.isFinite(item) && item > 0)
}

function clampToProductMaxDuration(value: number | null): number {
  if (value === null) return PRODUCT_VIDEO_MAX_DURATION_SECONDS
  return Math.min(value, PRODUCT_VIDEO_MAX_DURATION_SECONDS)
}

export function getVideoTimingProfile(
  modelKey: string | null | undefined,
  durationOptions?: readonly number[] | null,
  fpsOptions?: readonly number[] | null,
): VideoTimingProfile {
  const workflowProfile = getLtx23WorkflowProfile(modelKey)
  if (workflowProfile) {
    return {
      fps: workflowProfile.fps,
      maxDurationSeconds: workflowProfile.maxDurationSeconds,
    }
  }

  const normalized = typeof modelKey === 'string' ? modelKey.trim().toLowerCase() : ''
  const configuredDurations = normalizeDurationOptions(durationOptions)
  const configuredMaxDuration = configuredDurations.length > 0
    ? configuredDurations[configuredDurations.length - 1]
    : null
  const configuredFps = normalizeFpsOptions(fpsOptions)[0] ?? COMFYUI_LTX23_DEFAULT_FPS

  if (normalized.includes('ltx2.3') || normalized.includes('ltx-2.3') || normalized.includes('/ltx')) {
    return {
      fps: configuredFps,
      maxDurationSeconds: clampToProductMaxDuration(configuredMaxDuration ?? COMFYUI_LTX23_MAX_DURATION_SECONDS),
    }
  }

  return {
    fps: configuredFps,
    maxDurationSeconds: clampToProductMaxDuration(configuredMaxDuration),
  }
}

function includesAny(text: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword))
}

function buildTimingReason(flags: {
  wideShot: boolean
  closeShot: boolean
  slowEmotion: boolean
  lineCount: number
  capped: boolean
}): string {
  const reasons = ['context-aware audio timing']
  if (flags.wideShot) reasons.push('added establishing pre-roll')
  if (flags.closeShot) reasons.push('added facial/emotional hold')
  if (flags.slowEmotion) reasons.push('added slower emotional breathing room')
  if (flags.lineCount > 1) reasons.push('kept space for combined dialogue beats')
  if (flags.capped) reasons.push('clamped by current workflow maximum duration')
  return reasons.join('; ')
}

export function buildAudioDrivenDurationOptions(timing: ResolvedAudioDrivenVideoTiming | null): number[] {
  if (!timing || timing.audioDurationSeconds <= 0) return []
  const maxDurationSeconds = timing.maxDurationSeconds ?? Math.max(12, timing.audioDurationSeconds)
  if (timing.audioDurationSeconds > maxDurationSeconds) return []

  const candidates = [
    timing.audioDurationSeconds,
    Math.ceil(timing.audioDurationSeconds),
    5,
    6,
    8,
    10,
    12,
    maxDurationSeconds,
  ]

  const seen = new Set<string>()
  return candidates
    .map((value) => Number(value.toFixed(2)))
    .filter((value) => value >= timing.audioDurationSeconds && value <= maxDurationSeconds)
    .filter((value) => {
      const key = value.toFixed(2)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((left, right) => left - right)
}

function resolveContextAwarePadding(
  audioDurationSeconds: number,
  lineCount: number,
  context?: AudioDrivenVideoTimingContext | null,
): { preRollSeconds: number; postRollSeconds: number; reasonFlags: {
  wideShot: boolean
  closeShot: boolean
  slowEmotion: boolean
  lineCount: number
} } {
  let preRollSeconds = 0.45
  let postRollSeconds = 0.65

  if (audioDurationSeconds <= 1.2) {
    preRollSeconds = 0.35
    postRollSeconds = 0.75
  } else if (audioDurationSeconds <= 3.2) {
    preRollSeconds = 0.6
    postRollSeconds = 1
  } else if (audioDurationSeconds <= 6.5) {
    preRollSeconds = 0.75
    postRollSeconds = 1.15
  }

  const contextText = [
    context?.shotType,
    context?.cameraMove,
    context?.description,
    context?.sceneType,
    context?.clipContent,
    context?.srtSegment,
  ].filter(Boolean).join(' ').toLowerCase()

  const wideShot = includesAny(contextText, [
    '全景',
    '远景',
    '环境',
    '走廊',
    '办公室',
    'establishing',
    'wide',
    'long shot',
  ])
  const closeShot = includesAny(contextText, [
    '近景',
    '特写',
    '面部',
    '表情',
    'close',
    'close-up',
    'face',
  ])
  const slowEmotion = includesAny(contextText, [
    '缓慢',
    '慢',
    '静止',
    '沉默',
    '停顿',
    '思考',
    '凝视',
    '情绪',
    'slow',
    'pause',
    'silent',
    'emotion',
  ])

  if (wideShot) preRollSeconds += 0.35
  if (closeShot) postRollSeconds += 0.25
  if (slowEmotion) {
    preRollSeconds += 0.2
    postRollSeconds += 0.3
  }
  if (lineCount > 1) postRollSeconds += Math.min(0.45, (lineCount - 1) * 0.15)

  return {
    preRollSeconds: Number(preRollSeconds.toFixed(2)),
    postRollSeconds: Number(postRollSeconds.toFixed(2)),
    reasonFlags: {
      wideShot,
      closeShot,
      slowEmotion,
      lineCount,
    },
  }
}

function fitPaddingIntoTarget(params: {
  audioDurationSeconds: number
  rawPreRollSeconds: number
  rawPostRollSeconds: number
  targetDurationSeconds: number
}): { preRollSeconds: number; postRollSeconds: number } {
  const availablePadding = Math.max(0, params.targetDurationSeconds - params.audioDurationSeconds)
  const desiredPadding = params.rawPreRollSeconds + params.rawPostRollSeconds
  if (availablePadding <= 0 || desiredPadding <= 0) {
    return { preRollSeconds: 0, postRollSeconds: 0 }
  }
  if (availablePadding >= desiredPadding) {
    return {
      preRollSeconds: Number(params.rawPreRollSeconds.toFixed(2)),
      postRollSeconds: Number(params.rawPostRollSeconds.toFixed(2)),
    }
  }

  const scale = availablePadding / desiredPadding
  return {
    preRollSeconds: Number((params.rawPreRollSeconds * scale).toFixed(2)),
    postRollSeconds: Number((params.rawPostRollSeconds * scale).toFixed(2)),
  }
}

export function resolveAudioDrivenVideoTiming(params: {
  binding: VideoDurationBinding
  candidates: AudioDurationCandidate[]
  modelKey?: string | null
  durationOptions?: readonly number[] | null
  fpsOptions?: readonly number[] | null
  context?: AudioDrivenVideoTimingContext | null
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

  const profile = getVideoTimingProfile(params.modelKey, params.durationOptions, params.fpsOptions)
  const audioDurationSeconds = Number((sourceDurationMs / 1000).toFixed(2))
  const padding = resolveContextAwarePadding(audioDurationSeconds, matchedVoiceLineIds.length, params.context)
  const requestedTargetDurationSeconds = normalizeTargetDurationSeconds(binding.targetDurationSeconds)
  const desiredDurationSeconds = requestedTargetDurationSeconds === null
    ? audioDurationSeconds
    : Math.max(audioDurationSeconds, requestedTargetDurationSeconds)
  const audioExceedsMax = profile.maxDurationSeconds !== null && audioDurationSeconds > profile.maxDurationSeconds
  const targetExceedsMax = profile.maxDurationSeconds !== null && desiredDurationSeconds > profile.maxDurationSeconds
  const blockedReason = audioExceedsMax
    ? 'audio_exceeds_max_duration'
    : targetExceedsMax
      ? 'target_exceeds_max_duration'
      : undefined
  const cappedDurationSeconds = profile.maxDurationSeconds === null
    ? desiredDurationSeconds
    : Math.min(desiredDurationSeconds, profile.maxDurationSeconds)
  const targetDurationSeconds = Math.max(0.4, Number(cappedDurationSeconds.toFixed(2)))
  const fittedPadding = fitPaddingIntoTarget({
    audioDurationSeconds,
    rawPreRollSeconds: padding.preRollSeconds,
    rawPostRollSeconds: padding.postRollSeconds,
    targetDurationSeconds,
  })
  const dialogueStartSeconds = Number(fittedPadding.preRollSeconds.toFixed(2))
  const dialogueEndSeconds = Number(
    Math.min(targetDurationSeconds, dialogueStartSeconds + audioDurationSeconds).toFixed(2),
  )
  const targetFrameCount = Math.max(1, Math.round(targetDurationSeconds * profile.fps))
  const capped = profile.maxDurationSeconds !== null && desiredDurationSeconds > profile.maxDurationSeconds

  return {
    mode: 'match_audio',
    selectedVoiceLineIds,
    matchedVoiceLineIds,
    sourceDurationMs,
    audioDurationSeconds,
    targetDurationSeconds,
    targetFrameCount,
    fps: profile.fps,
    maxDurationSeconds: profile.maxDurationSeconds,
    preRollSeconds: fittedPadding.preRollSeconds,
    postRollSeconds: fittedPadding.postRollSeconds,
    dialogueStartSeconds,
    dialogueEndSeconds,
    timingStrategy: 'context_aware_audio',
    reason: buildTimingReason({ ...padding.reasonFlags, capped }),
    capped,
    canGenerate: !blockedReason,
    ...(blockedReason ? { blockedReason } : {}),
  }
}
