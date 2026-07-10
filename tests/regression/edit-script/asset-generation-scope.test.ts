import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type CharacterCreateInput = {
  readonly data: {
    readonly name: string
  }
}

type AssetGenerateInput = {
  readonly kind: string
  readonly assetId: string
}

type CharacterFindFirstInput = {
  readonly where: {
    readonly id: string
  }
}

const prismaMock = vi.hoisted(() => ({
  projectEditScript: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  projectEditAssetRequirement: {
    findFirst: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  projectCharacter: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
  characterAppearance: {
    findFirst: vi.fn(),
  },
  projectLocation: {
    findMany: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
  projectEditChapter: {
    findFirst: vi.fn(),
  },
  projectEditBible: {
    findUnique: vi.fn(),
  },
  task: {
    findFirst: vi.fn(),
  },
}))

const submitAssetGenerateTaskMock = vi.hoisted(() => vi.fn(async (input: AssetGenerateInput) => ({
  taskId: `task-${input.assetId}`,
  status: 'queued',
  runId: null,
  deduped: false,
})))
const readEpisodeEditBibleMock = vi.hoisted(() => vi.fn())
const readEpisodeEditChaptersMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/assets/services/asset-actions', () => ({
  submitAssetGenerateTask: submitAssetGenerateTaskMock,
}))
vi.mock('@/lib/edit-bible/service', () => ({
  readEpisodeEditBible: readEpisodeEditBibleMock,
  readEpisodeEditChapters: readEpisodeEditChaptersMock,
}))

import {
  approveProjectEditScriptAssets,
  generateProjectEditScriptAssets,
} from '@/lib/edit-script/service'

function request(): NextRequest {
  return new Request('http://localhost/api/projects/project-1/edit-script/assets/generate', {
    method: 'POST',
    headers: { 'accept-language': 'zh' },
  }) as unknown as NextRequest
}

function corePlan() {
  return {
    shots: [
      {
        shotId: 'shot-1',
        shotNumber: 1,
        durationSec: 3,
        scene: {
          locationId: 'location-1',
          name: 'Room',
          subScene: 'Interior',
        },
        action: 'A character waits.',
        shotPurpose: 'action',
        characters: [],
        keyObjects: [],
        dialogue: [],
        sound: 'Room tone',
      },
    ],
    generationSegments: [
      {
        shotIds: ['shot-1'],
        continuity: 'Single shot continuity.',
      },
    ],
  }
}

function requirement(input: {
  readonly id: string
  readonly chapterId: string
  readonly name: string
  readonly targetId?: string | null
}) {
  return {
    id: input.id,
    kind: 'character',
    name: input.name,
    description: `${input.name} character design`,
    requiredForShotIds: ['shot-1'],
    status: 'pending',
    targetId: input.targetId ?? null,
    errorMessage: null,
    chapterId: input.chapterId,
  }
}

function script(input: {
  readonly id: string
  readonly chapterId: string
  readonly requirements: readonly ReturnType<typeof requirement>[]
}) {
  return {
    id: input.id,
    projectId: 'project-1',
    episodeId: 'episode-1',
    chapterId: input.chapterId,
    corePlanJson: corePlan(),
    durationSec: 3,
    shotCount: 1,
    status: 'ready',
    assetReviewStatus: 'pending',
    requirements: input.requirements,
  }
}

function characterAssetRow(input: {
  readonly id: string
  readonly name: string
  readonly appearanceId: string
  readonly hasOutput?: boolean
}) {
  return {
    id: input.id,
    name: input.name,
    appearances: [
      {
        id: input.appearanceId,
        imageUrl: input.hasOutput ? `https://cdn.example/${input.id}.png` : null,
        imageMediaId: input.hasOutput ? `media-${input.id}` : null,
        imageUrls: '[]',
      },
    ],
  }
}

describe('edit script asset generation scope regression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.projectEditAssetRequirement.findFirst.mockResolvedValue(null)
    prismaMock.projectEditAssetRequirement.update.mockImplementation(async (input: unknown) => input)
    prismaMock.projectEditAssetRequirement.count.mockResolvedValue(2)
    prismaMock.projectEditScript.updateMany.mockResolvedValue({ count: 0 })
    prismaMock.projectEditChapter.findFirst.mockImplementation(async (input: { readonly where: { readonly id: string } }) => ({
      id: input.where.id,
      sourceStart: null,
      sourceEnd: null,
      sourceDocumentId: null,
      sourceDocument: null,
    }))
    prismaMock.projectEditBible.findUnique.mockResolvedValue(null)
    readEpisodeEditBibleMock.mockResolvedValue({
      stylePreviews: [{ status: 'confirmed', imageUrl: 'https://cdn.example/style.png' }],
    })
    readEpisodeEditChaptersMock.mockResolvedValue([{ id: 'chapter-1' }])
    prismaMock.task.findFirst.mockResolvedValue(null)
    prismaMock.projectCharacter.findFirst.mockImplementation(async (input: CharacterFindFirstInput) => characterAssetRow({
      id: input.where.id,
      name: input.where.id.replace(/^character-/, ''),
      appearanceId: `appearance-${input.where.id}`,
    }))
    prismaMock.characterAppearance.findFirst.mockImplementation(async (input: { readonly where: { readonly characterId: string } }) => ({
      id: `appearance-${input.where.characterId}`,
      appearanceIndex: 0,
    }))
    prismaMock.projectCharacter.create.mockImplementation(async (input: CharacterCreateInput) => {
      const id = `character-${input.data.name.toLowerCase()}`
      return {
        id,
        appearances: [{ id: `appearance-${id}` }],
      }
    })
  })

  it('processes all ready edit scripts when asset generation is episode-scoped', async () => {
    const firstRequirement = requirement({ id: 'requirement-1', chapterId: 'chapter-1', name: 'Alice' })
    const secondRequirement = requirement({ id: 'requirement-2', chapterId: 'chapter-2', name: 'Bob' })
    const firstScript = script({ id: 'script-1', chapterId: 'chapter-1', requirements: [firstRequirement] })
    const secondScript = script({ id: 'script-2', chapterId: 'chapter-2', requirements: [secondRequirement] })
    readEpisodeEditChaptersMock.mockResolvedValue([{ id: 'chapter-1' }, { id: 'chapter-2' }])

    prismaMock.projectEditScript.findMany.mockResolvedValue([firstScript, secondScript])
    prismaMock.projectEditScript.findFirst.mockResolvedValue(script({
      id: 'script-1',
      chapterId: 'chapter-1',
      requirements: [
        requirement({
          id: 'requirement-1',
          chapterId: 'chapter-1',
          name: 'Alice',
          targetId: 'character-alice',
        }),
      ],
    }))
    prismaMock.projectCharacter.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([characterAssetRow({
        id: 'character-alice',
        name: 'Alice',
        appearanceId: 'appearance-character-alice',
      })])

    const result = await generateProjectEditScriptAssets({
      request: request(),
      projectId: 'project-1',
      episodeId: 'episode-1',
      userId: 'user-1',
      locale: 'zh',
    })

    expect(prismaMock.projectEditScript.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        projectId: 'project-1',
        episodeId: 'episode-1',
        status: 'ready',
      },
    }))
    expect(prismaMock.projectEditAssetRequirement.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'requirement-1' },
      data: { targetId: 'character-alice', status: 'generating', errorMessage: null },
    }))
    expect(prismaMock.projectEditAssetRequirement.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'requirement-2' },
      data: { targetId: 'character-bob', status: 'generating', errorMessage: null },
    }))
    expect(submitAssetGenerateTaskMock).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({
      async: true,
      total: 2,
      processedRequirementCount: 2,
      remainingRequirementCount: 2,
      taskIds: ['task-character-alice', 'task-character-bob'],
    })
  })

  it('submits one task for a shared asset while binding every matching chapter requirement', async () => {
    const firstRequirement = requirement({ id: 'requirement-1', chapterId: 'chapter-1', name: 'Alice' })
    const secondRequirement = requirement({ id: 'requirement-2', chapterId: 'chapter-2', name: 'Alice' })
    const firstScript = script({ id: 'script-1', chapterId: 'chapter-1', requirements: [firstRequirement] })
    const secondScript = script({ id: 'script-2', chapterId: 'chapter-2', requirements: [secondRequirement] })
    readEpisodeEditChaptersMock.mockResolvedValue([{ id: 'chapter-1' }, { id: 'chapter-2' }])
    const aliceAsset = characterAssetRow({
      id: 'character-alice',
      name: 'Alice',
      appearanceId: 'appearance-character-alice',
    })

    prismaMock.projectEditScript.findMany.mockResolvedValue([firstScript, secondScript])
    prismaMock.projectEditScript.findFirst.mockResolvedValue(script({
      id: 'script-1',
      chapterId: 'chapter-1',
      requirements: [
        requirement({
          id: 'requirement-1',
          chapterId: 'chapter-1',
          name: 'Alice',
          targetId: 'character-alice',
        }),
      ],
    }))
    prismaMock.projectCharacter.findMany
      .mockResolvedValueOnce([aliceAsset])
      .mockResolvedValueOnce([aliceAsset])
      .mockResolvedValueOnce([aliceAsset])

    const result = await generateProjectEditScriptAssets({
      request: request(),
      projectId: 'project-1',
      episodeId: 'episode-1',
      userId: 'user-1',
      locale: 'zh',
    })

    expect(prismaMock.projectEditAssetRequirement.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'requirement-1' },
      data: { targetId: 'character-alice', status: 'generating', errorMessage: null },
    }))
    expect(prismaMock.projectEditAssetRequirement.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'requirement-2' },
      data: { targetId: 'character-alice', status: 'generating', errorMessage: null },
    }))
    expect(submitAssetGenerateTaskMock).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      async: true,
      total: 1,
      processedRequirementCount: 2,
      remainingRequirementCount: 2,
      taskIds: ['task-character-alice'],
    })
  })

  it('fails explicitly when no tasks are submitted but scoped requirements remain unfinished', async () => {
    const firstRequirement = requirement({
      id: 'requirement-1',
      chapterId: 'chapter-1',
      name: 'Alice',
      targetId: 'character-alice',
    })
    const firstScript = script({ id: 'script-1', chapterId: 'chapter-1', requirements: [firstRequirement] })

    prismaMock.projectEditScript.findMany.mockResolvedValue([firstScript])
    prismaMock.projectEditScript.findFirst.mockResolvedValue(firstScript)
    prismaMock.projectCharacter.findFirst.mockResolvedValue(characterAssetRow({
      id: 'character-alice',
      name: 'Alice',
      appearanceId: 'appearance-character-alice',
      hasOutput: true,
    }))
    prismaMock.projectEditAssetRequirement.count.mockResolvedValue(1)

    await expect(generateProjectEditScriptAssets({
      request: request(),
      projectId: 'project-1',
      episodeId: 'episode-1',
      userId: 'user-1',
      locale: 'zh',
    })).rejects.toThrow('No edit script asset generation tasks were submitted while asset requirements remain unfinished.')

    expect(submitAssetGenerateTaskMock).not.toHaveBeenCalled()
  })

  it('does not mutate requirements or submit FAL tasks while any episode core edit table is not ready', async () => {
    const firstScript = script({
      id: 'script-1',
      chapterId: 'chapter-1',
      requirements: [requirement({ id: 'requirement-1', chapterId: 'chapter-1', name: 'Alice' })],
    })
    readEpisodeEditChaptersMock.mockResolvedValue([{ id: 'chapter-1' }, { id: 'chapter-2' }])
    prismaMock.projectEditScript.findMany.mockResolvedValue([firstScript])

    await expect(generateProjectEditScriptAssets({
      request: request(),
      projectId: 'project-1',
      episodeId: 'episode-1',
      userId: 'user-1',
      locale: 'zh',
    })).rejects.toThrow('EDIT_SCRIPT_ASSET_EPISODE_GATE_NOT_READY:chapter-2')

    expect(prismaMock.projectEditAssetRequirement.update).not.toHaveBeenCalled()
    expect(submitAssetGenerateTaskMock).not.toHaveBeenCalled()
  })

  it('approves every ready edit script when asset review is episode-scoped', async () => {
    const firstScript = script({
      id: 'script-1',
      chapterId: 'chapter-1',
      requirements: [
        {
          ...requirement({ id: 'requirement-1', chapterId: 'chapter-1', name: 'Alice', targetId: 'character-alice' }),
          status: 'completed',
        },
      ],
    })
    const secondScript = script({
      id: 'script-2',
      chapterId: 'chapter-2',
      requirements: [
        {
          ...requirement({ id: 'requirement-2', chapterId: 'chapter-2', name: 'Bob', targetId: 'character-bob' }),
          status: 'completed',
        },
      ],
    })

    prismaMock.projectEditScript.findMany.mockResolvedValue([firstScript, secondScript])

    const result = await approveProjectEditScriptAssets({
      projectId: 'project-1',
      episodeId: 'episode-1',
      userId: 'user-1',
    })

    expect(prismaMock.projectEditScript.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.projectEditScript.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['script-1', 'script-2'] },
        projectId: 'project-1',
        episodeId: 'episode-1',
        project: {
          userId: 'user-1',
        },
      },
      data: {
        assetReviewStatus: 'approved',
      },
    })
    expect(result.assetReviewStatus).toBe('approved')
  })
})
