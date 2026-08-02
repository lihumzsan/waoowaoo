import { describe, expect, it } from 'vitest'
import {
  buildTaskExecutionData,
  type TaskExecutionDataSource,
} from '@/lib/task/execution-input'
import { TASK_TYPE } from '@/lib/task/types'

const validBillingInfo = {
  billable: true as const,
  source: 'task' as const,
  taskType: TASK_TYPE.WORKSPACE_RESOURCE_VIDEO,
  apiType: 'video' as const,
  model: 'kling::video-model',
  quantity: 2,
  unit: 'video' as const,
  maxFrozenCost: 4,
  action: 'generate_workspace_resource_video',
  freezeId: 'freeze-1',
  status: 'frozen' as const,
}

function validSource(
  overrides: Partial<TaskExecutionDataSource> = {},
): TaskExecutionDataSource {
  return {
    id: 'task-1',
    parentTaskId: 'parent-1',
    type: TASK_TYPE.WORKSPACE_RESOURCE_VIDEO,
    projectId: 'project-1',
    targetType: 'WorkspaceResource',
    targetId: 'resource-1',
    payload: { meta: { locale: 'zh', trace: { requestId: 'request-trace-1' } } },
    billingInfo: validBillingInfo,
    userId: 'user-1',
    operationId: 'generate_workspace_resource_video',
    operationSource: 'assistant',
    approvalGrantId: 'grant-1',
    operationExecutionId: 'execution-1',
    operationPlanTaskId: 'plan-task-1',
    operationRequestId: 'operation-request-1',
    ...overrides,
  }
}

describe('Task execution input', () => {
  it('projects every durable execution field from the Task row', () => {
    const billingInfo = validBillingInfo
    const payload = {
      resourceId: 'resource-1',
      meta: {
        locale: 'zh',
        trace: { requestId: 'request-trace-1' },
      },
    }

    const data = buildTaskExecutionData({
      id: 'task-1',
      parentTaskId: 'parent-1',
      type: TASK_TYPE.WORKSPACE_RESOURCE_VIDEO,
      projectId: 'project-1',
      targetType: 'WorkspaceResource',
      targetId: 'resource-1',
      payload,
      billingInfo,
      userId: 'user-1',
      operationId: 'generate_workspace_resource_video',
      operationSource: 'assistant',
      approvalGrantId: 'grant-1',
      operationExecutionId: 'execution-1',
      operationPlanTaskId: 'plan-task-1',
      operationRequestId: 'operation-request-1',
    })

    expect(data).toEqual({
        taskId: 'task-1',
        parentTaskId: 'parent-1',
        type: TASK_TYPE.WORKSPACE_RESOURCE_VIDEO,
        locale: 'zh',
        projectId: 'project-1',
        targetType: 'WorkspaceResource',
        targetId: 'resource-1',
        payload,
        billingInfo,
        userId: 'user-1',
        operationId: 'generate_workspace_resource_video',
        operationSource: 'assistant',
        approvalGrantId: 'grant-1',
        operationExecutionId: 'execution-1',
        operationPlanTaskId: 'plan-task-1',
        operationRequestId: 'operation-request-1',
        trace: { requestId: 'request-trace-1' },
    })
  })

  it('fails explicitly when the durable payload has no locale', () => {
    expect(() => buildTaskExecutionData({
      id: 'task-2',
      parentTaskId: null,
      type: TASK_TYPE.WORKSPACE_RESOURCE_IMAGE,
      projectId: 'project-1',
      targetType: 'WorkspaceResource',
      targetId: 'resource-1',
      payload: { resourceId: 'resource-1' },
      billingInfo: null,
      userId: 'user-1',
      operationId: null,
      operationSource: null,
      approvalGrantId: null,
      operationExecutionId: null,
      operationPlanTaskId: null,
      operationRequestId: null,
    })).toThrow('task locale is missing')
  })

  it('fails explicitly for an unknown persisted task type', () => {
    expect(() => buildTaskExecutionData({
      id: 'task-3',
      parentTaskId: null,
      type: 'unknown_task_type',
      projectId: 'project-1',
      targetType: 'Project',
      targetId: 'project-1',
      payload: { meta: { locale: 'en' } },
      billingInfo: null,
      userId: 'user-1',
      operationId: null,
      operationSource: null,
      approvalGrantId: null,
      operationExecutionId: null,
      operationPlanTaskId: null,
      operationRequestId: null,
    })).toThrow('invalid task type: unknown_task_type')
  })

  it('fails explicitly when billable recovery metadata belongs to another task type', () => {
    expect(() => buildTaskExecutionData({
      id: 'task-4',
      parentTaskId: null,
      type: TASK_TYPE.WORKSPACE_RESOURCE_VIDEO,
      projectId: 'project-1',
      targetType: 'WorkspaceResource',
      targetId: 'resource-1',
      payload: { meta: { locale: 'en' } },
      billingInfo: {
        billable: true,
        source: 'task',
        taskType: TASK_TYPE.WORKSPACE_RESOURCE_IMAGE,
        apiType: 'video',
        model: 'video-model',
        quantity: 1,
        unit: 'video',
        maxFrozenCost: 1,
        action: 'generate_video',
      },
      userId: 'user-1',
      operationId: null,
      operationSource: null,
      approvalGrantId: 'grant-4',
      operationExecutionId: 'execution-4',
      operationPlanTaskId: 'plan-task-4',
      operationRequestId: null,
    })).toThrow('TASK_BILLING_INFO_INVALID:contract')
  })

  it('accepts every billing enum value and non-billable metadata', () => {
    for (const apiType of ['text', 'image', 'video', 'music', 'voice'] as const) {
      for (const unit of ['token', 'image', 'video', 'second', 'call', 'character'] as const) {
        expect(buildTaskExecutionData(validSource({
          billingInfo: { ...validBillingInfo, apiType, unit },
        })).billingInfo).toMatchObject({ apiType, unit })
      }
    }
    expect(buildTaskExecutionData(validSource({ billingInfo: { billable: false } })).billingInfo).toEqual({ billable: false })
    expect(buildTaskExecutionData(validSource({ billingInfo: null })).billingInfo).toBeNull()
    expect(buildTaskExecutionData(validSource({ billingInfo: undefined })).billingInfo).toBeNull()
  })

  it('rejects each malformed billable field at the durable boundary', () => {
    for (const billingInfo of ['billing', []]) {
      expect(() => buildTaskExecutionData(validSource({ billingInfo }))).toThrow('TASK_BILLING_INFO_INVALID')
    }
    for (const billingInfo of [{}, { ...validBillingInfo, billable: 'yes' }]) {
      expect(() => buildTaskExecutionData(validSource({ billingInfo }))).toThrow('TASK_BILLING_INFO_INVALID')
    }
    const invalidBillableContracts: unknown[] = [
      { ...validBillingInfo, source: 'route' },
      { ...validBillingInfo, taskType: TASK_TYPE.WORKSPACE_RESOURCE_IMAGE },
      { ...validBillingInfo, apiType: 'unknown' },
      { ...validBillingInfo, model: 3 },
      { ...validBillingInfo, model: '   ' },
      { ...validBillingInfo, quantity: '2' },
      { ...validBillingInfo, quantity: Number.NaN },
      { ...validBillingInfo, quantity: 0 },
      { ...validBillingInfo, unit: 'unknown' },
      { ...validBillingInfo, maxFrozenCost: '4' },
      { ...validBillingInfo, maxFrozenCost: Number.NaN },
      { ...validBillingInfo, maxFrozenCost: -1 },
      { ...validBillingInfo, action: 7 },
      { ...validBillingInfo, action: '   ' },
    ]
    for (const billingInfo of invalidBillableContracts) {
      expect(() => buildTaskExecutionData(validSource({ billingInfo }))).toThrow(
        'TASK_BILLING_INFO_INVALID',
      )
    }
    expect(buildTaskExecutionData(validSource({
      billingInfo: { ...validBillingInfo, maxFrozenCost: 0 },
    })).billingInfo).toMatchObject({ maxFrozenCost: 0 })
  })

  it('rejects every non-object payload at the durable boundary', () => {
    for (const payload of ['payload', 1, true, []]) {
      expect(() => buildTaskExecutionData(validSource({ payload }))).toThrow('task payload must be an object or null')
    }
    for (const payload of [null, undefined]) {
      expect(() => buildTaskExecutionData(validSource({ payload }))).toThrow('task locale is missing')
    }
  })

  it('uses a trimmed payload trace only when its nested shape is valid', () => {
    expect(buildTaskExecutionData(validSource({
      payload: { meta: { locale: 'zh', trace: { requestId: '  trace-id  ' } } },
    })).trace).toEqual({ requestId: 'trace-id' })

    const fallbackPayloads: unknown[] = [
      { locale: 'zh', meta: null },
      { meta: { locale: 'zh' } },
      { meta: { locale: 'zh', trace: null } },
      { meta: { locale: 'zh', trace: [] } },
      { meta: { locale: 'zh', trace: { requestId: 9 } } },
      { meta: { locale: 'zh', trace: { requestId: '   ' } } },
    ]
    for (const payload of fallbackPayloads) {
      expect(buildTaskExecutionData(validSource({
        payload,
        operationRequestId: 'operation-fallback',
      })).trace).toEqual({ requestId: 'operation-fallback' })
    }
  })
})
