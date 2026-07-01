import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHARACTER_ASSET_IMAGE_RATIO, CHARACTER_PROMPT_SUFFIX } from '@/lib/constants'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { buildZenStyleBibleFixture } from '../../fixtures/edit-script-style-bible'

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => undefined),
  getProjectModels: vi.fn(async () => ({ characterModel: 'image-model-1', analysisModel: 'analysis-model-1' })),
  toSignedUrlIfCos: vi.fn((url: string | null | undefined) => (url ? `https://signed.example/${url}` : null)),
}))

const outboundMock = vi.hoisted(() => ({
  normalizeOptionalReferenceImagesForGeneration: vi.fn(async () => ['normalized-primary-ref']),
}))

const prismaMock = vi.hoisted(() => ({
  project: {
    findUnique: vi.fn(),
  },
  characterAppearance: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(async () => ({})),
  },
  projectCharacter: {
    findUnique: vi.fn(),
  },
  projectEditScript: {
    findFirst: vi.fn(),
  },
  projectEditScreenplay: {
    findFirst: vi.fn(),
  },
  projectEditAssetRequirement: {
    updateMany: vi.fn(async () => ({ count: 0 })),
  },
}))

const sharedMock = vi.hoisted(() => ({
  generateCleanImageToStorage: vi.fn<(input: {
    prompt: string
    options?: { referenceImages?: string[]; aspectRatio?: string }
  }) => Promise<string>>(async () => 'cos/character-generated-0.png'),
}))

const textEngineMock = vi.hoisted(() => ({
  executeAiTextStep: vi.fn(async () => ({
    text: JSON.stringify({
      prompts: [
        '候选角色提示词A，身份轮廓清晰',
        '候选角色提示词B，服装材质清晰',
        '候选角色提示词C，分镜动作语境清晰',
      ],
    }),
  })),
}))

vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/media/outbound-image', () => outboundMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/ai-exec/engine', () => textEngineMock)
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn(async () => undefined) }))
vi.mock('@/lib/workers/handlers/image-task-handler-shared', async () => {
  const actual = await vi.importActual<typeof import('@/lib/workers/handlers/image-task-handler-shared')>(
    '@/lib/workers/handlers/image-task-handler-shared',
  )
  return {
    ...actual,
    generateCleanImageToStorage: sharedMock.generateCleanImageToStorage,
  }
})

import { handleCharacterImageTask } from '@/lib/workers/handlers/character-image-task-handler'

function buildJob(
  payload: Record<string, unknown>,
  targetId = 'appearance-2',
  episodeId: string | null = null,
): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-character-image-1',
      type: TASK_TYPE.IMAGE_CHARACTER,
      locale: 'zh',
      projectId: 'project-1',
      episodeId,
      targetType: 'CharacterAppearance',
      targetId,
      payload: {
        generationOptions: { aspectRatio: CHARACTER_ASSET_IMAGE_RATIO },
        ...payload,
      },
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker character-image-task-handler behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    prismaMock.project.findUnique.mockResolvedValue({
      id: 'project-1',
    })

    prismaMock.characterAppearance.findUnique.mockResolvedValue({
      id: 'appearance-2',
      characterId: 'character-1',
      appearanceIndex: 1,
      descriptions: JSON.stringify(['角色描述A']),
      description: '角色描述A',
      imageUrls: JSON.stringify([]),
      selectedIndex: 0,
      imageUrl: null,
      changeReason: '战斗形态',
      character: { name: 'Hero' },
    })

    prismaMock.characterAppearance.findFirst.mockResolvedValue({
      imageUrl: 'cos/primary-fallback.png',
      imageUrls: JSON.stringify(['cos/primary-fallback.png', 'cos/primary-selected.png']),
      selectedIndex: 1,
    })
    prismaMock.projectEditScript.findFirst.mockResolvedValue(null)
    prismaMock.projectEditScreenplay.findFirst.mockResolvedValue(null)
  })

  it('characterModel not configured -> explicit error', async () => {
    utilsMock.getProjectModels.mockResolvedValueOnce({ characterModel: '', analysisModel: 'analysis-model-1' })
    await expect(handleCharacterImageTask(buildJob({}))).rejects.toThrow('Character model not configured')
  })

  it('success path -> uses primary appearance as reference and persists imageUrls', async () => {
    const job = buildJob({ imageIndex: 0 })
    const result = await handleCharacterImageTask(job)

    expect(result).toEqual({
      appearanceId: 'appearance-2',
      imageCount: 1,
      imageUrl: 'cos/character-generated-0.png',
    })

    const generationInput = sharedMock.generateCleanImageToStorage.mock.calls[0]?.[0] as {
      prompt: string
      options?: { referenceImages?: string[]; aspectRatio?: string }
    }
    expect(generationInput.prompt).toContain(CHARACTER_PROMPT_SUFFIX)
    expect(generationInput.prompt).toContain('画面固定为单张完整 16:9 横版角色资产板')
    expect(generationInput.prompt).toContain('左侧约 40% 宽度是角色主全身英雄照')
    expect(generationInput.prompt).toContain('主全身照必须只有人物本体')
    expect(generationInput.prompt).toContain('不能手持任何物品')
    expect(generationInput.prompt).toContain('右上约 35% 高度是标准三视图')
    expect(generationInput.prompt).toContain('右下约 65% 高度是 3 个横向排列的动作/语境样本')
    expect(generationInput.prompt.split(CHARACTER_PROMPT_SUFFIX).length - 1).toBe(1)
    expect(generationInput.prompt).not.toContain('美式漫画风格')
    expect(generationInput.prompt).not.toContain('日式动漫风格')
    expect(generationInput.prompt).not.toContain('写实电影风格')
    expect(utilsMock.toSignedUrlIfCos).toHaveBeenCalledWith('cos/primary-selected.png', 3600)
    expect(generationInput.options).toEqual(expect.objectContaining({
      referenceImages: ['normalized-primary-ref'],
      aspectRatio: CHARACTER_ASSET_IMAGE_RATIO,
    }))

    expect(prismaMock.characterAppearance.update).toHaveBeenCalledWith({
      where: { id: 'appearance-2' },
      data: {
        imageUrls: JSON.stringify(['cos/character-generated-0.png']),
        imageUrl: 'cos/character-generated-0.png',
      },
    })
    expect(prismaMock.projectEditAssetRequirement.updateMany).toHaveBeenCalledWith({
      where: {
        projectId: 'project-1',
        kind: 'character',
        targetId: { in: ['character-1'] },
      },
      data: {
        status: 'completed',
        errorMessage: null,
      },
    })
  })

  it('primary appearance generation omits referenceImages option when no reference image exists', async () => {
    outboundMock.normalizeOptionalReferenceImagesForGeneration.mockResolvedValueOnce([])
    prismaMock.characterAppearance.findUnique.mockResolvedValueOnce({
      id: 'appearance-1',
      characterId: 'character-1',
      appearanceIndex: 0,
      descriptions: JSON.stringify(['主形象描述A']),
      description: '主形象描述A',
      imageUrls: JSON.stringify([]),
      selectedIndex: 0,
      imageUrl: null,
      changeReason: '初始形象',
      character: { name: 'Hero' },
    })

    await handleCharacterImageTask(buildJob({ imageIndex: 0 }, 'appearance-1'))

    expect(prismaMock.characterAppearance.findFirst).not.toHaveBeenCalled()
    const generationInput = sharedMock.generateCleanImageToStorage.mock.calls[0]?.[0] as {
      options?: { referenceImages?: string[]; aspectRatio?: string }
    }
    expect(generationInput.options).toEqual({
      aspectRatio: CHARACTER_ASSET_IMAGE_RATIO,
    })
    expect(Object.prototype.hasOwnProperty.call(generationInput.options || {}, 'referenceImages')).toBe(false)
  })

  it('appends Style Bible block to final character asset image prompt', async () => {
    prismaMock.projectEditScreenplay.findFirst.mockResolvedValueOnce({
      styleBibleJson: buildZenStyleBibleFixture(),
    })

    await handleCharacterImageTask(buildJob({ imageIndex: 0 }, 'appearance-2', 'episode-1'))

    const generationInput = sharedMock.generateCleanImageToStorage.mock.calls[0]?.[0] as {
      prompt: string
    }
    expect(generationInput.prompt).toContain('角色描述A')
    expect(generationInput.prompt).toContain('角色资产设定图')
    expect(generationInput.prompt).toContain('系统 Style Bible 视觉要求（固定追加，必须遵守）：')
    expect(generationInput.prompt).toContain('用途：资产图生成')
    expect(generationInput.prompt).toContain('画面滤镜：轻微柔焦，35mm镜头，克制高光。')
    expect(generationInput.prompt).not.toContain('负向约束：')
    expect(generationInput.prompt).not.toContain('Negative constraints:')
  })

  it('legacy payload artStyle -> explicit error', async () => {
    await expect(handleCharacterImageTask(buildJob({ imageIndex: 0, artStyle: 'noir' }))).rejects.toThrow(
      'LEGACY_ART_STYLE_REMOVED',
    )
  })

  it('uses requested count for grouped generation and expands imageUrls to requested size', async () => {
    sharedMock.generateCleanImageToStorage
      .mockResolvedValueOnce('cos/character-generated-0.png')
      .mockResolvedValueOnce('cos/character-generated-1.png')
      .mockResolvedValueOnce('cos/character-generated-2.png')

    const result = await handleCharacterImageTask(buildJob({ count: 5 }))

    expect(textEngineMock.executeAiTextStep).toHaveBeenCalledTimes(1)
    expect(sharedMock.generateCleanImageToStorage).toHaveBeenCalledTimes(3)
    const textCalls = textEngineMock.executeAiTextStep.mock.calls as unknown as Array<[{ messages?: Array<{ content?: string }> }]>
    const promptRequest = textCalls[0]?.[0]
    expect(promptRequest?.messages?.[0]?.content).toContain('三条不同的最终图片生成提示词')
    expect(result).toEqual({
      appearanceId: 'appearance-2',
      imageCount: 3,
      imageUrl: 'cos/character-generated-0.png',
    })
    expect(prismaMock.characterAppearance.update).toHaveBeenCalledWith({
      where: { id: 'appearance-2' },
      data: {
        imageUrls: JSON.stringify([
          'cos/character-generated-0.png',
          'cos/character-generated-1.png',
          'cos/character-generated-2.png',
        ]),
        imageUrl: 'cos/character-generated-0.png',
        descriptions: JSON.stringify([
          '候选角色提示词A，身份轮廓清晰',
          '候选角色提示词B，服装材质清晰',
          '候选角色提示词C，分镜动作语境清晰',
        ]),
      },
    })
  })

  it('honors explicit single-image grouped generation without candidate prompt analysis', async () => {
    sharedMock.generateCleanImageToStorage.mockResolvedValueOnce('cos/character-generated-single.png')

    const result = await handleCharacterImageTask(buildJob({ count: 1 }))

    expect(textEngineMock.executeAiTextStep).not.toHaveBeenCalled()
    expect(sharedMock.generateCleanImageToStorage).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      appearanceId: 'appearance-2',
      imageCount: 1,
      imageUrl: 'cos/character-generated-single.png',
    })
    expect(prismaMock.characterAppearance.update).toHaveBeenCalledWith({
      where: { id: 'appearance-2' },
      data: {
        imageUrls: JSON.stringify(['cos/character-generated-single.png']),
        imageUrl: 'cos/character-generated-single.png',
      },
    })
  })

  it('grouped character generation requires analysis model for candidate prompts', async () => {
    utilsMock.getProjectModels.mockResolvedValueOnce({ characterModel: 'image-model-1', analysisModel: '' })

    await expect(handleCharacterImageTask(buildJob({ count: 3 }))).rejects.toThrow(
      'CHARACTER_CANDIDATE_PROMPT_MODEL_REQUIRED',
    )
    expect(sharedMock.generateCleanImageToStorage).not.toHaveBeenCalled()
  })
})
