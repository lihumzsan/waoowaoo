import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import {
  collectAssistantAsyncTaskSubmissions,
  createTaskBatchSubmittedDataFromOperationPayload,
  createTaskSubmittedDataFromOperationPayload,
  findLatestAssistantExternalTaskWait,
  resolveAssistantAsyncTaskTerminalEvent,
} from '@/features/project-workspace/components/workspace-assistant/async-task-follow-up'
import { TASK_EVENT_TYPE, TASK_SSE_EVENT_TYPE, TASK_TYPE, type SSEEvent } from '@/lib/task/types'

function assistantMessage(parts: UIMessage['parts']): UIMessage {
  return {
    id: 'message-1',
    role: 'assistant',
    parts,
  }
}

describe('workspace assistant async task follow-up', () => {
  it('collects single and batch task submissions from assistant messages', () => {
    const singlePart = {
      type: 'data-task-submitted',
      data: {
        operationId: 'generate_edit_script',
        taskId: 'task-1',
        status: 'queued',
        projectId: 'project-1',
      },
    } as unknown as UIMessage['parts'][number]
    const batchPart = {
      type: 'data-task-batch-submitted',
      data: {
        operationId: 'generate_videos',
        total: 2,
        taskIds: ['task-2', 'task-3'],
      },
    } as unknown as UIMessage['parts'][number]

    const submissions = collectAssistantAsyncTaskSubmissions([
      assistantMessage([{ type: 'text', text: 'submitted' }, singlePart, batchPart]),
    ])

    expect(submissions.get('task-1')).toMatchObject({
      kind: 'single',
      operationId: 'generate_edit_script',
      taskId: 'task-1',
    })
    expect(submissions.get('task-2')).toMatchObject({
      kind: 'batch',
      operationId: 'generate_videos',
      taskId: 'task-2',
      batchKey: 'generate_videos:task-2,task-3',
    })
    expect(submissions.get('task-3')).toMatchObject({
      kind: 'batch',
      operationId: 'generate_videos',
      taskId: 'task-3',
    })
  })

  it('finds the latest external task wait stop from persisted assistant messages', () => {
    const wait = findLatestAssistantExternalTaskWait([
      assistantMessage([{
        type: 'data-agent-stop',
        data: {
          reason: 'awaiting_external_task',
          operationIds: ['generate_edit_script'],
          taskIds: ['task-1'],
          phases: [],
        },
      } as unknown as UIMessage['parts'][number]]),
      {
        id: 'message-2',
        role: 'assistant',
        parts: [{
          type: 'data-agent-stop',
          data: {
            reason: 'awaiting_external_task',
            operationIds: ['generate_edit_director_decoupage'],
            taskIds: ['task-2'],
            phases: ['processing'],
          },
        } as unknown as UIMessage['parts'][number]],
      },
    ])

    expect(wait).toEqual({
      operationId: 'generate_edit_director_decoupage',
      taskIds: ['task-2'],
    })
  })

  it('creates edit-script task submission data from confirmed operation payload', () => {
    const data = createTaskSubmittedDataFromOperationPayload({
      operationId: 'generate_edit_script',
      projectId: 'project-1',
      episodeId: 'episode-1',
      payload: {
        success: true,
        operationId: 'generate_edit_script',
        result: {
          success: true,
          async: true,
          taskId: 'task-1',
          status: 'queued',
          runId: null,
          deduped: false,
          episodeId: 'episode-1',
        },
      },
    })

    expect(data).toEqual({
      operationId: 'generate_edit_script',
      taskId: 'task-1',
      status: 'queued',
      runId: null,
      deduped: false,
      projectId: 'project-1',
      episodeId: 'episode-1',
      taskType: TASK_TYPE.EDIT_SCRIPT_GENERATE,
      targetType: 'ProjectEpisode',
      targetId: 'episode-1',
    })
  })

  it('creates batch task submission data from confirmed operation payload', () => {
    const data = createTaskBatchSubmittedDataFromOperationPayload({
      operationId: 'generate_all_videos',
      payload: {
        result: {
          success: true,
          async: true,
          total: 2,
          taskIds: ['task-1', 'task-2'],
          results: [
            { refId: 'shot-1', taskId: 'task-1' },
            { refId: 'shot-2', taskId: 'task-2' },
          ],
          mutationBatchId: 'batch-1',
        },
      },
    })

    expect(data).toEqual({
      operationId: 'generate_all_videos',
      total: 2,
      taskIds: ['task-1', 'task-2'],
      results: [
        { refId: 'shot-1', taskId: 'task-1' },
        { refId: 'shot-2', taskId: 'task-2' },
      ],
      mutationBatchId: 'batch-1',
    })
  })

  it('resolves only terminal lifecycle task events', () => {
    const processingEvent: SSEEvent = {
      id: 'event-1',
      type: TASK_SSE_EVENT_TYPE.LIFECYCLE,
      taskId: 'task-1',
      projectId: 'project-1',
      userId: 'user-1',
      ts: '2026-05-15T00:00:00.000Z',
      payload: {
        lifecycleType: TASK_EVENT_TYPE.PROCESSING,
      },
    }
    const completedEvent: SSEEvent = {
      ...processingEvent,
      id: 'event-2',
      payload: {
        lifecycleType: TASK_EVENT_TYPE.COMPLETED,
      },
    }

    expect(resolveAssistantAsyncTaskTerminalEvent(processingEvent)).toBeNull()
    expect(resolveAssistantAsyncTaskTerminalEvent(completedEvent)).toEqual({
      taskId: 'task-1',
      lifecycleType: TASK_EVENT_TYPE.COMPLETED,
    })
  })
})
