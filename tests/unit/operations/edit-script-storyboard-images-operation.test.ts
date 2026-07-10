import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { writeOperationDataPart } from '@/lib/operations/types'
import { TASK_TYPE } from '@/lib/task/types'
import type { Prisma } from '@prisma/client'

type SubmitOperationTaskMockInput = Record<string, unknown> & {
  payload: Record<string, unknown>
  targetId: string
}

const prismaMock = vi.hoisted(() => ({
  projectPanel: {
    findMany: vi.fn(),
  },
}))

const submitOperationTaskMock = vi.hoisted(() =>
  vi.fn(async (input: SubmitOperationTaskMockInput) => ({
    success: true,
    async: true,
    taskId: `task-${input.targetId}`,
    status: 'queued',
    runId: null,
    deduped: false,
  })),
)
const submitApprovedPlanMock = vi.hoisted(() =>
  vi.fn(
    async () =>
      new Map([
        [
          'generate_edit_script_storyboard_images:panel:panel-1',
          {
            success: true,
            async: true,
            taskId: 'task-panel-1',
            status: 'queued',
            runId: null,
            deduped: false,
          },
        ],
        [
          'generate_edit_script_storyboard_images:panel:panel-2',
          {
            success: true,
            async: true,
            taskId: 'task-panel-2',
            status: 'queued',
            runId: null,
            deduped: false,
          },
        ],
      ]),
  ),
)

const createMutationBatchMock = vi.hoisted(() =>
  vi.fn(async () => ({
    id: 'mutation-batch-images-1',
  })),
)

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
vi.mock('@/lib/config-service', () => ({
  getProjectModelConfig: vi.fn(async () => ({
    storyboardModel: 'storyboard-model-1',
    videoRatio: '16:9',
  })),
  resolveProjectModelCapabilityGenerationOptions: vi.fn(async () => ({
    quality: 'high',
  })),
  buildImageBillingPayload: vi.fn(
    (input: { imageModel: string | null; basePayload: Record<string, unknown>; aspectRatio?: string | null }) => ({
      ...input.basePayload,
      imageModel: input.imageModel,
      generationOptions: {
        quality: 'high',
        ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
      },
    }),
  ),
}))
vi.mock('@/lib/user-api/runtime-config', () => ({
  resolveModelSelection: vi.fn(async () => ({ model: 'storyboard-model-1' })),
}))
vi.mock('@/lib/edit-script/style-bible-prompt', () => ({
  resolveEditScriptStyleBibleSignatureForTask: vi.fn(async (input: { storyboardId: string }) => `style-${input.storyboardId}`),
}))
vi.mock('@/lib/billing', () => ({
  getBillingMode: vi.fn(async () => 'OFF'),
  buildDefaultTaskBillingInfo: vi.fn((taskType: string) => ({
    billable: true,
    source: 'task',
    taskType,
    apiType: 'image',
    model: 'storyboard-model-1',
    quantity: 1,
    unit: 'image',
    maxFrozenCost: 1,
    action: taskType,
    status: 'quoted',
  })),
}))
vi.mock('@/lib/operations/types', async () => {
  const actual = await vi.importActual<typeof import('@/lib/operations/types')>('@/lib/operations/types')
  return {
    ...actual,
    writeOperationDataPart: vi.fn(),
  }
})

import { createStoryboardPanelImageOperations } from '@/lib/operations/domains/storyboard/generation/image'

function buildContext(): ProjectAgentOperationContext {
  return {
    request: new NextRequest('http://localhost/api/projects/project-1/edit-script/storyboard/images/generate'),
    userId: 'user-1',
    projectId: 'project-1',
    context: { locale: 'zh', episodeId: 'episode-1' },
    source: 'project-ui',
    writer: null,
    toolCallId: null,
    executionAuthorization: {
      approvalGrantId: 'approval-grant-1',
      operationExecutionId: 'operation-execution-1',
      transaction: {} as Prisma.TransactionClient,
    },
  }
}

describe('generate_edit_script_storyboard_images operation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.projectPanel.findMany.mockResolvedValue([
      {
        id: 'panel-1',
        storyboardId: 'storyboard-1',
        panelIndex: 0,
        imageUrl: null,
        imageMediaId: null,
      },
      {
        id: 'panel-2',
        storyboardId: 'storyboard-1',
        panelIndex: 1,
        imageUrl: null,
        imageMediaId: null,
      },
    ])
  })

  it('submits one standalone image task for each missing panel', async () => {
    const operation = createStoryboardPanelImageOperations().generate_edit_script_storyboard_images
    if (!operation.plan) throw new Error('EXPECTED_STORYBOARD_IMAGE_PLAN')
    const plan = await operation.plan(buildContext(), {
      episodeId: 'episode-1',
    })
    if (!operation.commit) throw new Error('EXPECTED_STORYBOARD_IMAGE_COMMIT')
    const result = await operation.commit(buildContext(), { episodeId: 'episode-1' }, plan)

    expect(result).toMatchObject({
      total: 2,
      taskTotal: 2,
      targetTotal: 2,
      taskIds: ['task-panel-1', 'task-panel-2'],
      episodeId: 'episode-1',
      storyboardIds: ['storyboard-1'],
      panelIds: ['panel-1', 'panel-2'],
      mutationBatchId: 'mutation-batch-images-1',
    })
    expect(result).not.toHaveProperty('generationMode')

    expect(plan.tasks).toHaveLength(2)
    expect(plan.tasks[0]).toEqual(
      expect.objectContaining({
        taskType: TASK_TYPE.IMAGE_PANEL,
        target: { targetType: 'ProjectPanel', targetId: 'panel-1' },
        payload: expect.objectContaining({
          panelId: 'panel-1',
          candidateCount: 1,
          count: 1,
          referenceMode: 'asset',
          meta: { locale: 'zh' },
          imageModel: 'storyboard-model-1',
          generationOptions: { quality: 'high', aspectRatio: '16:9' },
          ui: expect.objectContaining({
            intent: 'generate',
            hasOutputAtStart: false,
          }),
        }),
        dedupeKey: 'edit_first_panel_image:panel-1:style-storyboard-1',
      }),
    )
    expect(plan.tasks[1]).toEqual(
      expect.objectContaining({
        taskType: TASK_TYPE.IMAGE_PANEL,
        target: { targetType: 'ProjectPanel', targetId: 'panel-2' },
        payload: expect.objectContaining({
          panelId: 'panel-2',
          candidateCount: 1,
          count: 1,
          referenceMode: 'asset',
          meta: { locale: 'zh' },
          imageModel: 'storyboard-model-1',
        }),
        dedupeKey: 'edit_first_panel_image:panel-2:style-storyboard-1',
      }),
    )
    const removedGridPayloadKey = ['storyboard', 'Grid'].join('')
    expect(plan.tasks[0]?.payload).not.toHaveProperty(removedGridPayloadKey)
    expect(plan.tasks[1]?.payload).not.toHaveProperty(removedGridPayloadKey)
  })

  it('reports task refs one-to-one with panel targets', async () => {
    const operation = createStoryboardPanelImageOperations().generate_edit_script_storyboard_images
    if (!operation.plan || !operation.commit) throw new Error('EXPECTED_STORYBOARD_IMAGE_PLAN_COMMIT')
    const context = buildContext()
    const input = { episodeId: 'episode-1' }
    await operation.commit(context, input, await operation.plan(context, input))

    expect(writeOperationDataPart).toHaveBeenCalledWith(
      null,
      'data-task-batch-submitted',
      expect.objectContaining({
        operationId: 'generate_edit_script_storyboard_images',
        total: 2,
        taskTotal: 2,
        targetTotal: 2,
        taskIds: ['task-panel-1', 'task-panel-2'],
        results: [
          expect.objectContaining({
            refId: 'panel-1',
            taskId: 'task-panel-1',
            targetId: 'panel-1',
          }),
          expect.objectContaining({
            refId: 'panel-2',
            taskId: 'task-panel-2',
            targetId: 'panel-2',
          }),
        ],
      }),
    )
    expect(createMutationBatchMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        operationId: 'generate_edit_script_storyboard_images',
        episodeId: 'episode-1',
        entries: [
          {
            kind: 'panel_candidate_cancel',
            targetType: 'ProjectPanel',
            targetId: 'panel-1',
          },
          {
            kind: 'panel_candidate_cancel',
            targetType: 'ProjectPanel',
            targetId: 'panel-2',
          },
        ],
      }),
    )
  })
})
