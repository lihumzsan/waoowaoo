import {
  EDIT_FIRST_CHOICE_TOOL_IDS,
  PROJECT_AGENT_MAX_TOOL_ERRORS_PER_OPERATION,
  PROJECT_AGENT_MAX_TOOL_ERRORS_PER_RUN,
  createProjectAgentStopController,
  describe,
  expect,
  it,
  submittedTasksOutput,
  toolErrorOutput,
  waitApprovalOutput,
  waitChoiceOutput,
} from './stop-conditions.fixture'

describe('project agent business stop signals', () => {
  it('[WaitApproval] -> keeps a business confirmation stop signal', () => {
    const controller = createProjectAgentStopController()
    const stopPart = controller.evaluateStep([waitApprovalOutput('generate_edit_script')])

    expect(stopPart).toEqual({
      reason: 'awaiting_user_confirmation',
      stepCount: 1,
      operationIds: ['generate_edit_script'],
    })
  })

  it('[WaitChoice] -> stops so the agent waits for the user choice', () => {
    const controller = createProjectAgentStopController()
    const stopPart = controller.evaluateStep([waitChoiceOutput(EDIT_FIRST_CHOICE_TOOL_IDS.bible_review)])

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

  it('[operation plan changed] -> cancels the approved attempt without retrying the stale Grant', () => {
    const controller = createProjectAgentStopController()
    const stopPart = controller.evaluateStep([
      toolErrorOutput('generate_video_segments', 'OPERATION_PLAN_CHANGED'),
    ])
    expect(stopPart).toEqual({
      reason: 'tool_error',
      stepCount: 1,
      operationIds: ['generate_video_segments'],
      codes: ['OPERATION_PLAN_CHANGED'],
    })
  })

  it('[error after recovery] -> SubmittedTasks still wins over earlier failures', () => {
    const controller = createProjectAgentStopController()
    expect(controller.evaluateStep([
      toolErrorOutput('generate_edit_script', 'OPERATION_EXECUTION_FAILED'),
    ])).toBeNull()
    const stopPart = controller.evaluateStep([
      submittedTasksOutput('generate_edit_shot_execution_plan', ['task-9']),
    ])
    expect(stopPart).toEqual(expect.objectContaining({
      reason: 'awaiting_external_task',
      taskIds: ['task-9'],
    }))
  })
})
