import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

type TextStepInput = {
  model: string
  action: string
}

const sharedMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => undefined),
}))

const storageMock = vi.hoisted(() => ({
  getSignedUrl: vi.fn((key: string) => `https://signed.example/${key}`),
}))

const handlerSharedMock = vi.hoisted(() => ({
  generateCleanImageToStorage: vi.fn(async (input: GenerationInput) => `${input.keyPrefix}/${input.targetId}.jpg`),
}))

const textEngineMock = vi.hoisted(() => ({
  executeAiTextStep: vi.fn<(input: TextStepInput) => Promise<{ text: string }>>(
    async () => ({ text: '{"prompt":"最终办公室惊悚空场景提示词"}' }),
  ),
}))

vi.mock('@/lib/ai-exec/engine', () => textEngineMock)
vi.mock('@/lib/workers/shared', () => sharedMock)
vi.mock('@/lib/storage', () => storageMock)
vi.mock('@/lib/workers/handlers/image-task-handler-shared', () => handlerSharedMock)

import { handleScenePromptTestTask } from '@/lib/workers/handlers/scene-prompt-test-task-handler'

type GenerationInput = {
  userId: string
  modelId: string
  prompt: string
  targetId: string
  keyPrefix: string
  allowTaskExternalIdResume?: boolean
  options?: {
    aspectRatio?: string
  }
}

function buildJob(payload: Record<string, unknown>): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-scene-prompt-test-1',
      type: TASK_TYPE.SCENE_PROMPT_TEST,
      locale: 'zh',
      projectId: 'system',
      targetType: 'ScenePromptTest',
      targetId: 'scene-prompt-test',
      payload,
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker scene-prompt-test-task-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('generates current baseline plus three story-aware scene prompt variants', async () => {
    const result = await handleScenePromptTestTask(buildJob({
      imageModel: 'location-model-1',
      analysisModel: 'analysis-model-1',
      sceneInput: '少年武僧下山前夜，师父在山寺庭院交代他去寻找失踪的旧友。清晨雾气很重，寺门外的山路通向未知的城镇。',
    }))

    expect(result.variants).toHaveLength(4)
    expect(result.variants.map((variant) => variant.id)).toEqual([
      'current_baseline',
      'story_core_single',
      'spatial_wide',
      'multi_view_board',
    ])
    expect(result.variants.map((variant) => variant.aspectRatio)).toEqual(['16:9', '16:9', '16:9', '21:9'])
    expect(result.variants.map((variant) => variant.prompt)).toEqual([
      '最终办公室惊悚空场景提示词',
      '最终办公室惊悚空场景提示词',
      '最终办公室惊悚空场景提示词',
      '最终办公室惊悚空场景提示词',
    ])
    expect(textEngineMock.executeAiTextStep).toHaveBeenCalledTimes(4)
    expect(textEngineMock.executeAiTextStep.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      model: 'analysis-model-1',
      action: 'scene_prompt_test_draft',
    }))

    expect(handlerSharedMock.generateCleanImageToStorage).toHaveBeenCalledTimes(4)
    const generationCalls = handlerSharedMock.generateCleanImageToStorage.mock.calls.map((call) => call[0] as GenerationInput)
    expect(generationCalls.map((call) => call.modelId)).toEqual([
      'location-model-1',
      'location-model-1',
      'location-model-1',
      'location-model-1',
    ])
    expect(generationCalls.map((call) => call.keyPrefix)).toEqual([
      'scene-prompt-test',
      'scene-prompt-test',
      'scene-prompt-test',
      'scene-prompt-test',
    ])
    expect(generationCalls.map((call) => call.allowTaskExternalIdResume)).toEqual([false, false, false, false])
    expect(generationCalls.map((call) => call.prompt)).toEqual([
      '最终办公室惊悚空场景提示词',
      '最终办公室惊悚空场景提示词',
      '最终办公室惊悚空场景提示词',
      '最终办公室惊悚空场景提示词',
    ])
    expect(generationCalls.map((call) => call.options?.aspectRatio)).toEqual(['16:9', '16:9', '16:9', '21:9'])
  })
})
