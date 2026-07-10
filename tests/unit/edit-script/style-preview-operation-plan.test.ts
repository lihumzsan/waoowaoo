import { describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskBillingInfo } from '@/lib/task/types'

const prepareCandidatesMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/edit-script/service', () => ({
  prepareProjectEditStylePreviewCandidates: prepareCandidatesMock,
}))

import {
  planProjectEditStylePreviews,
  readEditStylePreviewPlanMetadata,
} from '@/lib/edit-script/style-preview-operation-plan'

describe('visual style exact operation plan', () => {
  it('carries the persisted candidate prompt, target, image model, and exact billing into approval', async () => {
    const billingInfo: TaskBillingInfo = {
      billable: true,
      source: 'task',
      taskType: TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
      apiType: 'image',
      model: 'image-model',
      quantity: 1,
      unit: 'image',
      maxFrozenCost: 1.25,
      action: TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
    }
    prepareCandidatesMock.mockResolvedValueOnce({
      bibleId: 'bible-1',
      candidates: [{
        preview: {
          id: 'style-preview-1',
          imagePrompt: 'exact persisted prompt',
        },
        imageModel: 'image-model',
        payload: {
          prompt: 'exact persisted prompt',
          model: 'image-model',
          count: 1,
        },
        billingInfo,
      }],
    })

    const plan = await planProjectEditStylePreviews({
      projectId: 'project-1',
      userId: 'user-1',
      episodeId: 'episode-1',
      locale: 'zh',
    })

    expect(plan.tasks).toEqual([expect.objectContaining({
      taskType: TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
      target: {
        targetType: 'ProjectEditStylePreview',
        targetId: 'style-preview-1',
      },
      payload: {
        prompt: 'exact persisted prompt',
        model: 'image-model',
        count: 1,
      },
      billingInfo,
    })])
    expect(readEditStylePreviewPlanMetadata(plan)).toEqual({
      bibleId: 'bible-1',
      stylePreviewIds: ['style-preview-1'],
      imageModel: 'image-model',
      count: 1,
    })
  })
})
