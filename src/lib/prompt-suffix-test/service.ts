import { generateImage } from '@/lib/ai-exec/engine'
import { pollAsyncTask } from '@/lib/ai-exec/async-poll'
import { processMediaResult } from '@/lib/media-process'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { getModelsByType } from '@/lib/user-api/runtime-config'
import {
  getUserModelConfig,
  resolveModelCapabilityGenerationOptions,
} from '@/lib/config-service'
import { buildPromptSuffixTestPrompt } from './variants'

export interface RunPromptSuffixImageTestInput {
  readonly userId: string
  readonly modelKey: string
  readonly variantId: string
  readonly basePrompt: string
  readonly suffix: string
  readonly aspectRatio: string
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

  const finalPrompt = buildPromptSuffixTestPrompt({
    basePrompt: input.basePrompt,
    suffix: input.suffix,
  })
  const generated = await generateImageSource({
    userId: input.userId,
    modelKey: model.modelKey,
    prompt: finalPrompt,
    aspectRatio: input.aspectRatio,
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
