import { describe, expect, it } from 'vitest'
import { resolveWorkspaceAssistantSubagents } from '@/features/project-workspace/components/workspace-assistant/workspace-assistant-subagents'
import {
  reduceWorkspaceAssistantSubagentReasoningStream,
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
      stream: { kind: 'reasoning', lane: 'reasoning', seq, delta },
    },
  }
}

describe('Workspace Subagent reasoning stream', () => {
  it('merges ordered Task SSE deltas into the Task-owned durable trace', () => {
    const first = reduceWorkspaceAssistantSubagentReasoningStream(new Map(), streamEvent(1, 'Live '))
    expect(first.kind).toBe('updated')
    const second = reduceWorkspaceAssistantSubagentReasoningStream(first.streams, streamEvent(2, 'reasoning'))
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
      reasoningStreams: second.streams,
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
    const first = reduceWorkspaceAssistantSubagentReasoningStream(new Map(), streamEvent(1, 'one'))
    const gap = reduceWorkspaceAssistantSubagentReasoningStream(first.streams, streamEvent(3, 'three'))
    expect(gap.kind).toBe('gap')
    expect(gap.streams.size).toBe(0)

    const afterGap = reduceWorkspaceAssistantSubagentReasoningStream(
      gap.streams,
      streamEvent(4, 'four'),
      { invalidatedStreamIdentities: new Set(['task-1|stream-1|1:reasoning:1:block']) },
    )
    expect(afterGap.kind).toBe('unchanged')
    expect(afterGap.streams.size).toBe(0)

    const nextReasoning = reduceWorkspaceAssistantSubagentReasoningStream(
      afterGap.streams,
      streamEvent(1, 'new reasoning', null, '2:reasoning:1:block'),
      { invalidatedStreamIdentities: new Set(['task-1|stream-1|1:reasoning:1:block']) },
    )
    expect(nextReasoning.kind).toBe('updated')
    expect([...nextReasoning.streams.values()][0]?.text).toBe('new reasoning')
  })

  it('uses the Session Subagent task identity instead of the Task output episode', () => {
    const projectScoped = reduceWorkspaceAssistantSubagentReasoningStream(
      new Map(),
      streamEvent(1, 'project scoped', null),
      { ownedTaskIds: new Set(['task-1']) },
    )
    expect(projectScoped.kind).toBe('updated')

    const foreignSameEpisode = reduceWorkspaceAssistantSubagentReasoningStream(
      new Map(),
      streamEvent(1, 'foreign', 'episode-1'),
      { ownedTaskIds: new Set(['task-other']) },
    )
    expect(foreignSameEpisode.kind).toBe('unknown_task')
    expect(foreignSameEpisode.streams.size).toBe(0)
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
