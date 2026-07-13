import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  project: {
    findUnique: vi.fn(async () => ({ id: 'project-1' })),
  },
  novelPromotionProject: {
    findFirst: vi.fn(async () => ({ id: 'np-project-1' })),
  },
  novelPromotionEpisode: {
    findMany: vi.fn(async () => []),
  },
}))

const aiRuntimeMock = vi.hoisted(() => ({
  executeAiTextStep: vi.fn(async () => ({
    text: JSON.stringify({
      episodes: [
        {
          number: 1,
          title: 'Episode 1',
          summary: 'Opening',
          startMarker: 'START_MARKER',
          endMarker: 'END_MARKER',
        },
      ],
    }),
  })),
}))

const configServiceMock = vi.hoisted(() => ({
  getUserModelConfig: vi.fn(async () => ({
    analysisModel: 'codex::gpt-5.5',
  })),
}))

const internalStreamMock = vi.hoisted(() => ({
  withInternalLLMStreamCallbacks: vi.fn(async (_callbacks: unknown, fn: () => Promise<unknown>) => await fn()),
}))

const sharedMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => {}),
}))

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => {}),
}))

const llmStreamMock = vi.hoisted(() => ({
  createWorkerLLMStreamContext: vi.fn(() => ({ streamId: 'stream-1' })),
  createWorkerLLMStreamCallbacks: vi.fn(() => ({
    flush: vi.fn(async () => {}),
  })),
}))

const promptMock = vi.hoisted(() => ({
  PROMPT_IDS: { NP_EPISODE_SPLIT: 'np_episode_split' },
  buildPrompt: vi.fn(() => 'EPISODE_SPLIT_PROMPT'),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/ai-runtime', () => aiRuntimeMock)
vi.mock('@/lib/config-service', () => configServiceMock)
vi.mock('@/lib/llm-observe/internal-stream-context', () => internalStreamMock)
vi.mock('@/lib/workers/shared', () => sharedMock)
vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/workers/handlers/llm-stream', () => llmStreamMock)
vi.mock('@/lib/prompt-i18n', () => promptMock)
vi.mock('@/lib/novel-promotion/story-to-script/clip-matching', () => ({
  createTextMarkerMatcher: (content: string) => ({
    matchMarker: (marker: string, fromIndex = 0) => {
      const startIndex = content.indexOf(marker, fromIndex)
      if (startIndex === -1) return null
      return {
        startIndex,
        endIndex: startIndex + marker.length,
      }
    },
  }),
}))

import { handleEpisodeSplitTask } from '@/lib/workers/handlers/episode-split'

function buildJob(content: string): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-episode-split-1',
      type: TASK_TYPE.EPISODE_SPLIT_LLM,
      locale: 'zh',
      projectId: 'project-1',
      targetType: 'NovelPromotionProject',
      targetId: 'project-1',
      payload: { content },
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker episode-split', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionProject.findFirst.mockResolvedValue({
      id: 'np-project-1',
    })
    prismaMock.novelPromotionEpisode.findMany.mockResolvedValue([])
    configServiceMock.getUserModelConfig.mockResolvedValue({
      analysisModel: 'codex::gpt-5.5',
    })
    aiRuntimeMock.executeAiTextStep.mockResolvedValue({
      text: JSON.stringify({
        episodes: [
          {
            number: 1,
            title: 'Episode 1',
            summary: 'Opening',
            startMarker: 'START_MARKER',
            endMarker: 'END_MARKER',
          },
        ],
      }),
    })
  })

  it('fails fast when content is too short', async () => {
    const job = buildJob('short text')
    await expect(handleEpisodeSplitTask(job)).rejects.toThrow()
  })

  it('uses the user configured Codex analysis model', async () => {
    const content = [
      'This prefix makes the content long enough for validation. ',
      'This prefix makes the content long enough for validation. ',
      'START_MARKER',
      'This is the body of the first episode, long enough to exercise boundary matching. ',
      'END_MARKER',
      'This suffix keeps additional text outside the matched boundary.',
    ].join('')

    const job = buildJob(content)
    await handleEpisodeSplitTask(job)

    expect(configServiceMock.getUserModelConfig).toHaveBeenCalledWith('user-1')
    expect(aiRuntimeMock.executeAiTextStep).toHaveBeenCalledWith(expect.objectContaining({
      model: 'codex::gpt-5.5',
    }))
  })

  it('returns matched episodes when ai boundaries are valid', async () => {
    const content = [
      'This prefix makes the content long enough for validation. ',
      'This prefix makes the content long enough for validation. ',
      'START_MARKER',
      'This is the body of the first episode, long enough to exercise boundary matching. ',
      'END_MARKER',
      'This suffix keeps additional text outside the matched boundary.',
    ].join('')

    const job = buildJob(content)
    const result = await handleEpisodeSplitTask(job)

    expect(result.success).toBe(true)
    expect(result.episodes).toHaveLength(1)
    expect(result.episodes[0]?.number).toBe(1)
    expect(result.episodes[0]?.title).toBe('Episode 1')
    expect(result.episodes[0]?.content).toContain('START_MARKER')
    expect(result.episodes[0]?.content).toContain('END_MARKER')
  })

  it('rejects ai episode boundaries that exceed 400 words', async () => {
    const content = [
      'This prefix makes the content long enough for validation. ',
      'START_MARKER',
      '山'.repeat(401),
      'END_MARKER',
    ].join('')

    const job = buildJob(content)

    await expect(handleEpisodeSplitTask(job)).rejects.toThrow('exceeds 400 words')
  })
})
