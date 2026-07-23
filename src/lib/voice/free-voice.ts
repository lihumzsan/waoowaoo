import type { Locale } from '@/i18n/routing'
import { getProviderConfig, getProviderKey, resolveModelSelectionOrSingle } from '@/lib/api-config'
import { ApiError } from '@/lib/api-errors'
import { logError as _ulogError } from '@/lib/logging/core'
import { ensureMediaObjectFromStorageKey, resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { deleteMediaObjectIfUnreferenced } from '@/lib/media/unreferenced-cleanup'
import { resolveMediaContentType, resolveMediaExt } from '@/lib/media-process'
import { prisma } from '@/lib/prisma'
import { runComfyUiAudioWorkflow } from '@/lib/providers/comfyui/client'
import { extractStorageKey, getSignedUrl, toFetchableUrl, uploadObject } from '@/lib/storage'
import { submitTask } from '@/lib/task/submitter'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { resolveComfyUiSingleVoiceWorkflowKey } from './comfyui-voice-workflow'

type CheckCancelled = () => Promise<void>

type FreeVoiceVersionRow = {
  id: string
  recordId: string
  audioModel: string
  record: {
    id: string
    text: string
    referenceAudioUrl: string
    novelPromotionProject: { projectId: string }
  }
}

type FreeVoiceVersionDelegate = {
  findUnique(args: unknown): Promise<FreeVoiceVersionRow | null>
  update(args: unknown): Promise<unknown>
}

function freeVoiceVersionDelegate(): FreeVoiceVersionDelegate {
  return (prisma as unknown as {
    novelPromotionFreeVoiceVersion: FreeVoiceVersionDelegate
  }).novelPromotionFreeVoiceVersion
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

export async function generateFreeVoiceVersion(params: {
  projectId: string
  versionId: string
  userId: string
  locale?: Locale
  checkCancelled?: CheckCancelled
}) {
  const versions = freeVoiceVersionDelegate()
  const version = await versions.findUnique({
    where: { id: params.versionId },
    include: {
      record: {
        include: { novelPromotionProject: { select: { projectId: true } } },
      },
    },
  })
  if (!version || version.record.novelPromotionProject.projectId !== params.projectId) {
    throw new Error('FREE_VOICE_VERSION_NOT_FOUND')
  }

  await params.checkCancelled?.()
  const selection = await resolveModelSelectionOrSingle(params.userId, version.audioModel, 'audio')
  if (getProviderKey(selection.provider).toLowerCase() !== 'comfyui') {
    throw new Error('FREE_VOICE_COMFYUI_REQUIRED')
  }
  const { baseUrl } = await getProviderConfig(params.userId, selection.provider)
  if (!baseUrl) throw new Error('COMFYUI_BASE_URL_MISSING')

  const referenceAudioUrl = await resolveComfyUiReferenceAudioUrl(version.record.referenceAudioUrl)
  const result = await runComfyUiAudioWorkflow({
    baseUrl,
    workflowKey: resolveComfyUiSingleVoiceWorkflowKey(selection.modelId),
    prompt: version.record.text.trim(),
    referenceAudioUrls: [referenceAudioUrl],
  })
  await params.checkCancelled?.()

  const audioData = Buffer.from(result.audioBase64, 'base64')
  const audioExt = resolveMediaExt('audio', audioData, result.mimeType)
  const mimeType = result.mimeType || resolveMediaContentType(audioExt)
  const storageKey = await uploadObject(
    audioData,
    `voice/free/${params.projectId}/${version.recordId}/${version.id}.${audioExt}`,
    undefined,
    mimeType,
  )
  await params.checkCancelled?.()

  const durationMs = wavDurationMs(audioData)
  const media = await ensureMediaObjectFromStorageKey(storageKey, {
    mimeType,
    sizeBytes: audioData.length,
    durationMs,
  })
  await versions.update({
    where: { id: version.id },
    data: {
      audioModel: selection.modelKey,
      audioUrl: media.url,
      audioMediaId: media.id,
      audioDuration: media.durationMs ?? durationMs,
    },
  })

  return { versionId: version.id, audioUrl: media.url }
}

const FREE_VOICE_TARGET_TYPE = 'NovelPromotionFreeVoiceVersion'

function taskDto(task: {
  id: string
  status: string
  progress: number
  errorCode: string | null
  errorMessage: string | null
} | undefined) {
  if (!task) return null
  return {
    id: task.id,
    status: task.status,
    progress: task.progress,
    errorCode: task.errorCode,
    errorMessage: task.errorMessage,
  }
}

export async function listFreeVoiceRecords(projectId: string) {
  const project = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: { id: true },
  })
  if (!project) throw new ApiError('NOT_FOUND')

  const records = await prisma.novelPromotionFreeVoiceRecord.findMany({
    where: { novelPromotionProjectId: project.id },
    orderBy: { createdAt: 'desc' },
    include: { versions: { orderBy: { versionNumber: 'desc' } } },
  })
  const versionIds = records.flatMap((record) => record.versions.map((version) => version.id))
  const tasks = versionIds.length === 0 ? [] : await prisma.task.findMany({
    where: {
      type: TASK_TYPE.FREE_VOICE,
      targetType: FREE_VOICE_TARGET_TYPE,
      targetId: { in: versionIds },
    },
    orderBy: { queuedAt: 'desc' },
    select: {
      id: true,
      targetId: true,
      status: true,
      progress: true,
      errorCode: true,
      errorMessage: true,
    },
  })
  const latestTaskByVersion = new Map<string, (typeof tasks)[number]>()
  for (const task of tasks) {
    if (!latestTaskByVersion.has(task.targetId)) latestTaskByVersion.set(task.targetId, task)
  }

  return records.map((record) => ({
    ...record,
    versions: record.versions.map((version) => ({
      ...version,
      task: taskDto(latestTaskByVersion.get(version.id)),
    })),
  }))
}

async function resolveFreeVoiceModel(userId: string, configuredModel: string | null) {
  const selection = await resolveModelSelectionOrSingle(userId, configuredModel, 'audio')
  if (getProviderKey(selection.provider).toLowerCase() !== 'comfyui') {
    throw new ApiError('INVALID_PARAMS', { message: 'FREE_VOICE_COMFYUI_REQUIRED' })
  }
  const config = await getProviderConfig(userId, selection.provider)
  if (!config.baseUrl) {
    throw new ApiError('INVALID_PARAMS', { message: 'COMFYUI_BASE_URL_MISSING' })
  }
  return selection
}

async function submitFreeVoiceTask(params: {
  projectId: string
  versionId: string
  userId: string
  locale: Locale
  requestId?: string | null
  audioModel: string
}) {
  return submitTask({
    userId: params.userId,
    locale: params.locale,
    requestId: params.requestId,
    projectId: params.projectId,
    episodeId: null,
    type: TASK_TYPE.FREE_VOICE,
    targetType: 'NovelPromotionFreeVoiceVersion',
    targetId: params.versionId,
    payload: withTaskUiPayload({
      versionId: params.versionId,
      audioModel: params.audioModel,
    }, { intent: 'generate', hasOutputAtStart: false }),
    dedupeKey: `free_voice:${params.versionId}`,
  })
}

export async function createFreeVoiceRecord(params: {
  projectId: string
  userId: string
  locale: Locale
  requestId?: string | null
  text: string
  characterId: string
  voiceSourceType: 'character' | 'global_voice'
  voiceSourceId?: string | null
}) {
  const text = params.text.trim()
  if (!text || !params.characterId) throw new ApiError('INVALID_PARAMS')

  const project = await prisma.novelPromotionProject.findUnique({
    where: { projectId: params.projectId },
    select: {
      id: true,
      audioModel: true,
      characters: {
        where: { id: params.characterId },
        select: {
          id: true,
          name: true,
          customVoiceUrl: true,
          customVoiceMediaId: true,
        },
      },
    },
  })
  const character = project?.characters[0]
  if (!project || !character) throw new ApiError('NOT_FOUND')
  const model = await resolveFreeVoiceModel(params.userId, project.audioModel)

  let voiceSourceId: string
  let voiceName: string
  let referenceAudioUrl: string | null
  let referenceAudioMediaId: string | null
  if (params.voiceSourceType === 'global_voice') {
    const sourceId = params.voiceSourceId?.trim()
    if (!sourceId) throw new ApiError('INVALID_PARAMS')
    const voice = await prisma.globalVoice.findFirst({
      where: { id: sourceId, userId: params.userId },
      select: { id: true, name: true, customVoiceUrl: true, customVoiceMediaId: true },
    })
    if (!voice) throw new ApiError('NOT_FOUND')
    voiceSourceId = voice.id
    voiceName = voice.name
    referenceAudioUrl = voice.customVoiceUrl
    referenceAudioMediaId = voice.customVoiceMediaId
  } else {
    voiceSourceId = character.id
    voiceName = character.name
    referenceAudioUrl = character.customVoiceUrl
    referenceAudioMediaId = character.customVoiceMediaId
  }
  if (!referenceAudioUrl) {
    throw new ApiError('INVALID_PARAMS', { message: 'FREE_VOICE_REFERENCE_AUDIO_REQUIRED' })
  }

  const created = await prisma.$transaction(async (tx) => {
    const record = await tx.novelPromotionFreeVoiceRecord.create({
      data: {
        novelPromotionProjectId: project.id,
        text,
        characterId: character.id,
        characterName: character.name,
        voiceSourceType: params.voiceSourceType,
        voiceSourceId,
        voiceName,
        referenceAudioUrl,
        referenceAudioMediaId,
      },
    })
    const version = await tx.novelPromotionFreeVoiceVersion.create({
      data: { recordId: record.id, versionNumber: 1, audioModel: model.modelKey },
    })
    return { record, version }
  })

  try {
    const task = await submitFreeVoiceTask({
      projectId: params.projectId,
      versionId: created.version.id,
      userId: params.userId,
      locale: params.locale,
      requestId: params.requestId,
      audioModel: model.modelKey,
    })
    return { ...created, taskId: task.taskId }
  } catch (error) {
    // Explicit submission compensation: the queue never accepted this record/version.
    await prisma.novelPromotionFreeVoiceRecord.deleteMany({ where: { id: created.record.id } })
    throw error
  }
}

export async function createFreeVoiceVersion(params: {
  projectId: string
  recordId: string
  userId: string
  locale: Locale
  requestId?: string | null
}) {
  const record = await prisma.novelPromotionFreeVoiceRecord.findFirst({
    where: { id: params.recordId, novelPromotionProject: { projectId: params.projectId } },
    include: { novelPromotionProject: { select: { audioModel: true } } },
  })
  if (!record) throw new ApiError('NOT_FOUND')
  const model = await resolveFreeVoiceModel(params.userId, record.novelPromotionProject.audioModel)

  const version = await prisma.$transaction(async (tx) => {
    const latest = await tx.novelPromotionFreeVoiceVersion.findFirst({
      where: { recordId: record.id },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    })
    return tx.novelPromotionFreeVoiceVersion.create({
      data: {
        recordId: record.id,
        versionNumber: (latest?.versionNumber || 0) + 1,
        audioModel: model.modelKey,
      },
    })
  })

  try {
    const task = await submitFreeVoiceTask({
      projectId: params.projectId,
      versionId: version.id,
      userId: params.userId,
      locale: params.locale,
      requestId: params.requestId,
      audioModel: model.modelKey,
    })
    return { version, taskId: task.taskId }
  } catch (error) {
    // Explicit submission compensation: remove only the unqueued new version.
    await prisma.novelPromotionFreeVoiceVersion.deleteMany({ where: { id: version.id } })
    throw error
  }
}

async function assertNoActiveFreeVoiceTasks(recordId: string) {
  const versions = await prisma.novelPromotionFreeVoiceVersion.findMany({
    where: { recordId },
    select: { id: true },
  })
  const active = versions.length === 0 ? null : await prisma.task.findFirst({
    where: {
      type: TASK_TYPE.FREE_VOICE,
      targetType: FREE_VOICE_TARGET_TYPE,
      targetId: { in: versions.map((version) => version.id) },
      status: { in: [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] },
    },
    select: { id: true },
  })
  if (active) throw new ApiError('INVALID_PARAMS', { message: 'FREE_VOICE_TASK_ACTIVE' })
}

async function cleanupFreeVoiceMediaAfterRelationDeletion(params: {
  projectId: string
  recordId: string
  media: Array<{ mediaId: string | null; versionId: string }>
}) {
  const uniqueMedia = new Map<string, { mediaId: string; versionId: string }>()
  for (const candidate of params.media) {
    if (!candidate.mediaId || uniqueMedia.has(candidate.mediaId)) continue
    uniqueMedia.set(candidate.mediaId, {
      mediaId: candidate.mediaId,
      versionId: candidate.versionId,
    })
  }

  for (const candidate of uniqueMedia.values()) {
    try {
      await deleteMediaObjectIfUnreferenced(candidate.mediaId)
    } catch (error) {
      const storageKey = error && typeof error === 'object' && 'storageKey' in error
        && typeof error.storageKey === 'string'
        ? error.storageKey
        : undefined
      _ulogError('Free Voice media cleanup failed after relation deletion', {
        projectId: params.projectId,
        recordId: params.recordId,
        versionId: candidate.versionId,
        mediaId: candidate.mediaId,
        storageKey,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

export async function keepOnlyFreeVoiceVersion(params: {
  projectId: string
  recordId: string
  versionId: string
}) {
  const record = await prisma.novelPromotionFreeVoiceRecord.findFirst({
    where: { id: params.recordId, novelPromotionProject: { projectId: params.projectId } },
    include: { versions: true },
  })
  if (!record) throw new ApiError('NOT_FOUND')
  const kept = record.versions.find((version) => version.id === params.versionId)
  if (!kept || !kept.audioUrl) throw new ApiError('INVALID_PARAMS')
  await assertNoActiveFreeVoiceTasks(record.id)

  const removed = record.versions.filter((version) => version.id !== kept.id)
  await prisma.novelPromotionFreeVoiceVersion.deleteMany({
    where: { recordId: record.id, id: { not: kept.id } },
  })
  await cleanupFreeVoiceMediaAfterRelationDeletion({
    projectId: params.projectId,
    recordId: record.id,
    media: removed.map((version) => ({
      mediaId: version.audioMediaId,
      versionId: version.id,
    })),
  })
  return prisma.novelPromotionFreeVoiceRecord.findUnique({
    where: { id: record.id },
    include: { versions: { orderBy: { versionNumber: 'desc' } } },
  })
}

export async function deleteFreeVoiceRecord(params: { projectId: string; recordId: string }) {
  const record = await prisma.novelPromotionFreeVoiceRecord.findFirst({
    where: { id: params.recordId, novelPromotionProject: { projectId: params.projectId } },
    include: { versions: true },
  })
  if (!record) return { deleted: false }
  await assertNoActiveFreeVoiceTasks(record.id)
  await prisma.novelPromotionFreeVoiceRecord.delete({ where: { id: record.id } })
  await cleanupFreeVoiceMediaAfterRelationDeletion({
    projectId: params.projectId,
    recordId: record.id,
    media: record.versions.map((version) => ({
      mediaId: version.audioMediaId,
      versionId: version.id,
    })),
  })
  return { deleted: true }
}
