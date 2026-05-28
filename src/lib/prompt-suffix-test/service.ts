import type { Locale } from '@/i18n/routing'
import { executeAiTextStep, generateImage } from '@/lib/ai-exec/engine'
import { pollAsyncTask } from '@/lib/ai-exec/async-poll'
import { processMediaResult } from '@/lib/media-process'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { withTextBilling } from '@/lib/billing'
import { safeParseJsonObject } from '@/lib/json-repair'
import { getModelsByType } from '@/lib/user-api/runtime-config'
import {
  getUserModelConfig,
  resolveModelCapabilityGenerationOptions,
} from '@/lib/config-service'

export interface RunPromptSuffixImageTestInput {
  readonly userId: string
  readonly modelKey: string
  readonly variantId: string
  readonly finalPrompt: string
  readonly aspectRatio?: string
}

export interface PromptSuffixImageTestResult {
  readonly variantId: string
  readonly modelKey: string
  readonly modelName: string
  readonly imageUrl: string
  readonly displayUrl: string | null
  readonly finalPrompt: string
  readonly promptLength: number
  readonly externalId?: string
}

export interface ExpandPromptSuffixTestInput {
  readonly userId: string
  readonly locale: Locale
  readonly idea: string
  readonly aspectRatio: string
  readonly styleText: string
  readonly styleBibleText: string
}

export interface ExpandPromptSuffixTestResult {
  readonly analysisModel: string
  readonly sourceText: string
  readonly styleText: string
  readonly storyboardJson: string
  readonly finalImagePrompt: string
}

interface ImageSourceResult {
  readonly source: string
  readonly externalId?: string
}

function resolveExternalId(result: {
  readonly async?: boolean
  readonly externalId?: string
}): string | null {
  if (!result.async) return null
  const externalId = result.externalId?.trim()
  if (!externalId) throw new Error('PROMPT_SUFFIX_TEST_ASYNC_EXTERNAL_ID_MISSING')
  return externalId
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function pollImageSource(input: {
  readonly externalId: string
  readonly userId: string
}): Promise<string> {
  const startedAt = Date.now()
  const timeoutMs = 10 * 60 * 1000
  const intervalMs = 3000
  while (Date.now() - startedAt <= timeoutMs) {
    const status = await pollAsyncTask(input.externalId, input.userId)
    if (status.status === 'completed') {
      const url = status.resultUrl || status.imageUrl || status.videoUrl
      if (!url) throw new Error(`PROMPT_SUFFIX_TEST_ASYNC_RESULT_EMPTY:${input.externalId}`)
      return url
    }
    if (status.status === 'failed') {
      throw new Error(`PROMPT_SUFFIX_TEST_ASYNC_FAILED:${status.error || input.externalId}`)
    }
    await sleep(intervalMs)
  }
  throw new Error(`PROMPT_SUFFIX_TEST_ASYNC_TIMEOUT:${input.externalId}`)
}

function readRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  throw new Error(`PROMPT_SUFFIX_TEST_EXPAND_${fieldName.toUpperCase()}_OBJECT_REQUIRED`)
}

function readRequiredString(source: Record<string, unknown>, fieldName: string): string {
  const value = source[fieldName]
  if (typeof value === 'string' && value.trim()) return value.trim()
  throw new Error(`PROMPT_SUFFIX_TEST_EXPAND_${fieldName.toUpperCase()}_REQUIRED`)
}

function buildIdeaExpansionPrompt(input: {
  readonly locale: Locale
  readonly idea: string
  readonly aspectRatio: string
  readonly styleText: string
  readonly styleBibleText: string
}): string {
  if (input.locale === 'en') {
    return [
      'You expand a loose visual idea into a single storyboard image test payload.',
      'Return JSON only. Do not include markdown fences or explanatory text.',
      'The result will be used to test image prompts with multiple compression levels.',
      '',
      'Input idea:',
      input.idea,
      '',
      `Aspect ratio: ${input.aspectRatio}`,
      `Style guide: ${input.styleText}`,
      'Fixed Style Bible:',
      input.styleBibleText,
      '',
      'Output schema:',
      '{',
      '  "sourceText": "one concise source sentence describing the shot",',
      '  "styleText": "concise visual style text derived from the style guide",',
      '  "storyboard": {',
      '    "panel": {',
      '      "panel_id": "generated_prompt",',
      '      "shot_type": "shot scale in natural language",',
      '      "camera_move": "camera placement or movement in natural language",',
      '      "description": "shot action and subject",',
      '      "image_prompt": "complete final image prompt for the image model",',
      '      "location": "short location name",',
      '      "characters": [{ "name": "character/object name", "appearance": "short appearance" }],',
      '      "source_text": "same as sourceText",',
      '      "shot_blocking": {',
      '        "locationName": "location name",',
      '        "absolutePosition": "where the main subject stands/is placed",',
      '        "relativePosition": "subject relation to important scene anchors",',
      '        "screenPosition": "screen position",',
      '        "cameraPlacement": "camera position, height, angle",',
      '        "composition": "composition in one sentence"',
      '      }',
      '    }',
      '  }',
      '}',
      '',
      'Rules for image_prompt:',
      '- It must be a single complete final prompt, not a JSON fragment.',
      '- Include subject, scene, action, lighting, composition, lens/shot scale, mood, aspect ratio, and negative text/watermark constraints.',
      '- Do not add unrelated people, props, brands, logos, text, subtitles, watermarks, or story events.',
    ].join('\n')
  }
  return [
    '你负责把一个松散的画面想法扩展成单张分镜图片测试数据。',
    '只输出 JSON。不要输出 markdown 代码块，不要解释。',
    '这个结果会用于测试图片提示词的多档压缩效果。',
    '',
    '输入想法：',
    input.idea,
    '',
    `画幅：${input.aspectRatio}`,
    `风格指导：${input.styleText}`,
    '固定 Style Bible：',
    input.styleBibleText,
    '',
    '输出结构：',
    '{',
    '  "sourceText": "一句简洁的镜头原文",',
    '  "styleText": "根据风格指导提炼出的简洁视觉风格",',
    '  "storyboard": {',
    '    "panel": {',
    '      "panel_id": "generated_prompt",',
    '      "shot_type": "自然语言景别",',
    '      "camera_move": "自然语言机位或运动",',
    '      "description": "镜头动作和主体",',
    '      "image_prompt": "完整最终图片提示词",',
    '      "location": "简短场景名",',
    '      "characters": [{ "name": "角色或主体名", "appearance": "简短外观" }],',
    '      "source_text": "与 sourceText 相同",',
    '      "shot_blocking": {',
    '        "locationName": "场景名",',
    '        "absolutePosition": "主体所在位置",',
    '        "relativePosition": "主体与关键场景锚点的关系",',
    '        "screenPosition": "画面位置",',
    '        "cameraPlacement": "机位、高度、角度",',
    '        "composition": "一句话构图"',
    '      }',
    '    }',
    '  }',
    '}',
    '',
    'image_prompt 规则：',
    '- 它必须是一条完整最终图片提示词，不是 JSON 片段。',
    '- 必须包含主体、场景、动作、光线、构图、镜头/景别、情绪、画幅、禁止文字水印等约束。',
    '- 不要添加与输入想法无关的人物、道具、品牌、logo、文字、字幕、水印或剧情事件。',
  ].join('\n')
}

function normalizeExpansionResponse(parsed: Record<string, unknown>): {
  readonly sourceText: string
  readonly styleText: string
  readonly storyboardJson: string
  readonly finalImagePrompt: string
} {
  const sourceText = readRequiredString(parsed, 'sourceText')
  const styleText = readRequiredString(parsed, 'styleText')
  const storyboard = readRecord(parsed.storyboard, 'storyboard')
  const panel = readRecord(storyboard.panel, 'panel')
  const finalImagePrompt = readRequiredString(panel, 'image_prompt')
  return {
    sourceText,
    styleText,
    storyboardJson: JSON.stringify(storyboard, null, 2),
    finalImagePrompt,
  }
}

export async function expandPromptSuffixTestIdea(
  input: ExpandPromptSuffixTestInput,
): Promise<ExpandPromptSuffixTestResult> {
  const idea = input.idea.trim()
  if (!idea) throw new Error('PROMPT_SUFFIX_TEST_IDEA_REQUIRED')
  const userConfig = await getUserModelConfig(input.userId)
  const analysisModel = userConfig.analysisModel?.trim()
  if (!analysisModel) throw new Error('PROMPT_SUFFIX_TEST_ANALYSIS_MODEL_REQUIRED')

  const prompt = buildIdeaExpansionPrompt({
    locale: input.locale,
    idea,
    aspectRatio: input.aspectRatio.trim() || '16:9',
    styleText: input.styleText.trim(),
    styleBibleText: input.styleBibleText.trim(),
  })
  const action = 'prompt_suffix_test_expand'
  const completion = await withTextBilling(
    input.userId,
    analysisModel,
    Math.max(1600, Math.ceil(prompt.length * 1.2)),
    { projectId: 'prompt-suffix-test', action, metadata: { locale: input.locale } },
    async () =>
      await executeAiTextStep({
        userId: input.userId,
        model: analysisModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.35,
        reasoning: false,
        action,
        meta: {
          stepId: action,
          stepTitle: 'Expand prompt suffix test idea',
          stepIndex: 1,
          stepTotal: 1,
        },
      }),
  )
  const normalized = normalizeExpansionResponse(safeParseJsonObject(completion.text))
  return {
    analysisModel,
    sourceText: normalized.sourceText,
    styleText: normalized.styleText,
    storyboardJson: normalized.storyboardJson,
    finalImagePrompt: normalized.finalImagePrompt,
  }
}

async function generateImageSource(input: {
  readonly userId: string
  readonly modelKey: string
  readonly prompt: string
  readonly aspectRatio: string
}): Promise<ImageSourceResult> {
  const userConfig = await getUserModelConfig(input.userId)
  const capabilityOptions = resolveModelCapabilityGenerationOptions({
    modelType: 'image',
    modelKey: input.modelKey,
    capabilityDefaults: userConfig.capabilityDefaults,
  })
  const result = await generateImage(input.userId, input.modelKey, input.prompt, {
    ...capabilityOptions,
    aspectRatio: input.aspectRatio,
  })
  if (!result.success) {
    throw new Error(`PROMPT_SUFFIX_TEST_IMAGE_FAILED:${result.error || '<empty>'}`)
  }

  const directSource = result.imageUrls?.[0] || result.imageUrl
  if (directSource) return { source: directSource }
  if (result.imageBase64) return { source: `data:image/png;base64,${result.imageBase64}` }

  const externalId = resolveExternalId(result)
  if (!externalId) throw new Error('PROMPT_SUFFIX_TEST_IMAGE_EMPTY')
  return {
    source: await pollImageSource({
      externalId,
      userId: input.userId,
    }),
    externalId,
  }
}

export async function runPromptSuffixImageTest(
  input: RunPromptSuffixImageTestInput,
): Promise<PromptSuffixImageTestResult> {
  const imageModels = await getModelsByType(input.userId, 'image')
  const model = imageModels.find((item) => item.modelKey === input.modelKey)
  if (!model) {
    throw new Error(`PROMPT_SUFFIX_TEST_IMAGE_MODEL_INVALID:${input.modelKey}`)
  }
  const finalPrompt = input.finalPrompt.trim()
  if (!finalPrompt) throw new Error('PROMPT_SUFFIX_TEST_FINAL_PROMPT_REQUIRED')
  const generated = await generateImageSource({
    userId: input.userId,
    modelKey: model.modelKey,
    prompt: finalPrompt,
    aspectRatio: input.aspectRatio?.trim() || '16:9',
  })
  const storageKey = await processMediaResult({
    source: generated.source,
    type: 'image',
    keyPrefix: 'prompt-suffix-test',
    targetId: `${input.variantId}-${crypto.randomUUID()}`,
  })

  return {
    variantId: input.variantId,
    modelKey: model.modelKey,
    modelName: model.name,
    imageUrl: storageKey,
    displayUrl: toDisplayImageUrl(storageKey),
    finalPrompt,
    promptLength: finalPrompt.length,
    ...(generated.externalId ? { externalId: generated.externalId } : {}),
  }
}
