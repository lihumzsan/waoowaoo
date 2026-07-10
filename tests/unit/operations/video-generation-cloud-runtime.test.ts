import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import {
  OPENROUTER_PLATFORM_DEFAULT_ANALYSIS_MODEL_KEY,
  OPENROUTER_PLATFORM_DEFAULT_VIDEO_MODEL_KEY,
} from '@/lib/ai-providers/openrouter/models'
import type { Prisma } from '@prisma/client'

const prismaMock = vi.hoisted(() => ({
  project: {
    findUnique: vi.fn(),
  },
  projectPanel: {
    findUnique: vi.fn(),
  },
}))

const submitOperationTaskMock = vi.hoisted(() =>
  vi.fn(async () => ({
    taskId: 'task-1',
    runId: 'run-1',
    status: 'queued',
    deduped: false,
  })),
)
const submitApprovedPlanMock = vi.hoisted(() =>
  vi.fn(
    async () =>
      new Map([
        [
          'generate_panel_video:panel-1',
          {
            taskId: 'task-1',
            runId: 'run-1',
            status: 'queued',
            deduped: false,
          },
        ],
      ]),
  ),
)

const createMutationBatchMock = vi.hoisted(() =>
  vi.fn(async () => ({
    id: 'mutation-batch-1',
  })),
)

const hasPanelVideoOutputMock = vi.hoisted(() => vi.fn(async () => false))
const PLATFORM_VIDEO_MODEL = 'openrouter::bytedance/seedance-2.0-fast'
const resolveSystemModelKeyMock = vi.hoisted(() => vi.fn(async () => PLATFORM_VIDEO_MODEL))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/operations/submit-operation-task', () => ({
  submitOperationTask: submitOperationTaskMock,
}))
vi.mock('@/lib/task/approved-plan-submitter', () => ({
  submitApprovedOperationPlanTasks: submitApprovedPlanMock,
}))
vi.mock('@/lib/mutation-batch/service', () => ({
  createMutationBatchInTransaction: createMutationBatchMock,
}))
vi.mock('@/lib/task/has-output', () => ({
  hasPanelVideoOutput: hasPanelVideoOutputMock,
  hasVideoGroupOutput: vi.fn(async () => false),
}))
vi.mock('@/lib/model-access/system-model-resolver', () => ({
  resolveSystemModelKey: resolveSystemModelKeyMock,
}))

import { createVideoGenerationOperations } from '@/lib/operations/domains/storyboard/generation/video'

const ENV_KEYS = [
  'DEPLOYMENT_EDITION',
  'PROVIDER_CREDENTIAL_MODE',
  'BILLING_MODE',
  'PLATFORM_DEFAULT_ANALYSIS_MODEL',
  'PLATFORM_DEFAULT_VIDEO_MODEL',
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
    executionAuthorization: {
      approvalGrantId: 'approval-grant-1',
      operationExecutionId: 'operation-execution-1',
      transaction: {} as Prisma.TransactionClient,
    },
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
    process.env.PLATFORM_DEFAULT_ANALYSIS_MODEL = OPENROUTER_PLATFORM_DEFAULT_ANALYSIS_MODEL_KEY
    process.env.PLATFORM_DEFAULT_VIDEO_MODEL = OPENROUTER_PLATFORM_DEFAULT_VIDEO_MODEL_KEY
    process.env.PLATFORM_VIDEO_RESOLUTION = '480p'
    process.env.PLATFORM_VIDEO_GENERATE_AUDIO = 'true'
    mockPanelAndProject()
  })

  afterEach(() => restoreEnv())

  it('uses platform video model and runtime options when submitting a panel video task', async () => {
    const operation = createVideoGenerationOperations().generate_panel_video
    const input = {
      panelId: 'panel-1',
      generationOptions: {
        resolution: '480p',
        generateAudio: true,
      },
    }
    if (!operation.plan) throw new Error('EXPECTED_VIDEO_PLAN')
    const plan = await operation.plan(buildContext(), input)
    if (!operation.commit) throw new Error('EXPECTED_VIDEO_COMMIT')
    const result = await operation.commit(buildContext(), input, plan)

    expect(result).toMatchObject({
      taskId: 'task-1',
      panelId: 'panel-1',
      mutationBatchId: 'mutation-batch-1',
    })
    expect(plan.tasks[0]).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          videoModel: PLATFORM_VIDEO_MODEL,
          generationOptions: expect.objectContaining({
            resolution: '480p',
            generateAudio: true,
            duration: 5,
            generationMode: 'normal',
          }),
        }),
      }),
    )
  })

  it('rejects aspectRatio in generationOptions because video ratio is project-owned', async () => {
    const operation = createVideoGenerationOperations().generate_panel_video
    if (!operation.plan) throw new Error('EXPECTED_VIDEO_PLAN')
    await expect(
      operation.plan(buildContext(), {
        panelId: 'panel-1',
        generationOptions: {
          aspectRatio: '16:9',
        },
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      details: expect.objectContaining({
        code: 'TASK_VIDEO_RATIO_MANAGED_BY_PROJECT',
        field: 'generationOptions.aspectRatio',
      }),
    })
    expect(submitApprovedPlanMock.mock.calls).toEqual([])
  })

  it('rejects caller-supplied video model fields before task submission', async () => {
    const operation = createVideoGenerationOperations().generate_panel_video
    if (!operation.plan) throw new Error('EXPECTED_VIDEO_PLAN')
    await expect(
      operation.plan(buildContext(), {
        panelId: 'panel-1',
        videoModel: 'hunyuan',
      }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      details: expect.objectContaining({
        code: 'TASK_MODEL_MANAGED_BY_CONFIG',
        field: 'videoModel',
      }),
    })
    expect(submitApprovedPlanMock.mock.calls).toEqual([])
  })
})
