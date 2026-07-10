import {
  TASK_TYPE,
  authorizedOperationContext,
  beforeEach,
  billingInfo,
  commitProjectEditScriptAssetsOperation,
  describe,
  expect,
  it,
  operationContext,
  planProjectEditScriptAssetsOperation,
  planAssetGenerateTaskMock,
  prismaMock,
  readEpisodeEditChaptersMock,
  readProjectEditScriptsMock,
  requirement,
  script,
  setupAssetGenerationScopeMocks,
  submitPlannedOperationTaskMock,
} from './asset-generation-scope.fixture'

describe('edit script asset generation planned lifecycle regression', () => {
  beforeEach(() => {
    setupAssetGenerationScopeMocks()
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

  it('rejects a billable commit without the approval-owned transaction before the first asset write', async () => {
    readProjectEditScriptsMock.mockResolvedValue([
      script('script-1', 'chapter-1', [requirement('requirement-1', 'Alice')]),
      script('script-2', 'chapter-2', [requirement('requirement-2', 'Bob')]),
    ])
    const plan = await planProjectEditScriptAssetsOperation(operationContext(), { episodeId: 'episode-1' })

    await expect(commitProjectEditScriptAssetsOperation({
      ctx: operationContext(),
      input: {},
      plan,
    })).rejects.toMatchObject({
      details: expect.objectContaining({ code: 'OPERATION_EXECUTION_TRANSACTION_REQUIRED' }),
    })
    expect(prismaMock.projectCharacter.create).not.toHaveBeenCalled()
    expect(prismaMock.projectEditAssetRequirement.update).not.toHaveBeenCalled()
    expect(submitPlannedOperationTaskMock).not.toHaveBeenCalled()
  })

  it('commits only planned child tasks through the approval-owned execution transaction', async () => {
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
      ctx: authorizedOperationContext(),
      input: {},
      plan,
    })

    expect(submitPlannedOperationTaskMock).toHaveBeenCalledTimes(2)
    expect(submitPlannedOperationTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'generate_edit_script_assets',
      ctx: expect.objectContaining({
        executionAuthorization: expect.objectContaining({
          approvalGrantId: 'approval-grant-1',
          operationExecutionId: 'operation-execution-1',
          transaction: prismaMock,
        }),
      }),
      task: expect.objectContaining({
        taskType: TASK_TYPE.IMAGE_CHARACTER,
        billingInfo,
      }),
    }))
    for (const call of submitPlannedOperationTaskMock.mock.calls) {
      expect(call[0]).toMatchObject({
        operationId: 'generate_edit_script_assets',
        ctx: expect.objectContaining({
          executionAuthorization: expect.objectContaining({
            approvalGrantId: 'approval-grant-1',
            operationExecutionId: 'operation-execution-1',
          }),
        }),
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
    ['persisted projection read', 'projection read failed'],
    ['remaining requirement count', 'remaining requirement count failed'],
  ] as const)('propagates post-submit %s failure so the approval transaction rolls back atomically', async (failureStage, failureMessage) => {
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
    if (failureStage === 'persisted projection read') {
      prismaMock.projectEditScript.findFirst.mockRejectedValueOnce(new Error(failureMessage))
    } else {
      prismaMock.projectEditAssetRequirement.count.mockRejectedValueOnce(new Error(failureMessage))
    }

    await expect(commitProjectEditScriptAssetsOperation({
      ctx: authorizedOperationContext(),
      input: {},
      plan,
    })).rejects.toThrow(failureMessage)

    expect(submitPlannedOperationTaskMock).toHaveBeenCalledTimes(2)
    expect(prismaMock.projectCharacter.deleteMany).not.toHaveBeenCalled()
    expect(prismaMock.projectLocation.deleteMany).not.toHaveBeenCalled()
    if (failureStage === 'persisted projection read') {
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
