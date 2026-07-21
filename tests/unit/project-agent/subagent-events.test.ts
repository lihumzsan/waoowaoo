import { describe, expect, it } from 'vitest'
import {
  parseProjectAgentSubagentEventPartData,
  resolveProjectAgentSubagentViews,
} from '@/lib/project-agent/subagent-events'

const identity = {
  subagentId: 'task-1',
  taskId: 'task-1',
  runId: 'run-1',
  toolCallId: 'delegate-call-1',
}

function eventPart(sequence: number, event: unknown) {
  return parseProjectAgentSubagentEventPartData({
    ...identity,
    sequence,
    occurredAt: `2026-07-21T00:00:0${String(sequence)}.000Z`,
    event,
  })
}

describe('Creative Subagent execution projection', () => {
  it('preserves visible reasoning and the bounded read_skill result under Task-owned status', () => {
    const events = [
      eventPart(1, {
        kind: 'started',
        outputKind: 'style_bible',
        goal: 'Design a paper-cut visual system',
      }),
      eventPart(2, {
        kind: 'reasoning',
        reasoningId: '1:1:reasoning-1',
        text: 'I will first inspect the style-development skill.',
        status: 'completed',
        truncated: false,
      }),
      eventPart(3, {
        kind: 'tool_completed',
        toolCallId: '1:call-1',
        toolName: 'read_skill',
        skillId: 'style-development',
        trace: {
          ordinal: 2,
          source: 'tool',
          skillId: 'style-development',
          version: '2026-07-20',
          uri: 'skill://style-development/SKILL.md',
          checksum: 'sha256:style',
          contentChars: 2048,
        },
      }),
    ]

    const [view] = resolveProjectAgentSubagentViews(events, [{
      taskId: 'task-1',
      status: 'completed',
      summary: 'A finalized paper-cut Style Bible.',
      errorCode: null,
      finishedAt: '2026-07-21T00:01:00.000Z',
    }])

    expect(view).toMatchObject({
      subagentId: 'task-1',
      status: 'completed',
      summary: 'A finalized paper-cut Style Bible.',
    })
    expect(view?.events.map((entry) => entry.event.kind)).toEqual([
      'started',
      'reasoning',
      'tool_completed',
    ])
    expect(view?.skillReads).toEqual([
      expect.objectContaining({
        skillId: 'style-development',
        contentChars: 2048,
      }),
    ])
  })
})
