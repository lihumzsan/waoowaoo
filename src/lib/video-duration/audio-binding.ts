import { getLtx23WorkflowProfile } from '@/lib/providers/comfyui/ltx23-workflow-profiles'

export type VideoDurationMode = 'manual' | 'match_audio'

export type VideoDurationBinding = {
  mode?: VideoDurationMode
  voiceLineIds?: string[]
  targetDurationSeconds?: number | null
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

export type AudioDrivenVideoSplitVoiceLine = {
  id: string
  speaker?: string | null
  content: string
  audioDuration: number
}

export type AudioDrivenVideoSplitSegment = {
  segmentIndex: number
  voiceLineIds: string[]
  voiceLines: AudioDrivenVideoSplitVoiceLine[]
  audioDurationMs: number
  audioDurationSeconds: number
  targetDurationSeconds: number
  targetFrameCount: number
}

export type AudioDrivenVideoSplitPlan = {
  mode: 'split_audio'
  selectedVoiceLineIds: string[]
  matchedVoiceLineIds: string[]
  fps: number
  maxDurationSeconds: number
  totalAudioDurationMs: number
  totalAudioDurationSeconds: number
  totalTargetDurationSeconds: number
  segments: AudioDrivenVideoSplitSegment[]
  reason: string
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
  splitPlan?: AudioDrivenVideoSplitPlan
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

export function normalizeVideoDurationBinding(value: unknown): VideoDurationBinding {
  if (!isRecord(value)) return { mode: 'manual', voiceLineIds: [] }
  const mode = value.mode === 'match_audio' ? 'match_audio' : 'manual'
  const targetDurationSeconds = normalizeTargetDurationSeconds(value.targetDurationSeconds)
  return {
    mode,
    voiceLineIds: normalizeVoiceLineIds(value.voiceLineIds),
    ...(targetDurationSeconds !== null ? { targetDurationSeconds } : {}),
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

function normalizeAudioDurationMs(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return Math.round(value)
}

function toSeconds(valueMs: number): number {
  return Number((valueMs / 1000).toFixed(2))
}

function supportsAutomaticAudioSplit(modelKey: string | null | undefined): boolean {
  const normalized = typeof modelKey === 'string' ? modelKey.trim().toLowerCase() : ''
  if (!normalized.includes('comfyui::')) return false
  return normalized.includes('ltx2.3')
    || normalized.includes('ltx-2.3')
    || normalized.includes('/ltx')
    || normalized.includes('ltxv')
}

type MatchedAudioLine = {
  id: string
  speaker?: string | null
  content: string
  audioDurationMs: number
}

function resolveMatchedAudioLines(
  binding: VideoDurationBinding,
  candidates: AudioDurationCandidate[],
): { selectedVoiceLineIds: string[]; lines: MatchedAudioLine[] } {
  const normalizedBinding = normalizeVideoDurationBinding(binding)
  const selectedVoiceLineIds = normalizeVoiceLineIds(normalizedBinding.voiceLineIds)
  if (normalizedBinding.mode !== 'match_audio' || selectedVoiceLineIds.length === 0) {
    return { selectedVoiceLineIds, lines: [] }
  }

  const candidateMap = new Map(
    candidates.map((candidate) => [candidate.id, candidate]),
  )
  const lines: MatchedAudioLine[] = []

  for (const voiceLineId of selectedVoiceLineIds) {
    const candidate = candidateMap.get(voiceLineId)
    if (!candidate) continue
    const audioDurationMs = normalizeAudioDurationMs(candidate.audioDuration)
    if (audioDurationMs === null) continue
    lines.push({
      id: voiceLineId,
      speaker: candidate.speaker,
      content: typeof candidate.content === 'string' ? candidate.content : '',
      audioDurationMs,
    })
  }

  return { selectedVoiceLineIds, lines }
}

function clampToProductMaxDuration(value: number | null): number {
  if (value === null) return PRODUCT_VIDEO_MAX_DURATION_SECONDS
  return Math.min(value, PRODUCT_VIDEO_MAX_DURATION_SECONDS)
}

function normalizeTextUnits(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  const units = trimmed.match(/[^。！？!?；;，,.\n]+[。！？!?；;，,.\n]*/g)
  return units && units.length > 0 ? units.map((unit) => unit.trim()).filter(Boolean) : Array.from(trimmed)
}

function splitTextByWeight(text: string, count: number): string[] {
  const safeCount = Math.max(1, Math.floor(count))
  const trimmed = text.trim()
  if (!trimmed) return Array.from({ length: safeCount }, () => '')
  if (safeCount === 1) return [trimmed]

  const units = normalizeTextUnits(trimmed)
  if (units.length <= safeCount) {
    const chars = Array.from(trimmed)
    const chunkSize = Math.max(1, Math.ceil(chars.length / safeCount))
    return Array.from({ length: safeCount }, (_, index) =>
      chars.slice(index * chunkSize, (index + 1) * chunkSize).join('').trim(),
    )
  }

  const weights = units.map((unit) => Math.max(1, Array.from(unit.replace(/\s+/g, '')).length))
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  const targetWeight = totalWeight / safeCount
  const chunks: string[] = []
  let currentUnits: string[] = []
  let currentWeight = 0

  units.forEach((unit, index) => {
    currentUnits.push(unit)
    currentWeight += weights[index] ?? 1
    const remainingUnits = units.length - index - 1
    const remainingChunks = safeCount - chunks.length - 1
    if (
      chunks.length < safeCount - 1
      && currentWeight >= targetWeight
      && remainingUnits >= remainingChunks
    ) {
      chunks.push(currentUnits.join('').trim())
      currentUnits = []
      currentWeight = 0
    }
  })

  if (currentUnits.length > 0) chunks.push(currentUnits.join('').trim())
  while (chunks.length < safeCount) chunks.push('')
  return chunks.slice(0, safeCount)
}

function buildSplitSegment(
  segmentIndex: number,
  lines: MatchedAudioLine[],
  fps: number,
): AudioDrivenVideoSplitSegment {
  const audioDurationMs = lines.reduce((sum, line) => sum + line.audioDurationMs, 0)
  const audioDurationSeconds = toSeconds(audioDurationMs)
  const targetDurationSeconds = Math.max(0.4, audioDurationSeconds)
  return {
    segmentIndex,
    voiceLineIds: lines.map((line) => line.id),
    voiceLines: lines.map((line) => ({
      id: line.id,
      speaker: line.speaker,
      content: line.content,
      audioDuration: line.audioDurationMs,
    })),
    audioDurationMs,
    audioDurationSeconds,
    targetDurationSeconds,
    targetFrameCount: Math.max(1, Math.round(targetDurationSeconds * fps)),
  }
}

function splitLongLine(line: MatchedAudioLine, maxDurationMs: number): MatchedAudioLine[] {
  const segmentCount = Math.max(2, Math.ceil(line.audioDurationMs / maxDurationMs))
  const chunks = splitTextByWeight(line.content, segmentCount)
  const baseDurationMs = Math.floor(line.audioDurationMs / segmentCount)
  let allocated = 0

  return Array.from({ length: segmentCount }, (_, index) => {
    const audioDurationMs = index === segmentCount - 1
      ? line.audioDurationMs - allocated
      : baseDurationMs
    allocated += audioDurationMs
    return {
      id: line.id,
      speaker: line.speaker,
      content: chunks[index] || line.content,
      audioDurationMs,
    }
  })
}

export function resolveAudioDrivenVideoSplitPlan(params: {
  binding: VideoDurationBinding
  candidates: AudioDurationCandidate[]
  modelKey?: string | null
  durationOptions?: readonly number[] | null
}): AudioDrivenVideoSplitPlan | null {
  if (!supportsAutomaticAudioSplit(params.modelKey)) return null

  const binding = normalizeVideoDurationBinding(params.binding)
  if (binding.mode !== 'match_audio') return null

  const profile = getVideoTimingProfile(params.modelKey, params.durationOptions)
  if (profile.maxDurationSeconds === null || profile.maxDurationSeconds <= 0) return null

  const { selectedVoiceLineIds, lines } = resolveMatchedAudioLines(binding, params.candidates)
  if (lines.length === 0) return null

  const totalAudioDurationMs = lines.reduce((sum, line) => sum + line.audioDurationMs, 0)
  const maxDurationMs = Math.round(profile.maxDurationSeconds * 1000)
  if (totalAudioDurationMs <= maxDurationMs) return null

  const segments: AudioDrivenVideoSplitSegment[] = []
  let currentLines: MatchedAudioLine[] = []
  let currentDurationMs = 0

  const flushCurrent = () => {
    if (currentLines.length === 0) return
    segments.push(buildSplitSegment(segments.length, currentLines, profile.fps))
    currentLines = []
    currentDurationMs = 0
  }

  for (const line of lines) {
    if (line.audioDurationMs > maxDurationMs) {
      flushCurrent()
      for (const part of splitLongLine(line, maxDurationMs)) {
        segments.push(buildSplitSegment(segments.length, [part], profile.fps))
      }
      continue
    }

    if (currentLines.length > 0 && currentDurationMs + line.audioDurationMs > maxDurationMs) {
      flushCurrent()
    }
    currentLines.push(line)
    currentDurationMs += line.audioDurationMs
  }
  flushCurrent()

  if (segments.length < 2) return null

  return {
    mode: 'split_audio',
    selectedVoiceLineIds,
    matchedVoiceLineIds: lines.map((line) => line.id),
    fps: profile.fps,
    maxDurationSeconds: profile.maxDurationSeconds,
    totalAudioDurationMs,
    totalAudioDurationSeconds: toSeconds(totalAudioDurationMs),
    totalTargetDurationSeconds: Number(segments.reduce((sum, segment) => sum + segment.targetDurationSeconds, 0).toFixed(2)),
    segments,
    reason: 'linked audio exceeds current ComfyUI LTX workflow max duration; split into continuous video segments',
  }
}

export function getVideoTimingProfile(
  modelKey: string | null | undefined,
  durationOptions?: readonly number[] | null,
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

  if (normalized.includes('ltx2.3') || normalized.includes('ltx-2.3') || normalized.includes('/ltx')) {
    return {
      fps: COMFYUI_LTX23_DEFAULT_FPS,
      maxDurationSeconds: clampToProductMaxDuration(configuredMaxDuration ?? COMFYUI_LTX23_MAX_DURATION_SECONDS),
    }
  }

  return {
    fps: COMFYUI_LTX23_DEFAULT_FPS,
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

  const profile = getVideoTimingProfile(params.modelKey, params.durationOptions)
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
  const splitPlan = audioExceedsMax
    ? resolveAudioDrivenVideoSplitPlan({
      binding,
      candidates: params.candidates,
      modelKey: params.modelKey,
      durationOptions: params.durationOptions,
    })
    : null
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
    ...(splitPlan ? { splitPlan } : {}),
  }
}
