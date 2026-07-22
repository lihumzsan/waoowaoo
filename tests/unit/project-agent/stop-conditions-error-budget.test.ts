import {
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
    const stopPart = controller.evaluateStep([waitApprovalOutput('create_image')])

    expect(stopPart).toEqual({
      reason: 'awaiting_user_confirmation',
      stepCount: 1,
      operationIds: ['create_image'],
    })
  })

  it('[WaitChoice] -> stops so the agent waits for the user choice', () => {
    const controller = createProjectAgentStopController()
    const stopPart = controller.evaluateStep([waitChoiceOutput('request_choice')])

    expect(stopPart).toEqual({
      reason: 'awaiting_user_confirmation',
      stepCount: 1,
      operationIds: ['request_choice'],
    })
  })

  it('[first tool error] -> returns the error to the model instead of stopping', () => {
    const controller = createProjectAgentStopController()
    const stopPart = controller.evaluateStep([
      toolErrorOutput('delegate_creative_work', 'OPERATION_EXECUTION_FAILED'),
    ])
    expect(stopPart).toBeNull()
  })

  it('[repeated same-operation errors] -> stops once the per-operation budget is exhausted', () => {
    const controller = createProjectAgentStopController()
    expect(controller.evaluateStep([
      toolErrorOutput('delegate_creative_work', 'OPERATION_EXECUTION_FAILED'),
    ])).toBeNull()

    const stopPart = controller.evaluateStep([
      toolErrorOutput('delegate_creative_work', 'OPERATION_EXECUTION_FAILED'),
    ])
    expect(stopPart).toEqual({
      reason: 'tool_error',
      stepCount: 2,
      operationIds: ['delegate_creative_work'],
      codes: ['OPERATION_EXECUTION_FAILED'],
    })
    expect(PROJECT_AGENT_MAX_TOOL_ERRORS_PER_OPERATION).toBe(2)
  })

  it('[parallel same-operation errors] -> count as one correction opportunity', () => {
    const controller = createProjectAgentStopController()
    expect(controller.evaluateStep(Array.from({ length: 6 }, () => (
      toolErrorOutput('create_video', 'OPERATION_EXECUTION_FAILED')
    )))).toBeNull()

    const stopPart = controller.evaluateStep([
      toolErrorOutput('create_video', 'OPERATION_EXECUTION_FAILED'),
    ])
    expect(stopPart).toEqual({
      reason: 'tool_error',
      stepCount: 2,
      operationIds: ['create_video'],
      codes: ['OPERATION_EXECUTION_FAILED'],
    })
  })

  it('[parallel mixed-operation errors] -> advance the run budget once', () => {
    const controller = createProjectAgentStopController()
    expect(controller.evaluateStep([
      toolErrorOutput('op_a', 'OPERATION_EXECUTION_FAILED'),
      toolErrorOutput('op_b', 'OPERATION_EXECUTION_FAILED'),
      toolErrorOutput('op_c', 'OPERATION_EXECUTION_FAILED'),
      toolErrorOutput('op_d', 'OPERATION_EXECUTION_FAILED'),
    ])).toBeNull()
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
      toolErrorOutput('delegate_creative_work', 'OPERATION_NOT_ALLOWED'),
    ])
    expect(stopPart).toEqual({
      reason: 'tool_error',
      stepCount: 1,
      operationIds: ['delegate_creative_work'],
      codes: ['OPERATION_NOT_ALLOWED'],
    })
  })

  it('[operation plan changed] -> cancels the approved attempt without retrying the stale Grant', () => {
    const controller = createProjectAgentStopController()
    const stopPart = controller.evaluateStep([
      toolErrorOutput('create_video', 'OPERATION_PLAN_CHANGED'),
    ])
    expect(stopPart).toEqual({
      reason: 'tool_error',
      stepCount: 1,
      operationIds: ['create_video'],
      codes: ['OPERATION_PLAN_CHANGED'],
    })
  })

  it('[error after recovery] -> SubmittedTasks remains non-blocking', () => {
    const controller = createProjectAgentStopController()
    expect(controller.evaluateStep([
      toolErrorOutput('delegate_creative_work', 'OPERATION_EXECUTION_FAILED'),
    ])).toBeNull()
    const stopPart = controller.evaluateStep([
      submittedTasksOutput('delegate_creative_work', ['task-9']),
    ])
    expect(stopPart).toBeNull()
  })
})
