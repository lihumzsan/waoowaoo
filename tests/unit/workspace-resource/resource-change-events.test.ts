import { describe, expect, it } from 'vitest'
import {
  buildWorkspaceResourceBroadcastIdempotencyKey,
  extractWorkspaceResourceChangeEventSpecs,
} from '@/lib/workspace-resource/resource-change-events'

describe('resource-change-events', () => {
  it('groups explicit resource refs without inspecting an operation result', () => {
    const specs = extractWorkspaceResourceChangeEventSpecs({
      affectedResources: [
        { kind: 'storyCanon', projectId: 'project-1', episodeId: 'episode-1' },
        { kind: 'projectData', projectId: 'project-1' },
        { kind: 'storyCanon', projectId: 'project-1', episodeId: 'episode-1' },
      ],
    })

    expect(specs).toEqual([{
      projectId: 'project-1',
      affectedResources: [
        { kind: 'storyCanon', projectId: 'project-1', episodeId: 'episode-1' },
        { kind: 'projectData', projectId: 'project-1' },
      ],
    }])
  })

  it('derives a deterministic bounded Outbox identity from arbitrarily long invocation identities', () => {
    const invocationId = `merge_videos:${'resource-identity:'.repeat(80)}`
    const first = buildWorkspaceResourceBroadcastIdempotencyKey({
      invocationId,
      projectId: 'project-1',
    })
    const replay = buildWorkspaceResourceBroadcastIdempotencyKey({
      invocationId,
      projectId: 'project-1',
    })
    const differentProject = buildWorkspaceResourceBroadcastIdempotencyKey({
      invocationId,
      projectId: 'project-2',
    })

    expect(first).toBe(replay)
    expect(first).not.toBe(differentProject)
    expect(first).toMatch(/^workspace-resource:[a-f0-9]{64}$/)
    expect(first.length).toBeLessThanOrEqual(191)
  })
})
