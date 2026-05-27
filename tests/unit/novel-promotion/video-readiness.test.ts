import { describe, expect, it } from 'vitest'
import {
  resolvePanelVideoReadinessIssue,
  summarizeVideoReadinessIssues,
  type VideoReadinessPanelLike,
} from '@/lib/novel-promotion/video-readiness'

function buildPanel(overrides?: Partial<VideoReadinessPanelLike>): VideoReadinessPanelLike {
  return {
    id: 'panel-1',
    imageUrl: 'cos/panel.png',
    videoPrompt: 'The doctor pushes his glasses.',
    description: 'The doctor pushes his glasses.',
    srtSegment: 'The doctor pushes his glasses.',
    matchedVoiceLines: [],
    storyboard: {
      clip: {
        content: 'A doctor and a young man talk in an office.',
      },
    },
    ...(overrides || {}),
  }
}

describe('video readiness', () => {
  it('accepts panels when stale structured prompts can fall back to panel facts', () => {
    const issue = resolvePanelVideoReadinessIssue(buildPanel({
      videoPrompt: [
        'GLOBAL:',
        'Office night.',
        'LOCAL:',
        '[0.0-2.5] Wrong action | [2.5-5.0] Another wrong action',
      ].join('\n'),
      videoPromptEditedByUser: true,
      description: 'The middle-aged doctor pushes his glasses.',
    }))

    expect(issue).toBeNull()
  })

  it('blocks batch readiness when matched audio exceeds the selected LTX workflow max', () => {
    const issue = resolvePanelVideoReadinessIssue(buildPanel({
      matchedVoiceLines: [
        { id: 'line-1', content: 'ok', audioDuration: 23_884 },
      ],
    }), {
      durationOptions: [2, 4, 6, 8, 12],
    })

    expect(issue?.code).toBe('audio_duration_exceeds_model')
    expect(issue?.details).toMatchObject({
      audioDurationSeconds: 23.88,
      maxDurationSeconds: 12,
    })
  })

  it('blocks batch readiness when long LTX audio exceeds the normal workflow duration', () => {
    const issue = resolvePanelVideoReadinessIssue(buildPanel({
      matchedVoiceLines: [
        {
          id: 'line-1',
          content: 'This long line should use a dedicated long video workflow.',
          audioDuration: 23_884,
        },
      ],
    }), {
      modelKey: 'comfyui::basevideo/demo/LTX2.3-fast',
      durationOptions: [4, 5, 6, 8, 10, 12],
      payload: {
        videoModel: 'comfyui::basevideo/demo/LTX2.3-fast',
      },
    })

    expect(issue?.code).toBe('audio_duration_exceeds_model')
    expect(issue?.details).toMatchObject({
      audioDurationSeconds: 23.88,
      maxDurationSeconds: 12,
      blockedReason: 'audio_exceeds_max_duration',
    })
  })

  it('allows batch readiness for 23.884s audio on the 30s Damaicha long-video workflow', () => {
    const issue = resolvePanelVideoReadinessIssue(buildPanel({
      matchedVoiceLines: [
        {
          id: 'line-1',
          content: 'This long line should go through the selected long video workflow.',
          audioDuration: 23_884,
        },
      ],
    }), {
      modelKey: 'comfyui::basevideo/ltx23-profiles/damaicha-image-to-30s-long-video',
      payload: {
        videoModel: 'comfyui::basevideo/ltx23-profiles/damaicha-image-to-30s-long-video',
      },
    })

    expect(issue).toBeNull()
  })

  it('blocks short dialogue that is bound to unusually long audio before batch submission', () => {
    const issue = resolvePanelVideoReadinessIssue(buildPanel({
      matchedVoiceLines: [
        { id: 'line-1', content: 'no', audioDuration: 6_200 },
      ],
    }), {
      durationOptions: [2, 4, 6, 8, 12],
    })

    expect(issue?.code).toBe('short_dialogue_audio_too_long')
  })

  it('allows borderline compact Chinese dialogue around 4.5 seconds', () => {
    const issue = resolvePanelVideoReadinessIssue(buildPanel({
      matchedVoiceLines: [
        { id: 'line-1', content: '影响治疗效果。', audioDuration: 4_534 },
      ],
    }), {
      durationOptions: [2, 4, 6, 8, 12],
    })

    expect(issue).toBeNull()
  })

  it('allows short dialogue when the audio duration remains compact', () => {
    const issue = resolvePanelVideoReadinessIssue(buildPanel({
      matchedVoiceLines: [
        { id: 'line-1', content: 'ok', audioDuration: 3_200 },
      ],
    }), {
      durationOptions: [2, 4, 6, 8, 12],
    })

    expect(issue).toBeNull()
  })

  it('summarizes skipped readiness issue codes', () => {
    expect(summarizeVideoReadinessIssues([
      { code: 'missing_image', message: 'missing' },
      { code: 'missing_image', message: 'missing' },
      { code: 'short_dialogue_audio_too_long', message: 'long' },
      null,
    ])).toEqual({
      missing_image: 2,
      short_dialogue_audio_too_long: 1,
    })
  })
})
