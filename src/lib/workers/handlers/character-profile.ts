import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { executeAiTextStep } from '@/lib/ai-runtime'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { getProjectModelConfig, buildImageBillingPayload } from '@/lib/config-service'
import { encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { normalizeImageGenerationCount } from '@/lib/image-generation/count'
import { createScopedLogger } from '@/lib/logging/core'
import { validateProfileData, stringifyProfileData } from '@/types/character-profile'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import { submitTask } from '@/lib/task/submitter'
import { hasCharacterAppearanceOutput } from '@/lib/task/has-output'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import {
  type AnyObj,
  parseVisualResponse,
  readRequiredString,
  readText,
  resolveProjectModel,
} from './character-profile-helpers'
import { resolveAnalysisModel } from './resolve-analysis-model'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from './llm-stream'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'

const logger = createScopedLogger({ module: 'worker.character-profile' })

type ConfirmProfileOptions = {
  suppressProgress?: boolean
}

/**
 * 与 POST /api/.../generate-image（character）对齐：确认档案后自动入队主形象生图（ComfyUI / FAL 等由项目「角色图模型」决定）。
 */
async function tryEnqueuePrimaryAppearanceImage(job: Job<TaskJobData>, characterId: string, primaryAppearanceId: string) {
  const projectId = job.data.projectId
  const userId = job.data.userId
  const locale = job.data.locale

  const projectModelConfig = await getProjectModelConfig(projectId, userId)
  if (!projectModelConfig.characterModel) {
    logger.warn({
      action: 'post_confirm_image_skipped',
      message: 'skip auto character image: character model not configured',
      projectId,
      details: { characterId, primaryAppearanceId },
    })
    return null
  }

  const count = normalizeImageGenerationCount('character', undefined)
  const basePayload: Record<string, unknown> = {
    type: 'character',
    id: characterId,
    appearanceId: primaryAppearanceId,
    count,
  }

  const hasOutputAtStart = await hasCharacterAppearanceOutput({
    appearanceId: primaryAppearanceId,
    characterId,
    appearanceIndex: 0,
  })

  let billingPayload: Record<string, unknown>
  try {
    billingPayload = await buildImageBillingPayload({
      projectId,
      userId,
      imageModel: projectModelConfig.characterModel,
      basePayload,
    })
  } catch (error) {
    logger.warn({
      action: 'post_confirm_image_skipped',
      message: 'skip auto character image: billing/capability payload failed',
      projectId,
      details: {
        characterId,
        primaryAppearanceId,
        error: error instanceof Error ? error.message : String(error),
      },
    })
    return null
  }

  try {
    const submitResult = await submitTask({
      userId,
      locale,
      projectId,
      type: TASK_TYPE.IMAGE_CHARACTER,
      targetType: 'CharacterAppearance',
      targetId: primaryAppearanceId,
      payload: withTaskUiPayload(billingPayload, { hasOutputAtStart }),
      dedupeKey: `${TASK_TYPE.IMAGE_CHARACTER}:${primaryAppearanceId}:${count}`,
      billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.IMAGE_CHARACTER, billingPayload),
      requestId: null,
    })
    logger.info({
      action: 'post_confirm_image_enqueued',
      message: 'enqueued character image after profile confirm',
      projectId,
      details: {
        characterId,
        primaryAppearanceId,
        imageTaskId: submitResult.taskId,
      },
    })
    return submitResult.taskId
  } catch (error) {
    logger.warn({
      action: 'post_confirm_image_enqueue_failed',
      message: 'auto character image submitTask failed (profile already saved)',
      projectId,
      details: {
        characterId,
        primaryAppearanceId,
        error: error instanceof Error ? error.message : String(error),
      },
    })
    return null
  }
}

async function handleConfirmProfile(
  job: Job<TaskJobData>,
  payload: AnyObj,
  options: ConfirmProfileOptions = {},
) {
  const suppressProgress = options.suppressProgress === true
  const characterId = readRequiredString(payload.characterId, 'characterId')
  const project = await resolveProjectModel(job.data.projectId)
  const analysisModel = await resolveAnalysisModel({
    userId: job.data.userId,
    projectId: job.data.projectId,
  })

  const character = await prisma.novelPromotionCharacter.findFirst({
    where: {
      id: characterId,
      novelPromotionProjectId: project.novelPromotionData!.id,
    },
  })
  if (!character) {
    throw new Error('Character not found')
  }

  let finalProfileData = character.profileData
  if (payload.profileData) {
    if (!validateProfileData(payload.profileData)) {
      throw new Error('档案数据格式错误')
    }
    finalProfileData = stringifyProfileData(payload.profileData)
    await assertTaskActive(job, 'character_profile_confirm_update_profile')
    await prisma.novelPromotionCharacter.update({
      where: { id: characterId },
      data: { profileData: finalProfileData },
    })
  }

  if (!finalProfileData) {
    throw new Error('角色缺少档案数据')
  }

  const parsedProfile = JSON.parse(finalProfileData) as AnyObj
  const promptTemplate = buildPrompt({
    promptId: PROMPT_IDS.NP_AGENT_CHARACTER_VISUAL,
    locale: job.data.locale,
    variables: {
      character_profiles: JSON.stringify(
        [
          {
            name: character.name,
            ...parsedProfile,
          },
        ],
        null,
        2,
      ),
    },
  })

  if (!suppressProgress) {
    await reportTaskProgress(job, 20, {
      stage: 'character_profile_confirm_prepare',
      stageLabel: '准备角色档案确认参数',
      displayMode: 'detail',
    })
  }
  await assertTaskActive(job, 'character_profile_confirm_prepare')

  const streamContext = createWorkerLLMStreamContext(job, 'character_profile_confirm')
  const streamCallbacks = createWorkerLLMStreamCallbacks(job, streamContext)
  const completion = await withInternalLLMStreamCallbacks(
    streamCallbacks,
    async () =>
      await executeAiTextStep({
        userId: job.data.userId,
        model: analysisModel,
        messages: [{ role: 'user', content: promptTemplate }],
        temperature: 0.7,
        projectId: job.data.projectId,
        action: 'generate_character_visual',
        meta: {
          stepId: 'character_profile_confirm',
          stepTitle: '角色档案确认',
          stepIndex: 1,
          stepTotal: 1,
        },
      }),
  )
  await streamCallbacks.flush()
  await assertTaskActive(job, 'character_profile_confirm_parse')

  const responseText = completion.text
  const visualData = parseVisualResponse(responseText)
  const visualCharacters = Array.isArray(visualData.characters)
    ? (visualData.characters as Array<AnyObj>)
    : []
  const firstCharacter = visualCharacters[0]
  const appearances = Array.isArray(firstCharacter?.appearances)
    ? (firstCharacter!.appearances as Array<AnyObj>)
    : []
  if (appearances.length === 0) {
    throw new Error('AI返回格式错误: 缺少 appearances')
  }

  if (!suppressProgress) {
    await reportTaskProgress(job, 78, {
      stage: 'character_profile_confirm_persist',
      stageLabel: '保存角色档案确认结果',
      displayMode: 'detail',
    })
  }
  await assertTaskActive(job, 'character_profile_confirm_persist')

  const appearanceRows: Array<{
    characterId: string
    appearanceIndex: number
    changeReason: string
    description: string
    descriptions: string
    imageUrls: string
    previousImageUrls: string
  }> = []
  const createdAppearanceIds: string[] = []
  for (let appIndex = 0; appIndex < appearances.length; appIndex++) {
    const app = appearances[appIndex]
    await assertTaskActive(job, 'character_profile_confirm_create_appearance')
    const descriptions = Array.isArray(app.descriptions) ? app.descriptions : []
    const normalizedDescriptions = descriptions.map((item) => readText(item)).filter(Boolean)
    appearanceRows.push({
      characterId: character.id,
      appearanceIndex: appIndex,
      changeReason: readText(app.change_reason) || '初始形象',
      description: normalizedDescriptions[0] || '',
      descriptions: JSON.stringify(normalizedDescriptions),
      imageUrls: encodeImageUrls([]),
      previousImageUrls: encodeImageUrls([]),
    })
  }

  await prisma.$transaction(async (tx) => {
    await tx.characterAppearance.deleteMany({
      where: { characterId: character.id },
    })

    for (const appearanceRow of appearanceRows) {
      const created = await tx.characterAppearance.create({
        data: appearanceRow,
      })
      createdAppearanceIds.push(created.id)
    }

    await tx.novelPromotionCharacter.update({
      where: { id: characterId },
      data: {
        profileData: finalProfileData,
        profileConfirmed: true,
      },
    })
  })

  /** 前端 useProfileManagement 传 generateImage: true；此前未消费该字段，导致确认后不会走 ComfyUI/生图队列 */
  const generateImage = payload.generateImage === true
  const primaryAppearanceId = createdAppearanceIds[0]
  let followUpImageTaskId: string | null = null
  if (generateImage && primaryAppearanceId) {
    followUpImageTaskId = await tryEnqueuePrimaryAppearanceImage(job, character.id, primaryAppearanceId)
  }

  if (!suppressProgress) {
    await reportTaskProgress(job, 96, {
      stage: 'character_profile_confirm_done',
      stageLabel: '角色档案确认完成',
      displayMode: 'detail',
      meta: { characterId, followUpImageTaskId },
    })
  }

  return {
    success: true,
    character: {
      ...character,
      profileConfirmed: true,
      appearances,
    },
    followUpImageTaskId,
  }
}

async function handleBatchConfirmProfile(job: Job<TaskJobData>) {
  const project = await resolveProjectModel(job.data.projectId)

  const unconfirmedCharacters = await prisma.novelPromotionCharacter.findMany({
    where: {
      novelPromotionProjectId: project.novelPromotionData!.id,
      profileConfirmed: false,
      profileData: { not: null },
    },
  })

  if (unconfirmedCharacters.length === 0) {
    return {
      success: true,
      count: 0,
      message: '没有待确认的角色',
    }
  }

  await reportTaskProgress(job, 18, {
    stage: 'character_profile_batch_prepare',
    stageLabel: '准备批量角色档案确认参数',
    displayMode: 'detail',
    message: `共 ${unconfirmedCharacters.length} 个角色`,
  })
  await assertTaskActive(job, 'character_profile_batch_prepare')

  let successCount = 0
  const totalCount = unconfirmedCharacters.length

  for (let index = 0; index < unconfirmedCharacters.length; index++) {
    const character = unconfirmedCharacters[index]
    await assertTaskActive(job, 'character_profile_batch_loop_character')
    const progress = 18 + Math.floor(((index + 1) / totalCount) * 78)
    await reportTaskProgress(job, progress, {
      stage: 'character_profile_batch_loop_character',
      stageLabel: '批量角色档案确认中',
      displayMode: 'detail',
      message: `${index + 1}/${totalCount} ${character.name}`,
      meta: { characterId: character.id, index: index + 1, total: totalCount },
    })
    await handleConfirmProfile(job, { characterId: character.id }, { suppressProgress: true })
    successCount += 1
  }

  await reportTaskProgress(job, 96, {
    stage: 'character_profile_batch_done',
    stageLabel: '批量角色档案确认完成',
    displayMode: 'detail',
    meta: { count: successCount },
  })

  return {
    success: true,
    count: successCount,
  }
}

export async function handleCharacterProfileTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  switch (job.data.type) {
    case TASK_TYPE.CHARACTER_PROFILE_CONFIRM:
      return await handleConfirmProfile(job, payload)
    case TASK_TYPE.CHARACTER_PROFILE_BATCH_CONFIRM:
      return await handleBatchConfirmProfile(job)
    default:
      throw new Error(`Unsupported character profile task type: ${job.data.type}`)
  }
}
