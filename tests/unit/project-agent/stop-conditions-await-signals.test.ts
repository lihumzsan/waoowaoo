import {
  PROJECT_AGENT_MAX_TURNS,
  createProjectAgentStopController,
  describe,
  expect,
  it,
} from './stop-conditions.fixture'

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
      taskWaits: [{ operationId: 'generate_edit_script', taskIds: ['task-1'], phases: [] }],
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
      taskWaits: [{ operationId: 'generate_episode_videos', taskIds: ['task-video-1'], phases: [] }],
    })
  })

  it('rejects multiple long-running Operations in one model step instead of creating parallel Wait state machines', () => {
    const controller = createProjectAgentStopController()
    expect(() => controller.evaluateStep([
      {
        toolName: 'generate_edit_script',
        output: { ok: true, data: { async: true, taskId: 'task-script-1' } },
      },
      {
        toolName: 'generate_episode_videos',
        output: { ok: true, data: { async: true, taskIds: ['task-video-1', 'task-video-2'] } },
      },
    ])).toThrow('PROJECT_AGENT_MULTIPLE_ASYNC_OPERATIONS_UNSUPPORTED:generate_edit_script,generate_episode_videos')
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
})
