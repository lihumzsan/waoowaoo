import { describe, expect, it } from 'vitest'
import { extractWorkspaceResourceChangeEventSpecs } from '@/lib/workspace-resource/resource-change-events'

describe('resource-change-events', () => {
  it('groups explicit resource refs without inspecting an operation result', () => {
    const specs = extractWorkspaceResourceChangeEventSpecs({
      affectedResources: [
        { kind: 'editBible', projectId: 'project-1', episodeId: 'episode-1' },
        { kind: 'projectData', projectId: 'project-1' },
        { kind: 'editBible', projectId: 'project-1', episodeId: 'episode-1' },
      ],
    })

    expect(specs).toEqual([{
      projectId: 'project-1',
      affectedResources: [
        { kind: 'editBible', projectId: 'project-1', episodeId: 'episode-1' },
        { kind: 'projectData', projectId: 'project-1' },
      ],
    }])
  })
})
