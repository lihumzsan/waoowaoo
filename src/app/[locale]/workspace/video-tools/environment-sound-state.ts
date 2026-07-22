import type { EnvironmentSoundPlan } from '@/lib/video-tools/environment-sound'

export type EnvironmentSoundVideo = {
  key: string
  url: string
  name: string
  size?: number
  mimeType?: string
}

export type EnvironmentSoundTask = {
  id: string
  status: string
  progress: number
  payload: Record<string, unknown> | null
  result: Record<string, unknown> | null
  error: { message?: string | null } | null
}

export type EnvironmentSoundTaskPhase =
  | 'idle'
  | 'queued'
  | 'analyzing'
  | 'planReady'
  | 'generating'
  | 'persisting'
  | 'completed'
  | 'failed'

export type EnvironmentSoundTaskView = {
  phase: EnvironmentSoundTaskPhase
  active: boolean
  progress: number
  plan: EnvironmentSoundPlan | null
  audioUrl: string | null
  audioKey: string | null
  durationSeconds: number | null
  expiresAt: string | null
  errorMessage: string | null
}

export const ENVIRONMENT_SOUND_RECOVERY_STORAGE_KEY = 'waoowaoo:video-tools:environment-sound:recovery'

export type EnvironmentSoundRecovery = {
  taskId: string
  video: EnvironmentSoundVideo
  expiresAt: string
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readPlan(value: unknown): EnvironmentSoundPlan | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Partial<EnvironmentSoundPlan>
  return typeof candidate.durationSeconds === 'number' && Array.isArray(candidate.zones)
    ? candidate as EnvironmentSoundPlan
    : null
}

export function parseEnvironmentSoundRecovery(
  raw: string | null,
  nowMs: number = Date.now(),
): EnvironmentSoundRecovery | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<EnvironmentSoundRecovery>
    const expiresAtMs = typeof value.expiresAt === 'string' ? Date.parse(value.expiresAt) : Number.NaN
    const candidateVideo = value.video
    if (
      typeof value.taskId !== 'string'
      || !value.taskId.trim()
      || !Number.isFinite(expiresAtMs)
      || expiresAtMs <= nowMs
      || !candidateVideo
      || typeof candidateVideo.key !== 'string'
      || !candidateVideo.key.startsWith('video-tools/')
      || typeof candidateVideo.url !== 'string'
      || !candidateVideo.url
      || typeof candidateVideo.name !== 'string'
      || !candidateVideo.name
    ) {
      return null
    }
    return {
      taskId: value.taskId.trim(),
      video: candidateVideo,
      expiresAt: value.expiresAt!,
    }
  } catch {
    return null
  }
}

function isActiveTask(task: EnvironmentSoundTask | null): boolean {
  return task?.status === 'queued' || task?.status === 'processing'
}

export function canAnalyzeEnvironmentSound(
  video: EnvironmentSoundVideo | null,
  task: EnvironmentSoundTask | null,
  uploading: boolean,
): boolean {
  return !!video && !isActiveTask(task) && !uploading
}

export function canGenerateEnvironmentSound(
  video: EnvironmentSoundVideo | null,
  plan: EnvironmentSoundPlan | null,
  task: EnvironmentSoundTask | null,
): boolean {
  return !!video && !!plan && !isActiveTask(task)
}

export function resolveEnvironmentSoundTaskView(
  task: EnvironmentSoundTask | null,
): EnvironmentSoundTaskView {
  const base = {
    progress: task ? Math.max(0, Math.min(100, Math.floor(task.progress || 0))) : 0,
    plan: null,
    audioUrl: null,
    audioKey: null,
    durationSeconds: null,
    expiresAt: null,
    errorMessage: null,
  }
  if (!task) return { ...base, phase: 'idle', active: false }
  if (task.status === 'failed' || task.status === 'canceled') {
    return {
      ...base,
      phase: 'failed',
      active: false,
      errorMessage: readString(task.error?.message) || 'ENVIRONMENT_SOUND_FAILED',
    }
  }
  if (task.status === 'completed') {
    const plan = readPlan(task.result?.plan)
    const audioUrl = readString(task.result?.audioUrl)
    return {
      ...base,
      progress: 100,
      plan,
      audioUrl,
      audioKey: readString(task.result?.audioKey),
      durationSeconds: readNumber(task.result?.durationSeconds),
      expiresAt: readString(task.result?.expiresAt),
      phase: audioUrl ? 'completed' : plan ? 'planReady' : 'persisting',
      active: !audioUrl && !plan,
    }
  }
  if (task.status === 'queued') return { ...base, phase: 'queued', active: true }

  const stage = readString(task.payload?.stage)
  const phase: EnvironmentSoundTaskPhase = stage === 'environment_sound_generate'
    || stage === 'environment_sound_prompt_sync'
    ? 'generating'
    : stage === 'environment_sound_compose' || stage === 'environment_sound_persist'
      ? 'persisting'
      : 'analyzing'
  return { ...base, phase, active: true }
}
