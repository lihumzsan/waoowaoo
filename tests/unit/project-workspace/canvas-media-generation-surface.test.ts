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
 * Rejects: planning one chapter-owned video segment with only episode scope, which makes
 * the server infer a default chapter and fail for multi-chapter episodes.
 * Production entry: resolveWorkspaceCanvasBillableActionRequest.
 * Oracle: both grid and asset-reference requests preserve the action's exact chapterId.
 * Command: npx vitest run tests/unit/project-workspace/canvas-media-generation-surface.test.ts
 */
describe('resolveWorkspaceCanvasBillableActionRequest', () => {
  it('preserves explicit chapter scope for both single-segment video modes', () => {
    const shared = {
      projectId: 'project-1',
      episodeId: 'episode-1',
    }

    expect(resolveWorkspaceCanvasBillableActionRequest({
      ...shared,
      action: {
        type: 'generate_video_group',
        chapterId: 'chapter-2',
        gridMode: '2x2',
        shotIds: ['shot-3', 'shot-4'],
      },
    })?.input).toEqual({
      all: false,
      episodeId: 'episode-1',
      chapterId: 'chapter-2',
      mode: 'grid',
      gridMode: '2x2',
      shotIds: ['shot-3', 'shot-4'],
    })

    expect(resolveWorkspaceCanvasBillableActionRequest({
      ...shared,
      action: {
        type: 'generate_asset_reference_video',
        chapterId: 'chapter-2',
        segmentIndex: 1,
        referenceImageUrls: ['/m/reference-1'],
      },
    })?.input).toEqual({
      all: false,
      episodeId: 'episode-1',
      chapterId: 'chapter-2',
      mode: 'asset-reference',
      segmentIndex: 1,
      referenceImageUrls: ['/m/reference-1'],
    })
  })
})
