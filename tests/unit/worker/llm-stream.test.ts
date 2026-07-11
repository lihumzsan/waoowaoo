import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const reportTaskProgressMock = vi.hoisted(() => vi.fn(async () => undefined))
const reportTaskStreamChunkMock = vi.hoisted(() => vi.fn(async () => undefined))
const assertTaskActiveMock = vi.hoisted(() => vi.fn(async () => undefined))
const isTaskActiveMock = vi.hoisted(() => vi.fn(async () => true))

vi.mock('@/lib/workers/shared', () => ({
  reportTaskProgress: reportTaskProgressMock,
  reportTaskStreamChunk: reportTaskStreamChunkMock,
}))

vi.mock('@/lib/workers/utils', () => ({
  assertTaskActive: assertTaskActiveMock,
}))

vi.mock('@/lib/task/service', () => ({
  isTaskActive: isTaskActiveMock,
}))

import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from '@/lib/workers/handlers/llm-stream'

function buildJob(): Job<TaskJobData> {
  const data: TaskJobData = {
    taskId: 'task-1',
    type: TASK_TYPE.EDIT_BIBLE_GENERATE,
    locale: 'zh',
    projectId: 'project-1',
    userId: 'user-1',
    targetType: 'ProjectEpisode',
    targetId: 'episode-1',
    payload: {},
    trace: null,
  }
  return {
    data,
  } as unknown as Job<TaskJobData>
}

describe('createWorkerLLMStreamCallbacks', () => {
  beforeEach(() => {
    reportTaskProgressMock.mockReset()
    reportTaskStreamChunkMock.mockReset()
    assertTaskActiveMock.mockReset()
    isTaskActiveMock.mockReset()
    isTaskActiveMock.mockResolvedValue(true)
  })

  it('publishes final step output on onComplete for replay recovery', async () => {
    const job = buildJob()
    const context = createWorkerLLMStreamContext(job, 'story_to_script')
    const callbacks = createWorkerLLMStreamCallbacks(job, context)

    expect(callbacks.onStage).toBeTruthy()
    callbacks.onStage?.({
      stage: 'streaming',
      provider: 'ark',
      step: {
        id: 'bible_clip_1',
        attempt: 2,
        title: 'progress.streamStep.bibleConversion',
        index: 1,
        total: 1,
      },
    })
    expect(callbacks.onComplete).toBeTruthy()
    callbacks.onComplete?.('final bible text', {
      id: 'bible_clip_1',
      attempt: 2,
      title: 'progress.streamStep.bibleConversion',
      index: 1,
      total: 1,
    })
    await callbacks.flush()

    const finalProgressCall = reportTaskProgressMock.mock.calls.find((call) => {
      const payload = (call as unknown as [unknown, unknown, Record<string, unknown> | undefined])[2]
      return payload?.stage === 'worker_llm_complete'
    })

    expect(finalProgressCall).toBeDefined()
    const payload = (finalProgressCall as unknown as [unknown, unknown, Record<string, unknown>])[2]
    expect(payload.done).toBe(true)
    expect(payload.output).toBe('final bible text')
    expect(payload.stepId).toBe('bible_clip_1')
    expect(payload.stepAttempt).toBe(2)
    expect(payload.stepTitle).toBe('progress.streamStep.bibleConversion')
    expect(payload.stepIndex).toBe(1)
    expect(payload.stepTotal).toBe(1)
  })

  it('keeps completion payload bound to provided step under interleaved steps', async () => {
    const job = buildJob()
    const context = createWorkerLLMStreamContext(job, 'story_to_script')
    const callbacks = createWorkerLLMStreamCallbacks(job, context)

    expect(callbacks.onChunk).toBeTruthy()
    callbacks.onChunk?.({
      kind: 'text',
      delta: 'A-',
      seq: 1,
      lane: 'main',
      step: { id: 'step_characters', attempt: 1, title: 'A', index: 1, total: 2 },
    })
    callbacks.onChunk?.({
      kind: 'text',
      delta: 'B-',
      seq: 1,
      lane: 'main',
      step: { id: 'step_locations', attempt: 1, title: 'B', index: 2, total: 2 },
    })
    expect(callbacks.onComplete).toBeTruthy()
    callbacks.onComplete?.('characters-final', {
      id: 'step_characters',
      attempt: 1,
      title: 'A',
      index: 1,
      total: 2,
    })
    await callbacks.flush()

    const finalProgressCall = reportTaskProgressMock.mock.calls.find((call) => {
      const payload = (call as unknown as [unknown, unknown, Record<string, unknown> | undefined])[2]
      return payload?.stage === 'worker_llm_complete'
    })

    expect(finalProgressCall).toBeDefined()
    const payload = (finalProgressCall as unknown as [unknown, unknown, Record<string, unknown>])[2]
    expect(payload.stepId).toBe('step_characters')
    expect(payload.stepTitle).toBe('A')
    expect(payload.output).toBe('characters-final')
  })

  it('uses injected active controller for run-owned workflows', async () => {
    const job = buildJob()
    const context = createWorkerLLMStreamContext(job, 'story_to_script')
    const assertActive = vi.fn(async (_stage: string) => undefined)
    const isActive = vi.fn(async () => true)
    const callbacks = createWorkerLLMStreamCallbacks(job, context, {
      assertActive,
      isActive,
    })

    callbacks.onChunk?.({
      kind: 'text',
      delta: 'hello',
      seq: 1,
      lane: 'main',
      step: { id: 'edit_bible_generate', attempt: 1, title: 'split', index: 1, total: 1 },
    })
    await callbacks.flush()

    expect(assertActive).toHaveBeenCalledWith('worker_llm_stream')
    expect(assertTaskActiveMock).not.toHaveBeenCalled()
    expect(reportTaskStreamChunkMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        delta: 'hello',
        seq: 1,
      }),
      expect.objectContaining({
        stepId: 'edit_bible_generate',
        stepAttempt: 1,
        streamRunId: context.streamRunId,
      }),
    )
  })

  it('surfaces a queued stream persistence failure instead of silently dropping it', async () => {
    reportTaskProgressMock.mockRejectedValueOnce(new Error('STREAM_PROGRESS_DB_DOWN'))
    const job = buildJob()
    const callbacks = createWorkerLLMStreamCallbacks(
      job,
      createWorkerLLMStreamContext(job, 'failure-regression'),
    )

    callbacks.onStage?.({
      stage: 'streaming',
      provider: 'ark',
      step: { id: 'step-1', attempt: 1, title: 'Step', index: 1, total: 1 },
    })

    await expect(callbacks.flush()).rejects.toThrow('STREAM_PROGRESS_DB_DOWN')
  })
})
