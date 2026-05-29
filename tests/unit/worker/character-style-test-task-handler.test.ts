import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHARACTER_STYLE_TEST_ASPECT_RATIO } from '@/lib/character-style-test/prompt'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const sharedMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => undefined),
}))

const handlerSharedMock = vi.hoisted(() => ({
  generateCleanImageToStorage: vi.fn<(input: GenerationInput) => Promise<string>>(async () => 'cos/character-style-test.jpg'),
}))

const storageMock = vi.hoisted(() => ({
  getSignedUrl: vi.fn((key: string) => `https://signed.example/${key}`),
}))

vi.mock('@/lib/workers/shared', () => sharedMock)
vi.mock('@/lib/storage', () => storageMock)
vi.mock('@/lib/workers/handlers/image-task-handler-shared', () => handlerSharedMock)

import { handleCharacterStyleTestTask } from '@/lib/workers/handlers/character-style-test-task-handler'

type GenerationInput = {
  job?: Job<TaskJobData>
  userId: string
  modelId: string
  prompt: string
  keyPrefix: string
  targetId: string
  options: {
    aspectRatio: string
    resolution?: string
    quality?: string
  }
}

function buildJob(payload: Record<string, unknown>): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-character-style-test-1',
      type: TASK_TYPE.CHARACTER_STYLE_TEST,
      locale: 'zh',
      projectId: 'system',
      targetType: 'CharacterStyleTest',
      targetId: 'character-style-test',
      payload,
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker character-style-test-task-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('success path -> generates a stylized multi-view asset prompt from user input only', async () => {
    const result = await handleCharacterStyleTestTask(buildJob({
      characterRequest: '冷峻黑客，黑色风衣，窄框墨镜，霓虹黑色电影，冷绿色边缘光，胶片颗粒',
      imageModel: 'character-model-1',
      generationOptions: { resolution: '1024x1024', quality: 'high' },
    }))

    expect(result).toEqual({
      imageUrl: 'https://signed.example/cos/character-style-test.jpg',
      imageKey: 'cos/character-style-test.jpg',
      prompt: expect.any(String),
      aspectRatio: CHARACTER_STYLE_TEST_ASPECT_RATIO,
      styleSummary: '本次临时资产风格来源：冷峻黑客，黑色风衣，窄框墨镜，霓虹黑色电影，冷绿色边缘光，胶片颗粒',
    })

    const generationInput = handlerSharedMock.generateCleanImageToStorage.mock.calls[0]?.[0] as GenerationInput | undefined
    expect(generationInput).toEqual(expect.objectContaining({
      userId: 'user-1',
      modelId: 'character-model-1',
      keyPrefix: 'character-style-test',
      targetId: 'task-character-style-test-1',
      options: {
        aspectRatio: CHARACTER_STYLE_TEST_ASPECT_RATIO,
        resolution: '1024x1024',
        quality: 'high',
      },
    }))
    expect(generationInput?.prompt).toContain('用户输入（本次人物与风格的唯一来源）')
    expect(generationInput?.prompt).toContain('先根据用户输入在内部归纳一份“本次角色资产风格规范”')
    expect(generationInput?.prompt).toContain('左侧约 1/3 宽度为角色大头正面身份特写')
    expect(generationInput?.prompt).toContain('右侧约 2/3 宽度横向排列同一角色的正面全身、侧面全身、背面全身')
    expect(generationInput?.prompt).toContain('资产图不能使用纯白底')
    expect(generationInput?.prompt).toContain('不要引用项目 Style Bible')
  })

  it('missing image model -> explicit error before image generation', async () => {
    await expect(handleCharacterStyleTestTask(buildJob({
      characterRequest: '冷峻黑客',
    }))).rejects.toThrow('imageModel is required')
    expect(handlerSharedMock.generateCleanImageToStorage).not.toHaveBeenCalled()
  })
})
