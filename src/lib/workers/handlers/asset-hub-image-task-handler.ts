import { type Job } from 'bullmq'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { addCharacterPromptSuffix, addLocationPromptSuffix, addPropPromptSuffix } from '@/lib/constants'
import { type TaskJobData } from '@/lib/task/types'
import { encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { normalizeImageGenerationCount } from '@/lib/image-generation/count'
import { PRIMARY_APPEARANCE_INDEX } from '@/lib/constants'
import { executeAiStructuredTextStep } from '@/lib/ai-exec/structured-step'
import {
  buildCharacterCandidatePromptInstruction,
  CHARACTER_CANDIDATE_PROMPT_COUNT,
  parseCharacterCandidatePrompts,
} from '@/lib/asset-generation/character-candidate-prompts'
import {
  appendLocationCompleteSceneRule,
  buildLocationCandidateStrategies,
  parseLocationCandidatePrompt,
  type LocationCandidateStrategy,
} from '@/lib/asset-generation/location-candidate-prompts'
import { buildLocationImagePromptCore } from '@/lib/location-image-prompt'
import { buildPropImagePromptCore } from '@/lib/prop-image-prompt'
import {
  assertTaskActive,
  getUserModels,
} from '../utils'
import {
  AnyObj,
  buildImageProviderRuntimeOptions,
  generateCleanImageToStorage,
  parseJsonStringArray,
} from './image-task-handler-shared'

interface GlobalCharacterAppearanceRecord {
  id: string
  appearanceIndex: number
  changeReason: string | null
  description: string | null
  descriptions: string | null
}

interface GlobalCharacterRecord {
  id: string
  name: string
  appearances: GlobalCharacterAppearanceRecord[]
}

interface GlobalLocationImageRecord {
  id: string
  description: string | null
}

interface GlobalLocationRecord {
  id: string
  name: string
  images: GlobalLocationImageRecord[]
}

interface AssetHubImageDb {
  globalCharacter: {
    findFirst(args: Record<string, unknown>): Promise<GlobalCharacterRecord | null>
  }
  globalCharacterAppearance: {
    update(args: Record<string, unknown>): Promise<unknown>
  }
  globalLocation: {
    findFirst(args: Record<string, unknown>): Promise<GlobalLocationRecord | null>
  }
  globalLocationImage: {
    update(args: Record<string, unknown>): Promise<unknown>
  }
}

async function generateGlobalCharacterCandidatePrompts(input: {
  readonly userId: string
  readonly analysisModel: string
  readonly description: string
  readonly locale: 'zh' | 'en'
}): Promise<string[]> {
  const completion = await executeAiStructuredTextStep({
    userId: input.userId,
    model: input.analysisModel,
    messages: [{
      role: 'user',
      content: buildCharacterCandidatePromptInstruction({
        description: input.description,
        locale: input.locale,
        styleBible: null,
      }),
    }],
    projectId: 'global-asset-hub',
    action: 'global_character_candidate_prompts',
    locale: input.locale,
    meta: {
      stepId: 'global_character_candidate_prompts',
      stepTitle: '全局角色候选提示词',
      stepIndex: 1,
      stepTotal: 1,
    },
    schema: z.unknown(),
    parse: { kind: 'object' },
    validate: (raw) => parseCharacterCandidatePrompts(raw as Record<string, unknown>),
  })
  return completion.data
}

async function generateGlobalLocationCandidatePrompt(input: {
  readonly userId: string
  readonly analysisModel: string
  readonly locale: 'zh' | 'en'
  readonly strategy: LocationCandidateStrategy
}): Promise<string> {
  const completion = await executeAiStructuredTextStep({
    userId: input.userId,
    model: input.analysisModel,
    messages: [{ role: 'user', content: input.strategy.draftInstruction }],
    projectId: 'global-asset-hub',
    action: 'global_location_candidate_prompt',
    locale: input.locale,
    meta: {
      stepId: `global_location_candidate_prompt:${input.strategy.id}`,
      stepTitle: input.strategy.label,
      stepIndex: 1,
      stepTotal: 1,
    },
    schema: z.unknown(),
    parse: { kind: 'object' },
    validate: (raw) => parseLocationCandidatePrompt(raw as Record<string, unknown>),
  })
  return completion.data
}

export async function handleAssetHubImageTask(job: Job<TaskJobData>) {
  const db = prisma as unknown as AssetHubImageDb
  const payload = (job.data.payload || {}) as AnyObj
  const userId = job.data.userId
  const userModels = await getUserModels(userId)
  if (Object.prototype.hasOwnProperty.call(payload, 'artStyle')) {
    throw new Error('LEGACY_ART_STYLE_REMOVED')
  }

  if (payload.type === 'character') {
    const characterId = typeof payload.id === 'string' ? payload.id : null
    if (!characterId) throw new Error('Global character id missing')

    const character = await db.globalCharacter.findFirst({
      where: { id: characterId, userId },
      include: { appearances: { orderBy: { appearanceIndex: 'asc' } } },
    })

    if (!character) throw new Error('Global character not found')

    const appearanceIndex = Number(payload.appearanceIndex ?? PRIMARY_APPEARANCE_INDEX)
    const appearance = character.appearances.find((appearanceItem) => appearanceItem.appearanceIndex === appearanceIndex)
    if (!appearance) throw new Error('Global character appearance not found')

    const modelId = userModels.characterModel
    if (!modelId) throw new Error('User character model not configured')
    const analysisModel = userModels.analysisModel
    if (!analysisModel) throw new Error('CHARACTER_CANDIDATE_PROMPT_MODEL_REQUIRED')

    const descriptions = parseJsonStringArray(appearance.descriptions)
    const base = descriptions.length ? descriptions : [appearance.description || '']
    const count = CHARACTER_CANDIDATE_PROMPT_COUNT
    const candidatePrompts = await generateGlobalCharacterCandidatePrompts({
      userId,
      analysisModel,
      description: base[0] || appearance.description || '',
      locale: job.data.locale === 'en' ? 'en' : 'zh',
    })
    const imageUrls: string[] = []

    for (let i = 0; i < count; i++) {
      const raw = candidatePrompts[i]
      const prompt = addCharacterPromptSuffix(raw)
      const imageKey = await generateCleanImageToStorage({
        job,
        userId,
        modelId,
        prompt,
        targetId: `${appearance.id}-${i}`,
        keyPrefix: 'global-character',
        options: buildImageProviderRuntimeOptions({
          generationOptions: payload.generationOptions,
          context: 'global_character_image',
        }),
      })
      imageUrls.push(imageKey)
    }

    await assertTaskActive(job, 'persist_global_character_image')
    await db.globalCharacterAppearance.update({
      where: { id: appearance.id },
      data: {
        imageUrls: encodeImageUrls(imageUrls),
        imageUrl: imageUrls[0] || null,
        selectedIndex: null,
        descriptions: JSON.stringify(candidatePrompts),
      },
    })

    return { type: payload.type, appearanceId: appearance.id, imageCount: imageUrls.length }
  }

  if (payload.type === 'location' || payload.type === 'prop') {
    const locationId = typeof payload.id === 'string' ? payload.id : null
    if (!locationId) throw new Error('Global location id missing')

    const location = await db.globalLocation.findFirst({
      where: { id: locationId, userId },
      include: { images: { orderBy: { imageIndex: 'asc' } } },
    })

    if (!location || !location.images?.length) throw new Error('Global location not found')

    const modelId = userModels.locationModel
    if (!modelId) throw new Error('User location model not configured')
    const analysisModel = userModels.analysisModel
    if (payload.type === 'location' && !analysisModel) throw new Error('LOCATION_CANDIDATE_PROMPT_MODEL_REQUIRED')

    const count = normalizeImageGenerationCount('location', payload.count)
    const targetImages = Object.prototype.hasOwnProperty.call(payload, 'count')
      ? location.images.slice(0, count)
      : location.images
    const groupedLocationDescription = payload.type === 'location'
      ? targetImages.find((image) => typeof image.description === 'string' && image.description.trim())?.description?.trim() || ''
      : ''

    for (const image of targetImages) {
      if (!image.description) continue
      const promptCore = await (async () => {
        if (payload.type === 'prop') {
          return buildPropImagePromptCore({
            description: image.description || '',
          })
        }
        const locale = job.data.locale === 'en' ? 'en' : 'zh'
        const strategies = buildLocationCandidateStrategies({
          description: groupedLocationDescription || image.description || '',
          locale,
          styleBible: null,
        })
        const strategy = strategies[targetImages.indexOf(image) % strategies.length]
        if (!strategy) throw new Error('LOCATION_CANDIDATE_STRATEGY_NOT_FOUND')
        if (!analysisModel) throw new Error('LOCATION_CANDIDATE_PROMPT_MODEL_REQUIRED')
        const candidatePrompt = await generateGlobalLocationCandidatePrompt({
          userId,
          analysisModel,
          locale,
          strategy,
        })
        return buildLocationImagePromptCore({
          description: appendLocationCompleteSceneRule({
            prompt: candidatePrompt,
            locale,
          }),
          locale,
        })
      })()
      const promptWithSuffix = payload.type === 'prop'
        ? addPropPromptSuffix(promptCore)
        : addLocationPromptSuffix(promptCore)
      const prompt = promptWithSuffix
      const imageKey = await generateCleanImageToStorage({
        job,
        userId,
        modelId,
        prompt,
        targetId: image.id,
        keyPrefix: 'global-location',
        options: buildImageProviderRuntimeOptions({
          generationOptions: payload.generationOptions,
          context: payload.type === 'prop' ? 'global_prop_image' : 'global_location_image',
        }),
      })

      await assertTaskActive(job, 'persist_global_location_image')
      await db.globalLocationImage.update({
        where: { id: image.id },
        data: {
          imageUrl: imageKey,
        },
      })
    }

    return { type: payload.type, locationId: location.id, imageCount: targetImages.length }
  }

  throw new Error(`Unsupported asset-hub image type: ${String(payload.type)}`)
}
