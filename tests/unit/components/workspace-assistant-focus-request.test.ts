import { describe, expect, it } from 'vitest'
import {
  resolveWorkspaceAssistantActiveFocusRequest,
} from '@/features/project-workspace/components/workspace-assistant/workspace-assistant-runtime-state'
import type { ProjectAgentSessionActivity } from '@/lib/project-agent/session-state'

function activity(input: {
  readonly activityId: string
  readonly runId: string
  readonly type: ProjectAgentSessionActivity['type']
  readonly operationId?: string | null
  readonly sourceOperationId?: string | null
}): ProjectAgentSessionActivity {
  return {
    activityId: input.activityId,
    runId: input.runId,
    type: input.type,
    status: 'running',
    operationId: input.operationId ?? null,
    sourceOperationId: input.sourceOperationId ?? null,
    toolCallId: null,
    choiceType: null,
  }
}

describe('workspace assistant focus request', () => {
  it('uses the active activity id as the canvas focus request key', () => {
    expect(resolveWorkspaceAssistantActiveFocusRequest({
      pendingRun: { runId: 'run-1' },
      operationId: 'generate_edit_script',
      activities: [
        activity({
          activityId: 'activity-1',
          runId: 'run-1',
          type: 'operation',
          operationId: 'generate_edit_script',
        }),
      ],
    })).toEqual({
      operationId: 'generate_edit_script',
      requestKey: 'run-1:activity-1:generate_edit_script',
    })
  })

  it('uses waiting-task source operation as the focus operation', () => {
    expect(resolveWorkspaceAssistantActiveFocusRequest({
      pendingRun: { runId: 'run-1' },
      operationId: 'generate_panel_video',
      activities: [
        activity({
          activityId: 'wait-activity-1',
          runId: 'run-1',
          type: 'waiting_task',
          sourceOperationId: 'generate_panel_video',
        }),
      ],
    })).toEqual({
      operationId: 'generate_panel_video',
      requestKey: 'run-1:wait-activity-1:generate_panel_video',
    })
  })

  it('falls back to run and operation when no matching activity is available', () => {
    expect(resolveWorkspaceAssistantActiveFocusRequest({
      pendingRun: { runId: 'run-2' },
      operationId: 'generate_edit_script',
      activities: [],
    })).toEqual({
      operationId: 'generate_edit_script',
      requestKey: 'run-2:generate_edit_script',
    })
  })
})
