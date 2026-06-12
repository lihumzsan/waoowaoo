import { describe, expect, it } from 'vitest'
import {
  PROJECT_AGENT_MAX_TURNS,
  buildProjectAgentStopPartFromToolOutputs,
} from '@/lib/project-agent/stop-conditions'

describe('project agent business stop signals', () => {
  it('exposes the Agents SDK max turn cap constant', () => {
    expect(PROJECT_AGENT_MAX_TURNS).toBe(12)
  })

  it('[async task submitted] -> emits external task wait stop data', () => {
    const stopPart = buildProjectAgentStopPartFromToolOutputs([{
      toolName: 'generate_edit_script',
      output: {
        ok: true,
        data: {
          async: true,
          taskId: 'task-1',
          status: 'processing',
        },
      },
    }])

    expect(stopPart).toEqual({
      reason: 'awaiting_external_task',
      stepCount: 1,
      operationIds: ['generate_edit_script'],
      taskIds: ['task-1'],
      phases: [],
    })
  })

  it('[task status active] -> emits external task wait stop data', () => {
    const stopPart = buildProjectAgentStopPartFromToolOutputs([{
      toolName: 'get_task_status',
      output: {
        ok: true,
        data: {
          states: [{
            targetType: 'ProjectEpisode',
            targetId: 'episode-1',
            phase: 'processing',
            runningTaskId: 'task-1',
          }],
        },
      },
    }])

    expect(stopPart).toEqual({
      reason: 'awaiting_external_task',
      stepCount: 1,
      operationIds: ['get_task_status'],
      taskIds: ['task-1'],
      phases: ['processing'],
    })
  })

  it('[task status terminal] -> returns null so the agent can summarize completed results', () => {
    const stopPart = buildProjectAgentStopPartFromToolOutputs([{
      toolName: 'get_task_status',
      output: {
        ok: true,
        data: {
          states: [{
            targetType: 'ProjectEpisode',
            targetId: 'episode-1',
            phase: 'completed',
            runningTaskId: null,
          }],
        },
      },
    }])

    expect(stopPart).toBeNull()
  })

  it('[confirmation required] -> keeps a business confirmation stop signal for legacy operation errors', () => {
    const stopPart = buildProjectAgentStopPartFromToolOutputs([{
      toolName: 'delete_storyboard_panel',
      output: {
        ok: false,
        confirmationRequired: true,
        error: {
          operationId: 'delete_storyboard_panel',
          code: 'CONFIRMATION_REQUIRED',
        },
      },
    }])

    expect(stopPart).toEqual({
      reason: 'awaiting_user_confirmation',
      stepCount: 1,
      operationIds: ['delete_storyboard_panel'],
    })
  })

  it('[tool error] -> emits explicit tool error stop data', () => {
    const stopPart = buildProjectAgentStopPartFromToolOutputs([{
      toolName: 'generate_edit_script',
      output: {
        ok: false,
        error: {
          operationId: 'generate_edit_script',
          code: 'OPERATION_EXECUTION_FAILED',
        },
      },
    }])

    expect(stopPart).toEqual({
      reason: 'tool_error',
      stepCount: 1,
      operationIds: ['generate_edit_script'],
      codes: ['OPERATION_EXECUTION_FAILED'],
    })
  })
})
