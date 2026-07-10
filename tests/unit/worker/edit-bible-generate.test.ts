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
      }],
    },
    ledger: { events: [] },
    emotionalCurve: { cues: [] },
  })),
  markEditBibleScriptReadyForReview: vi.fn(async () => undefined),
  normalizeExpandedSourceScriptOutput: vi.fn((value: {
    title: string
    summary: string
    segments: Array<{
      episodeIndex: number
      episodeTitle: string
      episodeSummary: string
      actIndex: number
      actTitle: string
      actSummary: string
      sceneIndex: number
      title: string
      location: string
      timeOfDay?: string | null
      characters: string[]
      summary: string
      body: string
      beats: Array<{ beatIndex: number; title: string; summary: string }>
    }>
  }) => ({
    normalizedText: value.segments.map((segment) => segment.body).join('\n\n'),
    structure: {
      version: 1,
      title: value.title,
      summary: value.summary,
      episodes: [{
        episodeIndex: 0,
        title: value.segments[0]?.episodeTitle,
        summary: value.segments[0]?.episodeSummary,
        acts: [{
          actIndex: 0,
          title: value.segments[0]?.actTitle,
          summary: value.segments[0]?.actSummary,
          scenes: value.segments.map((segment) => ({
            sceneIndex: segment.sceneIndex,
            title: segment.title,
            location: segment.location,
            timeOfDay: segment.timeOfDay,
            characters: segment.characters,
            summary: segment.summary,
            body: segment.body,
            beats: segment.beats,
          })),
        }],
      }],
    },
  })),
  persistGeneratedEditBibleBundle: vi.fn(async () => ({
    editBible: {
      id: 'bible-1',
      status: 'ready_for_review',
      version: 1,
    },
    chapters: [{ id: 'chapter-1' }],
  })),
}))

const sourceDocumentMock = vi.hoisted(() => ({
  EDIT_SOURCE_DOCUMENT_OUTPUT_TOKEN_RESERVE: 512,
  estimateEditSourceDocumentInputTokens: vi.fn((text: string) => text.length),
  readEpisodeSourceDocumentById: vi.fn(async () => ({
    id: 'source-1',
    episodeId: 'episode-1',
    normalizedText: '0123456789',
    checksum: 'checksum-1',
    sourceKind: 'paste',
    scriptStructureJson: null,
    rawFileMediaId: null,
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  })),
  materializePromptGeneratedSourceDocument: vi.fn(async () => ({
    id: 'source-1',
    episodeId: 'episode-1',
    normalizedText: '扩写后的完整剧本',
    checksum: 'checksum-expanded',
    sourceKind: 'prompt_generated_script',
    scriptStructureJson: null,
    rawFileMediaId: null,
    version: 2,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:01:00Z'),
    estimatedInputTokens: 120,
  })),
}))

const aiMock = vi.hoisted(() => ({
  expandedScriptOutput: {
    version: 1 as const,
    title: '民科超光速',
    summary: '民间科学家试图证明超光速，最终面对代价。',
    segments: [{
      episodeIndex: 0,
      episodeTitle: '第 1 集',
      episodeSummary: '主角启动实验并付出代价。',
      actIndex: 0,
      actTitle: '实验启动',
      actSummary: '主角进入实验室并开启装置。',
      sceneIndex: 0,
      title: '地下实验室',
      location: '地下实验室',
      timeOfDay: '夜',
      characters: ['林'],
      summary: '林启动超光速装置。',
      body: '场景一：地下实验室。林启动超光速装置。',
      beats: [{ beatIndex: 0, title: '启动', summary: '林按下开关。' }],
    }],
  },
  executeAiStructuredTextStep: vi.fn(async () => ({
    text: '扩写后的完整剧本',
    data: {
      version: 1 as const,
      title: '民科超光速',
      summary: '民间科学家试图证明超光速，最终面对代价。',
      segments: [] as unknown[],
    },
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

const promptMock = vi.hoisted(() => ({
  AI_PROMPT_IDS: {
    EDIT_BIBLE_OUTLINE_SCRIPT: 'outline-script',
  },
  buildAiPromptContent: vi.fn((input: { variables?: { user_prompt?: string } }) => input.variables?.user_prompt ?? '请扩写用户创意。'),
  flattenChatMessageContent: vi.fn((value: unknown) => String(value)),
}))

const workerMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => undefined),
  assertTaskActive: vi.fn(async () => undefined),
}))

const streamMock = vi.hoisted(() => ({
  flush: vi.fn(async () => undefined),
}))

vi.mock('@/lib/edit-bible', () => editBibleMock)
vi.mock('@/lib/edit-source-document', async () => {
  const { z } = await import('zod')
  const editSourcePointAnchorSchema = z.object({
    sourceOffset: z.number().int().min(0),
    text: z.string().optional(),
  }).passthrough()
  const editSourceRangeSchema = z.object({
    sourceStart: z.number().int().min(0),
    sourceEnd: z.number().int().min(0),
  }).passthrough()
  return {
    ...sourceDocumentMock,
    editSourcePointAnchorSchema,
    editSourceRangeSchema,
    editSourceAnchorSchema: editSourceRangeSchema,
  }
})
vi.mock('@/lib/ai-exec/structured-step', () => aiMock)
vi.mock('@/lib/billing', () => billingMock)
vi.mock('@/lib/ai-prompts', () => ({
  AI_PROMPT_IDS: promptMock.AI_PROMPT_IDS,
  buildAiPromptContent: promptMock.buildAiPromptContent,
}))
vi.mock('@/lib/ai-registry/message-content', () => ({
  flattenChatMessageContent: promptMock.flattenChatMessageContent,
}))
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

function buildJob(
  payload: Record<string, unknown>,
  type: TaskJobData['type'] = TASK_TYPE.EDIT_BIBLE_GENERATE,
): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-bible-1',
      type,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: type === TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE ? 'ProjectEditSourceScript' : 'ProjectEditBible',
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
    sourceDocumentMock.readEpisodeSourceDocumentById.mockResolvedValue({
      id: 'source-1',
      episodeId: 'episode-1',
      normalizedText: '0123456789',
      checksum: 'checksum-1',
      sourceKind: 'paste',
      scriptStructureJson: null,
      rawFileMediaId: null,
      version: 1,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    })
    sourceDocumentMock.materializePromptGeneratedSourceDocument.mockResolvedValue({
      id: 'source-1',
      episodeId: 'episode-1',
      normalizedText: '扩写后的完整剧本',
      checksum: 'checksum-expanded',
      sourceKind: 'prompt_generated_script',
      scriptStructureJson: null,
      rawFileMediaId: null,
      version: 2,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:01:00Z'),
      estimatedInputTokens: 120,
    })
    aiMock.executeAiStructuredTextStep.mockResolvedValue({
      text: '扩写后的完整剧本',
      data: aiMock.expandedScriptOutput,
      reasoning: '',
      usage: null,
      completion: null,
    })
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
    })
    expect(aiMock.executeAiStructuredTextStep).not.toHaveBeenCalled()
    expect(editBibleMock.persistGeneratedEditBibleBundle).toHaveBeenCalledTimes(1)
    expect(editBibleMock.persistGeneratedEditBibleBundle).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      episodeId: 'episode-1',
      editBibleId: 'bible-1',
      sourceDocumentId: 'source-1',
      taskId: 'task-bible-1',
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

  it('expands prompt_generated_outline into a reviewable script without generating the bible', async () => {
    sourceDocumentMock.readEpisodeSourceDocumentById.mockResolvedValueOnce({
      id: 'source-1',
      episodeId: 'episode-1',
      normalizedText: '两分钟民科超光速短片',
      checksum: 'checksum-prompt',
      sourceKind: 'prompt_generated_outline',
      scriptStructureJson: null,
      rawFileMediaId: null,
      version: 1,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    })

    const result = await handleEditBibleGenerateTask(buildJob({
      episodeId: 'episode-1',
      sourceDocumentId: 'source-1',
      editBibleId: 'bible-1',
      analysisModel: 'analysis-model',
    }, TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE))

    expect(aiMock.executeAiStructuredTextStep).toHaveBeenCalledWith(expect.objectContaining({
      action: 'outline-script',
      model: 'analysis-model',
      projectId: 'project-1',
      userId: 'user-1',
      meta: expect.objectContaining({
        stepId: 'outline-script',
      }),
    }))
    expect(sourceDocumentMock.materializePromptGeneratedSourceDocument).toHaveBeenCalledWith({
      projectId: 'project-1',
      episodeId: 'episode-1',
      sourceDocumentId: 'source-1',
      text: '场景一：地下实验室。林启动超光速装置。',
      scriptStructure: expect.objectContaining({ title: '民科超光速' }),
    })
    expect(editBibleMock.markEditBibleScriptReadyForReview).toHaveBeenCalledWith({
      editBibleId: 'bible-1',
      sourceDocumentId: 'source-1',
      taskId: 'task-bible-1',
    })
    expect(editBibleMock.generateEditBibleArtifacts).not.toHaveBeenCalled()
    expect(editBibleMock.persistGeneratedEditBibleBundle).not.toHaveBeenCalled()
    expect(result).toEqual({
      editBibleId: 'bible-1',
      episodeId: 'episode-1',
      sourceDocumentId: 'source-1',
      status: 'script_ready_for_review',
      chapterCount: 0,
      version: null,
    })
  })

  it('revises a prompt-generated script using the previous full script as context', async () => {
    sourceDocumentMock.readEpisodeSourceDocumentById
      .mockResolvedValueOnce({
        id: 'source-revision',
        episodeId: 'episode-1',
        normalizedText: '把结尾改成更冷峻',
        checksum: 'checksum-revision',
        sourceKind: 'prompt_generated_outline',
        scriptStructureJson: null,
        rawFileMediaId: null,
        version: 1,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      })
      .mockResolvedValueOnce({
        id: 'source-previous',
        episodeId: 'episode-1',
        normalizedText: '上一版完整剧本',
        checksum: 'checksum-previous',
        sourceKind: 'prompt_generated_script',
        scriptStructureJson: null,
        rawFileMediaId: null,
        version: 2,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:01:00Z'),
      })

    await handleEditBibleGenerateTask(buildJob({
      episodeId: 'episode-1',
      sourceDocumentId: 'source-revision',
      previousSourceDocumentId: 'source-previous',
      editBibleId: 'bible-1',
      analysisModel: 'analysis-model',
    }, TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE))

    expect(sourceDocumentMock.readEpisodeSourceDocumentById).toHaveBeenNthCalledWith(2, {
      projectId: 'project-1',
      episodeId: 'episode-1',
      sourceDocumentId: 'source-previous',
    })
    expect(promptMock.buildAiPromptContent).toHaveBeenCalledWith(expect.objectContaining({
      variables: {
        user_prompt: expect.stringContaining('上一版完整剧本'),
      },
    }))
    expect(promptMock.buildAiPromptContent).toHaveBeenCalledWith(expect.objectContaining({
      variables: {
        user_prompt: expect.stringContaining('把结尾改成更冷峻'),
      },
    }))
    expect(editBibleMock.generateEditBibleArtifacts).not.toHaveBeenCalled()
  })

  it('leaves target failure state to the task lifecycle when one attempt throws', async () => {
    editBibleMock.generateEditBibleArtifacts.mockRejectedValueOnce(new Error('model failed'))

    await expect(handleEditBibleGenerateTask(buildJob({
      episodeId: 'episode-1',
      sourceDocumentId: 'source-1',
      editBibleId: 'bible-1',
      analysisModel: 'analysis-model',
    }))).rejects.toThrow('model failed')

    expect(editBibleMock.persistGeneratedEditBibleBundle).not.toHaveBeenCalled()
  })
})
