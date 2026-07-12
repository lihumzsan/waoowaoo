import { describe, expect, it } from 'vitest'
import {
  assertProjectAgentRunTransition,
  canTransitionProjectAgentRun,
  isProjectAgentRunTerminalStatus,
  normalizeProjectAgentRunStatus,
} from '@/lib/project-agent/run-state-machine'
import type { ProjectAgentRunStatus } from '@/lib/project-agent/runs'

const terminalStatuses: ProjectAgentRunStatus[] = ['completed', 'failed', 'cancelled']

describe('project agent run state machine', () => {
  it('normalizes every declared status without aliases', () => {
    const statuses: ProjectAgentRunStatus[] = [
      'running',
      'awaiting_approval',
      'awaiting_choice',
      'awaiting_task',
      'completed',
      'failed',
      'cancelled',
    ]
    for (const status of statuses) expect(normalizeProjectAgentRunStatus(status)).toBe(status)
  })

  it('allows only the declared seven-state lifecycle edges', () => {
    expect(canTransitionProjectAgentRun({ from: 'running', to: 'awaiting_approval' })).toBe(true)
    expect(canTransitionProjectAgentRun({ from: 'running', to: 'awaiting_choice' })).toBe(true)
    expect(canTransitionProjectAgentRun({ from: 'running', to: 'awaiting_task' })).toBe(true)
    expect(canTransitionProjectAgentRun({ from: 'awaiting_approval', to: 'running' })).toBe(true)
    expect(canTransitionProjectAgentRun({ from: 'awaiting_choice', to: 'running' })).toBe(true)
    expect(canTransitionProjectAgentRun({ from: 'awaiting_task', to: 'running' })).toBe(true)
    expect(canTransitionProjectAgentRun({ from: 'awaiting_task', to: 'awaiting_choice' })).toBe(true)
    expect(canTransitionProjectAgentRun({ from: 'awaiting_approval', to: 'completed' })).toBe(false)
    expect(canTransitionProjectAgentRun({ from: 'awaiting_choice', to: 'failed' })).toBe(false)
  })

  it('makes every terminal status monotonic', () => {
    expect(isProjectAgentRunTerminalStatus('running')).toBe(false)
    expect(isProjectAgentRunTerminalStatus('awaiting_approval')).toBe(false)
    expect(isProjectAgentRunTerminalStatus('awaiting_choice')).toBe(false)
    expect(isProjectAgentRunTerminalStatus('awaiting_task')).toBe(false)
    for (const terminal of terminalStatuses) {
      expect(isProjectAgentRunTerminalStatus(terminal)).toBe(true)
      expect(canTransitionProjectAgentRun({ from: terminal, to: terminal })).toBe(false)
      expect(canTransitionProjectAgentRun({ from: terminal, to: 'running' })).toBe(false)
      expect(canTransitionProjectAgentRun({ from: terminal, to: 'awaiting_task' })).toBe(false)
    }
  })

  it('requires the caller expected-state fence when one is provided', () => {
    expect(canTransitionProjectAgentRun({
      from: 'awaiting_choice',
      to: 'running',
      expectedStatuses: ['awaiting_choice'],
    })).toBe(true)
    expect(canTransitionProjectAgentRun({
      from: 'awaiting_approval',
      to: 'running',
      expectedStatuses: ['awaiting_choice'],
    })).toBe(false)
    expect(() => normalizeProjectAgentRunStatus('queued')).toThrow('PROJECT_AGENT_RUN_STATUS_INVALID:queued')
  })

  it('asserts invalid edges with the complete transition identity', () => {
    expect(() => assertProjectAgentRunTransition({
      runId: 'run-allowed',
      from: 'awaiting_task',
      to: 'running',
    })).not.toThrow()
    expect(() => assertProjectAgentRunTransition({
      runId: 'run-rejected',
      from: 'awaiting_approval',
      to: 'completed',
    })).toThrow('PROJECT_AGENT_RUN_TRANSITION_INVALID runId=run-rejected from=awaiting_approval to=completed')
  })
})
