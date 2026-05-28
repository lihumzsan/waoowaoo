import type { Job } from 'bullmq'
import { getSignedUrl } from '@/lib/storage'
import type { TaskJobData } from '@/lib/task/types'
import { getProjectModels } from '@/lib/workers/utils'
import { reportTaskProgress } from '@/lib/workers/shared'
import {
  resolveEditScriptStyleBibleForTask,
} from '@/lib/edit-script/style-bible-prompt'
import {
  buildCharacterStyleTestPrompt,
  CHARACTER_STYLE_TEST_ASPECT_RATIO,
} from '@/lib/character-style-test/prompt'
import { generateCleanImageToStorage } from './image-task-handler-shared'

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required`)
  }
  return value.trim()
}

export async function handleCharacterStyleTestTask(job: Job<TaskJobData>) {
  const payload = job.data.payload || {}
  const characterRequest = readRequiredString(payload.characterRequest, 'characterRequest')
  const episodeId = readRequiredString(payload.episodeId ?? job.data.episodeId, 'episodeId')
  const models = await getProjectModels(job.data.projectId, job.data.userId)
  const modelId = models.characterModel
  if (!modelId) throw new Error('Character model not configured')

  const styleBible = await resolveEditScriptStyleBibleForTask({
    projectId: job.data.projectId,
    episodeId,
  })
  if (!styleBible) {
    throw new Error('EDIT_SCRIPT_STYLE_BIBLE_REQUIRED')
  }

  const prompt = buildCharacterStyleTestPrompt({
    characterRequest,
    styleBible,
    locale: job.data.locale,
  })

  await reportTaskProgress(job, 20, {
    stage: 'character_style_test_prepare',
    stageLabel: job.data.locale === 'en'
      ? 'Preparing Style Bible character asset prompt'
      : '准备 Style Bible 角色资产提示词',
    displayMode: 'detail',
  })

  const imageKey = await generateCleanImageToStorage({
    job,
    userId: job.data.userId,
    modelId,
    prompt,
    targetId: job.data.taskId,
    keyPrefix: 'character-style-test',
    options: {
      aspectRatio: CHARACTER_STYLE_TEST_ASPECT_RATIO,
    },
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
    styleSummary: styleBible.styleSummary,
  }
}
