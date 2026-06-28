import { describe, expect, it } from 'vitest'
import {
  resolveWorkspaceCanvasActionPlanRequest,
  workspaceCanvasActionBillingPreviewKey,
} from '@/features/project-workspace/canvas/hooks/useWorkspaceCanvasActionBillingPreviews'
import type { WorkspaceCanvasNodeAction } from '@/features/project-workspace/canvas/node-canvas-types'

function resolve(action: WorkspaceCanvasNodeAction) {
  const request = resolveWorkspaceCanvasActionPlanRequest({
    projectId: 'project-1',
    episodeId: 'episode-1',
    action,
  })
  if (!request) throw new Error('ACTION_REQUEST_NOT_RESOLVED')
  return request
}

describe('workspace canvas action billing previews', () => {
  it('maps BGM generation to the music operation plan without requiring confirmation UI state', () => {
    const request = resolve({ type: 'generate_bgm_score' })

    expect(request.operationId).toBe('generate_episode_bgm_score')
    expect(request.input).toEqual({ episodeId: 'episode-1' })
    expect(request.context).toEqual({ episodeId: 'episode-1' })
  })

  it('maps grouped video actions to the same operation input used by submission', () => {
    const request = resolve({
      type: 'generate_video_group',
      gridMode: '3x3',
      shotNumbers: [1, 2, 3],
      generationOptions: { duration: 5, loop: false },
    })

    expect(request.operationId).toBe('generate_video_group')
    expect(request.input).toEqual({
      all: false,
      episodeId: 'episode-1',
      mode: 'grid',
      gridMode: '3x3',
      shotNumbers: [1, 2, 3],
      generationOptions: { duration: 5, loop: false },
    })
  })

  it('uses stable keys for equivalent visible actions', () => {
    const action: WorkspaceCanvasNodeAction = {
      type: 'generate_video',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      panelId: 'panel-1',
    }

    expect(workspaceCanvasActionBillingPreviewKey({
      projectId: 'project-1',
      episodeId: 'episode-1',
      action,
    })).toBe(resolve(action).cacheKey)
  })
})
