import { describe, expect, it } from 'vitest'
import { buildTaskFollowUpInputItem } from '@/lib/project-agent/runtime'
import type { ProjectAgentWaitFollowUp } from '@/lib/project-agent/waits'

function followUp(overrides: Partial<ProjectAgentWaitFollowUp> = {}): ProjectAgentWaitFollowUp {
  return {
    runId: 'run-1',
    activityId: 'activity-1',
    followUpActivityId: 'activity-follow-up-1',
    waitId: 'wait-1',
    followUpKey: 'follow-up-key-1',
    operationId: 'generate_edit_script_storyboard',
    taskIds: ['task-1'],
    failedTaskIds: [],
    terminalStatus: 'completed',
    total: 1,
    successCount: 1,
    failedCount: 0,
    claimId: 'claim-1',
    ...overrides,
  }
}

function readContent(item: ReturnType<typeof buildTaskFollowUpInputItem>): string {
  if (!('content' in item) || typeof item.content !== 'string') {
    throw new Error('TEST_EXPECTED_TEXT_AGENT_INPUT_ITEM')
  }
  return item.content
}

describe('project agent task follow-up input', () => {
  it('requires visible user-facing text before a tool call on task completion follow-up', () => {
    const content = readContent(buildTaskFollowUpInputItem(followUp(), 'zh'))

    expect(content).toContain('[task_update]')
    expect(content).toContain('operation=generate_edit_script_storyboard')
    expect(content).toContain('status=completed')
    expect(content).toContain('本轮在任何工具调用之前，必须先向用户输出一段可见的自然语言说明')
    expect(content).toContain('不要以工具调用作为本轮第一输出')
    expect(content).toContain('必须在调用工具前告诉用户马上要执行哪一步')
  })

  it('requires visible failure reporting before recovery tool calls', () => {
    const content = readContent(buildTaskFollowUpInputItem(followUp({
      terminalStatus: 'failed',
      failedTaskIds: ['task-failed-1'],
      successCount: 0,
      failedCount: 1,
    }), 'en'))

    expect(content).toContain('status=failed')
    expect(content).toContain('failedTaskIds=task-failed-1')
    expect(content).toContain('before any tool call, first output a visible natural-language message')
    expect(content).toContain('Do not start this turn with a tool call')
    expect(content).toContain('If status=failed, explain the failure')
  })
})
