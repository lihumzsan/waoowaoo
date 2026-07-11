import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHARACTER_PROMPT_SUFFIX, getArtStylePrompt } from '@/lib/constants'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => undefined),
  getProjectModels: vi.fn(async () => ({ characterModel: 'image-model-1', artStyle: 'realistic' })),
  toSignedUrlIfCos: vi.fn((url: string | null | undefined) => (url ? `https://signed.example/${url}` : null)),
}))

const outboundMock = vi.hoisted(() => ({
  normalizeReferenceImagesForGeneration: vi.fn(async () => ['normalized-primary-ref']),
}))

const prismaMock = vi.hoisted(() => ({
  characterAppearance: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(async () => ({})),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  novelPromotionCharacter: {
    findUnique: vi.fn(),
  },
}))

const sharedMock = vi.hoisted(() => ({
  generateProjectLabeledImageToStorage: vi.fn<(input: {
    prompt: string
    label: string
    options?: { referenceImages?: string[]; aspectRatio?: string }
  }) => Promise<string>>(async () => 'cos/character-generated-0.png'),
}))

vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/media/outbound-image', () => outboundMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn(async () => undefined) }))
vi.mock('@/lib/workers/handlers/image-task-handler-shared', async () => {
  const actual = await vi.importActual<typeof import('@/lib/workers/handlers/image-task-handler-shared')>(
    '@/lib/workers/handlers/image-task-handler-shared',
  )
  return {
    ...actual,
    generateProjectLabeledImageToStorage: sharedMock.generateProjectLabeledImageToStorage,
  }
})

import { handleCharacterImageTask } from '@/lib/workers/handlers/character-image-task-handler'

function buildJob(payload: Record<string, unknown>, targetId = 'appearance-2'): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-character-image-1',
      type: TASK_TYPE.IMAGE_CHARACTER,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: null,
      targetType: 'CharacterAppearance',
      targetId,
      payload,
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker character-image-task-handler behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()

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
      imageUrl: 'cos/primary.png',
      imageUrls: JSON.stringify(['cos/primary.png']),
    })
  })

  it('characterModel not configured -> explicit error', async () => {
    utilsMock.getProjectModels.mockResolvedValueOnce({ characterModel: '', artStyle: 'realistic' })
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

    const generationInput = sharedMock.generateProjectLabeledImageToStorage.mock.calls[0]?.[0] as {
      prompt: string
      label: string
      options?: { referenceImages?: string[]; aspectRatio?: string }
    }
    const realisticStylePrompt = getArtStylePrompt('realistic', 'zh')

    expect(generationInput.prompt).toContain(CHARACTER_PROMPT_SUFFIX)
    expect(generationInput.prompt).toContain(realisticStylePrompt)
    expect(generationInput.prompt.split(CHARACTER_PROMPT_SUFFIX).length - 1).toBe(1)
    expect(generationInput.prompt.split(realisticStylePrompt).length - 1).toBe(1)
    expect(generationInput.label).toBe('Hero - 战斗形态')
    expect(generationInput.options).toEqual(expect.objectContaining({
      referenceImages: ['normalized-primary-ref'],
      aspectRatio: '3:2',
    }))

    expect(prismaMock.characterAppearance.updateMany).toHaveBeenCalledWith({
      where: { id: 'appearance-2', imageUrls: JSON.stringify([]) },
      data: {
        imageUrls: JSON.stringify(['cos/character-generated-0.png']),
        imageUrl: 'cos/character-generated-0.png',
      },
    })
  })

  it('retries a single-image merge when a parallel sibling updates imageUrls first', async () => {
    prismaMock.characterAppearance.findUnique
      .mockResolvedValueOnce({
        id: 'appearance-2',
        characterId: 'character-1',
        appearanceIndex: 1,
        descriptions: JSON.stringify(['A', 'B']),
        description: 'A',
        imageUrls: JSON.stringify([]),
        selectedIndex: 0,
        imageUrl: null,
        changeReason: '初始形象',
        character: { name: 'Hero' },
      })
      .mockResolvedValueOnce({
        imageUrls: JSON.stringify([]),
        selectedIndex: 0,
        imageUrl: null,
      })
      .mockResolvedValueOnce({
        imageUrls: JSON.stringify(['cos/index-0.png']),
        selectedIndex: 0,
        imageUrl: 'cos/index-0.png',
      })
    prismaMock.characterAppearance.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
    sharedMock.generateProjectLabeledImageToStorage.mockResolvedValueOnce('cos/index-1.png')

    await handleCharacterImageTask(buildJob({ imageIndex: 1 }))

    expect(prismaMock.characterAppearance.updateMany).toHaveBeenCalledTimes(2)
    expect(prismaMock.characterAppearance.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: 'appearance-2',
        imageUrls: JSON.stringify(['cos/index-0.png']),
      },
      data: {
        imageUrls: JSON.stringify(['cos/index-0.png', 'cos/index-1.png']),
        imageUrl: 'cos/index-0.png',
      },
    })
  })

  it('payload artStyle overrides project artStyle in prompt', async () => {
    const job = buildJob({ imageIndex: 0, artStyle: 'japanese-anime' })
    await handleCharacterImageTask(job)

    const generationInput = sharedMock.generateProjectLabeledImageToStorage.mock.calls[0]?.[0] as {
      prompt: string
    }
    expect(generationInput.prompt).toContain(getArtStylePrompt('japanese-anime', 'zh'))
    expect(generationInput.prompt).not.toContain(getArtStylePrompt('realistic', 'zh'))
  })

  it('adds a visible-variation instruction when regenerating an existing character image', async () => {
    const job = buildJob({ imageIndex: 0, regenerationToken: 'regen-test-token' })
    await handleCharacterImageTask(job)

    const generationInput = sharedMock.generateProjectLabeledImageToStorage.mock.calls[0]?.[0] as {
      prompt: string
    }
    expect(generationInput.prompt).toContain('Regeneration variation token: regen-test-token-img-1-of-1')
    expect(generationInput.prompt).toContain('visibly different')
    expect(generationInput.prompt).toContain('at least three secondary elements')
    expect(generationInput.prompt).toContain('redraw the image from scratch')
    expect(generationInput.prompt).toContain('overrides earlier exact wardrobe')
    expect(generationInput.prompt).toContain('Do not repeat the same garment and color combination')
    expect(generationInput.prompt).toContain('gender presentation')
    expect(generationInput.prompt).toContain(CHARACTER_PROMPT_SUFFIX)
  })

  it('removes fixed wardrobe clauses from character regeneration prompts', async () => {
    prismaMock.characterAppearance.findUnique.mockResolvedValueOnce({
      id: 'appearance-2',
      characterId: 'character-1',
      appearanceIndex: 1,
      descriptions: JSON.stringify([
        '脸型清秀，眼神清澈。乌黑短发，身形修长。身穿白色衬衫，外搭灰色连帽外套，浅灰长裤，脚穿白灰短靴。',
      ]),
      description: '脸型清秀，眼神清澈。乌黑短发，身形修长。身穿白色衬衫，外搭灰色连帽外套，浅灰长裤，脚穿白灰短靴。',
      imageUrls: JSON.stringify([]),
      selectedIndex: 0,
      imageUrl: null,
      changeReason: '初始形象',
      character: { name: 'Hero' },
    })

    await handleCharacterImageTask(buildJob({ imageIndex: 0, regenerationToken: 'regen-test-token' }))

    const generationInput = sharedMock.generateProjectLabeledImageToStorage.mock.calls[0]?.[0] as {
      prompt: string
    }
    expect(generationInput.prompt).toContain('脸型清秀')
    expect(generationInput.prompt).toContain('乌黑短发')
    expect(generationInput.prompt).not.toContain('身穿白色衬衫')
    expect(generationInput.prompt).not.toContain('灰色连帽外套')
    expect(generationInput.prompt).not.toContain('白灰短靴')
    expect(generationInput.prompt).toContain('Regeneration wardrobe redesign')
    expect(generationInput.prompt).toContain('Suggested alternate styling')
  })

  it('invalid payload artStyle -> explicit error', async () => {
    await expect(handleCharacterImageTask(buildJob({ imageIndex: 0, artStyle: 'noir' }))).rejects.toThrow(
      'Invalid artStyle in IMAGE_CHARACTER payload',
    )
  })

  it('uses requested count for grouped generation and expands imageUrls to requested size', async () => {
    sharedMock.generateProjectLabeledImageToStorage
      .mockResolvedValueOnce('cos/character-generated-0.png')
      .mockResolvedValueOnce('cos/character-generated-1.png')
      .mockResolvedValueOnce('cos/character-generated-2.png')
      .mockResolvedValueOnce('cos/character-generated-3.png')
      .mockResolvedValueOnce('cos/character-generated-4.png')

    const result = await handleCharacterImageTask(buildJob({ count: 5 }))

    expect(sharedMock.generateProjectLabeledImageToStorage).toHaveBeenCalledTimes(5)
    expect(result).toEqual({
      appearanceId: 'appearance-2',
      imageCount: 5,
      imageUrl: 'cos/character-generated-0.png',
    })
    expect(prismaMock.characterAppearance.update).toHaveBeenCalledWith({
      where: { id: 'appearance-2' },
      data: {
        imageUrls: JSON.stringify([
          'cos/character-generated-0.png',
          'cos/character-generated-1.png',
          'cos/character-generated-2.png',
          'cos/character-generated-3.png',
          'cos/character-generated-4.png',
        ]),
        imageUrl: 'cos/character-generated-0.png',
      },
    })
  })

  it('uses a different regeneration variation token for each image in a grouped regeneration', async () => {
    sharedMock.generateProjectLabeledImageToStorage
      .mockResolvedValueOnce('cos/character-generated-0.png')
      .mockResolvedValueOnce('cos/character-generated-1.png')
      .mockResolvedValueOnce('cos/character-generated-2.png')

    await handleCharacterImageTask(buildJob({ count: 3, regenerationToken: 'regen-group-token' }))

    const prompts = sharedMock.generateProjectLabeledImageToStorage.mock.calls.map((call) => call[0].prompt)
    expect(prompts).toHaveLength(3)
    expect(prompts[0]).toContain('Regeneration variation token: regen-group-token-img-1-of-3')
    expect(prompts[1]).toContain('Regeneration variation token: regen-group-token-img-2-of-3')
    expect(prompts[2]).toContain('Regeneration variation token: regen-group-token-img-3-of-3')
    expect(new Set(prompts).size).toBe(3)
  })
})
