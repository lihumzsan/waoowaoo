import { describe, expect, it } from 'vitest'
import {
  createProjectAgentExecutionSegment,
  projectAgentExecutionStartedIdempotencyKey,
} from '@/lib/project-agent/execution-segment'

describe('project agent execution segment identity', () => {
  it('gives each irreversible control command its own durable identity', () => {
    const userTurn = createProjectAgentExecutionSegment({ kind: 'user_turn', runId: 'run-1' })
    const approval = createProjectAgentExecutionSegment({
      kind: 'approval_response',
      interruptionId: 'interruption-1',
    })
    const choice = createProjectAgentExecutionSegment({
      kind: 'choice_response',
      interruptionId: 'interruption-2',
    })
    const followUp = createProjectAgentExecutionSegment({
      kind: 'task_follow_up',
      commandId: 'command-1',
    })

    expect([userTurn, approval, choice, followUp]).toEqual([
      { id: 'user-turn:run-1', controlKind: 'user_turn' },
      { id: 'decision:interruption-1', controlKind: 'approval_response' },
      { id: 'decision:interruption-2', controlKind: 'choice_response' },
      { id: 'wait-continuation:command-1', controlKind: 'task_follow_up' },
    ])
    expect(new Set([userTurn, approval, choice, followUp].map((segment) => (
      projectAgentExecutionStartedIdempotencyKey(segment.id)
    ))).size).toBe(4)
  })

  it('fails explicitly when a command identity is absent', () => {
    expect(() => createProjectAgentExecutionSegment({
      kind: 'choice_response',
      interruptionId: ' ',
    })).toThrow('PROJECT_AGENT_EXECUTION_SEGMENT_INTERRUPTION_ID_REQUIRED')
  })
})
