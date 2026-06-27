import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertOperationPlanConfirmedCost,
  quoteOperationPlan,
  toOperationPlanView,
  type OperationPlan,
} from '@/lib/operations/planning'
import { createProjectAgentOperationRegistryForApi } from '@/lib/operations/registry'
import { TASK_TYPE, type TaskBillingInfo } from '@/lib/task/types'

const originalDeploymentEdition = process.env.DEPLOYMENT_EDITION
const originalBillingMode = process.env.BILLING_MODE

function mediaBillingInfo(params: {
  taskType: typeof TASK_TYPE.IMAGE_PANEL | typeof TASK_TYPE.VIDEO_PANEL
  apiType: 'image' | 'video'
  model: string
  maxFrozenCost: number
  unit: 'image' | 'video' | 'second'
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
    taskType: TASK_TYPE.EDIT_SCREENPLAY_GENERATE,
    apiType: 'text',
    model: 'text-model',
    quantity: 1000,
    unit: 'token',
    maxFrozenCost: 99,
    action: TASK_TYPE.EDIT_SCREENPLAY_GENERATE,
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
        taskType: TASK_TYPE.EDIT_SCREENPLAY_GENERATE,
        target: { targetType: 'ProjectEpisode', targetId: 'episode-1' },
        payload: { model: 'expensive-text-payload' },
        billingInfo: textBillingInfo(),
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
    expect(quote.taskCount).toBe(3)
    expect(quote.mediaTaskCount).toBe(2)
    expect(quote.totalMaxFrozenCost).toBe(9.75)
    expect(quote.items.map((item) => item.model)).toEqual([
      'planned-image-model',
      'planned-video-model',
    ])
  })

  it('hides credit amounts in self-hosted plan views while preserving task count', async () => {
    process.env.DEPLOYMENT_EDITION = 'self-hosted'
    process.env.BILLING_MODE = 'OFF'

    const view = await toOperationPlanView(buildPlan())

    expect(view.quote.showCredits).toBe(false)
    expect(view.quote.mediaTaskCount).toBe(2)
    expect(Object.prototype.hasOwnProperty.call(view.quote, 'totalMaxFrozenCost')).toBe(false)
    expect(view.quote.items.every((item) => !Object.prototype.hasOwnProperty.call(item, 'maxFrozenCost'))).toBe(true)
  })

  it('rejects commit when the planned media cost exceeds the confirmed maximum', async () => {
    await expect(assertOperationPlanConfirmedCost({
      plan: buildPlan(),
      confirmedMaxCost: 9.74,
    })).rejects.toMatchObject({
      code: 'CONFLICT',
      details: {
        code: 'OPERATION_QUOTE_EXCEEDED_CONFIRMED_MAX_COST',
        actual: 9.75,
        confirmedMaxCost: 9.74,
      },
    })
  })

  it('exposes plan and commit only for the migrated fixed-price media operations in this batch', () => {
    const registry = createProjectAgentOperationRegistryForApi()
    const mediaOperationIds = [
      'generate_edit_script_storyboard_images',
      'generate_storyboard_grid_images',
      'regenerate_panel_image',
      'panel_variant',
      'generate_panel_video',
      'generate_episode_videos',
      'generate_video_group',
      'generate_episode_video_groups',
      'generate_episode_videos_auto',
      'generate_asset_reference_video',
      'generate_episode_asset_reference_videos',
    ]

    for (const operationId of mediaOperationIds) {
      const operation = registry[operationId]
      expect(operation?.plan).toBeTypeOf('function')
      expect(operation?.commit).toBeTypeOf('function')
    }

    expect(registry.generate_edit_script_storyboard_spatial_blocking?.plan).toBeUndefined()
    expect(registry.generate_edit_script_storyboard?.plan).toBeUndefined()
  })
})
