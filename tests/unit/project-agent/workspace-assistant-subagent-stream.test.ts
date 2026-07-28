import { describe, expect, it } from 'vitest'
import {
  resolveWorkspaceAssistantSubagents,
  resolveWorkspaceAssistantSubagentStructuredOutputs,
} from '@/features/project-workspace/components/workspace-assistant/workspace-assistant-subagents'
import {
  reduceWorkspaceAssistantSubagentLiveStream,
  resolveWorkspaceAssistantSubagentTaskEventDisposition,
} from '@/features/project-workspace/components/workspace-assistant/workspace-assistant-subagent-stream'
import type { ProjectAgentSubagentView } from '@/lib/project-agent/subagent-events'
import { TASK_SSE_EVENT_TYPE, TASK_TYPE, type TaskSSEEvent } from '@/lib/task/types'

function streamEvent(
  seq: number,
  delta: string,
  episodeId: string | null = null,
  reasoningId = '1:reasoning:1:block',
): TaskSSEEvent {
  return {
    id: `event-${String(seq)}`,
    type: TASK_SSE_EVENT_TYPE.STREAM,
    taskId: 'task-1',
    projectId: 'project-1',
    userId: 'user-1',
    ts: '2026-07-22T00:00:00.000Z',
    taskType: TASK_TYPE.CREATIVE_WORK,
    episodeId,
    payload: {
      streamRunId: 'stream-1',
      stepId: reasoningId,
      stepAttempt: 1,
      stream: { kind: 'reasoning', lane: 'reasoning', seq, delta },
    },
  }
}

describe('Workspace Subagent reasoning stream', () => {
  it('merges ordered Task SSE deltas into the Task-owned durable trace', () => {
    const first = reduceWorkspaceAssistantSubagentLiveStream(new Map(), streamEvent(1, 'Live '))
    expect(first.kind).toBe('updated')
    const second = reduceWorkspaceAssistantSubagentLiveStream(first.streams, streamEvent(2, 'reasoning'))
    const subagent: ProjectAgentSubagentView = {
      subagentId: 'task-1',
      taskId: 'task-1',
      runId: 'run-1',
      toolCallId: 'call-1',
      outputKind: 'creative_direction',
      goal: 'Design a style',
      status: 'running',
      summary: null,
      errorCode: null,
      finishedAt: null,
      skillReads: [],
      events: [{
        subagentId: 'task-1',
        taskId: 'task-1',
        runId: 'run-1',
        toolCallId: 'call-1',
        sequence: 1,
        occurredAt: '2026-07-22T00:00:00.000Z',
        event: { kind: 'started', outputKind: 'creative_direction', goal: 'Design a style' },
      }],
    }
    const resolved = resolveWorkspaceAssistantSubagents({
      sessionSubagents: [subagent],
      liveStreams: second.streams,
    })
    expect(resolved[0]?.events[1]?.event).toEqual({
      kind: 'reasoning',
      reasoningId: '1:reasoning:1:block',
      text: 'Live reasoning',
      status: 'running',
      truncated: false,
    })
  })

  it('fails recovery when the Task stream has a sequence gap', () => {
    const first = reduceWorkspaceAssistantSubagentLiveStream(new Map(), streamEvent(1, 'one'))
    const gap = reduceWorkspaceAssistantSubagentLiveStream(first.streams, streamEvent(3, 'three'))
    expect(gap.kind).toBe('gap')
    expect(gap.streams.size).toBe(0)

    const afterGap = reduceWorkspaceAssistantSubagentLiveStream(
      gap.streams,
      streamEvent(4, 'four'),
      { invalidatedStreamIdentities: new Set(['task-1|stream-1|reasoning|1:reasoning:1:block']) },
    )
    expect(afterGap.kind).toBe('unchanged')
    expect(afterGap.streams.size).toBe(0)

    const nextReasoning = reduceWorkspaceAssistantSubagentLiveStream(
      afterGap.streams,
      streamEvent(1, 'new reasoning', null, '2:reasoning:1:block'),
      { invalidatedStreamIdentities: new Set(['task-1|stream-1|reasoning|1:reasoning:1:block']) },
    )
    expect(nextReasoning.kind).toBe('updated')
    expect([...nextReasoning.streams.values()][0]?.text).toBe('new reasoning')
  })

  it('uses the Session Subagent task identity instead of the Task output episode', () => {
    const projectScoped = reduceWorkspaceAssistantSubagentLiveStream(
      new Map(),
      streamEvent(1, 'project scoped', null),
      { ownedTaskIds: new Set(['task-1']) },
    )
    expect(projectScoped.kind).toBe('updated')

    const foreignSameEpisode = reduceWorkspaceAssistantSubagentLiveStream(
      new Map(),
      streamEvent(1, 'foreign', 'episode-1'),
      { ownedTaskIds: new Set(['task-other']) },
    )
    expect(foreignSameEpisode.kind).toBe('unknown_task')
    expect(foreignSameEpisode.streams.size).toBe(0)
  })

  it('streams whitespace-preserving partial JSON without treating it as a durable result', () => {
    const first = reduceWorkspaceAssistantSubagentLiveStream(new Map(), {
      ...streamEvent(1, '{'),
      payload: {
        streamRunId: 'stream-output-1',
        stepId: '1:structured-output',
        stepAttempt: 1,
        stream: {
          kind: 'text',
          lane: 'structured-output',
          seq: 1,
          delta: '{',
        },
      },
    })
    const second = reduceWorkspaceAssistantSubagentLiveStream(first.streams, {
      ...streamEvent(2, '\n  "kind": "screenplay"'),
      payload: {
        streamRunId: 'stream-output-1',
        stepId: '1:structured-output',
        stepAttempt: 1,
        stream: {
          kind: 'text',
          lane: 'structured-output',
          seq: 2,
          delta: '\n  "kind": "screenplay"',
        },
      },
    })

    expect(resolveWorkspaceAssistantSubagentStructuredOutputs(second.streams))
      .toEqual(new Map([['task-1', '{\n  "kind": "screenplay"']]))
  })

  it('requests ownership confirmation only once for an unknown Task', () => {
    expect(resolveWorkspaceAssistantSubagentTaskEventDisposition({
      ownedTaskIds: new Set(),
      ownershipRequestedTaskIds: new Set(),
      taskId: 'task-1',
    })).toBe('confirm')
    expect(resolveWorkspaceAssistantSubagentTaskEventDisposition({
      ownedTaskIds: new Set(),
      ownershipRequestedTaskIds: new Set(['task-1']),
      taskId: 'task-1',
    })).toBe('ignore')
    expect(resolveWorkspaceAssistantSubagentTaskEventDisposition({
      ownedTaskIds: new Set(['task-1']),
      ownershipRequestedTaskIds: new Set(['task-1']),
      taskId: 'task-1',
    })).toBe('accept')
  })
})

describe('Workspace Subagent live-stream robustness', () => {
  function subagentWith(events: ProjectAgentSubagentView['events']): ProjectAgentSubagentView {
    return {
      subagentId: 'task-1',
      taskId: 'task-1',
      runId: 'run-1',
      toolCallId: 'call-1',
      outputKind: 'creative_direction',
      goal: 'Design a style',
      status: 'running',
      summary: null,
      errorCode: null,
      finishedAt: null,
      skillReads: [],
      events,
    }
  }

  it('keeps live reasoning when the publisher omits stepAttempt', () => {
    // 发布端对 stepAttempt 是条件展开;缺失时 reasoning 不得被整条静默丢弃。
    const event = streamEvent(1, 'Live without attempt')
    const payload = event.payload as { stepAttempt?: number }
    delete payload.stepAttempt
    const result = reduceWorkspaceAssistantSubagentLiveStream(new Map(), event)
    expect(result.kind).toBe('updated')
    expect([...result.streams.values()][0]?.text).toBe('Live without attempt')
  })

  it('does not resurrect a completed reasoning event back to running', () => {
    const first = reduceWorkspaceAssistantSubagentLiveStream(new Map(), streamEvent(1, 'Live '))
    const subagent = subagentWith([
      {
        subagentId: 'task-1',
        taskId: 'task-1',
        runId: 'run-1',
        toolCallId: 'call-1',
        sequence: 1,
        occurredAt: '2026-07-22T00:00:00.000Z',
        event: { kind: 'started', outputKind: 'creative_direction', goal: 'Design a style' },
      },
      {
        subagentId: 'task-1',
        taskId: 'task-1',
        runId: 'run-1',
        toolCallId: 'call-1',
        sequence: 2,
        occurredAt: '2026-07-22T00:00:01.000Z',
        event: {
          kind: 'reasoning',
          reasoningId: '1:reasoning:1:block',
          text: 'Live reasoning finished',
          status: 'completed',
          truncated: false,
        },
      },
    ])
    const resolved = resolveWorkspaceAssistantSubagents({
      sessionSubagents: [subagent],
      liveStreams: first.streams,
    })
    const reasoning = resolved[0]?.events[1]?.event
    expect(reasoning?.kind).toBe('reasoning')
    if (reasoning?.kind === 'reasoning') {
      expect(reasoning.status).toBe('completed')
      expect(reasoning.text).toBe('Live reasoning finished')
    }
  })
})
