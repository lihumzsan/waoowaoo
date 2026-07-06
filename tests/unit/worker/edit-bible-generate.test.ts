import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const editBibleMock = vi.hoisted(() => ({
  generateEditBibleArtifacts: vi.fn(async () => ({
    bible: {
      synopsis: '故事梗概',
      characters: [],
      locations: [],
      worldRules: [],
      styleGuide: {},
    },
    beatSheet: {
      beats: [{
        beatId: 'beat-1',
        title: '开场',
        summary: '主角进入。',
        sourceStart: 0,
        sourceEnd: 10,
        estimatedDurationSec: 60,
        persistentFactsIntroduced: [],
      }],
    },
    ledger: { events: [] },
    emotionalCurve: { cues: [] },
  })),
  persistGeneratedEditBibleBundle: vi.fn(async () => ({
    editBible: {
      id: 'bible-1',
      status: 'ready_for_review',
      version: 1,
    },
    chapters: [{ id: 'chapter-1' }],
  })),
  markEditBibleGenerationFailed: vi.fn(async () => undefined),
  readEditBibleExtractionDiagnostics: vi.fn(() => null),
}))

const sourceDocumentMock = vi.hoisted(() => ({
  readEpisodeSourceDocumentById: vi.fn(async () => ({
    id: 'source-1',
    episodeId: 'episode-1',
    normalizedText: '0123456789',
    checksum: 'checksum-1',
    sourceKind: 'paste',
    rawFileMediaId: null,
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  })),
}))

const workerMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => undefined),
  assertTaskActive: vi.fn(async () => undefined),
}))

const streamMock = vi.hoisted(() => ({
  flush: vi.fn(async () => undefined),
}))

vi.mock('@/lib/edit-bible', () => editBibleMock)
vi.mock('@/lib/edit-source-document', () => sourceDocumentMock)
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: workerMock.reportTaskProgress }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: workerMock.assertTaskActive }))
vi.mock('@/lib/llm-observe/internal-stream-context', () => ({
  withInternalLLMStreamCallbacks: vi.fn(async (_callbacks: unknown, fn: () => Promise<unknown>) => await fn()),
}))
vi.mock('@/lib/workers/handlers/llm-stream', () => ({
  createWorkerLLMStreamContext: vi.fn(() => ({ streamRunId: 'run-1', nextSeqByStepLane: {} })),
  createWorkerLLMStreamCallbacks: vi.fn(() => streamMock),
}))

import { handleEditBibleGenerateTask } from '@/lib/workers/handlers/edit-bible-generate'

function buildJob(payload: Record<string, unknown>): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-bible-1',
      type: TASK_TYPE.EDIT_BIBLE_GENERATE,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'ProjectEditBible',
      targetId: 'bible-1',
      payload,
      userId: 'user-1',
      trace: { requestId: 'request-1' },
    },
  } as unknown as Job<TaskJobData>
}

describe('worker edit-bible-generate behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    editBibleMock.generateEditBibleArtifacts.mockResolvedValue({
      bible: {
        synopsis: '故事梗概',
        characters: [],
        locations: [],
        worldRules: [],
        styleGuide: {},
      },
      beatSheet: {
        beats: [{
          beatId: 'beat-1',
          title: '开场',
          summary: '主角进入。',
          sourceStart: 0,
          sourceEnd: 10,
          estimatedDurationSec: 60,
          persistentFactsIntroduced: [],
        }],
      },
      ledger: { events: [] },
      emotionalCurve: { cues: [] },
    })
  })

  it('requires sourceDocumentId explicitly', async () => {
    await expect(handleEditBibleGenerateTask(buildJob({
      episodeId: 'episode-1',
      editBibleId: 'bible-1',
      analysisModel: 'analysis-model',
    }))).rejects.toThrow('sourceDocumentId is required')
  })

  it('generates artifacts and persists the validated bundle once', async () => {
    const result = await handleEditBibleGenerateTask(buildJob({
      episodeId: 'episode-1',
      sourceDocumentId: 'source-1',
      editBibleId: 'bible-1',
      analysisModel: 'analysis-model',
    }))

    expect(sourceDocumentMock.readEpisodeSourceDocumentById).toHaveBeenCalledWith({
      projectId: 'project-1',
      episodeId: 'episode-1',
      sourceDocumentId: 'source-1',
    })
    expect(editBibleMock.generateEditBibleArtifacts).toHaveBeenCalledWith({
      userId: 'user-1',
      projectId: 'project-1',
      model: 'analysis-model',
      locale: 'zh',
      sourceDocument: '0123456789',
      sourceChecksum: 'checksum-1',
    })
    expect(editBibleMock.persistGeneratedEditBibleBundle).toHaveBeenCalledTimes(1)
    expect(editBibleMock.persistGeneratedEditBibleBundle).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      episodeId: 'episode-1',
      editBibleId: 'bible-1',
      sourceDocumentId: 'source-1',
    }))
    expect(result).toEqual({
      editBibleId: 'bible-1',
      episodeId: 'episode-1',
      sourceDocumentId: 'source-1',
      status: 'ready_for_review',
      chapterCount: 1,
      version: 1,
    })
  })

  it('marks the bible failed when generation throws', async () => {
    editBibleMock.generateEditBibleArtifacts.mockRejectedValueOnce(new Error('model failed'))

    await expect(handleEditBibleGenerateTask(buildJob({
      episodeId: 'episode-1',
      sourceDocumentId: 'source-1',
      editBibleId: 'bible-1',
      analysisModel: 'analysis-model',
    }))).rejects.toThrow('model failed')

    expect(editBibleMock.markEditBibleGenerationFailed).toHaveBeenCalledWith({
      editBibleId: 'bible-1',
      diagnostics: { error: 'model failed' },
    })
    expect(editBibleMock.persistGeneratedEditBibleBundle).not.toHaveBeenCalled()
  })
})
