import { describe, expect, it } from 'vitest'
import {
  isWorkspaceCanvasLifecycleRunning,
  resolveWorkspaceCanvasLifecycle,
} from '@/features/project-workspace/canvas/lifecycle/workspace-canvas-lifecycle'
import { WORKSPACE_CANVAS_NODE_DEFINITIONS } from '@/features/project-workspace/canvas/registry/workspace-canvas-node-registry'
import { WORKSPACE_CANVAS_CONFORMANCE_FIXTURES } from '@/features/project-workspace/canvas/conformance/workspace-canvas-conformance-fixtures'
import { WORKSPACE_CANVAS_NODE_RENDERERS } from '@/features/project-workspace/canvas/nodes/workspace-node-renderer-registry'

const definitions = Object.values(WORKSPACE_CANVAS_NODE_DEFINITIONS)

describe.each(definitions)('Canvas node conformance: $kind', (definition) => {
  const fixture = WORKSPACE_CANVAS_CONFORMANCE_FIXTURES[definition.conformanceFixture]

  it('has one matching definition, renderer, and real fixture', () => {
    expect(fixture.kind).toBe(definition.kind)
    expect(typeof WORKSPACE_CANVAS_NODE_RENDERERS[definition.rendererKey]).toBe('function')
    expect(fixture.canonicalNodeId).toContain(definition.kind)
  })

  it('uses the unified pending, submission, queued, processing, and terminal phases', () => {
    const pending = resolveWorkspaceCanvasLifecycle({
      persistedPhase: 'pending', task: null, stream: null, submitting: false,
    })
    const submitting = resolveWorkspaceCanvasLifecycle({
      persistedPhase: 'pending', task: null, stream: null, submitting: true,
    })
    const queued = resolveWorkspaceCanvasLifecycle({
      persistedPhase: 'pending',
      task: { phase: 'queued', taskId: 'task-1', runningTaskId: 'task-1' },
      stream: null,
      submitting: false,
    })
    const processing = resolveWorkspaceCanvasLifecycle({
      persistedPhase: 'pending',
      task: { phase: 'processing', taskId: 'task-1', runningTaskId: 'task-1' },
      stream: null,
      submitting: false,
    })
    const succeeded = resolveWorkspaceCanvasLifecycle({
      persistedPhase: 'succeeded',
      task: { phase: 'completed', taskId: 'task-1', runningTaskId: null },
      stream: null,
      submitting: false,
    })

    expect([pending.phase, submitting.phase, queued.phase, processing.phase, succeeded.phase]).toEqual([
      'pending', 'submitting', 'queued', 'processing', 'succeeded',
    ])
    expect(isWorkspaceCanvasLifecycleRunning(pending)).toBe(false)
    expect(isWorkspaceCanvasLifecycleRunning(submitting)).toBe(true)
    expect(isWorkspaceCanvasLifecycleRunning(queued)).toBe(true)
    expect(isWorkspaceCanvasLifecycleRunning(processing)).toBe(true)
    expect(isWorkspaceCanvasLifecycleRunning(succeeded)).toBe(false)
  })

  it('rejects retry-attempt failure as a business terminal until Task is final', () => {
    const retrying = resolveWorkspaceCanvasLifecycle({
      persistedPhase: 'pending',
      task: { phase: 'queued', taskId: 'task-1', runningTaskId: 'task-1', stage: 'retrying' },
      stream: null,
      submitting: false,
    })
    const failed = resolveWorkspaceCanvasLifecycle({
      persistedPhase: 'pending',
      task: {
        phase: 'failed',
        taskId: 'task-1',
        runningTaskId: null,
        lastError: { code: 'FINAL_FAILURE', message: 'Final failure' },
      },
      stream: null,
      submitting: false,
    })
    const canceled = resolveWorkspaceCanvasLifecycle({
      persistedPhase: 'succeeded',
      task: { phase: 'canceled', taskId: 'task-1', runningTaskId: null },
      stream: null,
      submitting: false,
    })
    const dismissed = resolveWorkspaceCanvasLifecycle({
      persistedPhase: 'succeeded',
      task: { phase: 'dismissed', taskId: 'task-1', runningTaskId: null },
      stream: null,
      submitting: false,
    })

    expect(retrying.phase).toBe('queued')
    expect(failed).toMatchObject({ phase: 'failed', error: { code: 'FINAL_FAILURE' } })
    expect(canceled.phase).toBe('canceled')
    expect(dismissed.phase).toBe('canceled')
  })

  it('requires an explicit notApplicable declaration for unsupported capabilities', () => {
    expect(['supported', 'notApplicable']).toContain(definition.stream.kind)
    expect(['supported', 'notApplicable']).toContain(definition.runtime.kind)
    expect(['supported', 'notApplicable']).toContain(definition.terminalHandoff.kind)
  })

  it('accepts matching stream facts and rejects the same stream after terminal handoff', () => {
    if (definition.stream.kind === 'notApplicable') {
      expect(definition.stream.reason.length).toBeGreaterThan(0)
      return
    }
    const stream = {
      taskId: 'task-1',
      taskType: 'conformance_task',
      presentation: {
        isStreaming: true,
        activeItemKey: 'item-1',
        displayedItemKeys: ['item-1'],
        pinnedItemKeys: [],
        revealedFieldCountByKey: {},
      },
      error: null,
    } as const
    const streaming = resolveWorkspaceCanvasLifecycle({
      persistedPhase: 'succeeded',
      task: {
        phase: 'processing',
        taskId: 'task-1',
        runningTaskId: 'task-1',
        runningTaskType: 'conformance_task',
      },
      stream,
      submitting: false,
    })
    const terminal = resolveWorkspaceCanvasLifecycle({
      persistedPhase: 'succeeded',
      task: {
        phase: 'completed',
        taskId: 'task-1',
        runningTaskId: null,
        runningTaskType: 'conformance_task',
      },
      stream,
      submitting: false,
    })

    expect(streaming.phase).toBe('streaming')
    expect(terminal.phase).toBe('succeeded')
    expect(terminal.stream).toBeNull()
  })
})
