import type { Job } from 'bullmq'
import { getSignedUrl } from '@/lib/storage'
import { normalizeOptionalReferenceImagesForGeneration } from '@/lib/media/outbound-image'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import {
  SCENE_REFERENCE_TEST_ASPECT_RATIO,
  buildMultiSceneReferencePrompt,
  buildSceneComparisonPrompt,
  buildSingleSceneReferencePrompt,
  normalizeSceneReferenceLayouts,
  type SceneReferenceLayout,
} from '@/lib/scene-reference-test/prompts'
import { generateCleanImageToStorage } from './image-task-handler-shared'

type SceneVariantInput = {
  readonly id: string
  readonly label: string
  readonly imageUrl: string
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`)
  return value.trim()
}

function readOptionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readImageOptions(value: unknown): { resolution?: string; quality?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  return {
    ...(typeof record.resolution === 'string' && record.resolution.trim()
      ? { resolution: record.resolution.trim() }
      : {}),
    ...(typeof record.quality === 'string' && record.quality.trim()
      ? { quality: record.quality.trim() }
      : {}),
  }
}

function readPairCount(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return 2
  return Math.min(4, Math.max(1, Math.floor(parsed)))
}

function readVariants(value: unknown): SceneVariantInput[] {
  if (!Array.isArray(value)) throw new Error('variants is required')
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`variant ${index + 1} is invalid`)
    }
    const record = item as Record<string, unknown>
    return {
      id: readRequiredString(record.id, `variant ${index + 1}.id`),
      label: readRequiredString(record.label, `variant ${index + 1}.label`),
      imageUrl: readRequiredString(record.imageUrl, `variant ${index + 1}.imageUrl`),
    }
  })
}

async function generateSceneImage(input: {
  readonly job: Job<TaskJobData>
  readonly modelId: string
  readonly prompt: string
  readonly targetSuffix: string
  readonly imageOptions: { resolution?: string; quality?: string }
}) {
  const options = {
    aspectRatio: SCENE_REFERENCE_TEST_ASPECT_RATIO,
    ...input.imageOptions,
  }
  const imageKey = await generateCleanImageToStorage({
    job: input.job,
    userId: input.job.data.userId,
    modelId: input.modelId,
    prompt: input.prompt,
    targetId: `${input.job.data.taskId}-${input.targetSuffix}`,
    keyPrefix: 'scene-reference-test',
    options,
  })
  return {
    imageKey,
    imageUrl: getSignedUrl(imageKey, 7 * 24 * 3600),
  }
}

export async function handleSceneReferenceTask(job: Job<TaskJobData>) {
  const payload = job.data.payload || {}
  const modelId = readRequiredString(payload.imageModel, 'imageModel')
  const sceneDescription = readRequiredString(payload.sceneDescription, 'sceneDescription')
  const styleRequest = readOptionalString(payload.styleRequest)
  const layouts = normalizeSceneReferenceLayouts(payload.layouts)
  const imageOptions = readImageOptions(payload.generationOptions)

  await reportTaskProgress(job, 15, {
    stage: 'scene_reference_single',
    stageLabel: job.data.locale === 'en' ? 'Generating single-view scene' : '生成单视图场景',
  })

  const singlePrompt = buildSingleSceneReferencePrompt({
    sceneDescription,
    styleRequest,
    locale: job.data.locale,
  })
  const single = await generateSceneImage({
    job,
    modelId,
    prompt: singlePrompt,
    targetSuffix: 'single',
    imageOptions,
  })

  const multiViews: Array<{
    id: SceneReferenceLayout
    label: string
    prompt: string
    imageKey: string
    imageUrl: string
  }> = []

  for (const [index, layout] of layouts.entries()) {
    await reportTaskProgress(job, 30 + Math.floor((index / Math.max(layouts.length, 1)) * 55), {
      stage: 'scene_reference_multi',
      stageLabel: job.data.locale === 'en' ? 'Generating multi-angle scene' : '生成多角度场景',
      layout,
    })
    const variant = buildMultiSceneReferencePrompt({
      sceneDescription,
      styleRequest,
      layout,
      locale: job.data.locale,
    })
    const image = await generateSceneImage({
      job,
      modelId,
      prompt: variant.prompt,
      targetSuffix: layout,
      imageOptions,
    })
    multiViews.push({ ...variant, ...image })
  }

  await reportTaskProgress(job, 95, {
    stage: 'scene_reference_done',
    stageLabel: job.data.locale === 'en' ? 'Scene references generated' : '场景参考图已生成',
  })

  return {
    singleView: {
      prompt: singlePrompt,
      ...single,
    },
    multiViews,
  }
}

export async function handleSceneReferenceComparisonTask(job: Job<TaskJobData>) {
  const payload = job.data.payload || {}
  const modelId = readRequiredString(payload.imageModel, 'imageModel')
  const characterImageUrl = readRequiredString(payload.characterImageUrl, 'characterImageUrl')
  const singleSceneImageUrl = readRequiredString(payload.singleSceneImageUrl, 'singleSceneImageUrl')
  const storyboardPrompt = readRequiredString(payload.storyboardPrompt, 'storyboardPrompt')
  const aspectRatio = readOptionalString(payload.aspectRatio) || '16:9'
  const variants = readVariants(payload.variants)
  const pairCount = readPairCount(payload.pairCount)
  const imageOptions = readImageOptions(payload.generationOptions)
  const prompt = buildSceneComparisonPrompt({
    storyboardPrompt,
    aspectRatio,
    locale: job.data.locale,
  })
  const normalizedCharacter = (await normalizeOptionalReferenceImagesForGeneration([characterImageUrl], {
    context: { taskType: String(job.data.type), scope: 'scene-reference.character' },
  }))[0]
  const normalizedSingleScene = (await normalizeOptionalReferenceImagesForGeneration([singleSceneImageUrl], {
    context: { taskType: String(job.data.type), scope: 'scene-reference.single-scene' },
  }))[0]
  if (!normalizedCharacter || !normalizedSingleScene) {
    throw new Error('SCENE_REFERENCE_INPUT_NORMALIZE_FAILED')
  }

  const pairs: Array<{
    variantId: string
    variantLabel: string
    pairIndex: number
    singleView: { imageKey: string; imageUrl: string; referenceImages: string[] }
    multiView: { imageKey: string; imageUrl: string; referenceImages: string[] }
  }> = []
  const total = Math.max(variants.length * pairCount, 1)
  let done = 0

  for (const variant of variants) {
    const normalizedMultiScene = (await normalizeOptionalReferenceImagesForGeneration([variant.imageUrl], {
      context: { taskType: String(job.data.type), scope: `scene-reference.multi-scene.${variant.id}` },
    }))[0]
    if (!normalizedMultiScene) throw new Error(`SCENE_REFERENCE_VARIANT_NORMALIZE_FAILED:${variant.id}`)

    for (let index = 0; index < pairCount; index++) {
      await reportTaskProgress(job, 15 + Math.floor((done / total) * 75), {
        stage: 'scene_reference_compare',
        stageLabel: job.data.locale === 'en' ? 'Generating A/B storyboard comparison' : '生成 A/B 分镜对比',
        variantId: variant.id,
        pairIndex: index,
      })

      const baseOptions = { aspectRatio, ...imageOptions }
      const singleReferenceImages = [normalizedCharacter, normalizedSingleScene]
      const multiReferenceImages = [normalizedCharacter, normalizedMultiScene]
      const single = await generateCleanImageToStorage({
        job,
        userId: job.data.userId,
        modelId,
        prompt,
        targetId: `${job.data.taskId}-${variant.id}-${index}-single`,
        keyPrefix: 'scene-reference-comparison',
        options: { ...baseOptions, referenceImages: singleReferenceImages },
      })
      const multi = await generateCleanImageToStorage({
        job,
        userId: job.data.userId,
        modelId,
        prompt,
        targetId: `${job.data.taskId}-${variant.id}-${index}-multi`,
        keyPrefix: 'scene-reference-comparison',
        options: { ...baseOptions, referenceImages: multiReferenceImages },
      })
      pairs.push({
        variantId: variant.id,
        variantLabel: variant.label,
        pairIndex: index + 1,
        singleView: {
          imageKey: single,
          imageUrl: getSignedUrl(single, 7 * 24 * 3600),
          referenceImages: singleReferenceImages,
        },
        multiView: {
          imageKey: multi,
          imageUrl: getSignedUrl(multi, 7 * 24 * 3600),
          referenceImages: multiReferenceImages,
        },
      })
      done += 1
    }
  }

  await reportTaskProgress(job, 95, {
    stage: 'scene_reference_compare_done',
    stageLabel: job.data.locale === 'en' ? 'A/B comparison generated' : 'A/B 对比已生成',
  })

  return {
    prompt,
    aspectRatio,
    pairCount,
    pairs,
  }
}
