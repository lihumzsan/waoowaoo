import type { Job } from 'bullmq'
import { getSignedUrl } from '@/lib/storage'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import {
  buildCharacterStyleTestPrompt,
  buildCharacterStyleTestStyleSummary,
  CHARACTER_STYLE_TEST_ASPECT_RATIO,
} from '@/lib/character-style-test/prompt'
import { generateCleanImageToStorage } from './image-task-handler-shared'

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required`)
  }
  return value.trim()
}

function readGenerationOptions(value: unknown): { resolution?: string; quality?: string } {
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

export async function handleCharacterStyleTestTask(job: Job<TaskJobData>) {
  const payload = job.data.payload || {}
  const characterRequest = readRequiredString(payload.characterRequest, 'characterRequest')
  const modelId = readRequiredString(payload.imageModel, 'imageModel')
  const generationOptions = readGenerationOptions(payload.generationOptions)

  const prompt = buildCharacterStyleTestPrompt({
    characterRequest,
    locale: job.data.locale,
  })
  const styleSummary = buildCharacterStyleTestStyleSummary({
    characterRequest,
    locale: job.data.locale,
  })

  await reportTaskProgress(job, 20, {
    stage: 'character_style_test_prepare',
    stageLabel: job.data.locale === 'en'
      ? 'Preparing input-derived character asset prompt'
      : '准备基于输入归纳的角色资产提示词',
    displayMode: 'detail',
  })

  const imageOptions = {
    aspectRatio: CHARACTER_STYLE_TEST_ASPECT_RATIO,
    ...generationOptions,
  }

  const imageKey = await generateCleanImageToStorage({
    job,
    userId: job.data.userId,
    modelId,
    prompt,
    targetId: job.data.taskId,
    keyPrefix: 'character-style-test',
    options: imageOptions,
  })

  await reportTaskProgress(job, 95, {
    stage: 'character_style_test_done',
    stageLabel: job.data.locale === 'en'
      ? 'Character style test image generated'
      : '角色风格测试图已生成',
    displayMode: 'detail',
  })

  return {
    imageUrl: getSignedUrl(imageKey, 7 * 24 * 3600),
    imageKey,
    prompt,
    aspectRatio: CHARACTER_STYLE_TEST_ASPECT_RATIO,
    styleSummary,
  }
}
