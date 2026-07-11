import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { TASK_TYPE } from '@/lib/task/types'
import type { Task } from '@prisma/client'

const prepareTaskSubmissionInputMock = vi.hoisted(() => vi.fn(async (params: Record<string, unknown>) => ({
  input: {
    ...params,
    operationSource: params.operationSource,
    operationRequestId: params.operationRequestId,
    billingInfo: params.billingInfo ?? null,
  },
  billingMode: 'OFF',
})))
vi.mock('@/lib/task/submitter', () => ({
  prepareTaskSubmissionInput: prepareTaskSubmissionInputMock,
}))

const txMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(async () => [{ status: 'running', runVersion: 2, eventSeq: BigInt(8) }]),
}))
const persistSubmittedTaskBatchInTransactionMock = vi.hoisted(() => vi.fn(async (params: {
  onBatchCreatedInTransaction?: (tx: typeof txMock, tasks: Array<{ task: Task; deduped: boolean }>) => Promise<void>
}) => {
  const task = { id: 'task-1', status: 'queued', billingInfo: null } as Task
  const tasks = [{ task, deduped: false }]
  await params.onBatchCreatedInTransaction?.(txMock, tasks)
  return tasks
}))
vi.mock('@/lib/task/transactional-create', () => ({
  persistSubmittedTaskBatchInTransaction: persistSubmittedTaskBatchInTransactionMock,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(async (work: (tx: typeof txMock) => Promise<unknown>) => await work(txMock)),
  },
}))
vi.mock('@/lib/billing/task-billing-view', () => ({
  buildBillingReceiptView: vi.fn(async () => null),
}))

const getRequestIdMock = vi.hoisted(() => vi.fn(() => 'req-1'))
vi.mock('@/lib/api-errors', () => ({
  getRequestId: getRequestIdMock,
  ApiError: class ApiError extends Error {},
}))

const resolveRequiredTaskLocaleMock = vi.hoisted(() => vi.fn(() => 'en'))
vi.mock('@/lib/task/resolve-locale', () => ({
  resolveRequiredTaskLocale: resolveRequiredTaskLocaleMock,
}))

const billingMock = vi.hoisted(() => ({
  isBillableTaskType: vi.fn(() => true),
  buildDefaultTaskBillingInfo: vi.fn(() => ({ billable: false, source: 'task', status: 'skipped' })),
  InsufficientBalanceError: class InsufficientBalanceError extends Error {},
}))
vi.mock('@/lib/billing', () => billingMock)

import { submitOperationTask } from '@/lib/operations/submit-operation-task'
import { runWithProjectAgentOperationExecutionFence } from '@/lib/project-agent/operation-execution-fence'

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
      payload,
      dedupeKey: 'music:project-1',
      priority: 7,
      locale: 'zh',
      billingInfo,
      decoratePayload: false,
    })

    expect(prepareTaskSubmissionInputMock).toHaveBeenCalledWith({
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
      payload: { prompt: 'wide shot', meta: { source: 'panel' } },
    })

    expect(prepareTaskSubmissionInputMock).toHaveBeenCalledWith(expect.objectContaining({
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
      operationRequestId: 'req-1',
    }))
    expect(resolveRequiredTaskLocaleMock).toHaveBeenCalledWith(expect.anything(), { prompt: 'wide shot', meta: { source: 'panel' } })
    expect(billingMock.buildDefaultTaskBillingInfo).toHaveBeenCalledWith(TASK_TYPE.IMAGE_PANEL, { prompt: 'wide shot', meta: { source: 'panel' } })
  })

  it('rejects Task creation when ownership is lost inside the Task transaction', async () => {
    const controller = new AbortController()
    await expect(runWithProjectAgentOperationExecutionFence({
      runFence: { runId: 'run-1', runVersion: 2, eventSeq: '8' },
      signal: controller.signal,
    }, async () => await submitOperationTask({
      request: buildRequest(),
      userId: 'user-1',
      projectId: 'project-1',
      type: TASK_TYPE.EDIT_SCRIPT_GENERATE,
      targetType: 'ProjectEditChapter',
      targetId: 'chapter-1',
      operationId: 'generate_edit_script',
      source: 'assistant-panel',
      payload: {},
      onTaskCreatedInTransaction: async () => {
        controller.abort(new Error('RUN_LOCK_LOST'))
      },
    }))).rejects.toThrow('PROJECT_AGENT_OPERATION_EXECUTION_FENCE_REJECTED runId=run-1 reason=aborted')
  })
})
