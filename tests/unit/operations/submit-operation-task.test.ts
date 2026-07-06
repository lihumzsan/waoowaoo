import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { TASK_TYPE } from '@/lib/task/types'

const submitTaskMock = vi.hoisted(() => vi.fn(async () => ({
  success: true,
  taskId: 'task-1',
  async: true,
  status: 'queued',
  runId: null,
  deduped: false,
})))
vi.mock('@/lib/task/submitter', () => ({
  submitTask: submitTaskMock,
}))

const getRequestIdMock = vi.hoisted(() => vi.fn(() => 'req-1'))
vi.mock('@/lib/api-errors', () => ({
  getRequestId: getRequestIdMock,
}))

const resolveRequiredTaskLocaleMock = vi.hoisted(() => vi.fn(() => 'en'))
vi.mock('@/lib/task/resolve-locale', () => ({
  resolveRequiredTaskLocale: resolveRequiredTaskLocaleMock,
}))

const billingMock = vi.hoisted(() => ({
  isBillableTaskType: vi.fn(() => true),
  buildDefaultTaskBillingInfo: vi.fn(() => ({ billable: false, source: 'task', status: 'skipped' })),
}))
vi.mock('@/lib/billing', () => billingMock)

import { submitOperationTask } from '@/lib/operations/submit-operation-task'

function buildRequest(): NextRequest {
  return new Request('http://localhost') as unknown as NextRequest
}

describe('submitOperationTask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('writes operation metadata and preserves explicit task submission controls', async () => {
    const billingInfo = { billable: false, source: 'task', status: 'skipped' } as const
    const payload = { prompt: 'theme', meta: { source: 'test' } }

    await submitOperationTask({
      request: buildRequest(),
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: 'episode-1',
      type: TASK_TYPE.MUSIC_GENERATE,
      targetType: 'Project',
      targetId: 'project-1',
      operationId: 'generate_project_music',
      source: 'assistant-confirmation',
      confirmed: true,
      payload,
      dedupeKey: 'music:project-1',
      priority: 7,
      locale: 'zh',
      billingInfo,
      decoratePayload: false,
    })

    expect(submitTaskMock).toHaveBeenCalledWith({
      userId: 'user-1',
      locale: 'zh',
      requestId: 'req-1',
      projectId: 'project-1',
      parentTaskId: null,
      episodeId: 'episode-1',
      type: TASK_TYPE.MUSIC_GENERATE,
      targetType: 'Project',
      targetId: 'project-1',
      payload,
      dedupeKey: 'music:project-1',
      batchKey: null,
      priority: 7,
      billingInfo,
      billingInfoSource: undefined,
      operationId: 'generate_project_music',
      operationSource: 'assistant-confirmation',
      operationConfirmed: true,
      operationRequestId: 'req-1',
    })
    expect(resolveRequiredTaskLocaleMock).not.toHaveBeenCalled()
    expect(billingMock.buildDefaultTaskBillingInfo).not.toHaveBeenCalled()
  })

  it('decorates payload and derives billing only when callers do not provide explicit values', async () => {
    await submitOperationTask({
      request: buildRequest(),
      userId: 'user-1',
      projectId: 'project-1',
      type: TASK_TYPE.IMAGE_PANEL,
      targetType: 'ProjectPanel',
      targetId: 'panel-1',
      operationId: 'regenerate_panel_image',
      source: 'assistant-tool',
      confirmed: false,
      payload: { prompt: 'wide shot', meta: { source: 'panel' } },
    })

    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      locale: 'en',
      episodeId: null,
      payload: {
        prompt: 'wide shot',
        sync: 1,
        meta: {
          source: 'panel',
          locale: 'en',
        },
      },
      dedupeKey: null,
      priority: 0,
      billingInfo: { billable: false, source: 'task', status: 'skipped' },
      operationId: 'regenerate_panel_image',
      operationSource: 'assistant-tool',
      operationConfirmed: false,
      operationRequestId: 'req-1',
    }))
    expect(resolveRequiredTaskLocaleMock).toHaveBeenCalledWith(expect.anything(), { prompt: 'wide shot', meta: { source: 'panel' } })
    expect(billingMock.buildDefaultTaskBillingInfo).toHaveBeenCalledWith(TASK_TYPE.IMAGE_PANEL, { prompt: 'wide shot', meta: { source: 'panel' } })
  })
})
