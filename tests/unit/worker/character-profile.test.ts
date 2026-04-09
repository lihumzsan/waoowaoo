import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  novelPromotionCharacter: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(async () => ({})),
  },
  characterAppearance: {
    create: vi.fn(async (args: { data: { appearanceIndex: number, characterId: string } }) => ({
      id: `appearance-${args.data.appearanceIndex}`,
      appearanceIndex: args.data.appearanceIndex,
      characterId: args.data.characterId,
    })),
    deleteMany: vi.fn(async () => ({ count: 1 })),
  },
}))

const aiRuntimeMock = vi.hoisted(() => ({
  executeAiTextStep: vi.fn(async () => ({ text: '{}' })),
}))

const helperMock = vi.hoisted(() => ({
  resolveProjectModel: vi.fn(async () => ({
    id: 'project-1',
    novelPromotionData: {
      id: 'np-project-1',
      analysisModel: 'llm::analysis-1',
    },
  })),
}))

const workerMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => undefined),
  assertTaskActive: vi.fn(async () => undefined),
}))

const configServiceMock = vi.hoisted(() => ({
  getProjectModelConfig: vi.fn(async () => ({
    analysisModel: 'llm::analysis-1',
    characterModel: 'image::character-1',
    locationModel: 'image::location-1',
    storyboardModel: null,
    editModel: null,
    videoModel: null,
    audioModel: null,
    videoRatio: '16:9',
    artStyle: 'american-comic',
    capabilityDefaults: {},
    capabilityOverrides: {},
  })),
  buildImageBillingPayload: vi.fn(async (input: {
    basePayload: Record<string, unknown>
    imageModel: string | null
  }) => ({
    ...input.basePayload,
    imageModel: input.imageModel,
  })),
}))

const hasOutputMock = vi.hoisted(() => ({
  hasCharacterAppearanceOutput: vi.fn(async () => false),
}))

const submitTaskMock = vi.hoisted(() => vi.fn(async () => ({
  success: true,
  async: true,
  taskId: 'task-image-1',
  status: 'queued',
  deduped: false,
})))

const billingMock = vi.hoisted(() => ({
  buildDefaultTaskBillingInfo: vi.fn(() => ({ billable: false })),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/ai-runtime', () => aiRuntimeMock)
vi.mock('@/lib/billing', () => billingMock)
vi.mock('@/lib/config-service', () => configServiceMock)
vi.mock('@/types/character-profile', () => ({
  validateProfileData: vi.fn(() => true),
  stringifyProfileData: vi.fn((value: unknown) => JSON.stringify(value)),
}))
vi.mock('@/lib/llm-observe/internal-stream-context', () => ({
  withInternalLLMStreamCallbacks: vi.fn(async (_callbacks: unknown, fn: () => Promise<unknown>) => await fn()),
}))
vi.mock('@/lib/task/has-output', () => hasOutputMock)
vi.mock('@/lib/task/submitter', () => ({ submitTask: submitTaskMock }))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: workerMock.reportTaskProgress }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: workerMock.assertTaskActive }))
vi.mock('@/lib/workers/handlers/llm-stream', () => ({
  createWorkerLLMStreamContext: vi.fn(() => ({ streamRunId: 'run-1', nextSeqByStepLane: {} })),
  createWorkerLLMStreamCallbacks: vi.fn(() => ({
    onStage: vi.fn(),
    onChunk: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
    flush: vi.fn(async () => undefined),
  })),
}))
vi.mock('@/lib/workers/handlers/character-profile-helpers', async () => {
  const actual = await vi.importActual<typeof import('@/lib/workers/handlers/character-profile-helpers')>(
    '@/lib/workers/handlers/character-profile-helpers',
  )
  return {
    ...actual,
    resolveProjectModel: helperMock.resolveProjectModel,
  }
})
vi.mock('@/lib/prompt-i18n', () => ({
  PROMPT_IDS: { NP_AGENT_CHARACTER_VISUAL: 'np_agent_character_visual' },
  buildPrompt: vi.fn(() => 'character-visual-prompt'),
}))

import { handleCharacterProfileTask } from '@/lib/workers/handlers/character-profile'

function buildJob(type: TaskJobData['type'], payload: Record<string, unknown>): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-character-profile-1',
      type,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: null,
      targetType: 'NovelPromotionCharacter',
      targetId: 'character-1',
      payload,
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker character-profile behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => Promise<unknown>) => {
      return await callback(prismaMock)
    })

    aiRuntimeMock.executeAiTextStep.mockResolvedValue({
      text: JSON.stringify({
        characters: [
          {
            appearances: [
              {
                change_reason: 'default look',
                descriptions: ['black hair, calm, trench coat'],
              },
            ],
          },
        ],
      }),
    })

    prismaMock.novelPromotionCharacter.findFirst.mockImplementation(async (args: { where: { id: string } }) => ({
      id: args.where.id,
      name: args.where.id === 'character-2' ? 'Villain' : 'Hero',
      profileData: JSON.stringify({ archetype: 'lead' }),
      profileConfirmed: false,
      novelPromotionProjectId: 'np-project-1',
    }))

    prismaMock.novelPromotionCharacter.findMany.mockResolvedValue([
      {
        id: 'character-1',
        name: 'Hero',
        profileData: JSON.stringify({ archetype: 'lead' }),
        profileConfirmed: false,
      },
      {
        id: 'character-2',
        name: 'Villain',
        profileData: JSON.stringify({ archetype: 'antagonist' }),
        profileConfirmed: false,
      },
    ])
  })

  it('unsupported task type -> explicit error', async () => {
    const job = buildJob(TASK_TYPE.AI_CREATE_CHARACTER, {})
    await expect(handleCharacterProfileTask(job)).rejects.toThrow('Unsupported character profile task type')
  })

  it('confirm profile success -> rebuilds appearances and marks profileConfirmed', async () => {
    const job = buildJob(TASK_TYPE.CHARACTER_PROFILE_CONFIRM, { characterId: 'character-1' })
    const result = await handleCharacterProfileTask(job)

    expect(prismaMock.characterAppearance.deleteMany).toHaveBeenCalledWith({
      where: { characterId: 'character-1' },
    })
    expect(prismaMock.characterAppearance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        characterId: 'character-1',
        appearanceIndex: 0,
        changeReason: 'default look',
        description: 'black hair, calm, trench coat',
      }),
      select: {
        id: true,
        appearanceIndex: true,
      },
    })
    expect(prismaMock.novelPromotionCharacter.update).toHaveBeenCalledWith({
      where: { id: 'character-1' },
      data: {
        profileData: JSON.stringify({ archetype: 'lead' }),
        profileConfirmed: true,
      },
    })
    expect(result).toEqual(expect.objectContaining({
      success: true,
      character: expect.objectContaining({
        id: 'character-1',
        profileConfirmed: true,
      }),
      imageTask: null,
    }))
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('batch confirm -> loops through all unconfirmed characters and returns count', async () => {
    const job = buildJob(TASK_TYPE.CHARACTER_PROFILE_BATCH_CONFIRM, {})
    const result = await handleCharacterProfileTask(job)

    expect(result).toEqual({
      success: true,
      count: 2,
    })
    expect(prismaMock.characterAppearance.create).toHaveBeenCalledTimes(2)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('reconfirm with existing appearances -> replaces old rows instead of colliding on unique index', async () => {
    const job = buildJob(TASK_TYPE.CHARACTER_PROFILE_CONFIRM, { characterId: 'character-1' })

    await expect(handleCharacterProfileTask(job)).resolves.toEqual(expect.objectContaining({
      success: true,
    }))

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(prismaMock.characterAppearance.deleteMany).toHaveBeenCalledWith({
      where: { characterId: 'character-1' },
    })
    expect(prismaMock.characterAppearance.create).toHaveBeenCalledTimes(1)
  })

  it('confirm profile with generateImage -> submits a character image task for the primary appearance', async () => {
    const job = buildJob(TASK_TYPE.CHARACTER_PROFILE_CONFIRM, {
      characterId: 'character-1',
      generateImage: true,
    })

    const result = await handleCharacterProfileTask(job)

    expect(configServiceMock.buildImageBillingPayload).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      imageModel: 'image::character-1',
      basePayload: expect.objectContaining({
        id: 'character-1',
        type: 'character',
        appearanceId: 'appearance-0',
        count: 3,
      }),
    })
    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      locale: 'zh',
      projectId: 'project-1',
      type: TASK_TYPE.IMAGE_CHARACTER,
      targetType: 'CharacterAppearance',
      targetId: 'appearance-0',
      dedupeKey: 'image_character:appearance-0:3',
      payload: expect.objectContaining({
        id: 'character-1',
        appearanceId: 'appearance-0',
        count: 3,
        imageModel: 'image::character-1',
        ui: expect.objectContaining({
          hasOutputAtStart: false,
        }),
      }),
    }))
    expect(result).toEqual(expect.objectContaining({
      success: true,
      imageTask: {
        taskId: 'task-image-1',
        status: 'queued',
        deduped: false,
      },
    }))
  })
})
