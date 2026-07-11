import {
  EDIT_FIRST_CHOICE_TOOL_IDS,
  PROJECT_AGENT_MAX_TOOL_ERRORS_PER_OPERATION,
  PROJECT_AGENT_MAX_TOOL_ERRORS_PER_RUN,
  createProjectAgentStopController,
  describe,
  expect,
  interruptBoundaryToolErrorOutput,
  it,
  toolErrorOutput,
} from './stop-conditions.fixture'

describe('project agent business stop signals', () => {
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
      suspendsFor: 'choice',
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
