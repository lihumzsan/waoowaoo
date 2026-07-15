import { describe, expect, it } from 'vitest'
import { buildTaskJobEnvelope } from '@/lib/task/job-envelope'
import type { TaskJobEnvelopeSource } from '@/lib/task/job-envelope'
import { TASK_TYPE } from '@/lib/task/types'

const validBillingInfo = {
  billable: true as const,
  source: 'task' as const,
  taskType: TASK_TYPE.VIDEO_SEGMENT,
  apiType: 'video' as const,
  model: 'kling::video-model',
  quantity: 2,
  unit: 'video' as const,
  maxFrozenCost: 4,
  action: 'generate_video_segments',
  freezeId: 'freeze-1',
  status: 'frozen' as const,
}

function validSource(overrides: Partial<TaskJobEnvelopeSource> = {}): TaskJobEnvelopeSource {
  return {
    id: 'task-1',
    parentTaskId: 'parent-1',
    type: TASK_TYPE.VIDEO_SEGMENT,
    projectId: 'project-1',
    episodeId: 'episode-1',
    targetType: 'ProjectVideoSegment',
    targetId: 'group-1',
    payload: { meta: { locale: 'zh', trace: { requestId: 'request-trace-1' } } },
    batchKey: 'batch-1',
    billingInfo: validBillingInfo,
    userId: 'user-1',
    operationId: 'generate_video_segments',
    operationSource: 'assistant',
    approvalGrantId: 'grant-1',
    operationExecutionId: 'execution-1',
    operationPlanTaskId: 'plan-task-1',
    operationRequestId: 'operation-request-1',
    priority: 7,
    ...overrides,
  }
}

describe('task job envelope', () => {
  it('preserves every durable recovery field in the BullMQ payload', () => {
    const billingInfo = validBillingInfo
    const payload = {
      groupId: 'group-1',
      meta: {
        locale: 'zh',
        trace: { requestId: 'request-trace-1' },
      },
    }

    const envelope = buildTaskJobEnvelope({
      id: 'task-1',
      parentTaskId: 'parent-1',
      type: TASK_TYPE.VIDEO_SEGMENT,
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'ProjectVideoSegment',
      targetId: 'group-1',
      payload,
      batchKey: 'batch-1',
      billingInfo,
      userId: 'user-1',
      operationId: 'generate_video_segments',
      operationSource: 'assistant',
      approvalGrantId: 'grant-1',
      operationExecutionId: 'execution-1',
      operationPlanTaskId: 'plan-task-1',
      operationRequestId: 'operation-request-1',
      priority: 7,
    })

    expect(envelope).toEqual({
      priority: 7,
      data: {
        taskId: 'task-1',
        parentTaskId: 'parent-1',
        type: TASK_TYPE.VIDEO_SEGMENT,
        locale: 'zh',
        projectId: 'project-1',
        episodeId: 'episode-1',
        targetType: 'ProjectVideoSegment',
        targetId: 'group-1',
        payload,
        batchKey: 'batch-1',
        billingInfo,
        userId: 'user-1',
        operationId: 'generate_video_segments',
        operationSource: 'assistant',
        approvalGrantId: 'grant-1',
        operationExecutionId: 'execution-1',
        operationPlanTaskId: 'plan-task-1',
        operationRequestId: 'operation-request-1',
        trace: { requestId: 'request-trace-1' },
      },
    })
  })

  it('fails explicitly when the durable payload has no locale', () => {
    expect(() => buildTaskJobEnvelope({
      id: 'task-2',
      parentTaskId: null,
      type: TASK_TYPE.IMAGE_CHARACTER,
      projectId: 'project-1',
      episodeId: null,
      targetType: 'CharacterAppearance',
      targetId: 'appearance-1',
      payload: { appearanceId: 'appearance-1' },
      batchKey: null,
      billingInfo: null,
      userId: 'user-1',
      operationId: null,
      operationSource: null,
      approvalGrantId: null,
      operationExecutionId: null,
      operationPlanTaskId: null,
      operationRequestId: null,
      priority: 0,
    })).toThrow('task locale is missing')
  })

  it('fails explicitly for an unknown persisted task type', () => {
    expect(() => buildTaskJobEnvelope({
      id: 'task-3',
      parentTaskId: null,
      type: 'unknown_task_type',
      projectId: 'project-1',
      episodeId: null,
      targetType: 'Project',
      targetId: 'project-1',
      payload: { meta: { locale: 'en' } },
      batchKey: null,
      billingInfo: null,
      userId: 'user-1',
      operationId: null,
      operationSource: null,
      approvalGrantId: null,
      operationExecutionId: null,
      operationPlanTaskId: null,
      operationRequestId: null,
      priority: 0,
    })).toThrow('invalid task type: unknown_task_type')
  })

  it('fails explicitly when billable recovery metadata belongs to another task type', () => {
    expect(() => buildTaskJobEnvelope({
      id: 'task-4',
      parentTaskId: null,
      type: TASK_TYPE.VIDEO_SEGMENT,
      projectId: 'project-1',
      episodeId: null,
      targetType: 'ProjectVideoSegment',
      targetId: 'group-1',
      payload: { meta: { locale: 'en' } },
      batchKey: null,
      billingInfo: {
        billable: true,
        source: 'task',
        taskType: TASK_TYPE.IMAGE_CHARACTER,
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
      priority: 0,
    })).toThrow('TASK_BILLING_INFO_INVALID:contract')
  })

  it('accepts every billing enum value and non-billable metadata', () => {
    for (const apiType of ['text', 'image', 'video', 'music'] as const) {
      for (const unit of ['token', 'image', 'video', 'second', 'call'] as const) {
        expect(buildTaskJobEnvelope(validSource({
          billingInfo: { ...validBillingInfo, apiType, unit },
        })).data.billingInfo).toMatchObject({ apiType, unit })
      }
    }
    expect(buildTaskJobEnvelope(validSource({ billingInfo: { billable: false } })).data.billingInfo).toEqual({ billable: false })
    expect(buildTaskJobEnvelope(validSource({ billingInfo: null })).data.billingInfo).toBeNull()
    expect(buildTaskJobEnvelope(validSource({ billingInfo: undefined })).data.billingInfo).toBeNull()
  })

  it('rejects each malformed billable field at the durable boundary', () => {
    for (const billingInfo of ['billing', []]) {
      expect(() => buildTaskJobEnvelope(validSource({ billingInfo }))).toThrow('TASK_BILLING_INFO_INVALID')
    }
    for (const billingInfo of [{}, { ...validBillingInfo, billable: 'yes' }]) {
      expect(() => buildTaskJobEnvelope(validSource({ billingInfo }))).toThrow('TASK_BILLING_INFO_INVALID')
    }
    const invalidBillableContracts: unknown[] = [
      { ...validBillingInfo, source: 'route' },
      { ...validBillingInfo, taskType: TASK_TYPE.IMAGE_CHARACTER },
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
      expect(() => buildTaskJobEnvelope(validSource({ billingInfo }))).toThrow(
        'TASK_BILLING_INFO_INVALID',
      )
    }
    expect(buildTaskJobEnvelope(validSource({
      billingInfo: { ...validBillingInfo, maxFrozenCost: 0 },
    })).data.billingInfo).toMatchObject({ maxFrozenCost: 0 })
  })

  it('rejects every non-object payload at the durable boundary', () => {
    for (const payload of ['payload', 1, true, []]) {
      expect(() => buildTaskJobEnvelope(validSource({ payload }))).toThrow('task payload must be an object or null')
    }
    for (const payload of [null, undefined]) {
      expect(() => buildTaskJobEnvelope(validSource({ payload }))).toThrow('task locale is missing')
    }
  })

  it('uses a trimmed payload trace only when its nested shape is valid', () => {
    expect(buildTaskJobEnvelope(validSource({
      payload: { meta: { locale: 'zh', trace: { requestId: '  trace-id  ' } } },
    })).data.trace).toEqual({ requestId: 'trace-id' })

    const fallbackPayloads: unknown[] = [
      { locale: 'zh', meta: null },
      { meta: { locale: 'zh' } },
      { meta: { locale: 'zh', trace: null } },
      { meta: { locale: 'zh', trace: [] } },
      { meta: { locale: 'zh', trace: { requestId: 9 } } },
      { meta: { locale: 'zh', trace: { requestId: '   ' } } },
    ]
    for (const payload of fallbackPayloads) {
      expect(buildTaskJobEnvelope(validSource({
        payload,
        operationRequestId: 'operation-fallback',
      })).data.trace).toEqual({ requestId: 'operation-fallback' })
    }
  })
})
