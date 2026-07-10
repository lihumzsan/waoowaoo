import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  quoteOperationPlan,
  toOperationPlanView,
  type OperationPlan,
} from '@/lib/operations/planning'
import { createProjectAgentOperationRegistryForApi } from '@/lib/operations/registry'
import { TASK_TYPE, type TaskBillingInfo } from '@/lib/task/types'

const originalDeploymentEdition = process.env.DEPLOYMENT_EDITION
const originalBillingMode = process.env.BILLING_MODE

function mediaBillingInfo(params: {
  taskType: typeof TASK_TYPE.IMAGE_PANEL | typeof TASK_TYPE.VIDEO_PANEL | typeof TASK_TYPE.MUSIC_GENERATE
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

function textBillingInfo(): TaskBillingInfo {
  return {
    billable: true,
    source: 'task',
    taskType: TASK_TYPE.EDIT_BIBLE_GENERATE,
    apiType: 'text',
    model: 'text-model',
    quantity: 1000,
    unit: 'token',
    maxFrozenCost: 99,
    action: TASK_TYPE.EDIT_BIBLE_GENERATE,
    status: 'quoted',
  }
}

function buildPlan(): OperationPlan {
  return {
    kind: 'task_submission',
    operationId: 'regenerate_panel_image',
    projectId: 'project-1',
    userId: 'user-1',
    tasks: [
      {
        id: 'image-task',
        taskType: TASK_TYPE.IMAGE_PANEL,
        target: { targetType: 'ProjectPanel', targetId: 'panel-1' },
        payload: { model: 'payload-should-not-drive-quote' },
        billingInfo: mediaBillingInfo({
          taskType: TASK_TYPE.IMAGE_PANEL,
          apiType: 'image',
          model: 'planned-image-model',
          maxFrozenCost: 3.5,
          unit: 'image',
        }),
        locale: 'zh',
      },
      {
        id: 'video-task',
        taskType: TASK_TYPE.VIDEO_PANEL,
        target: { targetType: 'ProjectPanel', targetId: 'panel-2' },
        payload: { model: 'different-payload-model' },
        billingInfo: mediaBillingInfo({
          taskType: TASK_TYPE.VIDEO_PANEL,
          apiType: 'video',
          model: 'planned-video-model',
          maxFrozenCost: 6.25,
          unit: 'second',
        }),
        locale: 'zh',
      },
      {
        id: 'text-task',
        taskType: TASK_TYPE.EDIT_BIBLE_GENERATE,
        target: { targetType: 'ProjectEpisode', targetId: 'episode-1' },
        payload: { model: 'expensive-text-payload' },
        billingInfo: textBillingInfo(),
        locale: 'zh',
      },
      {
        id: 'music-task',
        taskType: TASK_TYPE.MUSIC_GENERATE,
        target: { targetType: 'Project', targetId: 'project-1' },
        payload: { model: 'payload-music-model' },
        billingInfo: mediaBillingInfo({
          taskType: TASK_TYPE.MUSIC_GENERATE,
          apiType: 'music',
          model: 'planned-music-model',
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

  it('quotes fixed-price media from PlannedTask.billingInfo without counting text tasks', async () => {
    const quote = await quoteOperationPlan(buildPlan())

    expect(quote.showCredits).toBe(true)
    expect(quote.taskCount).toBe(4)
    expect(quote.mediaTaskCount).toBe(3)
    expect(quote.totalMaxFrozenCost).toBe(12.25)
    expect(quote.items.map((item) => item.model)).toEqual([
      'planned-image-model',
      'planned-video-model',
      'planned-music-model',
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

  it('requires every billable_media operation to expose the immutable plan and commit contract', () => {
    const registry = createProjectAgentOperationRegistryForApi()
    for (const [operationId, operation] of Object.entries(registry)) {
      if (operation.confirmation.kind !== 'billable_media') continue
      expect(operation.plan, operationId).toBeTypeOf('function')
      expect(operation.commit, operationId).toBeTypeOf('function')
    }
  })
})
