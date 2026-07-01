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
      readonly shots: readonly { readonly shotNumber: number }[]
      readonly generationSegments: readonly { readonly shotNumbers: readonly number[] }[]
      readonly screenplayText?: string | null
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
        shotNumber: 1,
        durationSec: 4,
        scene: { name: 'Studio' },
        action: 'The host reviews the completed edit plan.',
        characters: [
          {
            name: 'Host',
            visibility: 'visible',
            role: 'focus',
            performance: 'points to the timeline with a steady gesture',
          },
        ],
        keyObjects: [
          { name: 'Timeline', role: 'planning_reference' },
        ],
        sound: 'Quiet room tone.',
      },
    ],
    generationSegments: [
      {
        shotNumbers: [1],
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
    editScreenplayId: 'screenplay-1',
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
      editScreenplay: {
        id: 'screenplay-1',
        projectId: 'project-1',
        episodeId: 'episode-1',
        userPrompt: 'Create an edit plan.',
        styleBibleJson: null,
        screenplayText: 'Screenplay text',
        status: 'completed',
      },
    })
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
      { shotNumbers: [1], continuity: 'The host remains at the timeline station.' },
    ])
    expect(result.episode.editScript?.screenplayText).toBe('Screenplay text')
    expect(result.episode.editScript).not.toHaveProperty('corePlanJson')
    expect(prismaMock.projectEditScript.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        projectId: 'project-1',
        episodeId: 'episode-1',
      },
      include: expect.objectContaining({
        editScreenplay: true,
      }),
    }))
  })
})
