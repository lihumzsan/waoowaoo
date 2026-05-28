import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHARACTER_STYLE_TEST_ASPECT_RATIO } from '@/lib/character-style-test/prompt'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import type { EditScriptStyleBible } from '@/lib/edit-script/types'
import { buildZenStyleBibleFixture } from '../../fixtures/edit-script-style-bible'

const utilsMock = vi.hoisted(() => ({
  getProjectModels: vi.fn(async () => ({ characterModel: 'character-model-1' })),
}))

const sharedMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => undefined),
}))

const handlerSharedMock = vi.hoisted(() => ({
  generateCleanImageToStorage: vi.fn<(input: GenerationInput) => Promise<string>>(async () => 'cos/character-style-test.jpg'),
}))

const storageMock = vi.hoisted(() => ({
  getSignedUrl: vi.fn((key: string) => `https://signed.example/${key}`),
}))

const styleBibleMock = vi.hoisted(() => ({
  resolveEditScriptStyleBibleForTask: vi.fn<() => Promise<EditScriptStyleBible | null>>(async () => buildZenStyleBibleFixture()),
}))

vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/workers/shared', () => sharedMock)
vi.mock('@/lib/storage', () => storageMock)
vi.mock('@/lib/edit-script/style-bible-prompt', async () => {
  const actual = await vi.importActual<typeof import('@/lib/edit-script/style-bible-prompt')>(
    '@/lib/edit-script/style-bible-prompt',
  )
  return {
    ...actual,
    resolveEditScriptStyleBibleForTask: styleBibleMock.resolveEditScriptStyleBibleForTask,
  }
})
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
  }
}

function buildJob(payload: Record<string, unknown>): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-character-style-test-1',
      type: TASK_TYPE.CHARACTER_STYLE_TEST,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'CharacterStyleTest',
      targetId: 'episode-1',
      payload,
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker character-style-test-task-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    utilsMock.getProjectModels.mockResolvedValue({ characterModel: 'character-model-1' })
    styleBibleMock.resolveEditScriptStyleBibleForTask.mockResolvedValue(buildZenStyleBibleFixture())
  })

  it('success path -> generates a stylized multi-view asset prompt from the real Style Bible', async () => {
    const result = await handleCharacterStyleTestTask(buildJob({
      characterRequest: '冷峻黑客，黑色风衣，窄框墨镜',
      episodeId: 'episode-1',
    }))

    expect(result).toEqual({
      imageUrl: 'https://signed.example/cos/character-style-test.jpg',
      imageKey: 'cos/character-style-test.jpg',
      prompt: expect.any(String),
      aspectRatio: CHARACTER_STYLE_TEST_ASPECT_RATIO,
      styleSummary: '禅意电影感，安静、克制、自然。',
    })

    const generationInput = handlerSharedMock.generateCleanImageToStorage.mock.calls[0]?.[0] as GenerationInput | undefined
    expect(generationInput).toEqual(expect.objectContaining({
      userId: 'user-1',
      modelId: 'character-model-1',
      keyPrefix: 'character-style-test',
      targetId: 'task-character-style-test-1',
      options: {
        aspectRatio: CHARACTER_STYLE_TEST_ASPECT_RATIO,
      },
    }))
    expect(generationInput?.prompt).toContain('左侧约 1/3 宽度为角色大头正面身份特写')
    expect(generationInput?.prompt).toContain('右侧约 2/3 宽度横向排列同一角色的正面全身、侧面全身、背面全身')
    expect(generationInput?.prompt).toContain('资产图不能使用纯白底')
    expect(generationInput?.prompt).toContain('系统 Style Bible 视觉要求（固定追加，必须遵守）：')
    expect(generationInput?.prompt).toContain('用途：资产图生成')
    expect(generationInput?.prompt).toContain('画面滤镜：轻微柔焦，35mm镜头，克制高光。')
  })

  it('missing Style Bible -> explicit error before image generation', async () => {
    styleBibleMock.resolveEditScriptStyleBibleForTask.mockResolvedValueOnce(null)

    await expect(handleCharacterStyleTestTask(buildJob({
      characterRequest: '冷峻黑客',
      episodeId: 'episode-1',
    }))).rejects.toThrow('EDIT_SCRIPT_STYLE_BIBLE_REQUIRED')
    expect(handlerSharedMock.generateCleanImageToStorage).not.toHaveBeenCalled()
  })

  it('missing character model -> explicit error', async () => {
    utilsMock.getProjectModels.mockResolvedValueOnce({ characterModel: '' })

    await expect(handleCharacterStyleTestTask(buildJob({
      characterRequest: '冷峻黑客',
      episodeId: 'episode-1',
    }))).rejects.toThrow('Character model not configured')
  })
})
