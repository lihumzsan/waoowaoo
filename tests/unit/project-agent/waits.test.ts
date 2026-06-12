import { describe, expect, it } from 'vitest'
import { TASK_EVENT_TYPE } from '@/lib/task/types'
import {
  applyProjectAgentWaitTaskSnapshot,
  applyProjectAgentWaitTerminalEvent,
  resolveWaitTerminalNextStatus,
} from '@/lib/project-agent/waits'

describe('project agent waits', () => {
  it('[batch partial] -> does not resolve before all tasks are terminal', () => {
    expect(applyProjectAgentWaitTerminalEvent({
      taskId: 'task-1',
      lifecycleType: TASK_EVENT_TYPE.COMPLETED,
      taskIds: ['task-1', 'task-2'],
      terminalTaskIds: [],
      failedTaskIds: [],
    })).toEqual({
      terminalTaskIds: ['task-1'],
      failedTaskIds: [],
      terminalStatus: null,
    })
  })

  it('[batch completed] -> resolves completed after all tasks are terminal', () => {
    expect(applyProjectAgentWaitTerminalEvent({
      taskId: 'task-2',
      lifecycleType: TASK_EVENT_TYPE.COMPLETED,
      taskIds: ['task-1', 'task-2'],
      terminalTaskIds: ['task-1'],
      failedTaskIds: [],
    })).toEqual({
      terminalTaskIds: ['task-1', 'task-2'],
      failedTaskIds: [],
      terminalStatus: 'completed',
    })
  })

  it('[batch failed] -> resolves failed if any task failed', () => {
    expect(applyProjectAgentWaitTerminalEvent({
      taskId: 'task-2',
      lifecycleType: TASK_EVENT_TYPE.FAILED,
      taskIds: ['task-1', 'task-2'],
      terminalTaskIds: ['task-1'],
      failedTaskIds: [],
    })).toEqual({
      terminalTaskIds: ['task-1', 'task-2'],
      failedTaskIds: ['task-2'],
      terminalStatus: 'failed',
    })
  })

  it('[creation race] -> resolves from task snapshots when tasks finished before the wait row exists', () => {
    expect(applyProjectAgentWaitTaskSnapshot({
      taskIds: ['task-1', 'task-2'],
      tasks: [
        { id: 'task-1', status: 'completed' },
        { id: 'task-2', status: 'completed' },
      ],
    })).toEqual({
      terminalTaskIds: ['task-1', 'task-2'],
      failedTaskIds: [],
      terminalStatus: 'completed',
    })
  })

  it('[creation race partial] -> preserves already terminal task ids for later task events', () => {
    expect(applyProjectAgentWaitTaskSnapshot({
      taskIds: ['task-1', 'task-2'],
      tasks: [
        { id: 'task-1', status: 'completed' },
        { id: 'task-2', status: 'processing' },
      ],
    })).toEqual({
      terminalTaskIds: ['task-1'],
      failedTaskIds: [],
      terminalStatus: null,
    })
  })

  it('[await_user_choice completed] -> closes the wait without waking the agent', () => {
    expect(resolveWaitTerminalNextStatus({
      followUpMode: 'await_user_choice',
      terminalStatus: 'completed',
    })).toBe('followed')
  })

  it('[await_user_choice failed] -> still resumes the agent so it can report the failure', () => {
    expect(resolveWaitTerminalNextStatus({
      followUpMode: 'await_user_choice',
      terminalStatus: 'failed',
    })).toBe('resolved')
  })

  it('[resume_agent completed] -> becomes claimable for an agent follow-up turn', () => {
    expect(resolveWaitTerminalNextStatus({
      followUpMode: 'resume_agent',
      terminalStatus: 'completed',
    })).toBe('resolved')
  })
})
