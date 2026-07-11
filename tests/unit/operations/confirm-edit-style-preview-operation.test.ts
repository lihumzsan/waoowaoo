import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditStylePreviewPayload } from '@/lib/edit-script/types'
import type { Prisma } from '@prisma/client'

const mocks = vi.hoisted(() => ({
  projectFindFirst: vi.fn(),
  confirmProjectEditStylePreview: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    project: { findFirst: mocks.projectFindFirst },
  },
}))

vi.mock('@/lib/edit-script/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/edit-script/service')>()),
  confirmProjectEditStylePreview: mocks.confirmProjectEditStylePreview,
}))

import { createEditScriptOperations } from '@/lib/operations/domains/media/edit-script-ops'

function confirmedPreview(): EditStylePreviewPayload {
  return {
    id: 'style-2',
    projectId: 'project-1',
    episodeId: 'episode-1',
    bibleId: 'bible-1',
    styleKey: 'style_b',
    aspectRatio: '16:9',
    title: 'Style B',
    summary: 'Selected style',
    styleBible: {} as EditStylePreviewPayload['styleBible'],
    gridImagePrompt: 'grid prompt',
    imageKey: 'style-2.png',
    imageUrl: '/style-2.png',
    status: 'confirmed',
    taskId: 'task-2',
    errorMessage: null,
    updatedAt: new Date('2026-07-11T00:00:00Z'),
  }
}

describe('confirm_edit_style_preview operation', () => {
  const transaction = {
    project: { findFirst: mocks.projectFindFirst },
  } as unknown as Prisma.TransactionClient

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.projectFindFirst.mockResolvedValue({ videoRatio: '16:9' })
    mocks.confirmProjectEditStylePreview.mockResolvedValue(confirmedPreview())
  })

  it('performs no domain write until the registered operation executes', async () => {
    const operation = createEditScriptOperations().confirm_edit_style_preview

    expect(mocks.confirmProjectEditStylePreview).not.toHaveBeenCalled()
    const result = await operation.executeInTransaction!(
      {
        request: new NextRequest('http://localhost/api/test'),
        userId: 'user-1',
        projectId: 'project-1',
        context: {
          episodeId: 'episode-1',
          choiceDecision: { choiceType: 'style', decision: 'select', stylePreviewId: 'style-2' },
        },
        source: 'assistant-panel',
      },
      {},
      transaction,
    )

    expect(mocks.confirmProjectEditStylePreview).toHaveBeenCalledTimes(1)
    expect(mocks.confirmProjectEditStylePreview).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      stylePreviewId: 'style-2',
      aspectRatio: '16:9',
      client: transaction,
    })
    expect(result).toMatchObject({
      id: 'style-2',
      status: 'confirmed',
      aspectRatio: '16:9',
    })
  })

  it('fails explicitly when the authoritative project ratio is missing', async () => {
    mocks.projectFindFirst.mockResolvedValue({ videoRatio: null })
    const operation = createEditScriptOperations().confirm_edit_style_preview

    await expect(
      operation.executeInTransaction!(
        {
          request: new NextRequest('http://localhost/api/test'),
          userId: 'user-1',
          projectId: 'project-1',
          context: {
            episodeId: 'episode-1',
            choiceDecision: { choiceType: 'style', decision: 'select', stylePreviewId: 'style-2' },
          },
          source: 'assistant-panel',
        },
        {},
        transaction,
      ),
    ).rejects.toThrow('EDIT_STYLE_PREVIEW_PROJECT_VIDEO_RATIO_REQUIRED')
    expect(mocks.confirmProjectEditStylePreview).not.toHaveBeenCalled()
  })
})
