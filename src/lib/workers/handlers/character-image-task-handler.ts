import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { CHARACTER_ASSET_IMAGE_RATIO, addCharacterPromptSuffix, PRIMARY_APPEARANCE_INDEX } from '@/lib/constants'
import { type TaskJobData } from '@/lib/task/types'
import { encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { normalizeImageGenerationCount } from '@/lib/image-generation/count'
import { executeAiTextStep } from '@/lib/ai-exec/engine'
import { safeParseJsonObject } from '@/lib/json-repair'
import type { EditScriptStyleBible } from '@/lib/edit-script/types'
import {
  buildCharacterCandidatePromptInstruction,
  CHARACTER_CANDIDATE_PROMPT_COUNT,
  parseCharacterCandidatePrompts,
} from '@/lib/asset-generation/character-candidate-prompts'
import { reportTaskProgress } from '../shared'
import {
  assertTaskActive,
  getProjectModels,
  toSignedUrlIfCos,
} from '../utils'
import { normalizeOptionalReferenceImagesForGeneration } from '@/lib/media/outbound-image'
import {
  appendStyleBiblePromptBlock,
  resolveEditScriptStyleBibleForTask,
} from '@/lib/edit-script/style-bible-prompt'
import { markEditAssetRequirementsCompletedForTargets } from '@/lib/edit-script/asset-requirement-status'
import {
  AnyObj,
  generateCleanImageToStorage,
  parseImageUrls,
  parseJsonStringArray,
  pickFirstString,
} from './image-task-handler-shared'

interface CharacterAppearanceRecord {
  id: string
  characterId: string
  appearanceIndex: number
  descriptions: string | null
  description: string | null
  imageUrls: string | null
  selectedIndex: number | null
  imageUrl: string | null
  changeReason: string | null
}

interface CharacterAppearanceWithCharacter extends CharacterAppearanceRecord {
  character: {
    name: string
  }
}

interface CharacterRecord {
  id: string
  name: string
  appearances: CharacterAppearanceRecord[]
}

interface PrimaryAppearanceRecord {
  imageUrl: string | null
  imageUrls: string | null
  selectedIndex: number | null
}

async function generateCharacterCandidatePrompts(input: {
  readonly userId: string
  readonly projectId: string
  readonly analysisModel: string
  readonly description: string
  readonly locale: 'zh' | 'en'
  readonly styleBible: EditScriptStyleBible | null
}): Promise<string[]> {
  const instruction = buildCharacterCandidatePromptInstruction({
    description: input.description,
    locale: input.locale,
    styleBible: input.styleBible,
  })
  const completion = await executeAiTextStep({
    userId: input.userId,
    model: input.analysisModel,
    messages: [{ role: 'user', content: instruction }],
    temperature: 0.75,
    projectId: input.projectId,
    action: 'character_candidate_prompts',
    meta: {
      stepId: 'character_candidate_prompts',
      stepTitle: '角色候选提示词',
      stepIndex: 1,
      stepTotal: 1,
    },
  })
  return parseCharacterCandidatePrompts(safeParseJsonObject(completion.text))
}

interface CharacterImageDb {
  characterAppearance: {
    findUnique(args: Record<string, unknown>): Promise<CharacterAppearanceWithCharacter | null>
    findFirst(args: Record<string, unknown>): Promise<PrimaryAppearanceRecord | null>
    update(args: Record<string, unknown>): Promise<unknown>
  }
  projectCharacter: {
    findUnique(args: Record<string, unknown>): Promise<CharacterRecord | null>
  }
}

export async function handleCharacterImageTask(job: Job<TaskJobData>) {
  const db = prisma as unknown as CharacterImageDb
  const payload = (job.data.payload || {}) as AnyObj
  const projectId = job.data.projectId
  const userId = job.data.userId
  const models = await getProjectModels(projectId, userId)
  const modelId = models.characterModel
  if (!modelId) throw new Error('Character model not configured')
  if (Object.prototype.hasOwnProperty.call(payload, 'artStyle')) {
    throw new Error('LEGACY_ART_STYLE_REMOVED')
  }

  const appearanceId = pickFirstString(job.data.targetId, payload.appearanceId)
  let appearance: CharacterAppearanceRecord | null = null

  if (appearanceId) {
    const appearanceWithCharacter = await db.characterAppearance.findUnique({
      where: { id: appearanceId },
      include: { character: true },
    })
    if (appearanceWithCharacter) {
      appearance = appearanceWithCharacter
    }
  }

  const characterId = typeof payload.id === 'string' ? payload.id : null
  if (!appearance && characterId) {
    const character = await db.projectCharacter.findUnique({
      where: { id: characterId },
      include: { appearances: { orderBy: { appearanceIndex: 'asc' } } },
    })
    appearance = character?.appearances?.[0] || null
  }

  if (!appearance) throw new Error('Character appearance not found')

  const styleBible = await resolveEditScriptStyleBibleForTask({
    projectId,
    episodeId: job.data.episodeId,
  })
  const descriptions = parseJsonStringArray(appearance.descriptions)
  const baseDescriptions = descriptions.length > 0 ? descriptions : [appearance.description || '']

  // 子形象（不是主形象）生成时，引用主形象图片保持一致性
  const primaryReferenceInputs: string[] = []
  if (appearance.appearanceIndex > PRIMARY_APPEARANCE_INDEX) {
    const primaryAppearance = await db.characterAppearance.findFirst({
      where: {
        characterId: appearance.characterId,
        appearanceIndex: PRIMARY_APPEARANCE_INDEX,
      },
      select: { imageUrl: true, imageUrls: true, selectedIndex: true },
    })
    if (primaryAppearance) {
      const primaryImageUrls = parseImageUrls(primaryAppearance.imageUrls, 'primaryAppearance.imageUrls')
      const selectedIndex = primaryAppearance.selectedIndex
      const selectedKey = typeof selectedIndex === 'number' ? primaryImageUrls[selectedIndex] : null
      const fallbackKey = primaryImageUrls.find((value) => typeof value === 'string' && value) || primaryAppearance.imageUrl
      const primaryKey = (typeof selectedKey === 'string' && selectedKey) ? selectedKey : fallbackKey
      const primaryMainUrl = primaryKey ? toSignedUrlIfCos(primaryKey, 3600) : null
      if (primaryMainUrl) primaryReferenceInputs.push(primaryMainUrl)
    }
  }
  const primaryReferenceImages = await normalizeOptionalReferenceImagesForGeneration(primaryReferenceInputs, {
    context: { taskType: String(job.data.type), scope: 'character.primaryAppearance' },
  })

  const singleIndex = payload.imageIndex ?? payload.descriptionIndex
  const requestedGroupedCount = normalizeImageGenerationCount('character', payload.count, CHARACTER_CANDIDATE_PROMPT_COUNT)
  const count = singleIndex !== undefined
    ? normalizeImageGenerationCount('character', 1)
    : requestedGroupedCount === 1
      ? 1
      : CHARACTER_CANDIDATE_PROMPT_COUNT
  const indexes = singleIndex !== undefined
    ? [Number(singleIndex)]
    : Array.from({ length: count }, (_value, index) => index)

  const imageUrls = parseImageUrls(appearance.imageUrls, 'characterAppearance.imageUrls')
  const nextImageUrls = [...imageUrls]
  const generatedCandidateDescriptions = singleIndex === undefined && count > 1
    ? await (async () => {
      const analysisModel = models.analysisModel
      if (!analysisModel) throw new Error('CHARACTER_CANDIDATE_PROMPT_MODEL_REQUIRED')
      await reportTaskProgress(job, 12, {
        stage: 'generate_character_candidate_prompts',
      })
      return await generateCharacterCandidatePrompts({
        userId,
        projectId,
        analysisModel,
        description: baseDescriptions[0] || appearance.description || '',
        locale: job.data.locale === 'en' ? 'en' : 'zh',
        styleBible,
      })
    })()
    : null
  const effectiveDescriptions = generatedCandidateDescriptions || baseDescriptions

  for (let i = 0; i < indexes.length; i++) {
    const index = indexes[i]
    const raw = effectiveDescriptions[index] || effectiveDescriptions[0]
    const promptBase = addCharacterPromptSuffix(raw)
    const prompt = appendStyleBiblePromptBlock({
      prompt: promptBase,
      styleBible,
      usage: 'assetImage',
      locale: job.data.locale,
    })

    await reportTaskProgress(job, 15 + Math.floor((i / Math.max(indexes.length, 1)) * 55), {
      stage: 'generate_character_image',
      index,
    })

    const options: {
      referenceImages?: string[]
      aspectRatio: string
    } = {
      aspectRatio: CHARACTER_ASSET_IMAGE_RATIO,
    }
    if (primaryReferenceImages.length > 0) {
      options.referenceImages = primaryReferenceImages
    }

    const imageKey = await generateCleanImageToStorage({
      job,
      userId,
      modelId,
      prompt,
      targetId: `${appearance.id}-${index}`,
      keyPrefix: 'character',
      options,
    })

    while (nextImageUrls.length <= index) {
      nextImageUrls.push('')
    }
    nextImageUrls[index] = imageKey
  }

  const selectedIndex = appearance.selectedIndex
  const fallbackMain = nextImageUrls.find((url) => typeof url === 'string' && url) || appearance.imageUrl
  const mainImage = selectedIndex !== null && selectedIndex !== undefined && nextImageUrls[selectedIndex]
    ? nextImageUrls[selectedIndex]
    : fallbackMain

  await assertTaskActive(job, 'persist_character_image')
  await db.characterAppearance.update({
    where: { id: appearance.id },
    data: {
      imageUrls: encodeImageUrls(nextImageUrls),
      imageUrl: mainImage || null,
      ...(generatedCandidateDescriptions
        ? { descriptions: JSON.stringify(generatedCandidateDescriptions) }
        : {}),
    },
  })
  await markEditAssetRequirementsCompletedForTargets({
    projectId,
    kind: 'character',
    targetIds: [appearance.characterId],
  })

  return {
    appearanceId: appearance.id,
    imageCount: nextImageUrls.filter(Boolean).length,
    imageUrl: mainImage || null,
  }
}
