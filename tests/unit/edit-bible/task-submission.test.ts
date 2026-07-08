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
    rawFileMediaId: null,
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    estimatedInputTokens: 120,
  })),
  deleteEpisodeSourceDocumentForRollback: vi.fn(async () => undefined),
  estimateEditSourceDocumentInputTokens: vi.fn((text: string) => text.length),
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
  submitOperationTask: vi.fn(async () => ({
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
}))
vi.mock('@/lib/config-service', () => configMock)
vi.mock('@/lib/ai-exec/engine', () => aiMock)
vi.mock('@/lib/billing', () => billingMock)
vi.mock('@/lib/operations/submit-operation-task', () => submitMock)
vi.mock('@/lib/edit-bible/service', () => serviceMock)

import { submitProjectEditBibleGenerationTask } from '@/lib/edit-bible/task-submission'

function request(): NextRequest {
  return new Request('http://localhost/api/projects/project-1/bible', {
    method: 'POST',
  }) as NextRequest
}

describe('edit bible task submission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
      confirmed: true,
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
      taskType: TASK_TYPE.EDIT_BIBLE_GENERATE,
      targetType: 'ProjectEditBible',
      targetId: 'bible-1',
    }))
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
      confirmed: true,
      locale: 'zh',
    })

    expect(aiMock.executeAiTextStep).not.toHaveBeenCalled()
    expect(sourceDocumentMock.createEpisodeSourceDocument).toHaveBeenCalledWith(expect.objectContaining({
      sourceKind: 'paste',
      text: '完整剧本文本',
    }))
  })
})
