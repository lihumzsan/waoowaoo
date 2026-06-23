import { describe, expect, it } from 'vitest'
import { extractWorkspaceResourceChangeEventSpecs } from '@/lib/workspace-resource/resource-change-events'

describe('resource-change-events', () => {
  it('extracts a resource.changed spec from an edit screenplay result', () => {
    const specs = extractWorkspaceResourceChangeEventSpecs({
      result: {
        id: 'screenplay-1',
        projectId: 'project-1',
        episodeId: 'episode-1',
        userPrompt: 'quiet film',
        screenplayText: '标题：《静水》',
        status: 'ready',
      },
      fallbackProjectId: 'project-1',
      fallbackEpisodeId: 'episode-1',
    })

    expect(specs).toEqual([{
      projectId: 'project-1',
      episodeId: 'episode-1',
      resources: [
        'editScreenplay',
        'editDirectorDecoupage',
        'editScript',
        'editCinematographyShotPlan',
        'storyboards',
        'episodeData',
        'projectContext',
        'projectData',
      ],
    }])
  })
})
