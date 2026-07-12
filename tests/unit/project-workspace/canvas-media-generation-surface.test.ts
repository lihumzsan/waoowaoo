import { describe, expect, it } from 'vitest'
import { resolveCanvasMediaSurfacePhase } from '@/features/project-workspace/canvas/nodes/canvas-media-generation-view'
import type { WorkspaceCanvasLifecycle } from '@/features/project-workspace/canvas/lifecycle/workspace-canvas-lifecycle'

const lifecyclePhases = [
  'pending',
  'submitting',
  'queued',
  'processing',
  'streaming',
  'succeeded',
  'failed',
  'canceled',
] as const satisfies readonly WorkspaceCanvasLifecycle['phase'][]

describe('resolveCanvasMediaSurfacePhase', () => {
  it('exhaustively resolves empty and existing media through the shared five-state view', () => {
    expect(lifecyclePhases.map((lifecyclePhase) => ({
      lifecyclePhase,
      empty: resolveCanvasMediaSurfacePhase({ lifecyclePhase, hasOutput: false }),
      existing: resolveCanvasMediaSurfacePhase({ lifecyclePhase, hasOutput: true }),
    }))).toEqual([
      { lifecyclePhase: 'pending', empty: 'empty', existing: 'ready' },
      { lifecyclePhase: 'submitting', empty: 'generating', existing: 'regenerating' },
      { lifecyclePhase: 'queued', empty: 'generating', existing: 'regenerating' },
      { lifecyclePhase: 'processing', empty: 'generating', existing: 'regenerating' },
      { lifecyclePhase: 'streaming', empty: 'generating', existing: 'regenerating' },
      { lifecyclePhase: 'succeeded', empty: 'contract-error', existing: 'ready' },
      { lifecyclePhase: 'failed', empty: 'failed-empty', existing: 'failed-existing' },
      { lifecyclePhase: 'canceled', empty: 'empty', existing: 'ready' },
    ])
  })
})
