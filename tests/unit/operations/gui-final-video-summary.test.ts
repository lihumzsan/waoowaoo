import { describe, expect, it } from 'vitest'
import { normalizeFinalVideoSummary } from '@/lib/operations/domains/gui/final-video-summary'

describe('final video summary normalization', () => {
  it('surfaces completed music score from episode-level music score data', () => {
    const summary = normalizeFinalVideoSummary({
      id: 'final-output-1',
      episodeId: 'episode-1',
      renderStatus: null,
      renderTaskId: null,
      outputUrl: null,
      updatedAt: new Date('2026-05-15T12:02:41.656Z'),
    }, {
      id: 'music-score-1',
      status: 'completed',
      version: 1,
      taskId: 'task-bgm-1',
      timelineSignature: 'timeline-1',
      musicModel: 'google::lyria-3-pro-preview',
      cuesJson: {
        schemaVersion: 2,
        durationSeconds: 57,
        creativeBrief: {
          cueType: 'continuous instrumental underscore',
          genre: 'sci-fi drama',
          mood: 'awe',
          narrativeFunction: 'connect the edit',
        },
        scoreDesign: {
          overview: 'One coherent score design.',
          sections: [{ category: 'Cue Arc', title: 'Reveal', content: 'Open harmony.' }],
        },
        virtualLayers: [{ name: 'wide pad', purpose: 'internal color', content: 'not rendered separately' }],
        promptSections: [{ title: 'Main prompt', content: 'Generate one final cue.' }],
        finalPrompt: 'Generate one complete continuous instrumental cinematic BGM track for 57 seconds.',
      },
      mixJson: {
        mediaId: 'mix-media-1',
        url: '/m/mix-1',
        storageKey: 'images/music/bgm-score.m4a',
        mimeType: 'audio/mp4',
        durationMs: 57000,
      },
    })

    expect(summary?.musicScore).toMatchObject({
      status: 'completed',
      musicModel: 'google::lyria-3-pro-preview',
      mix: {
        url: '/m/mix-1',
      },
    })
    const cues = summary?.musicScore?.cues as { scoreDesign?: { overview?: string } } | undefined
    expect(cues?.scoreDesign?.overview).toBe('One coherent score design.')
  })

  it('omits music score when no episode music score exists', () => {
    expect(normalizeFinalVideoSummary({
      id: 'final-output-1',
      episodeId: 'episode-1',
    })?.musicScore).toBeNull()
  })
})
