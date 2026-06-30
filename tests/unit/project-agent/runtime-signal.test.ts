import { describe, expect, it } from 'vitest'
import {
  normalizeOperationRuntimeSignal,
  stableArgsHash,
} from '@/lib/project-agent/runtime-signal'
import { EDIT_FIRST_CHOICE_TOOL_IDS } from '@/lib/project-agent/edit-first-choice-tools'

describe('project agent runtime signal', () => {
  it('[async single] -> await_task signal', () => {
    expect(normalizeOperationRuntimeSignal({
      toolName: 'generate_edit_script',
      output: {
        ok: true,
        data: {
          async: true,
          taskId: 'task-1',
        },
      },
    })).toEqual({
      kind: 'await_task',
      operationId: 'generate_edit_script',
      taskIds: ['task-1'],
      phases: [],
    })
  })

  it('[async batch] -> await_task signal with all task ids', () => {
    expect(normalizeOperationRuntimeSignal({
      toolName: 'generate_storyboard_images',
      output: {
        ok: true,
        data: {
          async: true,
          taskIds: ['task-2', 'task-1', 'task-1'],
        },
      },
    })).toEqual({
      kind: 'await_task',
      operationId: 'generate_storyboard_images',
      taskIds: ['task-1', 'task-2'],
      phases: [],
    })
  })

  it('[task status active] -> active_status signal', () => {
    expect(normalizeOperationRuntimeSignal({
      toolName: 'get_task_status',
      output: {
        ok: true,
        data: {
          states: [
            { phase: 'completed', runningTaskId: null },
            { phase: 'processing', runningTaskId: 'task-1' },
            { phase: 'queued', taskId: 'task-2' },
          ],
        },
      },
    })).toEqual({
      kind: 'active_status',
      operationId: 'get_task_status',
      taskIds: ['task-1', 'task-2'],
      phases: ['processing', 'queued'],
    })
  })

  it('[non-status command] -> done signal', () => {
    expect(normalizeOperationRuntimeSignal({
      toolName: 'list_recent_commands',
      output: {
        ok: true,
        data: [
          { id: 'command-1', status: 'done', taskId: 'task-old' },
          { id: 'command-2', status: 'approved', taskId: 'task-1' },
        ],
      },
    })).toEqual({
      kind: 'done',
    })
  })

  it('[active operation tasks] -> active_status signal', () => {
    expect(normalizeOperationRuntimeSignal({
      toolName: 'get_project_context',
      output: {
        ok: true,
        data: {
          context: {
            activeOperationTasks: [
              { taskId: 'task-1', phase: 'processing' },
            ],
          },
        },
      },
    })).toEqual({
      kind: 'active_status',
      operationId: 'get_project_context',
      taskIds: ['task-1'],
      phases: ['processing'],
    })
  })

  it('[confirmation required] -> await_user_confirmation signal before tool_error', () => {
    expect(normalizeOperationRuntimeSignal({
      toolName: 'generate_edit_script',
      output: {
        ok: false,
        confirmationRequired: true,
        error: {
          operationId: 'generate_edit_script',
          code: 'CONFIRMATION_REQUIRED',
          message: 'requires confirmation',
        },
      },
    })).toEqual({
      kind: 'await_user_confirmation',
      operationId: 'generate_edit_script',
      message: 'requires confirmation',
    })
  })

  it('[choice card emitted] -> await_user_confirmation signal', () => {
    expect(normalizeOperationRuntimeSignal({
      toolName: EDIT_FIRST_CHOICE_TOOL_IDS.duration_and_aspect_ratio,
      output: {
        ok: true,
        data: {
          emitted: true,
          choiceType: 'duration_and_aspect_ratio',
          cardId: 'edit-first-duration-aspect-ratio',
          workflowStage: 'ready_to_generate_screenplay',
        },
      },
    })).toEqual({
      kind: 'await_user_confirmation',
      operationId: EDIT_FIRST_CHOICE_TOOL_IDS.duration_and_aspect_ratio,
    })
  })

  it('[terminal or idle] -> done signal', () => {
    expect(normalizeOperationRuntimeSignal({
      toolName: 'get_task_status',
      output: {
        ok: true,
        data: {
          states: [{ phase: 'completed', runningTaskId: null }],
        },
      },
    })).toEqual({ kind: 'done' })
  })

  it('[stable hash] -> same object values hash the same regardless of key order', () => {
    expect(stableArgsHash({ b: 2, a: 1 })).toBe(stableArgsHash({ a: 1, b: 2 }))
  })

  it('[stable hash] -> trims strings and ignores undefined object fields', () => {
    expect(stableArgsHash({
      prompt: ' make it cinematic ',
      optional: undefined,
    })).toBe(stableArgsHash({
      prompt: 'make it cinematic',
    }))
  })
})
