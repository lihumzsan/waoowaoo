import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE } from '@/lib/task/types'

const sourceDocumentMock = vi.hoisted(() => ({
  assertEpisodeSourceWritable: vi.fn(async () => undefined),
  createEpisodeSourceDocument: vi.fn(async () => ({
    id: 'source-1',
    episodeId: 'episode-1',
    normalizedText: '一个车站悬疑故事',
    checksum: 'checksum-1',
    sourceKind: 'prompt_generated_outline',
    scriptStructureJson: null,
    rawFileMediaId: null,
    version: 1,
    baseVersion: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    estimatedInputTokens: 120,
  })),
  deleteEpisodeSourceDocumentForRollback: vi.fn(async () => undefined),
  estimateEditSourceDocumentInputTokens: vi.fn((text: string) => text.length),
  readEpisodeSourceDocumentById: vi.fn(async () => ({
    id: 'source-script',
    episodeId: 'episode-1',
    normalizedText: '扩写后的完整剧本',
    checksum: 'checksum-script',
    sourceKind: 'prompt_generated_script',
    scriptStructureJson: null,
    rawFileMediaId: null,
    version: 2,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:01:00Z'),
  })),
}))

const prismaMock = vi.hoisted(() => ({
  projectEditBible: {
    findFirst: vi.fn(async () => ({
      id: 'bible-1',
      sourceDocumentId: 'source-script',
      status: 'script_approved',
    })),
  },
}))

const configMock = vi.hoisted(() => ({
  getProjectModelConfig: vi.fn(async () => ({
    analysisModel: 'openrouter::anthropic/claude-sonnet-4.6',
  })),
}))

const aiMock = vi.hoisted(() => ({
  executeAiTextStep: vi.fn(async () => ({
    text: '扩写后的完整剧本',
    reasoning: '',
    usage: null,
    completion: null,
  })),
}))

const billingMock = vi.hoisted(() => ({
  withTextBilling: vi.fn(async (
    _userId: string,
    _model: string,
    _maxInputTokens: number,
    _metadata: unknown,
    run: () => Promise<unknown>,
  ) => await run()),
}))

const submitMock = vi.hoisted(() => ({
  submitOperationTask: vi.fn(async (_input: Record<string, unknown>) => ({
    success: true,
    async: true,
    taskId: 'task-1',
    runId: null,
    status: 'queued',
    deduped: false,
  })),
}))

const serviceMock = vi.hoisted(() => ({
  prepareEditBibleGenerationTarget: vi.fn(async () => ({
    editBibleId: 'bible-1',
    episodeId: 'episode-1',
    sourceDocumentId: 'source-1',
    version: 1,
    rollback: vi.fn(async () => undefined),
  })),
}))

vi.mock('@/lib/edit-source-document', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/edit-source-document')>()),
  assertEpisodeSourceWritable: sourceDocumentMock.assertEpisodeSourceWritable,
  createEpisodeSourceDocument: sourceDocumentMock.createEpisodeSourceDocument,
  deleteEpisodeSourceDocumentForRollback: sourceDocumentMock.deleteEpisodeSourceDocumentForRollback,
  estimateEditSourceDocumentInputTokens: sourceDocumentMock.estimateEditSourceDocumentInputTokens,
  readEpisodeSourceDocumentById: sourceDocumentMock.readEpisodeSourceDocumentById,
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/config-service', () => configMock)
vi.mock('@/lib/ai-exec/engine', () => aiMock)
vi.mock('@/lib/billing', () => billingMock)
vi.mock('@/lib/operations/submit-operation-task', () => submitMock)
vi.mock('@/lib/edit-bible/service', () => serviceMock)

import {
  submitApprovedScriptEditBibleGenerationTask,
  submitProjectEditBibleGenerationTask,
  submitProjectEditScriptRevisionTask,
} from '@/lib/edit-bible/task-submission'

function request(): NextRequest {
  return new Request('http://localhost/api/projects/project-1/bible', {
    method: 'POST',
  }) as NextRequest
}

describe('edit bible task submission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.projectEditBible.findFirst.mockResolvedValue({
      id: 'bible-1',
      sourceDocumentId: 'source-script',
      status: 'script_approved',
    })
    sourceDocumentMock.createEpisodeSourceDocument.mockResolvedValue({
      id: 'source-1',
      episodeId: 'episode-1',
      normalizedText: '一个车站悬疑故事',
      checksum: 'checksum-1',
      sourceKind: 'prompt_generated_outline',
      scriptStructureJson: null,
      rawFileMediaId: null,
      version: 1,
      baseVersion: 0,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      estimatedInputTokens: 120,
    })
    sourceDocumentMock.readEpisodeSourceDocumentById.mockResolvedValue({
      id: 'source-script',
      episodeId: 'episode-1',
      normalizedText: '扩写后的完整剧本',
      checksum: 'checksum-script',
      sourceKind: 'prompt_generated_script',
      scriptStructureJson: null,
      rawFileMediaId: null,
      version: 2,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:01:00Z'),
    })
  })

  it('stores prompt_generated_outline as the raw source and leaves expansion to the worker', async () => {
    const result = await submitProjectEditBibleGenerationTask({
      request: request(),
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      sourceKind: 'prompt_generated_outline',
      text: '一个车站悬疑故事',
      source: 'project-ui',
      locale: 'zh',
    })

    expect(sourceDocumentMock.assertEpisodeSourceWritable).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
    })
    expect(aiMock.executeAiTextStep).not.toHaveBeenCalled()
    expect(billingMock.withTextBilling).not.toHaveBeenCalled()
    expect(sourceDocumentMock.createEpisodeSourceDocument).toHaveBeenCalledWith(expect.objectContaining({
      sourceKind: 'prompt_generated_outline',
      text: '一个车站悬疑故事',
    }))
    expect(result).toEqual(expect.objectContaining({
      taskType: TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE,
      targetType: 'ProjectEditSourceScript',
      targetId: 'bible-1',
    }))
    const updateMany = vi.fn(async () => ({ count: 1 }))
    const submission = submitMock.submitOperationTask.mock.calls[0]?.[0] as unknown as {
      onTaskCreatedInTransaction: (
        tx: { projectEditBible: { updateMany: typeof updateMany } },
        task: { id: string },
      ) => Promise<void>
    }
    await submission.onTaskCreatedInTransaction({ projectEditBible: { updateMany } }, { id: 'task-1' })
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'bible-1',
        sourceDocumentId: 'source-1',
        version: 1,
        generationTaskId: null,
        status: 'generating',
      },
      data: { generationTaskId: 'task-1' },
    })
  })

  it('stores pasted scripts directly without prompt expansion', async () => {
    await submitProjectEditBibleGenerationTask({
      request: request(),
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      sourceKind: 'paste',
      text: '完整剧本文本',
      source: 'project-ui',
      locale: 'zh',
    })

    expect(aiMock.executeAiTextStep).not.toHaveBeenCalled()
    expect(sourceDocumentMock.createEpisodeSourceDocument).toHaveBeenCalledWith(expect.objectContaining({
      sourceKind: 'paste',
      text: '完整剧本文本',
    }))
  })

  it('submits episode-plan generation only from an approved expanded script', async () => {
    const result = await submitApprovedScriptEditBibleGenerationTask({
      request: request(),
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      source: 'project-ui',
      locale: 'zh',
    })

    expect(prismaMock.projectEditBible.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        episodeId: 'episode-1',
      }),
    }))
    expect(sourceDocumentMock.readEpisodeSourceDocumentById).toHaveBeenCalledWith({
      projectId: 'project-1',
      episodeId: 'episode-1',
      sourceDocumentId: 'source-script',
    })
    expect(submitMock.submitOperationTask).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'generate_bible_from_script',
      targetType: 'ProjectEditBible',
      targetId: 'bible-1',
      payload: expect.objectContaining({
        sourceKind: 'prompt_generated_script',
      }),
    }))
    expect(result.taskType).toBe(TASK_TYPE.EDIT_BIBLE_GENERATE)
  })

  it('rejects episode-plan generation before the expanded script is approved', async () => {
    prismaMock.projectEditBible.findFirst.mockResolvedValueOnce({
      id: 'bible-1',
      sourceDocumentId: 'source-script',
      status: 'script_ready_for_review',
    })

    await expect(submitApprovedScriptEditBibleGenerationTask({
      request: request(),
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      source: 'project-ui',
      locale: 'zh',
    })).rejects.toMatchObject({
      details: expect.objectContaining({
        code: 'EDIT_SCRIPT_REVIEW_NOT_READY',
      }),
    })

    expect(submitMock.submitOperationTask).not.toHaveBeenCalled()
  })

  it('submits script revision with previous full script source context', async () => {
    prismaMock.projectEditBible.findFirst.mockResolvedValueOnce({
      id: 'bible-1',
      sourceDocumentId: 'source-previous',
      status: 'script_ready_for_review',
    })
    sourceDocumentMock.createEpisodeSourceDocument.mockResolvedValueOnce({
      id: 'source-revision',
      episodeId: 'episode-1',
      normalizedText: '把结尾改成更冷峻',
      checksum: 'checksum-revision',
      sourceKind: 'prompt_generated_outline',
      scriptStructureJson: null,
      rawFileMediaId: null,
      version: 1,
      baseVersion: 0,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      estimatedInputTokens: 48,
    })

    await submitProjectEditScriptRevisionTask({
      request: request(),
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      revisionNotes: '把结尾改成更冷峻',
      source: 'project-ui',
      locale: 'zh',
    })

    expect(sourceDocumentMock.createEpisodeSourceDocument).toHaveBeenCalledWith(expect.objectContaining({
      sourceKind: 'prompt_generated_outline',
      text: '把结尾改成更冷峻',
    }))
    expect(submitMock.submitOperationTask).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'revise_script',
      payload: expect.objectContaining({
        sourceDocumentId: 'source-revision',
        previousSourceDocumentId: 'source-previous',
        sourceKind: 'prompt_generated_outline',
      }),
    }))
  })
})
