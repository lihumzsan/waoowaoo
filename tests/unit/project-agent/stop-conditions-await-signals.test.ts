import {
  PROJECT_AGENT_MAX_TURNS,
  completedOutput,
  createProjectAgentStopController,
  describe,
  expect,
  it,
  noopOutput,
  submittedTasksOutput,
} from './stop-conditions.fixture'

describe('project agent business stop signals', () => {
  it('exposes the Agents SDK max turn cap constant', () => {
    expect(PROJECT_AGENT_MAX_TURNS).toBe(12)
  })

  it('[SubmittedTasks] -> keeps the foreground model loop running', () => {
    const controller = createProjectAgentStopController()
    const stopPart = controller.evaluateStep([
      submittedTasksOutput('delegate_creative_work', ['task-1']),
    ])

    expect(stopPart).toBeNull()
  })

  it('[SubmittedTasks batch] -> does not turn Task identity into a stop signal', () => {
    const controller = createProjectAgentStopController()
    const stopPart = controller.evaluateStep([
      submittedTasksOutput('create_video', ['task-video-1']),
    ])

    expect(stopPart).toBeNull()
  })

  it('keeps multiple submitted Operations non-blocking in one model step', () => {
    const controller = createProjectAgentStopController()
    expect(controller.evaluateStep([
      submittedTasksOutput('delegate_creative_work', ['task-screenplay-1']),
      submittedTasksOutput('create_video', ['task-video-1', 'task-video-2']),
    ])).toBeNull()
  })

  it('[Completed status query] -> remains an observation without creating a wait', () => {
    const controller = createProjectAgentStopController()
    const stopPart = controller.evaluateStep([completedOutput('get_task_status')])

    expect(stopPart).toBeNull()
  })

  it('[Completed project context] -> does not bind observed tasks as the current run wait', () => {
    const controller = createProjectAgentStopController()
    const stopPart = controller.evaluateStep([completedOutput('get_project_context')])

    expect(stopPart).toBeNull()
  })

  it('[Completed command status] -> does not bind a status query as an external task wait', () => {
    const controller = createProjectAgentStopController()
    const stopPart = controller.evaluateStep([completedOutput('list_recent_commands')])

    expect(stopPart).toBeNull()
  })

  it('[Completed task status] -> returns null so the agent can summarize results', () => {
    const controller = createProjectAgentStopController()
    const stopPart = controller.evaluateStep([completedOutput('get_task_status')])

    expect(stopPart).toBeNull()
  })

  it('[Noop approved plan] -> does not invent a Task wait from output fields', () => {
    const controller = createProjectAgentStopController()
    const stopPart = controller.evaluateStep([noopOutput('create_image')])

    expect(stopPart).toBeNull()
  })
})
