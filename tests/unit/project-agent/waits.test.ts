import { describe, expect, it } from 'vitest'
import { TASK_EVENT_TYPE } from '@/lib/task/types'
import {
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
      canceledTaskIds: [],
    })).toEqual({
      terminalTaskIds: ['task-1'],
      failedTaskIds: [],
      canceledTaskIds: [],
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
      canceledTaskIds: [],
    })).toEqual({
      terminalTaskIds: ['task-1', 'task-2'],
      failedTaskIds: [],
      canceledTaskIds: [],
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
      canceledTaskIds: [],
    })).toEqual({
      terminalTaskIds: ['task-1', 'task-2'],
      failedTaskIds: ['task-2'],
      canceledTaskIds: [],
      terminalStatus: 'failed',
    })
  })

  it('[duplicate terminal] -> preserves the locked Wait aggregate without inventing a second state', () => {
    expect(applyProjectAgentWaitTerminalEvent({
      taskId: 'task-1',
      lifecycleType: TASK_EVENT_TYPE.COMPLETED,
      taskIds: ['task-1', 'task-2'],
      terminalTaskIds: ['task-1'],
      failedTaskIds: [],
      canceledTaskIds: [],
    })).toEqual({
      terminalTaskIds: ['task-1'],
      failedTaskIds: [],
      canceledTaskIds: [],
      terminalStatus: null,
    })
  })

  it('[serialized terminal events] -> resolves from the accumulated locked Wait state', () => {
    expect(applyProjectAgentWaitTerminalEvent({
      taskId: 'task-2',
      lifecycleType: TASK_EVENT_TYPE.COMPLETED,
      taskIds: ['task-1', 'task-2'],
      terminalTaskIds: ['task-1'],
      failedTaskIds: [],
      canceledTaskIds: [],
    })).toEqual({
      terminalTaskIds: ['task-1', 'task-2'],
      failedTaskIds: [],
      canceledTaskIds: [],
      terminalStatus: 'completed',
    })
  })

  it('[resume_agent canceled] -> becomes claimable so the agent can explain cancellation', () => {
    expect(resolveWaitTerminalNextStatus({
      followUpMode: 'resume_agent',
      terminalStatus: 'canceled',
    })).toBe('resolved')
  })

  it('[resume_agent completed] -> becomes claimable for an agent follow-up turn', () => {
    expect(resolveWaitTerminalNextStatus({
      followUpMode: 'resume_agent',
      terminalStatus: 'completed',
    })).toBe('resolved')
  })
})
