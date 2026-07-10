import type { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskBillingInfo } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  projectEditScript: {
    findMany: vi.fn(),
  },
  projectEditAssetRequirement: {
    findMany: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  projectCharacter: {
    findMany: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
  projectLocation: {
    findMany: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
  $transaction: vi.fn(),
}))

const readEpisodeEditBibleMock = vi.hoisted(() => vi.fn())
const readEpisodeEditChaptersMock = vi.hoisted(() => vi.fn())
const readProjectEditScriptsMock = vi.hoisted(() => vi.fn())
const planAssetGenerateTaskMock = vi.hoisted(() => vi.fn())
const submitPlannedOperationTaskMock = vi.hoisted(() => vi.fn())
const compensateSubmittedTasksMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/edit-bible', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/edit-bible')>()
  return {
    ...original,
    readEpisodeEditBible: readEpisodeEditBibleMock,
    readEpisodeEditChapters: readEpisodeEditChaptersMock,
  }
})
vi.mock('@/lib/edit-script/service', () => ({
  readProjectEditScripts: readProjectEditScriptsMock,
}))
vi.mock('@/lib/assets/services/asset-actions', () => ({
  planAssetGenerateTask: planAssetGenerateTaskMock,
}))
vi.mock('@/lib/operations/planning', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/operations/planning')>()
  return {
    ...original,
    submitPlannedOperationTask: submitPlannedOperationTaskMock,
    compensateSubmittedTasks: compensateSubmittedTasksMock,
  }
})

import {
  commitProjectEditScriptAssetsOperation,
  planProjectEditScriptAssetsOperation,
} from '@/lib/edit-script/asset-generation-operation-plan'

const billingInfo: TaskBillingInfo = {
  billable: true,
  source: 'task',
  taskType: TASK_TYPE.IMAGE_CHARACTER,
  apiType: 'image',
  model: 'image-model',
  quantity: 1,
  unit: 'image',
  maxFrozenCost: 1,
  action: TASK_TYPE.IMAGE_CHARACTER,
  status: 'quoted',
}

function request(): NextRequest {
  return new Request('http://localhost', {
    headers: { 'accept-language': 'zh' },
  }) as unknown as NextRequest
}

function operationContext() {
  return {
    request: request(),
    userId: 'user-1',
    projectId: 'project-1',
    context: { locale: 'zh', episodeId: 'episode-1' },
    source: 'project-ui',
    writer: null,
    toolCallId: null,
  }
}

function requirement(id: string, name: string) {
  return {
    id,
    kind: 'character' as const,
    name,
    description: `${name} design`,
    shotIds: ['shot-1'],
    status: 'pending' as const,
    targetId: null,
    errorMessage: null,
  }
}

function script(id: string, chapterId: string, requirements: readonly ReturnType<typeof requirement>[]) {
  return {
    id,
    projectId: 'project-1',
    episodeId: 'episode-1',
    chapterId,
    durationSec: 3,
    shotCount: 1,
    assetReviewStatus: 'pending' as const,
    styleBible: null,
    shots: [],
    generationSegments: [],
    requirements,
  }
}

describe('edit script asset generation planned lifecycle regression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readEpisodeEditBibleMock.mockResolvedValue({
      stylePreviews: [{ status: 'confirmed', imageUrl: 'https://cdn.example/style.png' }],
    })
    readEpisodeEditChaptersMock.mockResolvedValue([{ id: 'chapter-1' }, { id: 'chapter-2' }])
    prismaMock.projectEditScript.findMany.mockResolvedValue([
      { chapterId: 'chapter-1', status: 'ready' },
      { chapterId: 'chapter-2', status: 'ready' },
    ])
    prismaMock.projectCharacter.findMany.mockResolvedValue([])
    prismaMock.projectLocation.findMany.mockResolvedValue([])
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => Promise<unknown>) => await callback(prismaMock))
    planAssetGenerateTaskMock.mockImplementation(async (input: { assetId: string; body: { appearanceId?: string } }) => ({
      userId: 'user-1',
      projectId: 'project-1',
      task: {
        id: `planned:${input.assetId}`,
        taskType: TASK_TYPE.IMAGE_CHARACTER,
        target: { targetType: 'CharacterAppearance', targetId: input.body.appearanceId! },
        payload: { id: input.assetId, appearanceId: input.body.appearanceId },
        billingInfo,
        locale: 'zh',
        episodeId: 'episode-1',
      },
    }))
  })

  it('plans every episode-scoped requirement without writing assets or requirements', async () => {
    readProjectEditScriptsMock.mockResolvedValue([
      script('script-1', 'chapter-1', [requirement('requirement-1', 'Alice')]),
      script('script-2', 'chapter-2', [requirement('requirement-2', 'Bob')]),
    ])

    const plan = await planProjectEditScriptAssetsOperation(operationContext(), { episodeId: 'episode-1' })

    expect(plan.tasks).toHaveLength(2)
    expect(plan.tasks.map((task) => task.billingInfo)).toEqual([billingInfo, billingInfo])
    expect(plan.metadata?.requirements).toHaveLength(2)
    expect(prismaMock.projectCharacter.create).not.toHaveBeenCalled()
    expect(prismaMock.projectEditAssetRequirement.update).not.toHaveBeenCalled()
    expect(submitPlannedOperationTaskMock).not.toHaveBeenCalled()
  })

  it('plans one exact task for a shared asset while retaining both requirement bindings', async () => {
    readProjectEditScriptsMock.mockResolvedValue([
      script('script-1', 'chapter-1', [requirement('requirement-1', 'Alice')]),
      script('script-2', 'chapter-2', [requirement('requirement-2', 'Alice')]),
    ])

    const plan = await planProjectEditScriptAssetsOperation(operationContext(), { episodeId: 'episode-1' })

    expect(plan.tasks).toHaveLength(1)
    expect(plan.metadata?.requirements).toHaveLength(2)
    expect(planAssetGenerateTaskMock).toHaveBeenCalledTimes(1)
  })

  it('rejects an incomplete episode before creating assets or submitting tasks', async () => {
    readEpisodeEditChaptersMock.mockResolvedValue([{ id: 'chapter-1' }, { id: 'chapter-2' }])
    prismaMock.projectEditScript.findMany.mockResolvedValue([{ chapterId: 'chapter-1', status: 'ready' }])
    readProjectEditScriptsMock.mockResolvedValue([
      script('script-1', 'chapter-1', [requirement('requirement-1', 'Alice')]),
    ])

    await expect(planProjectEditScriptAssetsOperation(operationContext(), { episodeId: 'episode-1' }))
      .rejects.toThrow('EDIT_SCRIPT_ASSET_EPISODE_GATE_NOT_READY:chapter-2')
    expect(prismaMock.projectCharacter.create).not.toHaveBeenCalled()
    expect(submitPlannedOperationTaskMock).not.toHaveBeenCalled()
  })

  it('rejects an unconfirmed billable commit before the first asset write', async () => {
    readProjectEditScriptsMock.mockResolvedValue([
      script('script-1', 'chapter-1', [requirement('requirement-1', 'Alice')]),
      script('script-2', 'chapter-2', [requirement('requirement-2', 'Bob')]),
    ])
    const plan = await planProjectEditScriptAssetsOperation(operationContext(), { episodeId: 'episode-1' })

    await expect(commitProjectEditScriptAssetsOperation({
      ctx: operationContext(),
      input: { confirmed: false },
      plan,
    })).rejects.toMatchObject({
      details: expect.objectContaining({ code: 'OPERATION_CONFIRMATION_REQUIRED' }),
    })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(submitPlannedOperationTaskMock).not.toHaveBeenCalled()
  })

  it('commits only planned child tasks and preserves their operation confirmation metadata', async () => {
    const scripts = [
      script('script-1', 'chapter-1', [requirement('requirement-1', 'Alice')]),
      script('script-2', 'chapter-2', [requirement('requirement-2', 'Bob')]),
    ]
    readProjectEditScriptsMock.mockResolvedValue(scripts)
    const plan = await planProjectEditScriptAssetsOperation(operationContext(), { episodeId: 'episode-1' })
    const plannedRequirements = plan.metadata?.requirements as Array<{
      requirementId: string
      previousStatus: string
      previousTargetId: string | null
      previousErrorMessage: string | null
    }>
    prismaMock.projectEditAssetRequirement.findMany.mockResolvedValue(plannedRequirements.map((item) => ({
      id: item.requirementId,
      status: item.previousStatus,
      targetId: item.previousTargetId,
      errorMessage: item.previousErrorMessage,
    })))
    prismaMock.projectEditAssetRequirement.count.mockResolvedValue(2)
    submitPlannedOperationTaskMock.mockImplementation(async (input: { task: { id: string } }) => ({
      taskId: `task:${input.task.id}`,
      status: 'queued',
      runId: null,
      deduped: false,
    }))

    const result = await commitProjectEditScriptAssetsOperation({
      ctx: operationContext(),
      input: { confirmed: true },
      plan,
    })

    expect(submitPlannedOperationTaskMock).toHaveBeenCalledTimes(2)
    expect(submitPlannedOperationTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'generate_edit_script_assets',
      confirmed: true,
      task: expect.objectContaining({
        taskType: TASK_TYPE.IMAGE_CHARACTER,
        billingInfo,
      }),
    }))
    for (const call of submitPlannedOperationTaskMock.mock.calls) {
      expect(call[0]).toMatchObject({
        operationId: 'generate_edit_script_assets',
        confirmed: true,
      })
    }
    expect(result.taskIds).toHaveLength(2)
    expect(result.submittedTasks.map((task) => ({
      requirementId: task.requirementId,
      taskType: task.taskType,
      targetType: task.targetType,
    }))).toEqual([
      {
        requirementId: 'requirement-1',
        taskType: TASK_TYPE.IMAGE_CHARACTER,
        targetType: 'CharacterAppearance',
      },
      {
        requirementId: 'requirement-2',
        taskType: TASK_TYPE.IMAGE_CHARACTER,
        targetType: 'CharacterAppearance',
      },
    ])
  })

  it.each([
    ['projection read', 'projection read failed'],
    ['remaining requirement count', 'remaining requirement count failed'],
  ] as const)('compensates submitted tasks and restores asset writes when post-submit %s fails', async (failureStage, failureMessage) => {
    const scripts = [
      script('script-1', 'chapter-1', [requirement('requirement-1', 'Alice')]),
      script('script-2', 'chapter-2', [requirement('requirement-2', 'Bob')]),
    ]
    readProjectEditScriptsMock.mockResolvedValue(scripts)
    const plan = await planProjectEditScriptAssetsOperation(operationContext(), { episodeId: 'episode-1' })
    const plannedRequirements = plan.metadata?.requirements as Array<{
      requirementId: string
      previousStatus: string
      previousTargetId: string | null
      previousErrorMessage: string | null
    }>
    prismaMock.projectEditAssetRequirement.findMany.mockResolvedValue(plannedRequirements.map((item) => ({
      id: item.requirementId,
      status: item.previousStatus,
      targetId: item.previousTargetId,
      errorMessage: item.previousErrorMessage,
    })))
    submitPlannedOperationTaskMock.mockImplementation(async (input: { task: { id: string } }) => ({
      taskId: `task:${input.task.id}`,
      status: 'queued',
      runId: null,
      deduped: false,
    }))
    if (failureStage === 'projection read') {
      readProjectEditScriptsMock.mockRejectedValueOnce(new Error(failureMessage))
    } else {
      prismaMock.projectEditAssetRequirement.count.mockRejectedValueOnce(new Error(failureMessage))
    }

    await expect(commitProjectEditScriptAssetsOperation({
      ctx: operationContext(),
      input: { confirmed: true },
      plan,
    })).rejects.toThrow(failureMessage)

    const submittedTaskIds = plan.tasks.map((task) => `task:${task.id}`)
    expect(compensateSubmittedTasksMock).toHaveBeenCalledWith(submittedTaskIds)
    expect(prismaMock.projectEditAssetRequirement.update).toHaveBeenCalledWith({
      where: { id: 'requirement-1' },
      data: { status: 'pending', targetId: null, errorMessage: null },
    })
    expect(prismaMock.projectEditAssetRequirement.update).toHaveBeenCalledWith({
      where: { id: 'requirement-2' },
      data: { status: 'pending', targetId: null, errorMessage: null },
    })
    expect(prismaMock.projectCharacter.deleteMany).toHaveBeenCalledTimes(2)
    expect(prismaMock.projectCharacter.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ projectId: 'project-1' }),
    })
    if (failureStage === 'projection read') {
      expect(prismaMock.projectEditAssetRequirement.count).not.toHaveBeenCalled()
    } else {
      expect(prismaMock.projectEditAssetRequirement.count).toHaveBeenCalledWith({
        where: {
          editScriptId: { in: ['script-1', 'script-2'] },
          status: { not: 'completed' },
        },
      })
    }
  })
})
