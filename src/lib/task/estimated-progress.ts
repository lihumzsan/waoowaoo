import { TASK_TYPE, type TaskType } from './types'

export type EstimatedTaskProgressPhase = 'idle' | 'queued' | 'processing' | 'completed' | 'failed'

export interface EstimatedTaskProgressTiming {
  readonly expectedSeconds: number
  readonly tailSeconds: number
  readonly totalSeconds: number
}

export interface EstimatedTaskProgressInput {
  readonly phase: string | null | undefined
  readonly taskType: string | null | undefined
  readonly elapsedMs: number
}

export interface EstimatedTaskProgressSnapshot extends EstimatedTaskProgressTiming {
  readonly phase: EstimatedTaskProgressPhase
  readonly percent: number
  readonly elapsedSeconds: number
  readonly isRunning: boolean
  readonly isFailed: boolean
  readonly isCompleted: boolean
  readonly isOvertime: boolean
}

const IMAGE_EXPECTED_SECONDS = 150
const VIDEO_EXPECTED_SECONDS = 150
const AUDIO_EXPECTED_SECONDS = 60
const TAIL_RATIO = 0.5
const MAIN_PROGRESS_CAP = 90
const RUNNING_PROGRESS_CAP = 99

const IMAGE_PROGRESS_TASK_TYPES = new Set<string>([
  TASK_TYPE.WORKSPACE_RESOURCE_IMAGE,
])

const VIDEO_PROGRESS_TASK_TYPES = new Set<string>([
  TASK_TYPE.WORKSPACE_RESOURCE_VIDEO,
  TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE,
])

const MUSIC_PROGRESS_TASK_TYPES = new Set<string>([
  TASK_TYPE.WORKSPACE_RESOURCE_AUDIO,
])

const VOICE_PROGRESS_TASK_TYPES = new Set<string>([
  TASK_TYPE.WORKSPACE_RESOURCE_VOICE,
])

function normalizePhase(phase: string | null | undefined): EstimatedTaskProgressPhase {
  if (phase === 'queued' || phase === 'processing' || phase === 'completed' || phase === 'failed') return phase
  return 'idle'
}

function buildTiming(expectedSeconds: number): EstimatedTaskProgressTiming {
  const tailSeconds = Math.ceil(expectedSeconds * TAIL_RATIO)
  return {
    expectedSeconds,
    tailSeconds,
    totalSeconds: expectedSeconds + tailSeconds,
  }
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

function tailEaseOut(ratio: number): number {
  const clamped = Math.max(0, Math.min(1, ratio))
  const numerator = 1 - Math.exp(-3 * clamped)
  const denominator = 1 - Math.exp(-3)
  return numerator / denominator
}

export function getEstimatedTaskProgressTiming(taskType: string | null | undefined): EstimatedTaskProgressTiming | null {
  if (!taskType) return null
  if (IMAGE_PROGRESS_TASK_TYPES.has(taskType)) return buildTiming(IMAGE_EXPECTED_SECONDS)
  if (VIDEO_PROGRESS_TASK_TYPES.has(taskType)) return buildTiming(VIDEO_EXPECTED_SECONDS)
  if (MUSIC_PROGRESS_TASK_TYPES.has(taskType)) return buildTiming(AUDIO_EXPECTED_SECONDS)
  if (VOICE_PROGRESS_TASK_TYPES.has(taskType)) return buildTiming(AUDIO_EXPECTED_SECONDS)
  return null
}

export function shouldShowEstimatedTaskProgress(taskType: string | null | undefined): taskType is TaskType {
  return getEstimatedTaskProgressTiming(taskType) !== null
}

export function calculateEstimatedTaskProgress(input: EstimatedTaskProgressInput): EstimatedTaskProgressSnapshot | null {
  const timing = getEstimatedTaskProgressTiming(input.taskType)
  if (!timing) return null

  const phase = normalizePhase(input.phase)
  const isRunning = phase === 'queued' || phase === 'processing'
  const isFailed = phase === 'failed'
  const isCompleted = phase === 'completed'
  const elapsedSeconds = Math.max(0, Math.floor(input.elapsedMs / 1000))

  if (isCompleted) {
    return {
      ...timing,
      phase,
      percent: 100,
      elapsedSeconds,
      isRunning: false,
      isFailed: false,
      isCompleted: true,
      isOvertime: false,
    }
  }

  if (isFailed) {
    return {
      ...timing,
      phase,
      percent: 0,
      elapsedSeconds,
      isRunning: false,
      isFailed: true,
      isCompleted: false,
      isOvertime: false,
    }
  }

  if (!isRunning) {
    return {
      ...timing,
      phase,
      percent: 0,
      elapsedSeconds,
      isRunning: false,
      isFailed: false,
      isCompleted: false,
      isOvertime: false,
    }
  }

  if (elapsedSeconds <= timing.expectedSeconds) {
    return {
      ...timing,
      phase,
      percent: clampPercent((elapsedSeconds / timing.expectedSeconds) * MAIN_PROGRESS_CAP),
      elapsedSeconds,
      isRunning: true,
      isFailed: false,
      isCompleted: false,
      isOvertime: false,
    }
  }

  const tailElapsedSeconds = elapsedSeconds - timing.expectedSeconds
  if (tailElapsedSeconds < timing.tailSeconds) {
    return {
      ...timing,
      phase,
      percent: clampPercent(MAIN_PROGRESS_CAP + tailEaseOut(tailElapsedSeconds / timing.tailSeconds) * (RUNNING_PROGRESS_CAP - MAIN_PROGRESS_CAP)),
      elapsedSeconds,
      isRunning: true,
      isFailed: false,
      isCompleted: false,
      isOvertime: false,
    }
  }

  return {
    ...timing,
    phase,
    percent: RUNNING_PROGRESS_CAP,
    elapsedSeconds,
    isRunning: true,
    isFailed: false,
    isCompleted: false,
    isOvertime: true,
  }
}
