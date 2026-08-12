import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  mergeOperationPlanViewsForApproval,
  quoteOperationPlan,
  toOperationPlanView,
} from '@/lib/operations/planning'
import type { OperationPlan } from '@/lib/operations/plan-contract'
import { TASK_TYPE, type TaskBillingInfo } from '@/lib/task/types'

const originalDeploymentEdition = process.env.DEPLOYMENT_EDITION
const originalBillingMode = process.env.BILLING_MODE

function mediaBillingInfo(params: {
  taskType:
    | typeof TASK_TYPE.WORKSPACE_RESOURCE_IMAGE
    | typeof TASK_TYPE.WORKSPACE_RESOURCE_VIDEO
    | typeof TASK_TYPE.WORKSPACE_RESOURCE_AUDIO
  apiType: 'image' | 'video' | 'music'
  model: string
  maxFrozenCost: number
  unit: 'image' | 'video' | 'second' | 'call'
}): TaskBillingInfo {
  return {
    billable: true,
    source: 'task',
    taskType: params.taskType,
    apiType: params.apiType,
    model: params.model,
    quantity: 1,
    unit: params.unit,
    maxFrozenCost: params.maxFrozenCost,
    action: params.taskType,
    status: 'quoted',
  }
}

function buildPlan(): OperationPlan {
  return {
    kind: 'task_submission',
    operationId: 'create_video',
    projectId: 'project-1',
    userId: 'user-1',
    tasks: [
      {
        id: 'image-task',
        taskType: TASK_TYPE.WORKSPACE_RESOURCE_IMAGE,
        target: { targetType: 'WorkspaceResource', targetId: 'image-resource-1' },
        payload: { model: 'payload-should-not-drive-quote' },
        billingInfo: mediaBillingInfo({
          taskType: TASK_TYPE.WORKSPACE_RESOURCE_IMAGE,
          apiType: 'image',
          model: 'planned-image-model',
          maxFrozenCost: 3.5,
          unit: 'image',
        }),
        locale: 'zh',
      },
      {
        id: 'video-task',
        taskType: TASK_TYPE.WORKSPACE_RESOURCE_VIDEO,
        target: { targetType: 'WorkspaceResource', targetId: 'video-resource-1' },
        payload: { model: 'different-payload-model' },
        billingInfo: mediaBillingInfo({
          taskType: TASK_TYPE.WORKSPACE_RESOURCE_VIDEO,
          apiType: 'video',
          model: 'planned-video-model',
          maxFrozenCost: 6.25,
          unit: 'second',
        }),
        locale: 'zh',
      },
      {
        id: 'merge-task',
        taskType: TASK_TYPE.WORKSPACE_RESOURCE_VIDEO_MERGE,
        target: { targetType: 'WorkspaceResource', targetId: 'merged-video-resource-1' },
        payload: { deterministic: true },
        billingInfo: { billable: false },
        locale: 'zh',
      },
      {
        id: 'audio-task',
        taskType: TASK_TYPE.WORKSPACE_RESOURCE_AUDIO,
        target: { targetType: 'WorkspaceResource', targetId: 'audio-resource-1' },
        payload: { model: 'payload-audio-model' },
        billingInfo: mediaBillingInfo({
          taskType: TASK_TYPE.WORKSPACE_RESOURCE_AUDIO,
          apiType: 'music',
          model: 'planned-audio-model',
          maxFrozenCost: 2.5,
          unit: 'call',
        }),
        locale: 'zh',
      },
    ],
  }
}

describe('operation planning billing quote', () => {
  beforeEach(() => {
    process.env.DEPLOYMENT_EDITION = 'cloud'
    process.env.BILLING_MODE = 'ENFORCE'
  })

  afterEach(() => {
    if (originalDeploymentEdition === undefined) {
      delete process.env.DEPLOYMENT_EDITION
    } else {
      process.env.DEPLOYMENT_EDITION = originalDeploymentEdition
    }
    if (originalBillingMode === undefined) {
      delete process.env.BILLING_MODE
    } else {
      process.env.BILLING_MODE = originalBillingMode
    }
  })

  it('quotes fixed-price media without charging a deterministic merge Task', async () => {
    const quote = await quoteOperationPlan(buildPlan())

    expect(quote.showCredits).toBe(true)
    expect(quote.taskCount).toBe(4)
    expect(quote.mediaTaskCount).toBe(3)
    expect(quote.totalMaxFrozenCost).toBe(12.25)
    expect(quote.items.map((item) => item.model)).toEqual([
      'planned-image-model',
      'planned-video-model',
      'planned-audio-model',
    ])
  })

  it('hides credit amounts in self-hosted plan views while preserving task count', async () => {
    process.env.DEPLOYMENT_EDITION = 'self-hosted'
    process.env.BILLING_MODE = 'OFF'

    const view = await toOperationPlanView(buildPlan())

    expect(view.quote.showCredits).toBe(false)
    expect(view.quote.mediaTaskCount).toBe(3)
    expect(Object.prototype.hasOwnProperty.call(view.quote, 'totalMaxFrozenCost')).toBe(false)
    expect(view.quote.items.every((item) => !Object.prototype.hasOwnProperty.call(item, 'maxFrozenCost'))).toBe(true)
  })

  it('merges every member quote for one approval group without reusing a member snapshot identity', async () => {
    const music = {
      ...await toOperationPlanView(buildPlan()),
      operationId: 'create_audio' as const,
      planSnapshotId: 'music-snapshot',
    }
    const video = {
      ...await toOperationPlanView(buildPlan()),
      operationId: 'create_video' as const,
      planSnapshotId: 'video-snapshot',
      tasks: music.tasks.map((task) => ({ ...task, id: `video:${task.id}` })),
      quote: {
        ...music.quote,
        items: music.quote.items.map((item) => ({ ...item, id: `video:${item.id}` })),
      },
    }

    const approval = mergeOperationPlanViewsForApproval(
      'create_audio',
      [music, video],
    )

    expect(approval).toMatchObject({
      operationId: 'create_audio',
      taskCount: 8,
      quote: {
        taskCount: 8,
        mediaTaskCount: 6,
        totalMaxFrozenCost: 24.5,
      },
    })
    expect(approval?.tasks).toHaveLength(8)
    expect(approval?.quote.items).toHaveLength(6)
    expect(approval).not.toHaveProperty('planSnapshotId')
  })

})
