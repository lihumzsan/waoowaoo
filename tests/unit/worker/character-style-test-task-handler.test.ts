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
      characterRequest: '和尚',
      imageModel: 'character-model-1',
      generationOptions: { resolution: '1024x1024', quality: 'high' },
    }))

    expect(result).toEqual({
      imageUrl: 'https://signed.example/cos/character-style-test.jpg',
      imageKey: 'cos/character-style-test.jpg',
      prompt: expect.any(String),
      aspectRatio: CHARACTER_STYLE_TEST_ASPECT_RATIO,
      styleSummary: '本次临时资产风格来源：和尚',
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
    expect(generationInput?.prompt).toContain('本次角色资产风格规范（必须显性执行，不要只在脑中概括）')
    expect(generationInput?.prompt).toContain('短输入规则：如果用户只输入一个身份或名词')
    expect(generationInput?.prompt).toContain('必须主动选择鲜明、统一、可继承的视觉方向')
    expect(generationInput?.prompt).toContain('基础身份区 + 扩展语境区')
    expect(generationInput?.prompt).toContain('同一角色的正面全身、侧面全身、背面全身三视图')
    expect(generationInput?.prompt).toContain('根据本次角色特征自由生成 2 到 4 个小画面或姿态样本')
    expect(generationInput?.prompt).toContain('推导示例：输入“武僧”时')
    expect(generationInput?.prompt).toContain('用户没有明确指定的外观细节不要机械写死')
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
