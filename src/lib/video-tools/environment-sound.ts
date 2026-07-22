import { randomUUID } from 'node:crypto'
import { extname } from 'node:path'

export const STABLE_AUDIO_3_MEDIUM_WORKFLOW_KEY = 'baseaudio/environment/stable-audio-3-medium'
export const ENVIRONMENT_SOUND_PROJECT_ID = 'video-tools'
export const ENVIRONMENT_SOUND_DEFAULT_NEGATIVE_PROMPT = 'music, melody, speech, dialogue, vocals, narration'
export const ENVIRONMENT_SOUND_MAX_GENERATION_SECONDS = 150
export const ENVIRONMENT_SOUND_MAX_VOICE_UPLOAD_BYTES = 64 * 1024 * 1024
export const ENVIRONMENT_SOUND_MAX_VIDEO_DURATION_SECONDS = 60 * 60
export const ENVIRONMENT_SOUND_TTL_SECONDS = 24 * 60 * 60

const PLAN_TIME_TOLERANCE_SECONDS = 0.1
const MAX_SCRIPT_LENGTH = 20_000
const MAX_ZONES = 48
const NON_ENGLISH_SCRIPT_PATTERN = /[\u0400-\u052f\u0600-\u06ff\u3040-\u30ff\u3400-\u9fff]/u
const REQUIRED_NEGATIVE_PROMPT_TERMS = ENVIRONMENT_SOUND_DEFAULT_NEGATIVE_PROMPT.split(', ')

const VOICE_MIME_BY_EXTENSION: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
}

export type EnvironmentSoundTransition = 'smooth' | 'hard'

export type EnvironmentSoundZone = {
  id: string
  startSeconds: number
  endSeconds: number
  sceneZh: string
  ambienceZh: string
  eventSoundsZh: string[]
  avoidSoundsZh: string[]
  promptEn: string
  negativePromptEn: string
  transitionToNext: EnvironmentSoundTransition
}

export type EnvironmentSoundPlan = {
  durationSeconds: number
  summaryZh: string
  zones: EnvironmentSoundZone[]
}

export type EnvironmentSoundAnalyzeSubmission = {
  action: 'analyze'
  videoKey: string
  videoName: string
  scriptDialogue?: string
  voiceKey?: string
}

export type EnvironmentSoundGenerateSubmission = {
  action: 'generate'
  videoKey: string
  videoName: string
  plan: EnvironmentSoundPlan
}

export type EnvironmentSoundSubmission = EnvironmentSoundAnalyzeSubmission | EnvironmentSoundGenerateSubmission

export type EnvironmentSoundPiece = {
  zoneId: string
  zoneIndex: number
  pieceIndex: number
  timelineStartSeconds: number
  timelineDurationSeconds: number
  generationDurationSeconds: number
  transitionSeconds: number
  promptEn: string
  negativePromptEn: string
  seed: number
}

type UploadMetadata = {
  name: string
  type: string
  size: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown, code: string, maxLength = 4_000): string {
  const result = typeof value === 'string' ? value.trim() : ''
  if (!result || result.length > maxLength) throw new Error(code)
  return result
}

function readOptionalString(value: unknown, code: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return readString(value, code, maxLength)
}

function readFiniteNumber(value: unknown, code: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(code)
  return value
}

function readStringArray(value: unknown, code: string): string[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error(code)
  return value.map((item) => readString(item, code, 500))
}

function roundTime(value: number): number {
  return Math.round(value * 1000) / 1000
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasEnglishPromptSignal(value: string): boolean {
  if (NON_ENGLISH_SCRIPT_PATTERN.test(value)) return false
  return (value.match(/[a-z]+(?:'[a-z]+)?/gi) || []).length >= 5
}

function withRequiredNegativePromptTerms(value: string | undefined): string {
  if (!value) return ENVIRONMENT_SOUND_DEFAULT_NEGATIVE_PROMPT
  const normalized = value.toLowerCase()
  const missing = REQUIRED_NEGATIVE_PROMPT_TERMS.filter((term) => {
    return !new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i').test(normalized)
  })
  return [value, ...missing].join(', ')
}

function withRequiredPositivePromptConstraints(value: string): string {
  const normalized = value.toLowerCase()
  const constraints: string[] = []
  if (!normalized.includes('no music')) constraints.push('no music')
  if (!/\b(?:no|without)\s+(?:music\s+(?:or|and)\s+)?voices?\b/i.test(normalized)) {
    constraints.push('no voices')
  }
  return constraints.length > 0
    ? `${value.replace(/[,.\s]+$/u, '')}, ${constraints.join(', ')}`
    : value
}

export function isOwnedEnvironmentSoundVideoKey(userId: string, key: string): boolean {
  const safeUserId = safePathSegment(userId)
  if (!safeUserId || key.includes('..') || key.includes('\\')) return false
  const owner = escapeRegExp(safeUserId)
  return new RegExp(`^video-tools/${owner}/(?:inputs/[a-zA-Z0-9_-]+\\.(?:mp4|mov|webm|mkv)|outputs/[a-zA-Z0-9_-]+\\.mp4)$`).test(key)
}

export function isOwnedEnvironmentSoundVoiceKey(userId: string, key: string): boolean {
  const safeUserId = safePathSegment(userId)
  if (!safeUserId || key.includes('..') || key.includes('\\')) return false
  return new RegExp(`^video-tools/${escapeRegExp(safeUserId)}/voice-inputs/[a-zA-Z0-9_-]+\\.(?:mp3|wav|m4a|flac|ogg)$`).test(key)
}

export function isOwnedEnvironmentSoundOutputKey(userId: string, key: string): boolean {
  const safeUserId = safePathSegment(userId)
  if (!safeUserId || key.includes('..') || key.includes('\\')) return false
  return new RegExp(`^video-tools/${escapeRegExp(safeUserId)}/environment-sounds/[a-zA-Z0-9_-]+\\.mp3$`).test(key)
}

export function isOwnedEnvironmentSoundTemporaryObjectKey(userId: string, key: string): boolean {
  return isOwnedEnvironmentSoundVoiceKey(userId, key) || isOwnedEnvironmentSoundOutputKey(userId, key)
}

export function assertEnvironmentSoundVideoDuration(durationSeconds: number): void {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('ENVIRONMENT_SOUND_VIDEO_DURATION_INVALID')
  }
  if (durationSeconds > ENVIRONMENT_SOUND_MAX_VIDEO_DURATION_SECONDS) {
    throw new Error('ENVIRONMENT_SOUND_VIDEO_TOO_LONG')
  }
}

export function buildEnvironmentSoundVoiceInputKey(
  userId: string,
  extension: string,
  id: string = randomUUID(),
): string {
  const safeUserId = safePathSegment(userId)
  const safeExtension = extension.replace(/[^a-z0-9]+/gi, '').toLowerCase()
  const safeId = safePathSegment(id)
  if (!safeUserId || !safeExtension || !safeId) throw new Error('ENVIRONMENT_SOUND_VOICE_KEY_INVALID')
  return `video-tools/${safeUserId}/voice-inputs/${safeId}.${safeExtension}`
}

export function buildEnvironmentSoundOutputKey(userId: string, id: string = randomUUID()): string {
  const safeUserId = safePathSegment(userId)
  const safeId = safePathSegment(id)
  if (!safeUserId || !safeId) throw new Error('ENVIRONMENT_SOUND_OUTPUT_KEY_INVALID')
  return `video-tools/${safeUserId}/environment-sounds/${safeId}.mp3`
}

export function validateEnvironmentSoundVoiceUpload(metadata: UploadMetadata): {
  extension: string
  mimeType: string
} {
  if (!Number.isFinite(metadata.size) || metadata.size <= 0) {
    throw new Error('ENVIRONMENT_SOUND_VOICE_EMPTY')
  }
  if (metadata.size > ENVIRONMENT_SOUND_MAX_VOICE_UPLOAD_BYTES) {
    throw new Error('ENVIRONMENT_SOUND_VOICE_TOO_LARGE')
  }

  const extension = extname(metadata.name).replace(/^\./, '').toLowerCase()
  const mimeType = VOICE_MIME_BY_EXTENSION[extension]
  const providedMime = metadata.type.trim().toLowerCase()
  if (!mimeType || (providedMime && !providedMime.startsWith('audio/'))) {
    throw new Error('ENVIRONMENT_SOUND_VOICE_UNSUPPORTED')
  }
  return { extension, mimeType }
}

function parseEnvironmentSoundZone(value: unknown, index: number): EnvironmentSoundZone {
  if (!isRecord(value)) throw new Error('ENVIRONMENT_SOUND_PLAN_ZONE_INVALID')
  const startSeconds = roundTime(readFiniteNumber(value.startSeconds, 'ENVIRONMENT_SOUND_PLAN_ZONE_TIME_INVALID'))
  const endSeconds = roundTime(readFiniteNumber(value.endSeconds, 'ENVIRONMENT_SOUND_PLAN_ZONE_TIME_INVALID'))
  if (startSeconds < 0 || endSeconds - startSeconds < 1) {
    throw new Error('ENVIRONMENT_SOUND_PLAN_ZONE_TIME_INVALID')
  }

  const rawPromptEn = readString(value.promptEn, 'ENVIRONMENT_SOUND_PLAN_PROMPT_REQUIRED', 1_900)
  if (!hasEnglishPromptSignal(rawPromptEn)) throw new Error('ENVIRONMENT_SOUND_PLAN_PROMPT_NOT_ENGLISH')
  const promptEn = withRequiredPositivePromptConstraints(rawPromptEn)
  const rawNegativePrompt = readOptionalString(
    value.negativePromptEn,
    'ENVIRONMENT_SOUND_PLAN_NEGATIVE_PROMPT_INVALID',
    900,
  )
  const transitionToNext = value.transitionToNext
  if (transitionToNext !== 'smooth' && transitionToNext !== 'hard') {
    throw new Error('ENVIRONMENT_SOUND_PLAN_TRANSITION_INVALID')
  }

  return {
    id: readOptionalString(value.id, 'ENVIRONMENT_SOUND_PLAN_ZONE_ID_INVALID', 100) || `zone-${index + 1}`,
    startSeconds,
    endSeconds,
    sceneZh: readString(value.sceneZh, 'ENVIRONMENT_SOUND_PLAN_SCENE_REQUIRED', 1_000),
    ambienceZh: readString(value.ambienceZh, 'ENVIRONMENT_SOUND_PLAN_AMBIENCE_REQUIRED', 1_000),
    eventSoundsZh: readStringArray(value.eventSoundsZh, 'ENVIRONMENT_SOUND_PLAN_EVENTS_INVALID'),
    avoidSoundsZh: readStringArray(value.avoidSoundsZh, 'ENVIRONMENT_SOUND_PLAN_AVOID_INVALID'),
    promptEn,
    negativePromptEn: withRequiredNegativePromptTerms(rawNegativePrompt),
    transitionToNext,
  }
}

export function parseEnvironmentSoundPlan(value: unknown): EnvironmentSoundPlan {
  if (!isRecord(value)) throw new Error('ENVIRONMENT_SOUND_PLAN_REQUIRED')
  const durationSeconds = roundTime(readFiniteNumber(value.durationSeconds, 'ENVIRONMENT_SOUND_PLAN_DURATION_INVALID'))
  if (durationSeconds < 1 || durationSeconds > ENVIRONMENT_SOUND_MAX_VIDEO_DURATION_SECONDS) {
    throw new Error('ENVIRONMENT_SOUND_PLAN_DURATION_INVALID')
  }
  if (!Array.isArray(value.zones) || value.zones.length === 0 || value.zones.length > MAX_ZONES) {
    throw new Error('ENVIRONMENT_SOUND_PLAN_ZONES_INVALID')
  }

  const zones = value.zones.map(parseEnvironmentSoundZone)
  if (Math.abs(zones[0]!.startSeconds) > PLAN_TIME_TOLERANCE_SECONDS) {
    throw new Error('ENVIRONMENT_SOUND_PLAN_NOT_CONTIGUOUS')
  }
  for (let index = 1; index < zones.length; index += 1) {
    if (Math.abs(zones[index]!.startSeconds - zones[index - 1]!.endSeconds) > PLAN_TIME_TOLERANCE_SECONDS) {
      throw new Error('ENVIRONMENT_SOUND_PLAN_NOT_CONTIGUOUS')
    }
  }
  if (Math.abs(zones.at(-1)!.endSeconds - durationSeconds) > PLAN_TIME_TOLERANCE_SECONDS) {
    throw new Error('ENVIRONMENT_SOUND_PLAN_DURATION_MISMATCH')
  }
  const plannedAudioSeconds = zones.reduce(
    (total, zone) => total + zone.endSeconds - zone.startSeconds,
    0,
  )
  if (Math.abs(plannedAudioSeconds - durationSeconds) > PLAN_TIME_TOLERANCE_SECONDS) {
    throw new Error('ENVIRONMENT_SOUND_PLAN_DURATION_MISMATCH')
  }

  return {
    durationSeconds,
    summaryZh: readString(value.summaryZh, 'ENVIRONMENT_SOUND_PLAN_SUMMARY_REQUIRED', 4_000),
    zones,
  }
}

export function applyEnvironmentSoundPromptSync(
  planInput: EnvironmentSoundPlan,
  response: unknown,
): EnvironmentSoundPlan {
  const plan = parseEnvironmentSoundPlan(planInput)
  if (!isRecord(response) || !Array.isArray(response.zones) || response.zones.length !== plan.zones.length) {
    throw new Error('ENVIRONMENT_SOUND_PROMPT_SYNC_ZONES_INVALID')
  }

  const promptsById = new Map<string, { promptEn: string; negativePromptEn?: string }>()
  for (const value of response.zones) {
    if (!isRecord(value)) throw new Error('ENVIRONMENT_SOUND_PROMPT_SYNC_ZONE_INVALID')
    const id = readString(value.id, 'ENVIRONMENT_SOUND_PROMPT_SYNC_ZONE_ID_INVALID', 100)
    if (promptsById.has(id)) throw new Error('ENVIRONMENT_SOUND_PROMPT_SYNC_ZONE_ID_INVALID')
    promptsById.set(id, {
      promptEn: readString(value.promptEn, 'ENVIRONMENT_SOUND_PROMPT_SYNC_PROMPT_INVALID', 1_900),
      negativePromptEn: readOptionalString(
        value.negativePromptEn,
        'ENVIRONMENT_SOUND_PROMPT_SYNC_NEGATIVE_INVALID',
        900,
      ),
    })
  }

  if (promptsById.size !== plan.zones.length || plan.zones.some((zone) => !promptsById.has(zone.id))) {
    throw new Error('ENVIRONMENT_SOUND_PROMPT_SYNC_ZONES_INVALID')
  }

  return parseEnvironmentSoundPlan({
    ...plan,
    zones: plan.zones.map((zone) => {
      const synchronized = promptsById.get(zone.id)!
      return {
        ...zone,
        promptEn: synchronized.promptEn,
        negativePromptEn: synchronized.negativePromptEn || '',
      }
    }),
  })
}

export function parseEnvironmentSoundSubmission(userId: string, value: unknown): EnvironmentSoundSubmission {
  if (!isRecord(value)) throw new Error('ENVIRONMENT_SOUND_SUBMISSION_INVALID')
  const action = value.action
  if (action !== 'analyze' && action !== 'generate') throw new Error('ENVIRONMENT_SOUND_ACTION_INVALID')
  const videoKey = readString(value.videoKey, 'ENVIRONMENT_SOUND_VIDEO_REQUIRED', 1_000)
  if (!isOwnedEnvironmentSoundVideoKey(userId, videoKey)) {
    throw new Error('ENVIRONMENT_SOUND_VIDEO_NOT_OWNED')
  }
  const videoName = readString(value.videoName, 'ENVIRONMENT_SOUND_VIDEO_NAME_REQUIRED', 255)

  if (action === 'generate') {
    return { action, videoKey, videoName, plan: parseEnvironmentSoundPlan(value.plan) }
  }

  const voiceKey = readOptionalString(value.voiceKey, 'ENVIRONMENT_SOUND_VOICE_KEY_INVALID', 1_000)
  if (voiceKey && !isOwnedEnvironmentSoundVoiceKey(userId, voiceKey)) {
    throw new Error('ENVIRONMENT_SOUND_VOICE_NOT_OWNED')
  }
  const scriptDialogue = readOptionalString(
    value.scriptDialogue,
    'ENVIRONMENT_SOUND_SCRIPT_INVALID',
    MAX_SCRIPT_LENGTH,
  )
  return {
    action,
    videoKey,
    videoName,
    ...(scriptDialogue ? { scriptDialogue } : {}),
    ...(voiceKey ? { voiceKey } : {}),
  }
}

function stableSeed(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function buildEnvironmentSoundPieces(planInput: EnvironmentSoundPlan): EnvironmentSoundPiece[] {
  const plan = parseEnvironmentSoundPlan(planInput)
  const pieces: EnvironmentSoundPiece[] = []

  plan.zones.forEach((zone, zoneIndex) => {
    let remaining = roundTime(zone.endSeconds - zone.startSeconds)
    let timelineStartSeconds = zone.startSeconds
    let pieceIndex = 0

    while (remaining > 0.0005) {
      const hasInternalNext = remaining > ENVIRONMENT_SOUND_MAX_GENERATION_SECONDS - 1
      const transitionSeconds = hasInternalNext
        ? 1
        : zoneIndex === plan.zones.length - 1
          ? 0
          : zone.transitionToNext === 'smooth' ? 1 : 0.1
      const maxTimelineDuration = ENVIRONMENT_SOUND_MAX_GENERATION_SECONDS - transitionSeconds
      const timelineDurationSeconds = roundTime(Math.min(remaining, maxTimelineDuration))
      const generationDurationSeconds = roundTime(timelineDurationSeconds + transitionSeconds)
      pieces.push({
        zoneId: zone.id,
        zoneIndex,
        pieceIndex,
        timelineStartSeconds: roundTime(timelineStartSeconds),
        timelineDurationSeconds,
        generationDurationSeconds,
        transitionSeconds,
        promptEn: zone.promptEn,
        negativePromptEn: zone.negativePromptEn,
        seed: stableSeed(`${zone.id}:${pieceIndex}:${zone.promptEn}`),
      })
      remaining = roundTime(remaining - timelineDurationSeconds)
      timelineStartSeconds = roundTime(timelineStartSeconds + timelineDurationSeconds)
      pieceIndex += 1
    }
  })

  return pieces
}
