import { describe, expect, it } from 'vitest'
import type { ProjectAgentSubagentEventPartData } from '@/lib/project-agent/subagent-events'
import { resolveWorkspaceAssistantSubagentEventGlyph } from '@/features/project-workspace/components/workspace-assistant/workspace-assistant-panel-state'

function eventPart(
  event: ProjectAgentSubagentEventPartData['event'],
): ProjectAgentSubagentEventPartData {
  return {
    subagentId: 'task-1',
    taskId: 'task-1',
    runId: 'run-1',
    toolCallId: 'call-1',
    sequence: 2,
    occurredAt: '2026-07-28T00:00:00.000Z',
    event,
  }
}

describe('Workspace Subagent event glyphs', () => {
  it('does not turn an earlier running reasoning snapshot into a failure', () => {
    expect(resolveWorkspaceAssistantSubagentEventGlyph({
      part: eventPart({
        kind: 'reasoning',
        reasoningId: 'reasoning-1',
        text: 'Still reasoning',
        status: 'running',
        truncated: false,
      }),
      subagentStatus: 'running',
      isLast: false,
    })).toBe('none')
  })

  it('uses a loader only for the currently open tail event', () => {
    expect(resolveWorkspaceAssistantSubagentEventGlyph({
      part: eventPart({
        kind: 'reasoning',
        reasoningId: 'reasoning-1',
        text: 'Still reasoning',
        status: 'running',
        truncated: false,
      }),
      subagentStatus: 'running',
      isLast: true,
    })).toBe('loader')
  })

  it('reserves the warning glyph for explicit failure facts', () => {
    expect(resolveWorkspaceAssistantSubagentEventGlyph({
      part: eventPart({
        kind: 'tool_failed',
        toolCallId: 'skill-call-1',
        toolName: 'read_skill',
        skillId: 'story-development',
        code: 'CREATIVE_WORK_RUN_FAILED',
      }),
      subagentStatus: 'failed',
      isLast: true,
    })).toBe('alert')
  })

  it('shows generation and submission validation phases from persisted facts', () => {
    expect(resolveWorkspaceAssistantSubagentEventGlyph({
      part: eventPart({
        kind: 'generation',
        generationId: 'generation-2',
        phase: 'correcting_output',
        status: 'running',
      }),
      subagentStatus: 'running',
      isLast: true,
    })).toBe('loader')
    expect(resolveWorkspaceAssistantSubagentEventGlyph({
      part: eventPart({
        kind: 'submission_rejected',
        submissionId: 'submission-1',
        outputChars: 7_450,
        issues: [{
          path: '$',
          code: 'invalid_type',
          message: 'Expected object.',
        }],
      }),
      subagentStatus: 'running',
      isLast: true,
    })).toBe('alert')
    expect(resolveWorkspaceAssistantSubagentEventGlyph({
      part: eventPart({
        kind: 'submission_accepted',
        submissionId: 'submission-2',
        outputKind: 'creative_direction',
        outputChars: 7_500,
      }),
      subagentStatus: 'completed',
      isLast: true,
    })).toBe('check')
  })
})
