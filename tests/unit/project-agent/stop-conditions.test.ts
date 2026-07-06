import { describe, expect, it } from 'vitest'
import {
  PROJECT_AGENT_MAX_TOOL_ERRORS_PER_OPERATION,
  PROJECT_AGENT_MAX_TOOL_ERRORS_PER_RUN,
  PROJECT_AGENT_MAX_TURNS,
  createProjectAgentStopController,
} from '@/lib/project-agent/stop-conditions'
import { EDIT_FIRST_CHOICE_TOOL_IDS } from '@/lib/project-agent/edit-first-choice-tools'

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

function interruptBoundaryToolErrorOutput(operationId: string, code: string) {
  return {
    toolName: operationId,
    output: {
      ok: false,
      error: {
        operationId,
        code,
        details: {
          interruptsFor: 'choice',
        },
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

  it('[data task submitted part] -> emits external task wait stop data', () => {
    const controller = createProjectAgentStopController()
    const stopPart = controller.evaluateStep([{
      toolName: 'generate_episode_videos',
      output: {
        type: 'data-task-submitted',
        data: {
          operationId: 'generate_episode_videos',
          taskId: 'task-video-1',
          status: 'queued',
        },
      },
    }])

    expect(stopPart).toEqual({
      reason: 'awaiting_external_task',
      stepCount: 1,
      operationIds: ['generate_episode_videos'],
      taskIds: ['task-video-1'],
      phases: [],
    })
  })

  it('[task status active] -> remains an observation so the agent can answer without creating a wait', () => {
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

    expect(stopPart).toBeNull()
  })

  it('[project context active tasks] -> does not bind observed tasks as the current run wait', () => {
    const controller = createProjectAgentStopController()
    const stopPart = controller.evaluateStep([{
      toolName: 'get_project_context',
      output: {
        ok: true,
        data: {
          context: {
            activeOperationTasks: [{
              operationId: 'generate_edit_script_storyboard_images',
              taskId: 'task-1',
              status: 'processing',
            }],
          },
        },
      },
    }])

    expect(stopPart).toBeNull()
  })

  it('[running command status] -> does not bind status-query results as an external task wait', () => {
    const controller = createProjectAgentStopController()
    const stopPart = controller.evaluateStep([{
      toolName: 'list_recent_commands',
      output: {
        ok: true,
        data: [{
          operationId: 'generate_edit_script_storyboard_images',
          status: 'approved',
          taskId: 'task-1',
        }],
      },
    }])

    expect(stopPart).toBeNull()
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
      toolName: 'generate_edit_script',
      output: {
        ok: false,
        confirmationRequired: true,
        error: {
          operationId: 'generate_edit_script',
          code: 'CONFIRMATION_REQUIRED',
        },
      },
    }])

    expect(stopPart).toEqual({
      reason: 'awaiting_user_confirmation',
      stepCount: 1,
      operationIds: ['generate_edit_script'],
    })
  })

  it('[choice card emitted] -> stops so the agent waits for the user choice', () => {
    const controller = createProjectAgentStopController()
    const stopPart = controller.evaluateStep([{
      toolName: EDIT_FIRST_CHOICE_TOOL_IDS.bible_review,
      output: {
        ok: true,
        data: {
          emitted: true,
          choiceType: 'bible_review',
          cardId: 'edit-first-duration-aspect-ratio',
          workflowStage: 'ready_to_ingest_script',
        },
      },
    }])

    expect(stopPart).toEqual({
      reason: 'awaiting_user_confirmation',
      stepCount: 1,
      operationIds: [EDIT_FIRST_CHOICE_TOOL_IDS.bible_review],
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

  it('[interrupt boundary error] -> stops immediately so the model cannot mask a failed choice setup', () => {
    const controller = createProjectAgentStopController()
    const stopPart = controller.evaluateStep([
      interruptBoundaryToolErrorOutput(EDIT_FIRST_CHOICE_TOOL_IDS.bible_review, 'OPERATION_EXECUTION_FAILED'),
    ])

    expect(stopPart).toEqual({
      reason: 'tool_error',
      stepCount: 1,
      operationIds: [EDIT_FIRST_CHOICE_TOOL_IDS.bible_review],
      codes: ['OPERATION_EXECUTION_FAILED'],
    })
  })

  it('[error after recovery] -> a successful await signal still wins over earlier errors', () => {
    const controller = createProjectAgentStopController()
    expect(controller.evaluateStep([
      toolErrorOutput('generate_edit_script', 'OPERATION_EXECUTION_FAILED'),
    ])).toBeNull()
    const stopPart = controller.evaluateStep([{
      toolName: 'generate_edit_shot_execution_plan',
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
