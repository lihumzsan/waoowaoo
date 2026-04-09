import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import {
  createVoiceDesign,
  validatePreviewText,
  validateVoicePrompt,
  type VoiceDesignInput,
} from '@/lib/providers/bailian/voice-design'
import {
  getModelsByType,
  getProviderConfig,
  getProviderKey,
  resolveModelSelection,
  type ModelSelection,
} from '@/lib/api-config'
import { composeModelKey, extractModelKey, getProjectModelConfig, getUserModelConfig } from '@/lib/config-service'
import { runComfyUiAudioWorkflow } from '@/lib/providers/comfyui/client'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import {
  buildComfyUiDesignedVoiceId,
  COMFYUI_FISH_AUDIO_S2_VOICE_DESIGN_WORKFLOW_ID,
  generateFishAudioS2Prompt,
  type VoiceDesignCharacterContext,
} from '@/lib/voice-design/fish-audio-s2'
import type { Locale } from '@/i18n/routing'

const BAILIAN_VOICE_DESIGN_MODEL_ID = 'qwen-voice-design'
const PREFERRED_BAILIAN_TEXT_MODEL_IDS = [
  'qwen3.5-plus',
  'qwen3.5-flash',
  'qwen-plus',
  'qwen-turbo',
] as const

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readRequiredString(value: unknown, field: string): string {
  const normalized = readTrimmedString(value)
  if (!normalized) {
    throw new Error(`${field} is required`)
  }
  return normalized
}

function readLanguage(value: unknown): 'zh' | 'en' {
  return value === 'en' ? 'en' : 'zh'
}

function buildTaskType(job: Job<TaskJobData>) {
  return job.data.type === TASK_TYPE.ASSET_HUB_VOICE_DESIGN
    ? TASK_TYPE.ASSET_HUB_VOICE_DESIGN
    : TASK_TYPE.VOICE_DESIGN
}

async function resolveVoiceDesignSelection(userId: string): Promise<ModelSelection> {
  const pref = await prisma.userPreference.findUnique({
    where: { userId },
    select: { voiceDesignModel: true },
  })

  const configuredModelKey = extractModelKey(pref?.voiceDesignModel)
  if (configuredModelKey) {
    return await resolveModelSelection(userId, configuredModelKey, 'audio')
  }

  const models = await getModelsByType(userId, 'audio')

  const comfyUiDesign = models.find((model) =>
    getProviderKey(model.provider) === 'comfyui'
    && model.modelId === COMFYUI_FISH_AUDIO_S2_VOICE_DESIGN_WORKFLOW_ID,
  )
  if (comfyUiDesign) {
    return await resolveModelSelection(userId, composeModelKey(comfyUiDesign.provider, comfyUiDesign.modelId), 'audio')
  }

  const bailianDesign = models.find((model) =>
    getProviderKey(model.provider) === 'bailian'
    && model.modelId === BAILIAN_VOICE_DESIGN_MODEL_ID,
  )
  if (bailianDesign) {
    return await resolveModelSelection(userId, composeModelKey(bailianDesign.provider, bailianDesign.modelId), 'audio')
  }

  throw new Error('VOICE_DESIGN_MODEL_NOT_CONFIGURED')
}

async function resolveVoiceDesignTextModel(job: Job<TaskJobData>): Promise<string> {
  const projectId = readTrimmedString(job.data.projectId)
  const projectConfig = projectId && projectId !== 'global-asset-hub'
    ? await getProjectModelConfig(projectId, job.data.userId)
    : null
  const configuredAnalysisModel = projectConfig?.analysisModel ?? (await getUserModelConfig(job.data.userId)).analysisModel

  if (configuredAnalysisModel && getProviderKey(configuredAnalysisModel) === 'bailian') {
    return configuredAnalysisModel
  }

  const llmModels = await getModelsByType(job.data.userId, 'llm')
  const bailianModels = llmModels.filter((model) => getProviderKey(model.provider) === 'bailian')

  for (const modelId of PREFERRED_BAILIAN_TEXT_MODEL_IDS) {
    const matched = bailianModels.find((model) => model.modelId === modelId)
    if (matched) {
      return composeModelKey(matched.provider, matched.modelId)
    }
  }

  if (bailianModels[0]) {
    return composeModelKey(bailianModels[0].provider, bailianModels[0].modelId)
  }

  if (configuredAnalysisModel) {
    return configuredAnalysisModel
  }

  throw new Error('VOICE_DESIGN_TEXT_MODEL_NOT_CONFIGURED')
}

async function loadVoiceDesignCharacterContext(
  job: Job<TaskJobData>,
  characterId: string,
): Promise<VoiceDesignCharacterContext | null> {
  if (!characterId) return null

  if (job.data.type === TASK_TYPE.ASSET_HUB_VOICE_DESIGN) {
    const character = await prisma.globalCharacter.findFirst({
      where: {
        id: characterId,
        userId: job.data.userId,
      },
      select: {
        name: true,
        aliases: true,
        profileData: true,
        appearances: {
          orderBy: { appearanceIndex: 'asc' },
          select: {
            changeReason: true,
            description: true,
          },
        },
      },
    })

    if (!character) return null

    return {
      name: character.name,
      aliases: character.aliases,
      profileData: character.profileData,
      appearances: character.appearances.map((appearance) => ({
        label: appearance.changeReason,
        description: appearance.description,
      })),
    }
  }

  const projectId = readTrimmedString(job.data.projectId)
  if (!projectId) return null

  const character = await prisma.novelPromotionCharacter.findFirst({
    where: {
      id: characterId,
      novelPromotionProjectId: projectId,
    },
    select: {
      name: true,
      aliases: true,
      introduction: true,
      profileData: true,
      appearances: {
        orderBy: { appearanceIndex: 'asc' },
        select: {
          changeReason: true,
          description: true,
        },
      },
    },
  })

  if (!character) return null

  return {
    name: character.name,
    aliases: character.aliases,
    introduction: character.introduction,
    profileData: character.profileData,
    appearances: character.appearances.map((appearance) => ({
      label: appearance.changeReason,
      description: appearance.description,
    })),
  }
}

export async function handleVoiceDesignTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const voicePrompt = readRequiredString(payload.voicePrompt, 'voicePrompt')
  const previewText = readRequiredString(payload.previewText, 'previewText')
  const preferredName = readTrimmedString(payload.preferredName) || 'custom_voice'
  const language = readLanguage(payload.language)
  const characterId = readTrimmedString(payload.characterId)

  const promptValidation = validateVoicePrompt(voicePrompt)
  if (!promptValidation.valid) {
    throw new Error(promptValidation.error || 'invalid voicePrompt')
  }
  const textValidation = validatePreviewText(previewText)
  if (!textValidation.valid) {
    throw new Error(textValidation.error || 'invalid previewText')
  }

  const selection = await resolveVoiceDesignSelection(job.data.userId)
  const providerKey = getProviderKey(selection.provider).toLowerCase()

  await reportTaskProgress(job, 20, {
    stage: 'voice_design_prepare',
    stageLabel: '准备音色设计任务',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'voice_design_prepare')

  if (providerKey === 'comfyui') {
    const characterContext = characterId
      ? await loadVoiceDesignCharacterContext(job, characterId)
      : null
    const textModel = await resolveVoiceDesignTextModel(job)

    await reportTaskProgress(job, 45, {
      stage: 'voice_design_prompt',
      stageLabel: '生成 Fish Audio S2 提示词',
      displayMode: 'detail',
    })
    await assertTaskActive(job, 'voice_design_prompt')

    const promptResult = await generateFishAudioS2Prompt({
      userId: job.data.userId,
      locale: job.data.locale as Locale,
      model: textModel,
      projectId: readTrimmedString(job.data.projectId) || 'asset-hub',
      speakerName: characterContext?.name || preferredName,
      userVoicePrompt: voicePrompt,
      previewText,
      character: characterContext,
    })

    await reportTaskProgress(job, 75, {
      stage: 'voice_design_render',
      stageLabel: '调用 ComfyUI Fish Audio S2 工作流',
      displayMode: 'detail',
    })
    await assertTaskActive(job, 'voice_design_render')

    const { baseUrl } = await getProviderConfig(job.data.userId, selection.provider)
    if (!baseUrl) {
      throw new Error('COMFYUI_BASE_URL_MISSING')
    }

    const designed = await runComfyUiAudioWorkflow({
      baseUrl,
      workflowKey: selection.modelId,
      prompt: promptResult.fishText,
    })

    const voiceId = buildComfyUiDesignedVoiceId({
      workflowKey: selection.modelId,
      fishText: promptResult.fishText,
      preferredName,
    })

    await reportTaskProgress(job, 96, {
      stage: 'voice_design_done',
      stageLabel: 'ComfyUI 音色设计完成',
      displayMode: 'detail',
    })

    return {
      success: true,
      voiceId,
      targetModel: selection.modelId,
      audioBase64: designed.audioBase64,
      responseFormat: designed.mimeType,
      requestId: voiceId,
      finalPrompt: promptResult.fishText,
      normalizedVoicePrompt: promptResult.voicePrompt,
      taskType: buildTaskType(job),
    }
  }

  if (providerKey !== 'bailian') {
    throw new Error(`VOICE_DESIGN_PROVIDER_UNSUPPORTED: ${selection.provider}`)
  }

  await reportTaskProgress(job, 45, {
    stage: 'voice_design_submit',
    stageLabel: '提交百炼音色设计任务',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'voice_design_submit')

  const { apiKey } = await getProviderConfig(job.data.userId, selection.provider)
  const input: VoiceDesignInput = {
    voicePrompt,
    previewText,
    preferredName,
    language,
  }
  const designed = await createVoiceDesign(input, apiKey)
  if (!designed.success) {
    throw new Error(designed.error || '音色设计失败')
  }

  await reportTaskProgress(job, 96, {
    stage: 'voice_design_done',
    stageLabel: '百炼音色设计完成',
    displayMode: 'detail',
  })

  return {
    success: true,
    voiceId: designed.voiceId,
    targetModel: designed.targetModel,
    audioBase64: designed.audioBase64,
    sampleRate: designed.sampleRate,
    responseFormat: designed.responseFormat,
    usageCount: designed.usageCount,
    requestId: designed.requestId,
    taskType: buildTaskType(job),
  }
}
