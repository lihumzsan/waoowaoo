import { describe, expect, it } from 'vitest'
import {
  isWorkspaceCanvasLifecycleRunning,
  resolveWorkspaceCanvasLifecycle,
  workspaceCanvasLifecycleStatusKey,
  workspaceCanvasLifecycleTaskState,
} from '@/features/project-workspace/canvas/lifecycle/workspace-canvas-lifecycle'

describe('workspace Canvas Resource lifecycle', () => {
  it('uses active Task facts only for queued and processing phases', () => {
    const queued = resolveWorkspaceCanvasLifecycle({
      persistedPhase: 'pending',
      task: {
        phase: 'queued',
        taskId: ' resource-task ',
        runningTaskType: 'creative_resource_image',
        progress: 42.9,
      },
    })
    expect(queued).toEqual({
      phase: 'queued',
      taskId: 'resource-task',
      taskType: 'creative_resource_image',
      progress: 42,
      error: null,
    })
    expect(isWorkspaceCanvasLifecycleRunning(queued)).toBe(true)
    expect(workspaceCanvasLifecycleStatusKey(queued)).toBe('queued')
    expect(workspaceCanvasLifecycleTaskState(queued)).toMatchObject({
      taskId: 'resource-task',
      phase: 'queued',
    })
  })

  it('keeps the persisted Resource terminal phase when no Task is active', () => {
    const succeeded = resolveWorkspaceCanvasLifecycle({ persistedPhase: 'succeeded', task: null })
    expect(succeeded).toEqual({
      phase: 'succeeded',
      taskId: null,
      taskType: null,
      progress: null,
      error: null,
    })
    expect(isWorkspaceCanvasLifecycleRunning(succeeded)).toBe(false)
    expect(workspaceCanvasLifecycleTaskState(succeeded)).toBeNull()
  })

  it('makes an explicit contract error authoritative', () => {
    expect(resolveWorkspaceCanvasLifecycle({
      persistedPhase: 'pending',
      task: { phase: 'processing', taskId: 'task-1', progress: 140 },
      contractError: { code: 'RESOURCE_CONTRACT_INVALID', message: 'Invalid Resource contract' },
    })).toEqual({
      phase: 'failed',
      taskId: 'task-1',
      taskType: null,
      progress: 100,
      error: { code: 'RESOURCE_CONTRACT_INVALID', message: 'Invalid Resource contract' },
    })
  })
})
