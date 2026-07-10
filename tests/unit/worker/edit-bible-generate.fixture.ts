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

export type { Job } from 'bullmq'
export { beforeEach, describe, expect, it, vi } from 'vitest'
export { TASK_TYPE } from '@/lib/task/types'
export type { TaskJobData } from '@/lib/task/types'
export { handleEditBibleGenerateTask } from '@/lib/workers/handlers/edit-bible-generate'
export { aiMock, billingMock, buildJob, editBibleMock, promptMock, sourceDocumentMock, streamMock, workerMock }
