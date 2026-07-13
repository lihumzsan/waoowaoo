import { describe, expect, it } from 'vitest'
import { buildPanelTaskErrorMap } from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/hooks/useStoryboardGroupTaskErrors'
import type { TaskItem } from '@/lib/query/hooks/useTaskStatus'

function failedPanelTask(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: 'task-failed-1',
    type: 'image_panel',
    targetType: 'NovelPromotionPanel',
    targetId: 'panel-1',
    status: 'failed',
    progress: 90,
    errorCode: 'INTERNAL_ERROR',
    errorMessage: 'PANEL_IMAGE_AUDIT_CONTENT_MISMATCH: Generated image does not match the current panel packet',
    error: {
      code: 'INTERNAL_ERROR',
      message: 'PANEL_IMAGE_AUDIT_CONTENT_MISMATCH: Generated image does not match the current panel packet',
      retryable: false,
      category: 'system',
      userMessageKey: 'errors.internal',
    },
    createdAt: '2026-06-11T13:04:28.583Z',
    updatedAt: '2026-06-11T13:16:35.849Z',
    ...overrides,
  }
}

describe('buildPanelTaskErrorMap', () => {
  it('hides failed panel image tasks that are older than the current panel image output', () => {
    const map = buildPanelTaskErrorMap(
      [failedPanelTask()],
      new Map([
        ['panel-1', {
          imageUrl: 'images/panel-candidate-panel-1.png',
          updatedAt: '2026-06-11T13:22:57.761Z',
        }],
      ]),
    )

    expect(map.has('panel-1')).toBe(false)
  })

  it('keeps failed panel image tasks when the panel has no newer image output', () => {
    const map = buildPanelTaskErrorMap(
      [failedPanelTask()],
      new Map([
        ['panel-1', {
          imageUrl: null,
          updatedAt: '2026-06-11T13:22:57.761Z',
        }],
      ]),
    )

    expect(map.get('panel-1')).toEqual(expect.objectContaining({
      taskId: 'task-failed-1',
    }))
  })
})
