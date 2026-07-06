import { describe, expect, it } from 'vitest'
import { extractWorkspaceResourceChangeEventSpecs } from '@/lib/workspace-resource/resource-change-events'

describe('resource-change-events', () => {
  it('extracts a resource.changed spec from an edit bible result', () => {
    const specs = extractWorkspaceResourceChangeEventSpecs({
      result: {
        editBible: {
          id: 'bible-1',
          projectId: 'project-1',
          episodeId: 'episode-1',
          sourceDocumentId: 'source-document-1',
          userPrompt: 'quiet film',
          bibleText: '标题：《静水》',
          status: 'ready_for_review',
        },
      },
      fallbackProjectId: 'project-1',
      fallbackEpisodeId: 'episode-1',
    })

    expect(specs).toEqual([{
      projectId: 'project-1',
      affectedResources: [
        { kind: 'editBible', projectId: 'project-1', episodeId: 'episode-1' },
        { kind: 'editScript', projectId: 'project-1', episodeId: 'episode-1' },
        { kind: 'editShotExecutionPlan', projectId: 'project-1', episodeId: 'episode-1' },
        { kind: 'storyboards', projectId: 'project-1', episodeId: 'episode-1' },
        { kind: 'episodeData', projectId: 'project-1', episodeId: 'episode-1' },
        { kind: 'projectContext', projectId: 'project-1', episodeId: 'episode-1' },
        { kind: 'projectData', projectId: 'project-1' },
      ],
    }])
  })
})
