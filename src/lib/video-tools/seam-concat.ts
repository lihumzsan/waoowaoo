import { randomUUID } from 'node:crypto'
import { extname } from 'node:path'
import { parseVideoSeamBridgeOptions, type VideoSeamBridgeOptions } from './seam-bridge'
import { isValidVideoTrimFrames } from './trim-frames'

export { isValidVideoTrimFrames, VIDEO_SEAM_CONCAT_MAX_TRIM_FRAMES } from './trim-frames'

export const VIDEO_TOOLS_PROJECT_ID = 'video-tools'
export const VIDEO_SEAM_CONCAT_WORKFLOW_KEY = 'basevideo/tools/video-seam-concat-nvenc'
export const VIDEO_TOOL_MAX_UPLOAD_BYTES = 256 * 1024 * 1024

const VIDEO_MIME_BY_EXTENSION: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
}

type UploadMetadata = {
  name: string
  type: string
  size: number
}

export type VideoSeamMode = 'direct' | 'ai_bridge'

export type SeamConcatSubmission = {
  input1Key: string
  input1Name: string
  input1TrimEndFrames: number
  input2Key: string
  input2Name: string
  input2TrimStartFrames: number
  mode: VideoSeamMode
  bridge?: VideoSeamBridgeOptions
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readVideoTrimFrames(value: unknown, defaultValue: number): number {
  if (value === undefined) return defaultValue
  if (!isValidVideoTrimFrames(value)) {
    throw new Error('VIDEO_SEAM_CONCAT_TRIM_FRAMES_INVALID')
  }
  return value
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-')
}

export function validateVideoToolUpload(metadata: UploadMetadata): { extension: string; mimeType: string } {
  if (!Number.isFinite(metadata.size) || metadata.size <= 0) {
    throw new Error('VIDEO_TOOL_UPLOAD_EMPTY')
  }
  if (metadata.size > VIDEO_TOOL_MAX_UPLOAD_BYTES) {
    throw new Error('VIDEO_TOOL_UPLOAD_TOO_LARGE')
  }

  const extension = extname(metadata.name).replace(/^\./, '').toLowerCase()
  const mimeType = VIDEO_MIME_BY_EXTENSION[extension]
  const providedMime = metadata.type.trim().toLowerCase()
  if (!mimeType || (providedMime && !providedMime.startsWith('video/'))) {
    throw new Error('VIDEO_TOOL_UPLOAD_UNSUPPORTED')
  }

  return { extension, mimeType }
}

export function buildVideoToolInputKey(userId: string, extension: string, id: string = randomUUID()): string {
  const safeUserId = safePathSegment(userId)
  const safeExtension = extension.replace(/[^a-z0-9]+/gi, '').toLowerCase()
  const safeId = safePathSegment(id)
  if (!safeUserId || !safeExtension || !safeId) {
    throw new Error('VIDEO_TOOL_UPLOAD_KEY_INVALID')
  }
  return `video-tools/${safeUserId}/inputs/${safeId}.${safeExtension}`
}

export function buildVideoToolOutputKey(userId: string, id: string = randomUUID()): string {
  const safeUserId = safePathSegment(userId)
  const safeId = safePathSegment(id)
  if (!safeUserId || !safeId) {
    throw new Error('VIDEO_TOOL_OUTPUT_KEY_INVALID')
  }
  return `video-tools/${safeUserId}/outputs/${safeId}.mp4`
}

export function isOwnedVideoToolInputKey(userId: string, key: string): boolean {
  const safeUserId = safePathSegment(userId)
  if (!safeUserId || key.includes('..') || key.includes('\\')) return false
  return new RegExp(`^video-tools/${safeUserId}/inputs/[a-zA-Z0-9_-]+\\.(mp4|mov|webm|mkv)$`).test(key)
}

export function parseVideoSeamConcatSubmission(userId: string, value: unknown): SeamConcatSubmission {
  if (!isRecord(value) || !isRecord(value.input1) || !isRecord(value.input2)) {
    throw new Error('VIDEO_TOOL_INPUTS_REQUIRED')
  }

  const input1Key = readTrimmedString(value.input1.key)
  const input2Key = readTrimmedString(value.input2.key)
  const input1Name = readTrimmedString(value.input1.name)
  const input2Name = readTrimmedString(value.input2.name)
  const input1TrimEndFrames = readVideoTrimFrames(value.input1.trimEndFrames, 0)
  const input2TrimStartFrames = readVideoTrimFrames(value.input2.trimStartFrames, 1)
  if (!input1Key || !input2Key || !input1Name || !input2Name) {
    throw new Error('VIDEO_TOOL_INPUTS_REQUIRED')
  }
  if (!isOwnedVideoToolInputKey(userId, input1Key) || !isOwnedVideoToolInputKey(userId, input2Key)) {
    throw new Error('VIDEO_TOOL_INPUT_NOT_OWNED')
  }

  const mode = value.mode === undefined ? 'direct' : value.mode
  if (mode !== 'direct' && mode !== 'ai_bridge') {
    throw new Error('VIDEO_SEAM_MODE_INVALID')
  }
  const bridge = mode === 'ai_bridge' ? parseVideoSeamBridgeOptions(value.bridge) : undefined

  return {
    input1Key,
    input1Name,
    input1TrimEndFrames,
    input2Key,
    input2Name,
    input2TrimStartFrames,
    mode,
    ...(bridge ? { bridge } : {}),
  }
}
