import { describe, expect, it } from 'vitest'
import { normalizeFinalVideoSummary } from '@/lib/operations/domains/gui/final-video-summary'

describe('final video summary normalization', () => {
  it('surfaces completed BGM score from episode final output data', () => {
    const summary = normalizeFinalVideoSummary({
      id: 'final-output-1',
      episodeId: 'episode-1',
      renderStatus: null,
      renderTaskId: null,
      outputUrl: null,
      updatedAt: new Date('2026-05-15T12:02:41.656Z'),
      bgmScoreJson: {
        schemaVersion: 2,
        status: 'completed',
        taskId: 'task-bgm-1',
        editScriptId: 'edit-script-1',
        timelineSignature: 'timeline-1',
        durationSeconds: 57,
        musicModel: 'google::lyria-3-pro-preview',
        plan: {
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
          negativePrompt: 'no vocals',
        },
        mix: {
          mediaId: 'mix-media-1',
          url: '/m/mix-1',
          storageKey: 'images/music/bgm-score.m4a',
          mimeType: 'audio/mp4',
          durationMs: 57000,
        },
      },
    })

    expect(summary?.bgmScore).toMatchObject({
      status: 'completed',
      durationSeconds: 57,
      mix: {
        url: '/m/mix-1',
      },
    })
    const plan = summary?.bgmScore?.plan as { virtualLayers?: readonly unknown[] } | undefined
    expect(plan?.virtualLayers).toHaveLength(1)
  })

  it('fails explicitly for invalid serialized BGM score data', () => {
    expect(() => normalizeFinalVideoSummary({
      id: 'final-output-1',
      episodeId: 'episode-1',
      bgmScoreJson: '{invalid-json',
    })).toThrow()
  })
})
