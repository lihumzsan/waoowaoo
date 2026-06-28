import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import { writeOperationDataPart } from '@/lib/operations/types'
import { TASK_TYPE } from '@/lib/task/types'

type SubmitOperationTaskMockInput = Record<string, unknown> & {
  payload: Record<string, unknown>
}

const prismaMock = vi.hoisted(() => ({
  projectEditScript: {
    findFirst: vi.fn(),
  },
  projectPanel: {
    findMany: vi.fn(),
  },
}))

const submitOperationTaskMock = vi.hoisted(() => vi.fn(async (input: SubmitOperationTaskMockInput) => {
  void input
  return {
    success: true,
    async: true,
    taskId: 'task-grid-1',
    status: 'queued',
    runId: null,
    deduped: false,
  }
}))

const createMutationBatchMock = vi.hoisted(() => vi.fn(async () => ({
  id: 'mutation-batch-grid-1',
})))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/operations/submit-operation-task', () => ({ submitOperationTask: submitOperationTaskMock }))
vi.mock('@/lib/mutation-batch/service', () => ({ createMutationBatch: createMutationBatchMock }))
vi.mock('@/lib/config-service', () => ({
  getProjectModelConfig: vi.fn(async () => ({ storyboardModel: 'storyboard-model-1', videoRatio: '16:9' })),
  resolveProjectModelCapabilityGenerationOptions: vi.fn(async () => ({ quality: 'high' })),
  buildImageBillingPayload: vi.fn((input: {
    imageModel: string | null
    basePayload: Record<string, unknown>
    aspectRatio?: string | null
  }) => ({
    ...input.basePayload,
    imageModel: input.imageModel,
    generationOptions: {
      quality: 'high',
      ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
    },
  })),
}))
vi.mock('@/lib/user-api/runtime-config', () => ({
  resolveModelSelection: vi.fn(async () => ({ model: 'storyboard-model-1' })),
}))
vi.mock('@/lib/edit-script/style-bible-prompt', () => ({
  resolveEditScriptStyleBibleSignatureForTask: vi.fn(async () => 'style-signature-1'),
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
    request: new NextRequest('http://localhost/api/projects/project-1/edit-script/storyboard/images/block-grid/generate'),
    userId: 'user-1',
    projectId: 'project-1',
    context: { locale: 'zh', episodeId: 'episode-1' },
    source: 'project-ui',
    writer: null,
    toolCallId: null,
  }
}

describe('generate_storyboard_grid_images operation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.projectEditScript.findFirst.mockResolvedValue({ id: 'edit-script-1' })
    prismaMock.projectPanel.findMany.mockResolvedValue([
      {
        id: 'panel-1',
        storyboardId: 'storyboard-1',
        panelIndex: 0,
        imageUrl: 'images/panel-1-old.jpg',
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

  it('submits a 2x2 storyboard image task for the selected panel group', async () => {
    const operation = createStoryboardPanelImageOperations().generate_storyboard_grid_images
    const result = await operation.execute(buildContext(), {
      episodeId: 'episode-1',
      editScriptId: 'edit-script-1',
      sourceVideoBlockId: 'edit-script-1:video-block:1',
      panelIds: ['panel-1', 'panel-2'],
    })

    expect(result).toMatchObject({
      taskId: 'task-grid-1',
      episodeId: 'episode-1',
      sourceVideoBlockId: 'edit-script-1:video-block:1',
      panelIds: ['panel-1', 'panel-2'],
      mutationBatchId: 'mutation-batch-grid-1',
    })
    expect(submitOperationTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      type: TASK_TYPE.IMAGE_PANEL,
      targetType: 'ProjectPanel',
      targetId: 'panel-1',
      operationId: 'generate_storyboard_grid_images',
      payload: expect.objectContaining({
        panelId: 'panel-1',
        referenceMode: 'asset',
        storyboardGrid: {
          mode: '2x2',
          sourceVideoBlockId: 'edit-script-1:video-block:1',
          panelIds: ['panel-1', 'panel-2'],
        },
        imageModel: 'storyboard-model-1',
        generationOptions: { quality: 'high', aspectRatio: '16:9' },
        ui: expect.objectContaining({
          intent: 'regenerate',
          hasOutputAtStart: true,
        }),
      }),
      dedupeKey: expect.stringMatching(/^storyboard_grid_image:[a-f0-9]{32}$/),
    }))
    expect(createMutationBatchMock).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'generate_storyboard_grid_images',
      episodeId: 'episode-1',
      entries: [
        { kind: 'panel_candidate_cancel', targetType: 'ProjectPanel', targetId: 'panel-1' },
        { kind: 'panel_candidate_cancel', targetType: 'ProjectPanel', targetId: 'panel-2' },
      ],
    }))
  })
})

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
        photographyRules: JSON.stringify({
          source: 'edit_script',
          sourceVideoBlockKind: 'group',
          sourceVideoBlockId: 'edit-script-1:video-block:1',
        }),
      },
      {
        id: 'panel-2',
        storyboardId: 'storyboard-1',
        panelIndex: 1,
        imageUrl: null,
        imageMediaId: null,
        photographyRules: JSON.stringify({
          source: 'edit_script',
          sourceVideoBlockKind: 'group',
          sourceVideoBlockId: 'edit-script-1:video-block:1',
        }),
      },
    ])
  })

  it('submits individual panel image tasks when generation mode is single', async () => {
    const operation = createStoryboardPanelImageOperations().generate_edit_script_storyboard_images
    const result = await operation.execute(buildContext(), {
      episodeId: 'episode-1',
      generationMode: 'single',
    })

    expect(result).toMatchObject({
      total: 2,
      episodeId: 'episode-1',
      panelIds: ['panel-1', 'panel-2'],
      generationMode: 'single',
    })
    expect(submitOperationTaskMock).toHaveBeenCalledTimes(2)
    expect(submitOperationTaskMock.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      type: TASK_TYPE.IMAGE_PANEL,
      targetType: 'ProjectPanel',
      targetId: 'panel-1',
      operationId: 'generate_edit_script_storyboard_images',
      payload: expect.objectContaining({
        panelId: 'panel-1',
        referenceMode: 'asset',
        imageModel: 'storyboard-model-1',
      }),
    }))
    expect(submitOperationTaskMock.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      targetId: 'panel-2',
      payload: expect.objectContaining({
        panelId: 'panel-2',
        referenceMode: 'asset',
        imageModel: 'storyboard-model-1',
      }),
    }))
    expect(submitOperationTaskMock.mock.calls[0]?.[0]?.payload).toEqual(expect.not.objectContaining({
      storyboardGrid: expect.anything(),
    }))
    expect(submitOperationTaskMock.mock.calls[1]?.[0]?.payload).toEqual(expect.not.objectContaining({
      storyboardGrid: expect.anything(),
    }))
  })

  it('reports grid batch task count separately from covered panel count', async () => {
    const operation = createStoryboardPanelImageOperations().generate_edit_script_storyboard_images
    const result = await operation.execute(buildContext(), {
      episodeId: 'episode-1',
      generationMode: 'grid',
    })

    expect(result).toMatchObject({
      total: 1,
      taskTotal: 1,
      targetTotal: 2,
      episodeId: 'episode-1',
      panelIds: ['panel-1', 'panel-2'],
      generationMode: 'grid',
    })
    expect(submitOperationTaskMock).toHaveBeenCalledTimes(1)
    expect(writeOperationDataPart).toHaveBeenCalledWith(null, 'data-task-batch-submitted', expect.objectContaining({
      operationId: 'generate_edit_script_storyboard_images',
      total: 1,
      taskTotal: 1,
      targetTotal: 2,
      taskIds: ['task-grid-1'],
      results: [
        expect.objectContaining({
          refId: 'panel-1',
          taskId: 'task-grid-1',
          targetId: 'panel-1',
        }),
        expect.objectContaining({
          refId: 'panel-2',
          taskId: 'task-grid-1',
          targetId: 'panel-2',
        }),
      ],
    }))
  })
})
