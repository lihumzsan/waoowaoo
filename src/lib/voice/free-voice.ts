import type { Locale } from '@/i18n/routing'
import { getProviderConfig, getProviderKey, resolveModelSelectionOrSingle } from '@/lib/api-config'
import { ensureMediaObjectFromStorageKey, resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { resolveMediaContentType, resolveMediaExt } from '@/lib/media-process'
import { prisma } from '@/lib/prisma'
import { runComfyUiAudioWorkflow } from '@/lib/providers/comfyui/client'
import { extractStorageKey, getSignedUrl, toFetchableUrl, uploadObject } from '@/lib/storage'
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
