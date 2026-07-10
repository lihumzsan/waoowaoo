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
    followUpMode: 'resume_agent',
    operationId: 'generate_edit_script_storyboard',
    taskIds: ['task-1'],
    failedTaskIds: [],
    canceledTaskIds: [],
    failedTasks: [],
    terminalStatus: 'completed',
    total: 1,
    successCount: 1,
    failedCount: 0,
    canceledCount: 0,
    claimId: 'claim-1',
    commandId: 'command-1',
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
  it('emits only terminal task facts on task completion follow-up', () => {
    const content = readContent(buildTaskFollowUpInputItem(followUp()))

    expect(content).toContain('[task_update]')
    expect(content).toContain('operation=generate_edit_script_storyboard')
    expect(content).toContain('status=completed')
    expect(content).toContain('total=1 succeeded=1 failed=0')
    expect(content).not.toContain('本轮在任何工具调用之前')
    expect(content).not.toContain('Do not start this turn with a tool call')
    expect(content).not.toContain('不要重新运行刚刚到达终态')
    expect(content).not.toContain('Do not re-run the operation')
  })

  it('keeps failed task details as facts without behavior instructions', () => {
    const content = readContent(buildTaskFollowUpInputItem(followUp({
      terminalStatus: 'failed',
      failedTaskIds: ['task-failed-1'],
      failedTasks: [{
        taskId: 'task-failed-1',
        taskType: 'video_group',
        targetType: 'ProjectVideoGroup',
        targetId: 'group-1',
        status: 'failed',
        errorCode: 'INTERNAL_ERROR',
        errorMessage: 'output video may be related to copyright restrictions',
      }],
      successCount: 0,
      failedCount: 1,
    })))

    expect(content).toContain('status=failed')
    expect(content).toContain('failedTaskIds=task-failed-1')
    expect(content).toContain('failedTasks=')
    expect(content).toContain('INTERNAL_ERROR')
    expect(content).toContain('copyright restrictions')
    expect(content).not.toContain('before any tool call')
    expect(content).not.toContain('when they expose exactly one executable next operation')
    expect(content).not.toContain('If status=failed, explain the failure')
  })
})
