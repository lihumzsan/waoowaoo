import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { FAL_PLATFORM_DEFAULT_MUSIC_MODEL_KEY } from '@/lib/ai-providers/fal/models'
import { OPENROUTER_PLATFORM_DEFAULT_ANALYSIS_MODEL_KEY } from '@/lib/ai-providers/openrouter/models'
import { ELEVENLABS_PLATFORM_DEFAULT_SOUND_EFFECT_MODEL_KEY } from '@/lib/ai-providers/elevenlabs/models'
import { quoteOperationPlan } from '@/lib/operations/planning'

const submitOperationTaskMock = vi.hoisted(() => vi.fn(async () => ({
  taskId: 'task-1',
  runId: 'run-1',
  status: 'queued',
  deduped: false,
})))

const resolveSystemModelKeyMock = vi.hoisted(() => vi.fn())
const prismaMock = vi.hoisted(() => ({
  projectEpisode: {
    findFirst: vi.fn(async () => ({ id: 'episode-1' })),
  },
}))
const loadEpisodeChapterOutputClipsMock = vi.hoisted(() => vi.fn(async () => ([{
  durationSeconds: 30,
}])))

vi.mock('@/lib/operations/submit-operation-task', () => ({ submitOperationTask: submitOperationTaskMock }))
vi.mock('@/lib/model-access/system-model-resolver', () => ({
  resolveSystemModelKey: resolveSystemModelKeyMock,
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/video-compose/episode-chapter-clips', () => ({
  loadEpisodeChapterOutputClips: loadEpisodeChapterOutputClipsMock,
}))

import { createMusicGenerationOperations } from '@/lib/operations/domains/music/generation/music-generation-ops'

const ENV_KEYS = [
  'DEPLOYMENT_EDITION',
  'PROVIDER_CREDENTIAL_MODE',
  'BILLING_MODE',
  'PLATFORM_DEFAULT_ANALYSIS_MODEL',
  'PLATFORM_DEFAULT_MUSIC_MODEL',
  'PLATFORM_MUSIC_OUTPUT_FORMAT',
] as const

const ORIGINAL_ENV: Partial<Record<(typeof ENV_KEYS)[number], string>> = {}
for (const key of ENV_KEYS) {
  const value = process.env[key]
  if (value !== undefined) ORIGINAL_ENV[key] = value
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

function buildContext(): ProjectAgentOperationContext {
  return {
    request: new Request('http://localhost/api/projects/project-1/assistant', {
      headers: { 'accept-language': 'zh' },
    }) as unknown as NextRequest,
    userId: 'user-1',
    projectId: 'project-1',
    context: { episodeId: 'episode-1', locale: 'zh' },
    source: 'test',
    writer: null,
  }
}

describe('cloud music generation runtime options', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DEPLOYMENT_EDITION = 'cloud'
    process.env.PROVIDER_CREDENTIAL_MODE = 'platform-key'
    process.env.BILLING_MODE = 'ENFORCE'
    process.env.PLATFORM_DEFAULT_ANALYSIS_MODEL = OPENROUTER_PLATFORM_DEFAULT_ANALYSIS_MODEL_KEY
    process.env.PLATFORM_DEFAULT_MUSIC_MODEL = FAL_PLATFORM_DEFAULT_MUSIC_MODEL_KEY
    process.env.PLATFORM_MUSIC_OUTPUT_FORMAT = 'mp3'
    resolveSystemModelKeyMock.mockImplementation(async (input: { purpose: string }) => {
      if (input.purpose === 'sound-effect') return ELEVENLABS_PLATFORM_DEFAULT_SOUND_EFFECT_MODEL_KEY
      if (input.purpose === 'analysis') return OPENROUTER_PLATFORM_DEFAULT_ANALYSIS_MODEL_KEY
      return FAL_PLATFORM_DEFAULT_MUSIC_MODEL_KEY
    })
  })

  afterEach(() => restoreEnv())

  it('uses platform music model and platform output format without pre-confirm cost', async () => {
    const result = await createMusicGenerationOperations().generate_project_music.execute(buildContext(), {
      prompt: 'quiet tension cue',
      durationSeconds: 30,
    })

    expect(result).toMatchObject({
      taskId: 'task-1',
      musicModel: 'fal::fal-ai/lyria3/pro',
    })
    expect(submitOperationTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        prompt: 'quiet tension cue',
        durationSeconds: 30,
        musicModel: 'fal::fal-ai/lyria3/pro',
        outputFormat: 'mp3',
      }),
    }))
  })

  it('rejects user-selected music models in cloud mode', async () => {
    await expect(createMusicGenerationOperations().generate_project_music.execute(buildContext(), {
      confirmed: true,
      prompt: 'quiet tension cue',
      durationSeconds: 30,
      musicModel: 'fal::other-model',
    })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      details: expect.objectContaining({
        code: 'TASK_MODEL_MANAGED_BY_PLATFORM',
        field: 'musicModel',
      }),
    })
    expect(submitOperationTaskMock.mock.calls).toEqual([])
  })

  it('quotes a sound_effect approval ceiling and propagates it to the deferred soundscape task', async () => {
    const operation = createMusicGenerationOperations().generate_episode_soundscape
    if (!operation.plan) throw new Error('SOUNDSCAPE_PLAN_REQUIRED')
    const plan = await operation.plan(buildContext(), { episodeId: 'episode-1' })
    const quote = await quoteOperationPlan(plan)

    expect(plan.tasks).toHaveLength(1)
    expect(plan.tasks[0]?.taskType).toBe('soundscape_plan')
    expect(plan.approvalQuoteTasks).toHaveLength(1)
    expect(plan.approvalQuoteTasks?.[0]?.billingInfo).toMatchObject({
      billable: true,
      apiType: 'sound_effect',
      quantity: 12,
      maxFrozenCost: 1.44,
    })
    expect(quote).toMatchObject({
      billable: true,
      taskCount: 1,
      mediaTaskCount: 1,
      totalMaxFrozenCost: 1.44,
      items: [expect.objectContaining({
        apiType: 'sound_effect',
        targetId: 'episode-1',
      })],
    })

    await expect(operation.execute(buildContext(), {
      confirmed: true,
      confirmedMaxCost: 1.43,
      episodeId: 'episode-1',
    })).rejects.toMatchObject({
      code: 'CONFLICT',
      details: expect.objectContaining({
        code: 'OPERATION_QUOTE_EXCEEDED_CONFIRMED_MAX_COST',
        actual: 1.44,
        confirmedMaxCost: 1.43,
      }),
    })
    expect(submitOperationTaskMock).not.toHaveBeenCalled()

    await operation.execute(buildContext(), {
      confirmed: true,
      confirmedMaxCost: 1.44,
      episodeId: 'episode-1',
    })

    expect(submitOperationTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'soundscape_plan',
      confirmed: true,
      payload: expect.objectContaining({
        episodeId: 'episode-1',
        approvedMediaMaxCost: 1.44,
      }),
    }))
  })
})
