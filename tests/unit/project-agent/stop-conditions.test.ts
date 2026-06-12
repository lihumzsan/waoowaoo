import { describe, expect, it } from 'vitest'
import {
  PROJECT_AGENT_MAX_TOOL_ERRORS_PER_OPERATION,
  PROJECT_AGENT_MAX_TOOL_ERRORS_PER_RUN,
  PROJECT_AGENT_MAX_TURNS,
  createProjectAgentStopController,
} from '@/lib/project-agent/stop-conditions'

function toolErrorOutput(operationId: string, code: string) {
  return {
    toolName: operationId,
    output: {
      ok: false,
      error: {
        operationId,
        code,
      },
    },
  }
}

describe('project agent business stop signals', () => {
  it('exposes the Agents SDK max turn cap constant', () => {
    expect(PROJECT_AGENT_MAX_TURNS).toBe(12)
  })

  it('[async task submitted] -> emits external task wait stop data', () => {
    const controller = createProjectAgentStopController()
    const stopPart = controller.evaluateStep([{
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
    const controller = createProjectAgentStopController()
    const stopPart = controller.evaluateStep([{
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
    const controller = createProjectAgentStopController()
    const stopPart = controller.evaluateStep([{
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
    const controller = createProjectAgentStopController()
    const stopPart = controller.evaluateStep([{
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

  it('[choice card emitted] -> stops so the agent waits for the user choice', () => {
    const controller = createProjectAgentStopController()
    const stopPart = controller.evaluateStep([{
      toolName: 'request_edit_first_choice',
      output: {
        ok: true,
        data: {
          emitted: true,
          choiceType: 'duration_and_aspect_ratio',
          cardId: 'edit-first-duration-aspect-ratio',
          workflowStage: 'ready_to_generate_screenplay',
        },
      },
    }])

    expect(stopPart).toEqual({
      reason: 'awaiting_user_confirmation',
      stepCount: 1,
      operationIds: ['request_edit_first_choice'],
    })
  })

  it('[first tool error] -> returns the error to the model instead of stopping', () => {
    const controller = createProjectAgentStopController()
    const stopPart = controller.evaluateStep([
      toolErrorOutput('generate_edit_script', 'OPERATION_EXECUTION_FAILED'),
    ])
    expect(stopPart).toBeNull()
  })

  it('[repeated same-operation errors] -> stops once the per-operation budget is exhausted', () => {
    const controller = createProjectAgentStopController()
    expect(controller.evaluateStep([
      toolErrorOutput('generate_edit_script', 'OPERATION_EXECUTION_FAILED'),
    ])).toBeNull()

    const stopPart = controller.evaluateStep([
      toolErrorOutput('generate_edit_script', 'OPERATION_EXECUTION_FAILED'),
    ])
    expect(stopPart).toEqual({
      reason: 'tool_error',
      stepCount: 2,
      operationIds: ['generate_edit_script'],
      codes: ['OPERATION_EXECUTION_FAILED'],
    })
    expect(PROJECT_AGENT_MAX_TOOL_ERRORS_PER_OPERATION).toBe(2)
  })

  it('[errors across different operations] -> stops once the per-run budget is exhausted', () => {
    const controller = createProjectAgentStopController()
    expect(controller.evaluateStep([toolErrorOutput('op_a', 'OPERATION_EXECUTION_FAILED')])).toBeNull()
    expect(controller.evaluateStep([toolErrorOutput('op_b', 'OPERATION_INPUT_INVALID')])).toBeNull()
    expect(controller.evaluateStep([toolErrorOutput('op_c', 'OPERATION_EXECUTION_FAILED')])).toBeNull()
    const stopPart = controller.evaluateStep([toolErrorOutput('op_d', 'OPERATION_EXECUTION_FAILED')])
    expect(stopPart).toEqual(expect.objectContaining({
      reason: 'tool_error',
      operationIds: ['op_d'],
    }))
    expect(PROJECT_AGENT_MAX_TOOL_ERRORS_PER_RUN).toBe(4)
  })

  it('[fatal error code] -> stops immediately without retry budget', () => {
    const controller = createProjectAgentStopController()
    const stopPart = controller.evaluateStep([
      toolErrorOutput('generate_edit_script', 'OPERATION_NOT_ALLOWED'),
    ])
    expect(stopPart).toEqual({
      reason: 'tool_error',
      stepCount: 1,
      operationIds: ['generate_edit_script'],
      codes: ['OPERATION_NOT_ALLOWED'],
    })
  })

  it('[error after recovery] -> a successful await signal still wins over earlier errors', () => {
    const controller = createProjectAgentStopController()
    expect(controller.evaluateStep([
      toolErrorOutput('generate_edit_script', 'OPERATION_EXECUTION_FAILED'),
    ])).toBeNull()
    const stopPart = controller.evaluateStep([{
      toolName: 'generate_edit_director_decoupage',
      output: {
        ok: true,
        data: {
          async: true,
          taskId: 'task-9',
          status: 'queued',
        },
      },
    }])
    expect(stopPart).toEqual(expect.objectContaining({
      reason: 'awaiting_external_task',
      taskIds: ['task-9'],
    }))
  })
})
