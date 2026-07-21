import { isValidVideoTrimFrames } from '@/lib/video-tools/trim-frames'
import {
  isVideoSeamBridgeDuration,
  type VideoSeamBridgeDurationSeconds,
} from '@/lib/video-tools/seam-bridge'
import type { UploadedVideo, VideoToolTask } from './video-tools-state'

export type VideoSeamDraft = {
  input1: UploadedVideo | null
  input2: UploadedVideo | null
  input1TrimEndFrames: number | ''
  input2TrimStartFrames: number | ''
  seamMode: 'direct' | 'ai_bridge'
  bridgeDurationSeconds: VideoSeamBridgeDurationSeconds
  bridgePrompt: string
  taskId: string | null
}

const VIDEO_SEAM_DRAFT_VERSION = 1
const VIDEO_SEAM_DRAFT_STORAGE_PREFIX = 'waoowaoo:video-seam:draft:'

function normalizeUserId(userId: string): string {
  return userId.trim()
}

function getBrowserStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage || null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readRequiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readUploadedVideo(value: unknown): UploadedVideo | null {
  if (!isRecord(value)) return null
  const key = readRequiredString(value.key)
  const url = readRequiredString(value.url)
  const name = readRequiredString(value.name)
  const mimeType = readRequiredString(value.mimeType)
  if (!key || !url || !name || !mimeType
    || typeof value.size !== 'number'
    || !Number.isFinite(value.size)
    || !Number.isInteger(value.size)
    || value.size < 0) return null
  return { key, url, name, size: value.size, mimeType }
}

function readOptionalUploadedVideo(value: unknown): UploadedVideo | null | undefined {
  if (value === null) return null
  return readUploadedVideo(value) || undefined
}

function isStoredTrimFrames(value: unknown): value is number | '' {
  return value === '' || isValidVideoTrimFrames(value)
}

export function buildVideoSeamDraftStorageKey(userId: string): string {
  return `${VIDEO_SEAM_DRAFT_STORAGE_PREFIX}${encodeURIComponent(normalizeUserId(userId))}`
}

export function readVideoSeamDraft(userId: string): VideoSeamDraft | null {
  const normalizedUserId = normalizeUserId(userId)
  if (!normalizedUserId) return null
  const storage = getBrowserStorage()
  if (!storage) return null

  let raw: string | null
  try {
    raw = storage.getItem(buildVideoSeamDraftStorageKey(normalizedUserId))
  } catch {
    return null
  }
  if (!raw) return null

  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value)
      || value.version !== VIDEO_SEAM_DRAFT_VERSION
      || value.userId !== normalizedUserId) return null
    const taskId = value.taskId === null ? null : readRequiredString(value.taskId)
    if (!isStoredTrimFrames(value.input1TrimEndFrames)
      || !isStoredTrimFrames(value.input2TrimStartFrames)
      || (value.seamMode !== 'direct' && value.seamMode !== 'ai_bridge')
      || !isVideoSeamBridgeDuration(value.bridgeDurationSeconds)
      || typeof value.bridgePrompt !== 'string'
      || (value.taskId !== null && !taskId)) return null

    const input1 = readOptionalUploadedVideo(value.input1)
    const input2 = readOptionalUploadedVideo(value.input2)
    if (input1 === undefined || input2 === undefined) return null

    return {
      input1,
      input2,
      input1TrimEndFrames: value.input1TrimEndFrames,
      input2TrimStartFrames: value.input2TrimStartFrames,
      seamMode: value.seamMode,
      bridgeDurationSeconds: value.bridgeDurationSeconds,
      bridgePrompt: value.bridgePrompt.trim(),
      taskId,
    }
  } catch {
    return null
  }
}

export function writeVideoSeamDraft(userId: string, draft: VideoSeamDraft): void {
  const normalizedUserId = normalizeUserId(userId)
  if (!normalizedUserId) return
  const storage = getBrowserStorage()
  if (!storage) return

  try {
    storage.setItem(buildVideoSeamDraftStorageKey(normalizedUserId), JSON.stringify({
      version: VIDEO_SEAM_DRAFT_VERSION,
      userId: normalizedUserId,
      input1: draft.input1,
      input2: draft.input2,
      input1TrimEndFrames: draft.input1TrimEndFrames,
      input2TrimStartFrames: draft.input2TrimStartFrames,
      seamMode: draft.seamMode,
      bridgeDurationSeconds: draft.bridgeDurationSeconds,
      bridgePrompt: draft.bridgePrompt,
      taskId: draft.taskId,
    }))
  } catch {
    // Browser storage is optional; task execution must not fail when it is unavailable.
  }
}

export function createRecoveredVideoSeamTask(taskId: string): VideoToolTask {
  return {
    id: taskId.trim(),
    status: 'queued',
    progress: 0,
    payload: null,
    result: null,
    error: null,
  }
}
