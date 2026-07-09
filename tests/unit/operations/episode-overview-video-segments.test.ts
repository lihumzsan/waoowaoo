import { describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import type { ProjectAgentContext } from '@/lib/project-agent/types'
import type { ProjectAgentOperationContext, ProjectAgentOperationDefinitionBase } from '@/lib/operations/types'

const editBibleMock = vi.hoisted(() => ({
  confirmEpisodeEditBible: vi.fn(),
  confirmEditBibleInputSchema: { extend: vi.fn(() => ({ parse: vi.fn() })) },
  getEditBibleInputSchema: { parse: vi.fn((input: unknown) => input) },
  getEditChaptersInputSchema: { parse: vi.fn((input: unknown) => input) },
  ingestEditBibleScriptInputSchema: { extend: vi.fn(() => ({ parse: vi.fn() })) },
  readEpisodeEditBible: vi.fn(),
  readEpisodeEditChapters: vi.fn(),
  reviseEditBibleInputSchema: { extend: vi.fn(() => ({ parse: vi.fn() })) },
  reviseEpisodeEditBible: vi.fn(),
  submitProjectEditBibleGenerationTask: vi.fn(),
}))

const prismaMock = vi.hoisted(() => ({
  projectVideoGroup: {
    findMany: vi.fn(),
  },
}))

vi.mock('@/lib/edit-bible', () => editBibleMock)

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/operations/tool-input-schema', () => ({
  createProjectAgentToolInputSchema: vi.fn(() => ({
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  })),
}))

import { createBibleOperations } from '@/lib/operations/domains/media/bible-ops'

interface EpisodeOverviewOutput {
  readonly chapterSummary: {
    readonly total: number
    readonly rendered: number
  }
  readonly videoSegmentSummary: {
    readonly total: number
    readonly completed: number
    readonly processing: number
    readonly failed: number
    readonly totalDurationSec: number
  }
}

function buildCtx(): ProjectAgentOperationContext {
  return {
    request: new Request('http://localhost') as unknown as NextRequest,
    userId: 'user-1',
    projectId: 'project-1',
    context: { episodeId: 'episode-1' } as ProjectAgentContext,
    source: 'assistant-panel',
    writer: null,
  }
}

function getEpisodeOverviewOperation(): ProjectAgentOperationDefinitionBase<Record<string, never>, EpisodeOverviewOutput> {
  const operation = createBibleOperations().get_episode_overview
  if (!operation) throw new Error('get_episode_overview operation missing')
  return operation as ProjectAgentOperationDefinitionBase<Record<string, never>, EpisodeOverviewOutput>
}

describe('get_episode_overview video segment summary', () => {
  it('distinguishes completed video segments from missing chapter renders', async () => {
    editBibleMock.readEpisodeEditBible.mockResolvedValueOnce({ id: 'bible-1', status: 'confirmed' })
    editBibleMock.readEpisodeEditChapters.mockResolvedValueOnce([
      {
        id: 'chapter-1',
        status: 'planned',
        renderStatus: null,
        outputMediaId: null,
      },
    ])
    prismaMock.projectVideoGroup.findMany.mockResolvedValueOnce([
      {
        status: 'completed',
        durationSec: 14,
        videoUrl: '/m/video-1',
        videoMediaId: null,
      },
      {
        status: 'completed',
        durationSec: 9,
        videoUrl: null,
        videoMediaId: 'media-video-2',
      },
    ])

    const result = await getEpisodeOverviewOperation().execute(buildCtx(), {})

    expect(result.chapterSummary).toMatchObject({
      total: 1,
      rendered: 0,
    })
    expect(result.videoSegmentSummary).toEqual({
      total: 2,
      completed: 2,
      processing: 0,
      failed: 0,
      totalDurationSec: 23,
    })
    expect(prismaMock.projectVideoGroup.findMany).toHaveBeenCalledWith({
      where: {
        projectId: 'project-1',
        episodeId: 'episode-1',
      },
      select: {
        status: true,
        durationSec: true,
        videoUrl: true,
        videoMediaId: true,
      },
    })
  })
})
