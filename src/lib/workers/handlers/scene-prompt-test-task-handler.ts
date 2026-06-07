import type { Job } from 'bullmq'
import { getSignedUrl } from '@/lib/storage'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { buildScenePromptTestVariants } from '@/lib/scene-prompt-test/prompts'
import { generateCleanImageToStorage } from './image-task-handler-shared'

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`)
  return value.trim()
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

export async function handleScenePromptTestTask(job: Job<TaskJobData>) {
  const payload = job.data.payload || {}
  const modelId = readRequiredString(payload.imageModel, 'imageModel')
  const sceneInput = readRequiredString(payload.sceneInput, 'sceneInput')
  const imageOptions = readImageOptions(payload.generationOptions)
  const variants = buildScenePromptTestVariants({
    sceneInput,
    locale: job.data.locale,
  })
  const results: Array<{
    id: string
    label: string
    aspectRatio: string
    prompt: string
    imageKey: string
    imageUrl: string
  }> = []

  for (let index = 0; index < variants.length; index++) {
    const variant = variants[index]
    await reportTaskProgress(job, 15 + Math.floor((index / Math.max(variants.length, 1)) * 75), {
      stage: 'scene_prompt_test_generate',
      stageLabel: job.data.locale === 'en' ? `Generating ${variant.label}` : `生成${variant.label}`,
      variantId: variant.id,
    })
    const imageKey = await generateCleanImageToStorage({
      job,
      userId: job.data.userId,
      modelId,
      prompt: variant.prompt,
      targetId: `${job.data.taskId}-${variant.id}`,
      keyPrefix: 'scene-prompt-test',
      allowTaskExternalIdResume: false,
      options: {
        aspectRatio: variant.aspectRatio,
        ...imageOptions,
      },
    })
    results.push({
      ...variant,
      imageKey,
      imageUrl: getSignedUrl(imageKey, 7 * 24 * 3600),
    })
  }

  await reportTaskProgress(job, 95, {
    stage: 'scene_prompt_test_done',
    stageLabel: job.data.locale === 'en' ? 'Scene prompt test generated' : '造景 Prompt 测试已生成',
  })

  return {
    variants: results,
  }
}
