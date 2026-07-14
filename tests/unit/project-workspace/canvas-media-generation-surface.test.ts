import { describe, expect, it } from 'vitest'
import { resolveCanvasMediaSurfacePhase } from '@/features/project-workspace/canvas/nodes/canvas-media-generation-view'
import { resolveWorkspaceCanvasBillableActionRequest } from '@/features/project-workspace/canvas/hooks/useWorkspaceCanvasBillableAction'
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

/**
 * Logic Specification
 * Authority: CN-01 and BA-18 explicit resource scope.
 * Rejects: restoring separate grid and asset-reference video modes instead of the single
 * canonical full-reference segment operation.
 * Production entry: resolveWorkspaceCanvasBillableActionRequest.
 * Oracle: the Canvas submits only the episode-scoped canonical segment operation.
 * Command: npx vitest run tests/unit/project-workspace/canvas-media-generation-surface.test.ts
 */
describe('resolveWorkspaceCanvasBillableActionRequest', () => {
  it('submits the single full-reference segment operation', () => {
    const shared = {
      projectId: 'project-1',
      episodeId: 'episode-1',
    }

    expect(resolveWorkspaceCanvasBillableActionRequest({
      ...shared,
      action: { type: 'generate_video_segments' },
    })?.input).toEqual({
      episodeId: 'episode-1',
    })
  })
})
