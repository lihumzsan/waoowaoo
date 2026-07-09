import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import type { ProjectAgentContext } from '@/lib/project-agent/types'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'

const prismaMock = vi.hoisted(() => ({
  projectEpisode: {
    findFirst: vi.fn(),
  },
  project: {
    update: vi.fn(async () => ({ id: 'project-1' })),
  },
  projectEditScript: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  projectEditChapter: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  projectEditBible: {
    findUnique: vi.fn(),
  },
  projectEditShotExecutionPlan: {
    findMany: vi.fn(),
  },
  task: {
    findFirst: vi.fn(),
  },
}))

const loggingMock = vi.hoisted(() => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    event: vi.fn(),
    child: vi.fn(),
  }
  logger.child.mockReturnValue(logger)
  return {
    logError: vi.fn(),
    createScopedLogger: vi.fn(() => logger),
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/media/attach', () => ({
  attachMediaFieldsToProject: vi.fn(async (project: Record<string, unknown>) => project),
}))

vi.mock('@/lib/storage', () => ({
  deleteObject: vi.fn(async () => undefined),
  getSignedUrl: vi.fn(async (key: string) => `https://media.example/${key}`),
}))

vi.mock('@/lib/logging/core', () => loggingMock)

import { createGuiOperations } from '@/lib/operations/domains/gui/gui-ops'

interface EpisodeDetailResult {
  readonly episode: {
    readonly editScript: {
      readonly shots: readonly { readonly shotId: string; readonly shotNumber: number }[]
      readonly generationSegments: readonly { readonly shotIds: readonly string[] }[]
      readonly bibleId?: string | null
    } | null
  }
}

function buildCtx(): ProjectAgentOperationContext {
  return {
    request: new Request('http://localhost') as unknown as NextRequest,
    userId: 'user-1',
    projectId: 'project-1',
    context: {} as ProjectAgentContext,
    source: 'assistant-panel',
    writer: null,
  }
}

function corePlan() {
  return {
    shots: [
      {
        shotId: 'shot-1',
        shotNumber: 1,
        shotPurpose: 'action',
        durationSec: 4,
        scene: {
          locationId: 'location-1',
          name: 'Studio',
          subScene: 'timeline desk',
        },
        action: 'The host reviews the completed edit plan.',
        characters: [
          {
            characterId: 'character-1',
            name: 'Host',
            visibility: 'visible',
            role: 'focus',
            performance: 'points to the timeline with a steady gesture',
          },
        ],
        keyObjects: [
          { name: 'Timeline', role: 'planning_reference' },
        ],
        dialogue: [],
        sound: 'Quiet room tone.',
      },
    ],
    generationSegments: [
      {
        shotIds: ['shot-1'],
        continuity: 'The host remains at the timeline station.',
      },
    ],
  } as const
}

function rawEditScriptRow() {
  return {
    id: 'edit-script-1',
    projectId: 'project-1',
    episodeId: 'episode-1',
    chapterId: 'chapter-default',
    editBibleId: 'bible-1',
    corePlanJson: corePlan(),
    durationSec: 4,
    shotCount: 1,
    status: 'ready',
    assetReviewStatus: 'pending',
    requirements: [],
  }
}

describe('gui get_episode_detail operation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.projectEpisode.findFirst.mockResolvedValue({
      id: 'episode-1',
      projectId: 'project-1',
      name: 'Episode 1',
      novelText: null,
      audioUrl: null,
      srtContent: null,
      storyboards: [],
      videoGroups: [],
      editScript: rawEditScriptRow(),
      finalOutput: null,
    })
    prismaMock.projectEditScript.findFirst.mockResolvedValue({
      ...rawEditScriptRow(),
      editBible: {
        id: 'bible-1',
        projectId: 'project-1',
        episodeId: 'episode-1',
        userPrompt: 'Create an edit plan.',
        styleBibleJson: null,
        bibleText: 'Bible text',
        status: 'completed',
      },
    })
    prismaMock.projectEditChapter.findUnique.mockResolvedValue({ id: 'chapter-default' })
    prismaMock.projectEditChapter.findFirst.mockResolvedValue(null)
    prismaMock.projectEditChapter.findMany.mockResolvedValue([{ id: 'chapter-default', chapterIndex: 0 }])
    prismaMock.projectEditBible.findUnique.mockResolvedValue({
      id: 'bible-1',
      styleBibleJson: null,
    })
    prismaMock.projectEditScript.findMany.mockResolvedValue([{
      ...rawEditScriptRow(),
      editBible: {
        id: 'bible-1',
        projectId: 'project-1',
        episodeId: 'episode-1',
        userPrompt: 'Create an edit plan.',
        styleBibleJson: null,
        bibleText: 'Bible text',
        status: 'completed',
      },
    }])
    prismaMock.projectEditShotExecutionPlan.findMany.mockResolvedValue([])
  })

  it('returns the normalized edit script read model instead of the raw episode relation', async () => {
    const operations = createGuiOperations()
    const result = await operations.get_episode_detail.execute(buildCtx(), {
      episodeId: 'episode-1',
    }) as EpisodeDetailResult

    expect(result.episode.editScript?.shots).toEqual([
      expect.objectContaining({ shotNumber: 1 }),
    ])
    expect(result.episode.editScript?.generationSegments).toEqual([
      { shotIds: ['shot-1'], continuity: 'The host remains at the timeline station.' },
    ])
    expect(result.episode.editScript?.bibleId).toBe('bible-1')
    expect(result.episode.editScript).not.toHaveProperty('corePlanJson')
    expect(prismaMock.projectEditScript.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.projectEditChapter.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.projectEditScript.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        projectId: 'project-1',
        episodeId: 'episode-1',
      },
      include: expect.objectContaining({
        requirements: expect.any(Object),
      }),
    }))
  })
})
