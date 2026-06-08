import type { Job } from 'bullmq'
import { executeAiTextStep } from '@/lib/ai-exec/engine'
import { safeParseJsonObject } from '@/lib/json-repair'
import { getSignedUrl } from '@/lib/storage'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { buildScenePromptTestStrategies, type ScenePromptStrategy } from '@/lib/scene-prompt-test/prompts'
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

async function generateFinalImagePrompt(input: {
  readonly job: Job<TaskJobData>
  readonly strategy: ScenePromptStrategy
  readonly analysisModel: string
}): Promise<string> {
  const completion = await executeAiTextStep({
    userId: input.job.data.userId,
    model: input.analysisModel,
    messages: [{ role: 'user', content: input.strategy.draftInstruction }],
    temperature: 0.7,
    projectId: input.job.data.projectId,
    action: 'scene_prompt_test_draft',
    meta: {
      stepId: `scene_prompt_test_draft:${input.strategy.id}`,
      stepTitle: input.strategy.label,
      stepIndex: 1,
      stepTotal: 1,
    },
  })
  const parsed = safeParseJsonObject(completion.text)
  const prompt = typeof parsed.prompt === 'string' ? parsed.prompt.trim() : ''
  if (!prompt) throw new Error(`SCENE_PROMPT_TEST_EMPTY_FINAL_PROMPT:${input.strategy.id}`)
  return prompt
}

export async function handleScenePromptTestTask(job: Job<TaskJobData>) {
  const payload = job.data.payload || {}
  const modelId = readRequiredString(payload.imageModel, 'imageModel')
  const analysisModel = readRequiredString(payload.analysisModel, 'analysisModel')
  const sceneInput = readRequiredString(payload.sceneInput, 'sceneInput')
  const imageOptions = readImageOptions(payload.generationOptions)
  const strategies = buildScenePromptTestStrategies({
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

  for (let index = 0; index < strategies.length; index++) {
    const strategy = strategies[index]
    await reportTaskProgress(job, 10 + Math.floor((index / Math.max(strategies.length, 1)) * 35), {
      stage: 'scene_prompt_test_draft',
      stageLabel: job.data.locale === 'en' ? `Drafting ${strategy.label}` : `生成${strategy.label}最终提示词`,
      variantId: strategy.id,
    })
    const prompt = await generateFinalImagePrompt({
      job,
      strategy,
      analysisModel,
    })
    await reportTaskProgress(job, 45 + Math.floor((index / Math.max(strategies.length, 1)) * 45), {
      stage: 'scene_prompt_test_generate',
      stageLabel: job.data.locale === 'en' ? `Generating ${strategy.label}` : `生成${strategy.label}`,
      variantId: strategy.id,
    })
    const imageKey = await generateCleanImageToStorage({
      job,
      userId: job.data.userId,
      modelId,
      prompt,
      targetId: `${job.data.taskId}-${strategy.id}`,
      keyPrefix: 'scene-prompt-test',
      allowTaskExternalIdResume: false,
      options: {
        aspectRatio: strategy.aspectRatio,
        ...imageOptions,
      },
    })
    results.push({
      id: strategy.id,
      label: strategy.label,
      aspectRatio: strategy.aspectRatio,
      prompt,
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
