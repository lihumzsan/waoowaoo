import { logInfo as _ulogInfo } from '@/lib/logging/core'
import type { Locale } from '@/i18n/routing'
import { fal } from '@fal-ai/client'
import { prisma } from '@/lib/prisma'
import { getAudioApiKey, getProviderConfig, getProviderKey, resolveModelSelectionOrSingle } from '@/lib/api-config'
import { normalizeToBase64ForGeneration } from '@/lib/media/outbound-image'
import { extractStorageKey, getSignedUrl, toFetchableUrl, uploadObject } from '@/lib/storage'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { synthesizeWithBailianTTS } from '@/lib/providers/bailian'
import { runComfyUiAudioWorkflow } from '@/lib/providers/comfyui/client'
import {
  parseSpeakerVoiceMap,
  resolveVoiceBindingForProvider,
  type CharacterVoiceFields,
  type SpeakerVoiceMap,
} from '@/lib/voice/provider-voice-binding'
import { buildComfyUiLineRenderText } from '@/lib/voice/generate-voice-line-context'

type CheckCancelled = () => Promise<void>
type CharacterVoiceProfile = CharacterVoiceFields & {
  name: string
  aliases?: string | null
  introduction?: string | null
  profileData?: string | null
  appearances?: Array<{
    changeReason?: string | null
    description?: string | null
  }>
}

const COMFYUI_VOICE_LINE_WORKFLOW_FALLBACKS: Record<string, string> = {
  'baseaudio/多人/LongCat-two': 'baseaudio/单人/LongCat-one',
  'baseaudio/多人/s2-two': 'baseaudio/单人/s2-one',
  'baseaudio/三人/s2-three': 'baseaudio/单人/s2-one',
}

function resolveComfyUiVoiceLineWorkflowKey(modelId: string): string {
  const normalized = modelId.trim()
  return COMFYUI_VOICE_LINE_WORKFLOW_FALLBACKS[normalized] || normalized
}

function normalizeBailianVoiceGenerationError(errorMessage: string | null | undefined) {
  const message = typeof errorMessage === 'string' ? errorMessage.trim() : ''
  if (!message) return 'BAILIAN_AUDIO_GENERATION_FAILED'

  const normalized = message.toLowerCase()
  if (
    normalized.includes('bailian_tts_failed(400): invalidparameter') ||
    normalized.includes('invalidparameter')
  ) {
    return '无效音色ID，QwenTTS 必须使用 AI 设计音色'
  }

  return message
}

function getWavDurationFromBuffer(buffer: Buffer): number {
  try {
    const riff = buffer.slice(0, 4).toString('ascii')
    if (riff !== 'RIFF') {
      return Math.round((buffer.length * 8) / 128)
    }

    const byteRate = buffer.readUInt32LE(28)
    let offset = 12
    let dataSize = 0

    while (offset < buffer.length - 8) {
      const chunkId = buffer.slice(offset, offset + 4).toString('ascii')
      const chunkSize = buffer.readUInt32LE(offset + 4)

      if (chunkId === 'data') {
        dataSize = chunkSize
        break
      }

      offset += 8 + chunkSize
    }

    if (dataSize > 0 && byteRate > 0) {
      return Math.round((dataSize / byteRate) * 1000)
    }

    return Math.round((buffer.length * 8) / 128)
  } catch {
    return Math.round((buffer.length * 8) / 128)
  }
}

async function generateVoiceWithIndexTTS2(params: {
  endpoint: string
  referenceAudioUrl: string
  text: string
  emotionPrompt?: string | null
  strength?: number
  falApiKey?: string
}) {
  const strength = typeof params.strength === 'number' ? params.strength : 0.4

  _ulogInfo(`IndexTTS2: Generating with reference audio, strength: ${strength}`)
  if (params.emotionPrompt) {
    _ulogInfo(`IndexTTS2: Using emotion prompt: ${params.emotionPrompt}`)
  }

  if (params.falApiKey) {
    fal.config({ credentials: params.falApiKey })
  }

  const audioDataUrl = params.referenceAudioUrl.startsWith('data:')
    ? params.referenceAudioUrl
    : await normalizeToBase64ForGeneration(params.referenceAudioUrl)

  const input: {
    audio_url: string
    prompt: string
    should_use_prompt_for_emotion: boolean
    strength: number
    emotion_prompt?: string
  } = {
    audio_url: audioDataUrl,
    prompt: params.text,
    should_use_prompt_for_emotion: true,
    strength,
  }

  if (params.emotionPrompt?.trim()) {
    input.emotion_prompt = params.emotionPrompt.trim()
  }

  const result = await fal.subscribe(params.endpoint, {
    input,
    logs: false,
  })

  const audioUrl = (result as { data?: { audio?: { url?: string } } })?.data?.audio?.url
  if (!audioUrl) {
    throw new Error('No audio URL in response')
  }

  const audioData = await downloadAudioData(audioUrl)

  return {
    audioData,
    audioDuration: getWavDurationFromBuffer(audioData),
  }
}

function matchCharacterBySpeaker(
  speaker: string,
  characters: CharacterVoiceProfile[],
) {
  const exactMatch = characters.find((character) => character.name === speaker)
  if (exactMatch) return exactMatch
  return characters.find((character) => character.name.includes(speaker) || speaker.includes(character.name))
}

async function resolveReferenceAudioUrl(referenceAudioUrl: string): Promise<string> {
  if (referenceAudioUrl.startsWith('http') || referenceAudioUrl.startsWith('data:')) {
    return referenceAudioUrl
  }
  if (referenceAudioUrl.startsWith('/m/')) {
    const storageKey = await resolveStorageKeyFromMediaValue(referenceAudioUrl)
    if (!storageKey) {
      throw new Error(`无法解析参考音频路径: ${referenceAudioUrl}`)
    }
    return getSignedUrl(storageKey, 3600)
  }
  if (referenceAudioUrl.startsWith('/api/files/')) {
    const storageKey = extractStorageKey(referenceAudioUrl)
    return storageKey ? getSignedUrl(storageKey, 3600) : referenceAudioUrl
  }
  return getSignedUrl(referenceAudioUrl, 3600)
}

async function resolveComfyUiReferenceAudioUrl(referenceAudioUrl: string): Promise<string> {
  if (referenceAudioUrl.startsWith('http') || referenceAudioUrl.startsWith('data:')) {
    return referenceAudioUrl
  }

  const storageKey = await resolveStorageKeyFromMediaValue(referenceAudioUrl)
    ?? extractStorageKey(referenceAudioUrl)

  if (storageKey) {
    return toFetchableUrl(getSignedUrl(storageKey, 3600))
  }

  if (referenceAudioUrl.startsWith('/')) {
    return toFetchableUrl(referenceAudioUrl)
  }

  return toFetchableUrl(getSignedUrl(referenceAudioUrl, 3600))
}

async function downloadAudioData(audioUrl: string): Promise<Buffer> {
  const response = await fetch(toFetchableUrl(audioUrl))
  if (!response.ok) {
    throw new Error(`Audio download failed: ${response.status}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

export async function generateVoiceLine(params: {
  projectId: string
  episodeId?: string | null
  lineId: string
  userId: string
  locale?: Locale
  audioModel?: string
  checkCancelled?: CheckCancelled
}) {
  const checkCancelled = params.checkCancelled

  const line = await prisma.novelPromotionVoiceLine.findUnique({
    where: { id: params.lineId },
    select: {
      id: true,
      episodeId: true,
      speaker: true,
      content: true,
      emotionPrompt: true,
      emotionStrength: true,
      lineIndex: true,
      matchedStoryboardId: true,
      matchedPanelIndex: true,
    },
  })
  if (!line) {
    throw new Error('Voice line not found')
  }

  const episodeId = params.episodeId || line.episodeId
  if (!episodeId) {
    throw new Error('episodeId is required')
  }

  const [projectData, episode] = await Promise.all([
    prisma.novelPromotionProject.findUnique({
      where: { projectId: params.projectId },
      include: {
        characters: {
          include: {
            appearances: {
              orderBy: { appearanceIndex: 'asc' },
              select: {
                changeReason: true,
                description: true,
              },
            },
          },
        },
      },
    }),
    prisma.novelPromotionEpisode.findUnique({
      where: { id: episodeId },
      select: {
        speakerVoices: true,
        voiceLines: {
          orderBy: { lineIndex: 'asc' },
          select: {
            lineIndex: true,
            speaker: true,
            content: true,
          },
        },
        storyboards: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            clip: {
              select: {
                content: true,
              },
            },
            panels: {
              orderBy: { panelIndex: 'asc' },
              select: {
                panelIndex: true,
                srtSegment: true,
                description: true,
                characters: true,
              },
            },
          },
        },
      },
    }),
  ])

  if (!projectData) {
    throw new Error('Novel promotion project not found')
  }

  const speakerVoices: SpeakerVoiceMap = parseSpeakerVoiceMap(episode?.speakerVoices)

  const character = matchCharacterBySpeaker(line.speaker, projectData.characters || [])
  const speakerVoice = speakerVoices[line.speaker]

  const text = (line.content || '').trim()
  if (!text) {
    throw new Error('Voice line text is empty')
  }

  const audioSelection = await resolveModelSelectionOrSingle(params.userId, params.audioModel, 'audio')
  const providerKey = getProviderKey(audioSelection.provider).toLowerCase()
  const voiceBinding = resolveVoiceBindingForProvider({
    providerKey,
    character,
    speakerVoice,
  })
  let generated: { audioData: Buffer; audioDuration: number }
  let derivedEmotionPrompt: string | null = null
  if (providerKey === 'fal') {
    if (!voiceBinding || voiceBinding.provider !== 'fal') {
      throw new Error('请先为该发言人设置参考音频')
    }

    const fullAudioUrl = await resolveReferenceAudioUrl(voiceBinding.referenceAudioUrl)
    const falApiKey = await getAudioApiKey(params.userId, audioSelection.modelKey)
    generated = await generateVoiceWithIndexTTS2({
      endpoint: audioSelection.modelId,
      referenceAudioUrl: fullAudioUrl,
      text,
      emotionPrompt: line.emotionPrompt,
      strength: line.emotionStrength ?? 0.4,
      falApiKey,
    })
  } else if (providerKey === 'bailian') {
    if (!voiceBinding || voiceBinding.provider !== 'bailian') {
      const hasUploadedReference =
        !!character?.customVoiceUrl ||
        (speakerVoice?.provider === 'fal' && !!speakerVoice.audioUrl)
      if (hasUploadedReference) {
        throw new Error('无音色ID，QwenTTS 必须使用 AI 设计音色')
      }
      throw new Error('请先为该发言人绑定百炼音色')
    }
    const { apiKey } = await getProviderConfig(params.userId, audioSelection.provider)
    const result = await synthesizeWithBailianTTS({
      text,
      voiceId: voiceBinding.voiceId,
      modelId: audioSelection.modelId,
      languageType: 'Chinese',
    }, apiKey)
    if (!result.success || !result.audioData) {
      throw new Error(normalizeBailianVoiceGenerationError(result.error))
    }

    const audioData = result.audioData
    generated = {
      audioData,
      audioDuration: result.audioDuration ?? getWavDurationFromBuffer(audioData),
    }
  } else if (providerKey === 'comfyui') {
    if (!voiceBinding || voiceBinding.provider !== 'comfyui') {
      throw new Error('请先为该发言人设置参考音频')
    }

    const { baseUrl } = await getProviderConfig(params.userId, audioSelection.provider)
    if (!baseUrl) {
      throw new Error('COMFYUI_BASE_URL_MISSING')
    }

    const referenceAudioUrl = await resolveComfyUiReferenceAudioUrl(voiceBinding.referenceAudioUrl)
    const workflowKey = resolveComfyUiVoiceLineWorkflowKey(audioSelection.modelId)
    const renderPrompt = await buildComfyUiLineRenderText({
      userId: params.userId,
      locale: params.locale || 'zh',
      projectId: params.projectId,
      workflowKey,
      speakerName: line.speaker,
      lineIndex: line.lineIndex,
      lineText: text,
      emotionPrompt: line.emotionPrompt,
      emotionStrength: line.emotionStrength ?? null,
      character,
      voiceLines: episode?.voiceLines || [],
      storyboards: line.matchedStoryboardId
        ? (episode?.storyboards || []).filter((storyboard) => storyboard.id === line.matchedStoryboardId)
        : episode?.storyboards || [],
    })
    derivedEmotionPrompt = renderPrompt.derivedEmotionPrompt
    const result = await runComfyUiAudioWorkflow({
      baseUrl,
      workflowKey,
      prompt: renderPrompt.renderText || text,
      referenceAudioUrls: [referenceAudioUrl],
    })
    const audioData = Buffer.from(result.audioBase64, 'base64')
    generated = {
      audioData,
      audioDuration: getWavDurationFromBuffer(audioData),
    }
  } else {
    throw new Error(`AUDIO_PROVIDER_UNSUPPORTED: ${audioSelection.provider}`)
  }

  const audioKey = `voice/${params.projectId}/${episodeId}/${line.id}.wav`
  const cosKey = await uploadObject(generated.audioData, audioKey)

  await checkCancelled?.()

  await prisma.novelPromotionVoiceLine.update({
    where: { id: line.id },
    data: {
      audioUrl: cosKey,
      audioDuration: generated.audioDuration || null,
      ...(line.emotionPrompt ? {} : derivedEmotionPrompt ? { emotionPrompt: derivedEmotionPrompt } : {}),
    },
  })

  const signedUrl = getSignedUrl(cosKey, 7200)
  return {
    lineId: line.id,
    audioUrl: signedUrl,
    storageKey: cosKey,
    audioDuration: generated.audioDuration || null,
  }
}

export function estimateVoiceLineMaxSeconds(content: string | null | undefined) {
  const chars = typeof content === 'string' ? content.length : 0
  return Math.max(5, Math.ceil(chars / 2))
}
