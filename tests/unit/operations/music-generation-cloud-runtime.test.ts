import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'

const submitOperationTaskMock = vi.hoisted(() => vi.fn(async () => ({
  taskId: 'task-1',
  runId: 'run-1',
  status: 'queued',
  deduped: false,
})))

const resolveSystemModelKeyMock = vi.hoisted(() => vi.fn(async () => 'fal::fal-ai/lyria3/pro'))

vi.mock('@/lib/operations/submit-operation-task', () => ({ submitOperationTask: submitOperationTaskMock }))
vi.mock('@/lib/model-access/system-model-resolver', () => ({
  resolveSystemModelKey: resolveSystemModelKeyMock,
}))

import { createMusicGenerationOperations } from '@/lib/operations/domains/media/music-generation-ops'

const ENV_KEYS = [
  'DEPLOYMENT_EDITION',
  'PROVIDER_CREDENTIAL_MODE',
  'BILLING_MODE',
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
    request: new Request('http://localhost/api/projects/project-1/assistant') as unknown as NextRequest,
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
    process.env.PLATFORM_MUSIC_OUTPUT_FORMAT = 'mp3'
  })

  afterEach(() => restoreEnv())

  it('uses platform music model and platform output format when submitting a task', async () => {
    const result = await createMusicGenerationOperations().generate_project_music.execute(buildContext(), {
      confirmed: true,
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
})
