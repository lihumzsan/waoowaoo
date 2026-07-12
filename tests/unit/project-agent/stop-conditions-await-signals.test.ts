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

  it('[SubmittedTasks] -> emits external task wait stop data', () => {
    const controller = createProjectAgentStopController()
    const stopPart = controller.evaluateStep([
      submittedTasksOutput('generate_edit_script', ['task-1']),
    ])

    expect(stopPart).toEqual({
      reason: 'awaiting_external_task',
      stepCount: 1,
      operationIds: ['generate_edit_script'],
      taskIds: ['task-1'],
      phases: [],
      taskWaits: [{ operationId: 'generate_edit_script', taskIds: ['task-1'], phases: [] }],
    })
  })

  it('[SubmittedTasks batch] -> carries the durable task identities', () => {
    const controller = createProjectAgentStopController()
    const stopPart = controller.evaluateStep([
      submittedTasksOutput('generate_episode_videos', ['task-video-1']),
    ])

    expect(stopPart).toEqual({
      reason: 'awaiting_external_task',
      stepCount: 1,
      operationIds: ['generate_episode_videos'],
      taskIds: ['task-video-1'],
      phases: [],
      taskWaits: [{ operationId: 'generate_episode_videos', taskIds: ['task-video-1'], phases: [] }],
    })
  })

  it('collects multiple long-running Operations from one model step for one shared Wait', () => {
    const controller = createProjectAgentStopController()
    expect(controller.evaluateStep([
      submittedTasksOutput('generate_edit_script', ['task-script-1']),
      submittedTasksOutput('generate_episode_videos', ['task-video-1', 'task-video-2']),
    ])).toEqual({
      reason: 'awaiting_external_task',
      stepCount: 2,
      operationIds: ['generate_edit_script', 'generate_episode_videos'],
      taskIds: ['task-script-1', 'task-video-1', 'task-video-2'],
      phases: [],
      taskWaits: [
        { operationId: 'generate_edit_script', taskIds: ['task-script-1'], phases: [] },
        { operationId: 'generate_episode_videos', taskIds: ['task-video-1', 'task-video-2'], phases: [] },
      ],
    })
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
    const stopPart = controller.evaluateStep([noopOutput('generate_edit_script_assets')])

    expect(stopPart).toBeNull()
  })
})
