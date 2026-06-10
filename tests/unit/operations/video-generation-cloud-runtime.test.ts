import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'

const prismaMock = vi.hoisted(() => ({
  project: {
    findUnique: vi.fn(),
  },
  projectPanel: {
    findUnique: vi.fn(),
  },
}))

const submitOperationTaskMock = vi.hoisted(() => vi.fn(async () => ({
  taskId: 'task-1',
  runId: 'run-1',
  status: 'queued',
  deduped: false,
})))

const createMutationBatchMock = vi.hoisted(() => vi.fn(async () => ({
  id: 'mutation-batch-1',
})))

const hasPanelVideoOutputMock = vi.hoisted(() => vi.fn(async () => false))
const resolveSystemModelKeyMock = vi.hoisted(() => vi.fn(async () => 'ark::doubao-seedance-2-0-260128'))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/operations/submit-operation-task', () => ({ submitOperationTask: submitOperationTaskMock }))
vi.mock('@/lib/mutation-batch/service', () => ({ createMutationBatch: createMutationBatchMock }))
vi.mock('@/lib/task/has-output', () => ({
  hasPanelVideoOutput: hasPanelVideoOutputMock,
  hasVideoGroupOutput: vi.fn(async () => false),
}))
vi.mock('@/lib/model-access/system-model-resolver', () => ({
  resolveSystemModelKey: resolveSystemModelKeyMock,
}))

import { createVideoGenerationOperations } from '@/lib/operations/domains/media/video-generation-ops'

const ENV_KEYS = [
  'DEPLOYMENT_EDITION',
  'PROVIDER_CREDENTIAL_MODE',
  'BILLING_MODE',
  'PLATFORM_VIDEO_RESOLUTION',
  'PLATFORM_VIDEO_GENERATE_AUDIO',
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

function mockPanelAndProject(): void {
  prismaMock.project.findUnique.mockResolvedValue({
    videoRatio: '21:9',
  })
  prismaMock.projectPanel.findUnique.mockResolvedValue({
    videoUrl: null,
    duration: 5,
    lastVideoGenerationOptions: null,
    storyboard: { episodeId: 'episode-1' },
  })
}

describe('cloud video generation runtime options', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DEPLOYMENT_EDITION = 'cloud'
    process.env.PROVIDER_CREDENTIAL_MODE = 'platform-key'
    process.env.BILLING_MODE = 'ENFORCE'
    process.env.PLATFORM_VIDEO_RESOLUTION = '480p'
    process.env.PLATFORM_VIDEO_GENERATE_AUDIO = 'true'
    mockPanelAndProject()
  })

  afterEach(() => restoreEnv())

  it('uses platform video model and runtime options when submitting a panel video task', async () => {
    const result = await createVideoGenerationOperations().generate_panel_video.execute(buildContext(), {
      confirmed: true,
      panelId: 'panel-1',
      videoModel: 'ark::doubao-seedance-2-0-260128',
      generationOptions: {
        resolution: '480p',
        generateAudio: true,
      },
    })

    expect(result).toMatchObject({
      taskId: 'task-1',
      panelId: 'panel-1',
      mutationBatchId: 'mutation-batch-1',
    })
    expect(submitOperationTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        videoModel: 'ark::doubao-seedance-2-0-260128',
        groupVideoModel: 'ark::doubao-seedance-2-0-260128',
        generationOptions: expect.objectContaining({
          resolution: '480p',
          generateAudio: true,
          duration: 5,
          generationMode: 'normal',
        }),
      }),
    }))
  })

  it('rejects aspectRatio in generationOptions because video ratio is project-owned', async () => {
    await expect(createVideoGenerationOperations().generate_panel_video.execute(buildContext(), {
      confirmed: true,
      panelId: 'panel-1',
      videoModel: 'ark::doubao-seedance-2-0-260128',
      generationOptions: {
        aspectRatio: '16:9',
      },
    })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      details: expect.objectContaining({
        code: 'TASK_VIDEO_RATIO_MANAGED_BY_PROJECT',
        field: 'generationOptions.aspectRatio',
      }),
    })
    expect(submitOperationTaskMock.mock.calls).toEqual([])
  })
})
