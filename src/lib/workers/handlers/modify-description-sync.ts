import { z } from 'zod'
import { executeAiStructuredTextStep, executeAiStructuredVisionStep } from '@/lib/ai-exec/structured-step'
import { removeCharacterPromptSuffix, removeLocationPromptSuffix, removePropPromptSuffix } from '@/lib/constants'
import { buildAiPrompt as buildPrompt, AI_PROMPT_IDS as PROMPT_IDS, type AiPromptLocale as PromptLocale } from '@/lib/ai-prompts'
import {
  buildCharacterDescriptionFields,
  readIndexedDescription,
} from '@/lib/assets/description-fields'

export type SyncedAssetType = 'character' | 'location' | 'prop'

function trimText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function buildImageContext(type: SyncedAssetType, hasReferenceImages: boolean): string {
  if (!hasReferenceImages) return ''
  if (type === 'character') {
    return '【参考图片】\n请仔细分析参考图片中的服装款式、颜色、材质、配饰等关键视觉特征，并将这些特征融入更新后的描述中。'
  }
  if (type === 'prop') {
    return '【参考图片】\n请仔细分析参考图片中的材质、轮廓、比例、装饰细节、配色与表面处理，并将这些特征融入更新后的描述中。'
  }
  return '【参考图片】\n请仔细分析参考图片中的建筑风格、装饰元素、光线氛围、色调等关键视觉特征，并将这些特征融入更新后的描述中。'
}

function parseModifiedDescription(parsed: unknown): {
  prompt: string
} {
  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {}
  const prompt = trimText(typeof record.prompt === 'string' ? record.prompt : '')
  if (!prompt) {
    throw new Error('No prompt field in response')
  }
  return {
    prompt,
  }
}

export { buildCharacterDescriptionFields, readIndexedDescription }

export async function generateModifiedAssetDescription(params: {
  userId: string
  model: string
  locale: PromptLocale
  type: SyncedAssetType
  currentDescription: string
  modifyInstruction: string
  referenceImages?: string[]
  locationName?: string
  propName?: string
  projectId?: string
}): Promise<{
  prompt: string
}> {
  const hasReferenceImages = Array.isArray(params.referenceImages) && params.referenceImages.length > 0
  const finalPrompt = params.type === 'character'
    ? buildPrompt({
      promptId: PROMPT_IDS.CHARACTER_UPDATE_DESCRIPTION,
      locale: params.locale,
      variables: {
        original_description: removeCharacterPromptSuffix(params.currentDescription),
        modify_instruction: params.modifyInstruction,
        image_context: buildImageContext('character', hasReferenceImages),
      },
    })
    : params.type === 'prop'
      ? buildPrompt({
        promptId: PROMPT_IDS.PROP_UPDATE_DESCRIPTION,
        locale: params.locale,
        variables: {
          prop_name: trimText(params.propName) || '道具',
          original_description: removePropPromptSuffix(params.currentDescription),
          modify_instruction: params.modifyInstruction,
          image_context: buildImageContext('prop', hasReferenceImages),
        },
      })
    : buildPrompt({
      promptId: PROMPT_IDS.LOCATION_UPDATE_DESCRIPTION,
      locale: params.locale,
      variables: {
        location_name: trimText(params.locationName) || '场景',
        original_description: removeLocationPromptSuffix(params.currentDescription),
        modify_instruction: params.modifyInstruction,
        image_context: buildImageContext('location', hasReferenceImages),
      },
    })

  if (hasReferenceImages) {
    const completion = await executeAiStructuredVisionStep({
      userId: params.userId,
      model: params.model,
      prompt: finalPrompt,
      imageUrls: params.referenceImages ?? [],
      ...(params.projectId ? { projectId: params.projectId } : {}),
      locale: params.locale,
      schema: z.unknown(),
      parse: { kind: 'object' },
      validate: parseModifiedDescription,
    })
    return completion.data
  }

  const completion = await executeAiStructuredTextStep({
    userId: params.userId,
    model: params.model,
    messages: [{ role: 'user', content: finalPrompt }],
    ...(params.projectId ? { projectId: params.projectId } : {}),
    action: params.type === 'character'
      ? 'sync_character_description_after_image_modify'
      : params.type === 'prop'
        ? 'sync_prop_description_after_image_modify'
        : 'sync_location_description_after_image_modify',
    locale: params.locale,
    meta: {
      stepId: params.type === 'character'
        ? 'sync_character_description_after_image_modify'
        : params.type === 'prop'
          ? 'sync_prop_description_after_image_modify'
          : 'sync_location_description_after_image_modify',
      stepTitle: params.type === 'character' ? '同步角色描述' : params.type === 'prop' ? '同步道具描述' : '同步场景描述',
      stepIndex: 1,
      stepTotal: 1,
    },
    schema: z.unknown(),
    parse: { kind: 'object' },
    validate: parseModifiedDescription,
  })
  return completion.data
}
