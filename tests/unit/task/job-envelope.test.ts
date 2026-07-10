import { describe, expect, it } from 'vitest'
import { buildTaskJobEnvelope } from '@/lib/task/job-envelope'
import { TASK_TYPE } from '@/lib/task/types'

describe('task job envelope', () => {
  it('preserves every durable recovery field in the BullMQ payload', () => {
    const billingInfo = {
      billable: true as const,
      source: 'task' as const,
      taskType: TASK_TYPE.VIDEO_GROUP,
      apiType: 'video' as const,
      model: 'kling::video-model',
      quantity: 2,
      unit: 'video' as const,
      maxFrozenCost: 4,
      action: 'generate_video_group',
      freezeId: 'freeze-1',
      status: 'frozen' as const,
    }
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
      type: TASK_TYPE.VIDEO_GROUP,
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'ProjectVideoGroup',
      targetId: 'group-1',
      payload,
      batchKey: 'batch-1',
      billingInfo,
      userId: 'user-1',
      operationId: 'generate_video_group',
      operationSource: 'assistant',
      operationConfirmed: true,
      operationRequestId: 'operation-request-1',
      priority: 7,
    })

    expect(envelope).toEqual({
      priority: 7,
      data: {
        taskId: 'task-1',
        parentTaskId: 'parent-1',
        type: TASK_TYPE.VIDEO_GROUP,
        locale: 'zh',
        projectId: 'project-1',
        episodeId: 'episode-1',
        targetType: 'ProjectVideoGroup',
        targetId: 'group-1',
        payload,
        batchKey: 'batch-1',
        billingInfo,
        userId: 'user-1',
        operationId: 'generate_video_group',
        operationSource: 'assistant',
        operationConfirmed: true,
        operationRequestId: 'operation-request-1',
        trace: { requestId: 'request-trace-1' },
      },
    })
  })

  it('fails explicitly when the durable payload has no locale', () => {
    expect(() => buildTaskJobEnvelope({
      id: 'task-2',
      parentTaskId: null,
      type: TASK_TYPE.IMAGE_PANEL,
      projectId: 'project-1',
      episodeId: null,
      targetType: 'ProjectPanel',
      targetId: 'panel-1',
      payload: { panelId: 'panel-1' },
      batchKey: null,
      billingInfo: null,
      userId: 'user-1',
      operationId: null,
      operationSource: null,
      operationConfirmed: null,
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
      operationConfirmed: null,
      operationRequestId: null,
      priority: 0,
    })).toThrow('invalid task type: unknown_task_type')
  })

  it('fails explicitly when billable recovery metadata belongs to another task type', () => {
    expect(() => buildTaskJobEnvelope({
      id: 'task-4',
      parentTaskId: null,
      type: TASK_TYPE.VIDEO_GROUP,
      projectId: 'project-1',
      episodeId: null,
      targetType: 'ProjectVideoGroup',
      targetId: 'group-1',
      payload: { meta: { locale: 'en' } },
      batchKey: null,
      billingInfo: {
        billable: true,
        source: 'task',
        taskType: TASK_TYPE.IMAGE_PANEL,
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
      operationConfirmed: true,
      operationRequestId: null,
      priority: 0,
    })).toThrow('billable task billingInfo does not match the durable Task contract')
  })
})
