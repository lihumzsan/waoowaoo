import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => {
  const tx = {
    projectEditScript: {
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
  }
  return {
    projectEditScript: {
      findMany: vi.fn(),
    },
    projectEditChapter: {
      findFirst: vi.fn(),
    },
    projectEditBible: {
      findUnique: vi.fn(),
    },
    projectCharacter: {
      findFirst: vi.fn(),
    },
    projectLocation: {
      findFirst: vi.fn(),
    },
    task: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => await fn(tx)),
    tx,
  }
})

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { approveProjectEpisodeEditScriptAssets } from '@/lib/edit-script/service'

function scriptRow(id: string, chapterId: string, requirementStatus: string) {
  return {
    id,
    projectId: 'project-1',
    episodeId: 'episode-1',
    chapterId,
    bibleId: 'bible-1',
    styleBibleJson: null,
    corePlanJson: {
      shots: [{
        shotId: `shot-${chapterId}`,
        shotNumber: 1,
        shotPurpose: 'action',
        durationSec: 4,
        scene: {
          locationId: 'location-1',
          name: '地下室',
          subScene: '工作台',
        },
        action: '检查设备。',
        characters: [{
          characterId: 'character-1',
          name: '老李',
          visibility: 'visible',
          role: 'focus',
          performance: '检查设备',
        }],
        keyObjects: [],
        dialogue: [],
        sound: 'room tone',
      }],
      generationSegments: [{
        shotIds: [`shot-${chapterId}`],
        continuity: 'single shot segment',
      }],
    },
    durationSec: 4,
    shotCount: 1,
    status: 'ready',
    assetReviewStatus: 'pending',
    requirements: [{
      id: `requirement-${chapterId}`,
      kind: 'character',
      name: '老李',
      description: '主角',
      requiredForShotIds: [`shot-${chapterId}`],
      status: requirementStatus,
      targetId: requirementStatus === 'completed' ? 'character-1' : null,
      errorMessage: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    }],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  }
}

describe('approveProjectEpisodeEditScriptAssets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$transaction.mockImplementation(async (fn: (client: typeof prismaMock.tx) => Promise<unknown>) => await fn(prismaMock.tx))
    prismaMock.projectEditChapter.findFirst.mockResolvedValue({
      id: 'chapter-1',
      sourceStart: 0,
      sourceEnd: 10,
      sourceDocumentId: 'source-1',
      sourceDocument: {
        normalizedText: '0123456789',
      },
    })
    prismaMock.projectEditBible.findUnique.mockResolvedValue({
      id: 'bible-1',
      styleBibleJson: null,
    })
    prismaMock.projectCharacter.findFirst.mockResolvedValue({
      id: 'character-1',
      appearances: [{
        id: 'appearance-1',
        imageUrl: 'https://example.com/character.png',
        imageMediaId: null,
        imageUrls: '[]',
      }],
    })
    prismaMock.projectLocation.findFirst.mockResolvedValue(null)
    prismaMock.task.findFirst.mockResolvedValue(null)
  })

  it('approves all chapter edit scripts in one episode-level transaction', async () => {
    const scripts = [
      scriptRow('script-1', 'chapter-1', 'completed'),
      scriptRow('script-2', 'chapter-2', 'completed'),
      scriptRow('script-3', 'chapter-3', 'completed'),
    ]
    prismaMock.projectEditScript.findMany.mockResolvedValueOnce(scripts)
    prismaMock.tx.projectEditScript.updateMany.mockResolvedValueOnce({ count: 3 })
    prismaMock.tx.projectEditScript.findMany.mockResolvedValueOnce(scripts.map((script) => ({
      ...script,
      assetReviewStatus: 'approved',
    })))

    const result = await approveProjectEpisodeEditScriptAssets({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
    })

    expect(prismaMock.tx.projectEditScript.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['script-1', 'script-2', 'script-3'] },
        projectId: 'project-1',
        episodeId: 'episode-1',
      },
      data: {
        assetReviewStatus: 'approved',
      },
    })
    expect(result.approvedCount).toBe(3)
    expect(result.scripts.map((script) => script.chapterId)).toEqual(['chapter-1', 'chapter-2', 'chapter-3'])
    expect(result.scripts.every((script) => script.assetReviewStatus === 'approved')).toBe(true)
  })

  it('refuses partial approval when any chapter asset is not completed', async () => {
    prismaMock.projectEditScript.findMany.mockResolvedValueOnce([
      scriptRow('script-1', 'chapter-1', 'completed'),
      scriptRow('script-2', 'chapter-2', 'generating'),
    ])

    await expect(approveProjectEpisodeEditScriptAssets({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
    })).rejects.toThrow('Edit script assets are not ready: chapter-2:老李')

    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(prismaMock.tx.projectEditScript.updateMany).not.toHaveBeenCalled()
  })
})
