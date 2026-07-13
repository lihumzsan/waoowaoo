import { sha256Hex } from '@/lib/media/hash'
import {
  COMFYUI_LTX23_GOON_DEFAULT_DURATION_SECONDS,
  COMFYUI_LTX23_GOON_FPS,
  normalizeLtx23GoonDurationSeconds,
  resolveLtx23GoonFrameCount,
} from '@/lib/providers/comfyui/ltx23-workflow-profiles'
import type { VideoDurationBinding } from '@/lib/video-duration/audio-binding'
import { FIRST_LAST_FRAME_SMART_DURATION_ALGORITHM_VERSION } from './first-last-frame-smart-duration-constants'

export { FIRST_LAST_FRAME_SMART_DURATION_ALGORITHM_VERSION }
export const FIRST_LAST_FRAME_SMART_DURATION_CONFIDENCE_THRESHOLD = 0.6
export const FIRST_LAST_FRAME_SMART_DURATION_MIN_SECONDS = 4
export const FIRST_LAST_FRAME_SMART_DURATION_MAX_SECONDS = 15
export const FIRST_LAST_FRAME_SMART_DURATION_DEFAULT_SECONDS =
  COMFYUI_LTX23_GOON_DEFAULT_DURATION_SECONDS
export const FIRST_LAST_FRAME_SMART_DURATION_FPS = COMFYUI_LTX23_GOON_FPS

const MAX_MOTION_BEATS = 12
const MAX_REASON_LENGTH = 80
const LEAD_IN_SECONDS = 0.5
const TAIL_HOLD_SECONDS = 0.75

const BEAT_SECONDS = {
  micro_motion: 1,
  gesture: 2,
  body_action: 3,
  locomotion: 4,
  environment_change: 3,
  transformation: 4,
  camera_standard: 2,
  camera_large: 3,
} as const

const PACE_MULTIPLIER = {
  fast: 0.85,
  normal: 1,
  slow: 1.15,
} as const

export type FirstLastFrameMotionBeatType = keyof typeof BEAT_SECONDS
export type FirstLastFramePacing = keyof typeof PACE_MULTIPLIER
export type FirstLastFrameContinuity = 'good' | 'challenging' | 'discontinuous'
export type FirstLastFrameSmartDurationFallbackReason =
  | 'invalid_analysis'
  | 'low_confidence'
  | 'discontinuous'

export type FirstLastFrameMotionBeat = {
  type: FirstLastFrameMotionBeatType
  order: number
  parallelGroup?: string
}

export type FirstLastFrameDurationAnalysis = {
  motionBeats: FirstLastFrameMotionBeat[]
  pacing: FirstLastFramePacing
  continuity: FirstLastFrameContinuity
  confidence: number
  reason: string
}

export type FirstLastFrameSmartDurationRecommendation = {
  durationSeconds: number
  frameCount: number
  fps: number
  confidence: number
  reason: string
  fingerprint: string
  continuity: FirstLastFrameContinuity
  source: 'smart' | 'fallback'
  fallbackReason?: FirstLastFrameSmartDurationFallbackReason
}

export type FirstLastFrameSmartDurationBinding = VideoDurationBinding & {
  durationSource: 'smart'
  recommendationConfidence: number
  recommendationReason: string
  recommendationFingerprint: string
  recommendationAlgorithmVersion: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isMotionBeatType(value: unknown): value is FirstLastFrameMotionBeatType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BEAT_SECONDS, value)
}

function isPacing(value: unknown): value is FirstLastFramePacing {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PACE_MULTIPLIER, value)
}

function isContinuity(value: unknown): value is FirstLastFrameContinuity {
  return value === 'good' || value === 'challenging' || value === 'discontinuous'
}

function normalizeReason(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, MAX_REASON_LENGTH)
}

function normalizeParallelGroup(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, 40) : undefined
}

export function parseFirstLastFrameDurationAnalysis(raw: unknown): FirstLastFrameDurationAnalysis | null {
  if (!isRecord(raw)) return null

  const rawBeats = raw.motionBeats ?? raw.motion_beats
  if (!Array.isArray(rawBeats) || rawBeats.length > MAX_MOTION_BEATS) return null
  if (!isPacing(raw.pacing) || !isContinuity(raw.continuity)) return null
  if (typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) {
    return null
  }

  const reason = normalizeReason(raw.reason)
  if (!reason) return null

  const motionBeats: FirstLastFrameMotionBeat[] = []
  for (const rawBeat of rawBeats) {
    if (!isRecord(rawBeat) || !isMotionBeatType(rawBeat.type)) return null
    if (typeof rawBeat.order !== 'number' || !Number.isFinite(rawBeat.order)) return null
    const order = Math.trunc(rawBeat.order)
    if (order < 0 || order > 100) return null
    const parallelGroup = normalizeParallelGroup(rawBeat.parallelGroup ?? rawBeat.parallel_group)
    motionBeats.push({
      type: rawBeat.type,
      order,
      ...(parallelGroup ? { parallelGroup } : {}),
    })
  }

  return {
    motionBeats,
    pacing: raw.pacing,
    continuity: raw.continuity,
    confidence: Number(raw.confidence.toFixed(2)),
    reason,
  }
}

function stableNormalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableNormalize)
  if (!isRecord(value)) return value
  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((output, key) => {
      output[key] = stableNormalize(value[key])
      return output
    }, {})
}

export function buildFirstLastFrameSmartDurationFingerprint(input: unknown): string {
  return sha256Hex(JSON.stringify({
    algorithmVersion: FIRST_LAST_FRAME_SMART_DURATION_ALGORITHM_VERSION,
    input: stableNormalize(input),
  }))
}

function fallbackRecommendation(params: {
  fingerprint: string
  reason: string
  fallbackReason: FirstLastFrameSmartDurationFallbackReason
  continuity?: FirstLastFrameContinuity
  confidence?: number
}): FirstLastFrameSmartDurationRecommendation {
  const durationSeconds = FIRST_LAST_FRAME_SMART_DURATION_DEFAULT_SECONDS
  return {
    durationSeconds,
    frameCount: resolveLtx23GoonFrameCount(durationSeconds),
    fps: FIRST_LAST_FRAME_SMART_DURATION_FPS,
    confidence: params.confidence ?? 0,
    reason: params.reason,
    fingerprint: params.fingerprint,
    continuity: params.continuity ?? 'challenging',
    source: 'fallback',
    fallbackReason: params.fallbackReason,
  }
}

export function computeFirstLastFrameSmartDuration(params: {
  analysis: FirstLastFrameDurationAnalysis | null
  fingerprint: string
  audioTargetDurationSeconds?: number | null
  fallbackReason?: FirstLastFrameSmartDurationFallbackReason
}): FirstLastFrameSmartDurationRecommendation {
  const { analysis, fingerprint } = params
  if (!analysis) {
    return fallbackRecommendation({
      fingerprint,
      reason: '智能分析未完成，当前使用默认 10 秒',
      fallbackReason: params.fallbackReason ?? 'invalid_analysis',
    })
  }

  if (analysis.continuity === 'discontinuous') {
    return fallbackRecommendation({
      fingerprint,
      reason: analysis.reason || '首尾画面变化较大，建议增加中间关键帧',
      fallbackReason: 'discontinuous',
      continuity: analysis.continuity,
      confidence: analysis.confidence,
    })
  }

  if (analysis.confidence < FIRST_LAST_FRAME_SMART_DURATION_CONFIDENCE_THRESHOLD) {
    return fallbackRecommendation({
      fingerprint,
      reason: '智能分析置信度不足，当前使用默认 10 秒',
      fallbackReason: 'low_confidence',
      continuity: analysis.continuity,
      confidence: analysis.confidence,
    })
  }

  const stages = new Map<number, Map<string, number>>()
  for (const beat of analysis.motionBeats) {
    const stage = stages.get(beat.order) ?? new Map<string, number>()
    const key = beat.parallelGroup || `${beat.order}:${beat.type}:${stage.size}`
    stage.set(key, Math.max(stage.get(key) ?? 0, BEAT_SECONDS[beat.type]))
    stages.set(beat.order, stage)
  }

  const motionSeconds = Array.from(stages.keys())
    .sort((left, right) => left - right)
    .reduce((sum, order) => {
      const stage = stages.get(order)
      return sum + Math.max(0, ...Array.from(stage?.values() ?? []))
    }, 0)
  const paced = (motionSeconds + LEAD_IN_SECONDS + TAIL_HOLD_SECONDS) * PACE_MULTIPLIER[analysis.pacing]
  const audioTargetDurationSeconds = typeof params.audioTargetDurationSeconds === 'number'
    && Number.isFinite(params.audioTargetDurationSeconds)
    && params.audioTargetDurationSeconds > 0
    ? params.audioTargetDurationSeconds
    : 0
  const rounded = Math.round(Math.max(paced, audioTargetDurationSeconds))
  const clamped = Math.min(
    FIRST_LAST_FRAME_SMART_DURATION_MAX_SECONDS,
    Math.max(FIRST_LAST_FRAME_SMART_DURATION_MIN_SECONDS, rounded),
  )
  const durationSeconds = normalizeLtx23GoonDurationSeconds(clamped)

  return {
    durationSeconds,
    frameCount: resolveLtx23GoonFrameCount(durationSeconds),
    fps: FIRST_LAST_FRAME_SMART_DURATION_FPS,
    confidence: analysis.confidence,
    reason: analysis.reason,
    fingerprint,
    continuity: analysis.continuity,
    source: 'smart',
  }
}

export function resolveFirstLastFrameSmartDurationBinding(
  recommendation: FirstLastFrameSmartDurationRecommendation,
): FirstLastFrameSmartDurationBinding {
  return {
    mode: 'manual',
    voiceLineIds: [],
    targetDurationSeconds: recommendation.durationSeconds,
    recommendedDurationSeconds: recommendation.durationSeconds,
    durationSource: 'smart',
    recommendationConfidence: recommendation.confidence,
    recommendationReason: recommendation.reason,
    recommendationFingerprint: recommendation.fingerprint,
    recommendationAlgorithmVersion: FIRST_LAST_FRAME_SMART_DURATION_ALGORITHM_VERSION,
  }
}
