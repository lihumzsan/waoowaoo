import { isValidVideoTrimFrames } from '@/lib/video-tools/trim-frames'

export type UploadedVideo = {
  key: string
  url: string
  name: string
  size: number
  mimeType: string
}

export type VideoToolTask = {
  id: string
  status: string
  progress: number
  createdAt: string
  updatedAt: string
  payload: Record<string, unknown> | null
  result: Record<string, unknown> | null
  error: { message?: string | null } | null
}

export type VideoToolTaskPhase =
  | 'idle'
  | 'queued'
  | 'preparing'
  | 'processing'
  | 'persisting'
  | 'completed'
  | 'failed'

export type VideoToolTaskView = {
  phase: VideoToolTaskPhase
  active: boolean
  videoUrl: string | null
  videoKey: string | null
  errorMessage: string | null
}

export type VideoToolTaskTrimFrames = {
  input1TrimEndFrames: number
  input2TrimStartFrames: number
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isActiveTask(task: VideoToolTask | null | undefined): boolean {
  return task?.status === 'queued' || task?.status === 'processing'
}

export function canSubmitVideoSeamConcat(
  input1: UploadedVideo | null,
  input2: UploadedVideo | null,
  currentTask: VideoToolTask | null,
  input1TrimEndFrames: unknown = 0,
  input2TrimStartFrames: unknown = 1,
): boolean {
  return !!input1
    && !!input2
    && isValidVideoTrimFrames(input1TrimEndFrames)
    && isValidVideoTrimFrames(input2TrimStartFrames)
    && !isActiveTask(currentTask)
}

export function resolveVideoToolTaskView(task: VideoToolTask | null): VideoToolTaskView {
  if (!task) {
    return { phase: 'idle', active: false, videoUrl: null, videoKey: null, errorMessage: null }
  }

  const videoUrl = readString(task.result?.videoUrl)
  const videoKey = readString(task.result?.videoKey)
  if (task.status === 'completed') {
    return { phase: 'completed', active: false, videoUrl, videoKey, errorMessage: null }
  }
  if (task.status === 'failed' || task.status === 'canceled') {
    return {
      phase: 'failed',
      active: false,
      videoUrl: null,
      videoKey: null,
      errorMessage: readString(task.error?.message) || 'VIDEO_SEAM_CONCAT_FAILED',
    }
  }
  if (task.status === 'queued') {
    return { phase: 'queued', active: true, videoUrl: null, videoKey: null, errorMessage: null }
  }

  const stage = readString(task.payload?.stage)
  const phase: VideoToolTaskPhase = stage === 'persist_output'
    ? 'persisting'
    : stage === 'prepare_inputs'
      ? 'preparing'
      : 'processing'
  return { phase, active: true, videoUrl: null, videoKey: null, errorMessage: null }
}

function readTaskTrimFrames(resultValue: unknown, payloadValue: unknown, defaultValue: number): number {
  if (isValidVideoTrimFrames(resultValue)) return resultValue
  if (isValidVideoTrimFrames(payloadValue)) return payloadValue
  return defaultValue
}

export function resolveVideoToolTaskTrimFrames(task: VideoToolTask): VideoToolTaskTrimFrames {
  return {
    input1TrimEndFrames: readTaskTrimFrames(
      task.result?.input1TrimEndFrames,
      task.payload?.input1TrimEndFrames,
      0,
    ),
    input2TrimStartFrames: readTaskTrimFrames(
      task.result?.input2TrimStartFrames,
      task.payload?.input2TrimStartFrames,
      1,
    ),
  }
}

export function selectCurrentVideoToolTask(tasks: VideoToolTask[]): VideoToolTask | null {
  const newestFirst = [...tasks].sort((left, right) => {
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  })
  return newestFirst.find((task) => isActiveTask(task)) || newestFirst[0] || null
}
