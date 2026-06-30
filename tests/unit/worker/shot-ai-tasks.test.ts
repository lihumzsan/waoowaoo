import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const handlersMock = vi.hoisted(() => ({
  handleModifyAppearanceTask: vi.fn(),
  handleModifyLocationTask: vi.fn(),
  handleModifyPropTask: vi.fn(),
}))

vi.mock('@/lib/workers/handlers/shot-ai-prompt', () => ({
  handleModifyAppearanceTask: handlersMock.handleModifyAppearanceTask,
  handleModifyLocationTask: handlersMock.handleModifyLocationTask,
  handleModifyPropTask: handlersMock.handleModifyPropTask,
}))

import { handleShotAITask } from '@/lib/workers/handlers/shot-ai-tasks'

function buildJob(type: TaskJobData['type'], payload: Record<string, unknown>): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-1',
      type,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'ProjectPanel',
      targetId: 'panel-1',
      payload,
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker shot-ai-tasks behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    handlersMock.handleModifyAppearanceTask.mockResolvedValue({ type: 'appearance' })
    handlersMock.handleModifyLocationTask.mockResolvedValue({ type: 'location' })
    handlersMock.handleModifyPropTask.mockResolvedValue({ type: 'prop' })
  })

  it('AI_MODIFY_APPEARANCE -> routes to appearance handler with payload', async () => {
    const payload = { characterId: 'char-1', appearanceId: 'app-1' }
    const job = buildJob(TASK_TYPE.AI_MODIFY_APPEARANCE, payload)

    const result = await handleShotAITask(job)

    expect(result).toEqual({ type: 'appearance' })
    expect(handlersMock.handleModifyAppearanceTask).toHaveBeenCalledWith(job, payload)
  })

  it('AI_MODIFY_LOCATION and AI_MODIFY_PROP route correctly', async () => {
    const locationPayload = { locationId: 'loc-1' }
    const locationJob = buildJob(TASK_TYPE.AI_MODIFY_LOCATION, locationPayload)
    await handleShotAITask(locationJob)
    expect(handlersMock.handleModifyLocationTask).toHaveBeenCalledWith(locationJob, locationPayload)

    const propPayload = { propId: 'prop-1' }
    const propJob = buildJob(TASK_TYPE.AI_MODIFY_PROP, propPayload)
    await handleShotAITask(propJob)
    expect(handlersMock.handleModifyPropTask).toHaveBeenCalledWith(propJob, propPayload)
  })

  it('unsupported type -> throws explicit error', async () => {
    const job = buildJob(TASK_TYPE.IMAGE_CHARACTER, {})
    await expect(handleShotAITask(job)).rejects.toThrow('Unsupported shot AI task type')
  })
})
