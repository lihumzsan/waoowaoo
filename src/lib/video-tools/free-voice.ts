import { randomUUID } from 'node:crypto'
import type { Locale } from '@/i18n/routing'
import { getProviderConfig, getProviderKey, resolveModelSelectionOrSingle } from '@/lib/api-config'
import { ApiError } from '@/lib/api-errors'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { resolveMediaContentType, resolveMediaExt } from '@/lib/media-process'
import { prisma } from '@/lib/prisma'
import { runComfyUiAudioWorkflow } from '@/lib/providers/comfyui/client'
import { redis } from '@/lib/redis'
import { extractStorageKey, getSignedUrl, toFetchableUrl } from '@/lib/storage'
import { addTaskJob } from '@/lib/task/queues'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { resolveComfyUiSingleVoiceWorkflowKey } from '@/lib/voice/comfyui-voice-workflow'

export const VIDEO_TOOL_FREE_VOICE_TARGET_TYPE = 'VideoToolsFreeVoice'
export const VIDEO_TOOL_FREE_VOICE_TTL_SECONDS = 86_400
const MAX_RECORDS = 20

export type VideoToolFreeVoiceStatus = 'queued' | 'processing' | 'completed' | 'failed'

export type VideoToolFreeVoiceRecord = {
  id: string
  taskId: string
  text: string
  voiceName: string
  projectId?: string
  projectName?: string
  characterId?: string
  characterName?: string
  status: VideoToolFreeVoiceStatus
  progress: number
  audioUrl?: string | null
  audioModel?: string | null
  audioDuration?: number | null
  mimeType?: string | null
  errorMessage?: string | null
  createdAt: string
  updatedAt: string
}

type StoredAudio = {
  mimeType: string
  data: string
}

function recordsKey(userId: string) {
  return `video-tools:free-voice:${userId}:records`
}

function audioKey(userId: string, recordId: string) {
  return `video-tools:free-voice:${userId}:${recordId}:audio`
}

function audioUrl(recordId: string) {
  return `/api/video-tools/free-voice/${encodeURIComponent(recordId)}/audio`
}

function parseRecords(raw: string | null): VideoToolFreeVoiceRecord[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value.filter((item): item is VideoToolFreeVoiceRecord =>
      !!item
      && typeof item.id === 'string'
      && typeof item.taskId === 'string'
      && typeof item.text === 'string'
      && typeof item.voiceName === 'string'
      && typeof item.status === 'string'
      && typeof item.createdAt === 'string'
      && typeof item.updatedAt === 'string',
    )
  } catch {
    return []
  }
}

export async function listVideoToolFreeVoiceRecords(userId: string) {
  return parseRecords(await redis.get(recordsKey(userId)))
}

export async function saveVideoToolFreeVoiceRecord(userId: string, record: VideoToolFreeVoiceRecord) {
  const records = await listVideoToolFreeVoiceRecords(userId)
  const next = [
    record,
    ...records.filter((item) => item.id !== record.id),
  ].slice(0, MAX_RECORDS)
  await redis.set(recordsKey(userId), JSON.stringify(next), 'EX', VIDEO_TOOL_FREE_VOICE_TTL_SECONDS)
  return record
}

export async function updateVideoToolFreeVoiceRecord(
  userId: string,
  recordId: string,
  updates: Partial<VideoToolFreeVoiceRecord>,
) {
  const records = await listVideoToolFreeVoiceRecords(userId)
  const current = records.find((item) => item.id === recordId)
  if (!current) return null
  return await saveVideoToolFreeVoiceRecord(userId, {
    ...current,
    ...updates,
    id: current.id,
    taskId: current.taskId,
    updatedAt: new Date().toISOString(),
  })
}

export async function saveVideoToolFreeVoiceAudio(
  userId: string,
  recordId: string,
  audioData: Buffer,
  mimeType: string,
) {
  const stored: StoredAudio = {
    mimeType,
    data: audioData.toString('base64'),
  }
  await redis.set(audioKey(userId, recordId), JSON.stringify(stored), 'EX', VIDEO_TOOL_FREE_VOICE_TTL_SECONDS)
}

export async function getVideoToolFreeVoiceAudio(userId: string, recordId: string) {
  const raw = await redis.get(audioKey(userId, recordId))
  if (!raw) return null
  try {
    const stored = JSON.parse(raw) as Partial<StoredAudio>
    if (typeof stored.mimeType !== 'string' || typeof stored.data !== 'string') return null
    return {
      mimeType: stored.mimeType,
      data: Buffer.from(stored.data, 'base64'),
    }
  } catch {
    return null
  }
}

function wavDurationMs(buffer: Buffer): number {
  try {
    if (buffer.length < 32 || buffer.subarray(0, 4).toString('ascii') !== 'RIFF') {
      return Math.max(1, Math.round((buffer.length * 8) / 128))
    }
    const byteRate = buffer.readUInt32LE(28)
    let offset = 12
    while (offset + 8 <= buffer.length) {
      const id = buffer.subarray(offset, offset + 4).toString('ascii')
      const size = buffer.readUInt32LE(offset + 4)
      if (id === 'data' && byteRate > 0) return Math.round((size / byteRate) * 1000)
      offset += 8 + size
    }
  } catch {
    // Fall through to the conservative bitrate estimate.
  }
  return Math.max(1, Math.round((buffer.length * 8) / 128))
}

async function resolveComfyUiReferenceAudioUrl(value: string): Promise<string> {
  if (value.startsWith('http') || value.startsWith('data:')) return value
  const storageKey = await resolveStorageKeyFromMediaValue(value) ?? extractStorageKey(value)
  if (!storageKey) throw new Error('FREE_VOICE_REFERENCE_AUDIO_NOT_FOUND')
  return toFetchableUrl(getSignedUrl(storageKey, 3600))
}

async function resolveVideoToolFreeVoiceModel(userId: string, configuredModel: string | null) {
  const selection = await resolveModelSelectionOrSingle(userId, configuredModel, 'audio')
  if (getProviderKey(selection.provider).toLowerCase() !== 'comfyui') {
    throw new ApiError('INVALID_PARAMS', { message: 'FREE_VOICE_COMFYUI_REQUIRED' })
  }
  const config = await getProviderConfig(userId, selection.provider)
  if (!config.baseUrl) {
    throw new ApiError('INVALID_PARAMS', { message: 'COMFYUI_BASE_URL_MISSING' })
  }
  return { selection, baseUrl: config.baseUrl }
}

export async function createVideoToolFreeVoiceTask(params: {
  userId: string
  locale: Locale
  requestId?: string | null
  text: string
  projectId: string
  characterId: string
}) {
  const text = params.text.trim()
  const projectId = params.projectId.trim()
  const characterId = params.characterId.trim()
  if (!text || !projectId || !characterId) throw new ApiError('INVALID_PARAMS')

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId: params.userId },
    select: {
      id: true,
      name: true,
      novelPromotionData: { select: { id: true, audioModel: true } },
    },
  })
  if (!project?.novelPromotionData) throw new ApiError('NOT_FOUND')

  const character = await prisma.novelPromotionCharacter.findFirst({
    where: {
      id: characterId,
      novelPromotionProjectId: project.novelPromotionData.id,
    },
    select: { id: true, name: true, customVoiceUrl: true },
  })
  if (!character) throw new ApiError('NOT_FOUND')
  if (!character.customVoiceUrl) {
    throw new ApiError('INVALID_PARAMS', { message: 'FREE_VOICE_REFERENCE_AUDIO_REQUIRED' })
  }

  const { selection } = await resolveVideoToolFreeVoiceModel(params.userId, project.novelPromotionData.audioModel)
  const recordId = randomUUID()
  const taskId = `free_voice-${recordId}`
  const now = new Date().toISOString()
  const record: VideoToolFreeVoiceRecord = {
    id: recordId,
    taskId,
    text,
    voiceName: character.name,
    projectId: project.id,
    projectName: project.name,
    characterId: character.id,
    characterName: character.name,
    status: 'queued',
    progress: 0,
    audioModel: selection.modelKey,
    createdAt: now,
    updatedAt: now,
  }
  await saveVideoToolFreeVoiceRecord(params.userId, record)

  const jobData: TaskJobData = {
    taskId,
    persistence: 'transient',
    type: TASK_TYPE.FREE_VOICE,
    locale: params.locale,
    projectId: project.id,
    episodeId: null,
    targetType: VIDEO_TOOL_FREE_VOICE_TARGET_TYPE,
    targetId: recordId,
    payload: {
      text,
      referenceAudioUrl: character.customVoiceUrl,
      audioModel: selection.modelKey,
    },
    userId: params.userId,
    trace: {
      requestId: params.requestId || null,
    },
  }
  const job = await addTaskJob(jobData, {
    attempts: 1,
    removeOnComplete: { age: VIDEO_TOOL_FREE_VOICE_TTL_SECONDS, count: MAX_RECORDS },
    removeOnFail: { age: VIDEO_TOOL_FREE_VOICE_TTL_SECONDS, count: MAX_RECORDS },
  })

  return {
    record: { ...record, taskId: String(job.id || taskId) },
    taskId: String(job.id || taskId),
  }
}

export async function generateVideoToolFreeVoice(params: {
  recordId: string
  userId: string
  locale?: Locale
  text: string
  referenceAudioUrl: string
  audioModel?: string | null
}) {
  void params.locale
  const text = params.text.trim()
  if (!text || !params.referenceAudioUrl) throw new Error('FREE_VOICE_INVALID_TRANSIENT_PAYLOAD')

  await updateVideoToolFreeVoiceRecord(params.userId, params.recordId, {
    status: 'processing',
    progress: 20,
  })

  try {
    const selection = await resolveModelSelectionOrSingle(params.userId, params.audioModel || null, 'audio')
    if (getProviderKey(selection.provider).toLowerCase() !== 'comfyui') {
      throw new Error('FREE_VOICE_COMFYUI_REQUIRED')
    }
    const { baseUrl } = await getProviderConfig(params.userId, selection.provider)
    if (!baseUrl) throw new Error('COMFYUI_BASE_URL_MISSING')

    const referenceAudioUrl = await resolveComfyUiReferenceAudioUrl(params.referenceAudioUrl)
    const result = await runComfyUiAudioWorkflow({
      baseUrl,
      workflowKey: resolveComfyUiSingleVoiceWorkflowKey(selection.modelId),
      prompt: text,
      referenceAudioUrls: [referenceAudioUrl],
    })

    const audioData = Buffer.from(result.audioBase64, 'base64')
    const audioExt = resolveMediaExt('audio', audioData, result.mimeType)
    const mimeType = result.mimeType || resolveMediaContentType(audioExt)
    const durationMs = wavDurationMs(audioData)
    await saveVideoToolFreeVoiceAudio(params.userId, params.recordId, audioData, mimeType)
    const finalAudioUrl = audioUrl(params.recordId)
    await updateVideoToolFreeVoiceRecord(params.userId, params.recordId, {
      status: 'completed',
      progress: 100,
      audioModel: selection.modelKey,
      audioUrl: finalAudioUrl,
      audioDuration: durationMs,
      mimeType,
      errorMessage: null,
    })

    return {
      recordId: params.recordId,
      audioUrl: finalAudioUrl,
      audioDuration: durationMs,
      mimeType,
    }
  } catch (error) {
    await updateVideoToolFreeVoiceRecord(params.userId, params.recordId, {
      status: 'failed',
      progress: 100,
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
