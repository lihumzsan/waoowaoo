import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import {
  buildEnvironmentSoundAcrossfadeFilter,
  parseSceneChangeTimes,
  parseVoiceActivity,
  probeEnvironmentSoundMedia,
  selectEnvironmentSoundFrameTimes,
  summarizeEnvironmentSoundVoiceActivity,
} from '@/lib/video-tools/environment-sound-media'

describe('environment sound media analysis', () => {
  it('parses unique scene-change timestamps from FFmpeg showinfo output', () => {
    const stderr = [
      '[Parsed_showinfo_1] n:0 pts:123 pts_time:12.45 pos:0',
      '[Parsed_showinfo_1] n:1 pts:124 pts_time:12.45 pos:1',
      '[Parsed_showinfo_1] n:2 pts:330 pts_time:33.01 pos:2',
      '[Parsed_showinfo_1] pts_time:not-a-number',
    ].join('\n')

    expect(parseSceneChangeTimes(stderr)).toEqual([12.45, 33.01])
  })

  it('converts silence intervals into dialogue-active ranges', () => {
    const stderr = [
      '[silencedetect] silence_start: 2',
      '[silencedetect] silence_end: 5 | silence_duration: 3',
      '[silencedetect] silence_start: 8',
    ].join('\n')

    expect(parseVoiceActivity(stderr, 10)).toEqual([
      { startSeconds: 0, endSeconds: 2 },
      { startSeconds: 5, endSeconds: 8 },
    ])
  })

  it('treats uploaded voice as density-only even when its duration nearly matches the video', () => {
    const ranges = [{ startSeconds: 0, endSeconds: 4 }]

    expect(summarizeEnvironmentSoundVoiceActivity(ranges, 594, 600)).toMatchObject({
      timelineAligned: false,
      activeRanges: [],
      activeRatio: 0.007,
    })
    expect(summarizeEnvironmentSoundVoiceActivity(ranges, 10, 10)).toMatchObject({
      timelineAligned: false,
      activeRanges: [],
      activeRatio: 0.4,
    })
  })

  it('selects at most twelve ordered frames while retaining endpoints and scene changes', () => {
    const result = selectEnvironmentSoundFrameTimes(120, [33, 61])

    expect(result).toHaveLength(12)
    expect(result[0]).toBe(0)
    expect(result.at(-1)).toBe(119.9)
    expect(result).toContain(33)
    expect(result).toContain(61)
    expect(result).toEqual([...result].sort((left, right) => left - right))
  })

  it('keeps both endpoints when scene detection returns more cuts than the frame budget', () => {
    const result = selectEnvironmentSoundFrameTimes(
      120,
      Array.from({ length: 30 }, (_, index) => (index + 1) * 3),
    )

    expect(result).toHaveLength(12)
    expect(result[0]).toBe(0)
    expect(result.at(-1)).toBe(119.9)
    expect(result.some((timestamp) => timestamp > 80)).toBe(true)
  })

  it('reserves whole-video coverage when dense scene cuts cluster at the beginning', () => {
    const result = selectEnvironmentSoundFrameTimes(
      120,
      [0.1, 1, 1.9, 2.8, 4, 4.9, 5.8, 6.7, 7.9, 8.8, 9.7],
    )

    expect(result).toHaveLength(12)
    expect(result.some((timestamp) => timestamp >= 45 && timestamp <= 75)).toBe(true)
    expect(result.some((timestamp) => timestamp >= 80 && timestamp < 119)).toBe(true)
  })

  it('exposes bounded child-process options and parses digital silence', async () => {
    const mediaModule = await import('@/lib/video-tools/environment-sound-media') as typeof import('@/lib/video-tools/environment-sound-media') & {
      buildEnvironmentSoundCommandOptions?: (timeoutMs: number) => Record<string, unknown>
      parseEnvironmentSoundMaxVolume?: (stderr: string) => number
    }

    expect(mediaModule.buildEnvironmentSoundCommandOptions).toBeTypeOf('function')
    expect(mediaModule.buildEnvironmentSoundCommandOptions!(30_000)).toMatchObject({
      timeout: 30_000,
      killSignal: 'SIGKILL',
    })
    expect(mediaModule.parseEnvironmentSoundMaxVolume).toBeTypeOf('function')
    expect(mediaModule.parseEnvironmentSoundMaxVolume!('[Parsed_volumedetect] max_volume: -inf dB'))
      .toBe(Number.NEGATIVE_INFINITY)
  })

  it('reports a stable error when FFprobe is unavailable', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'waoowaoo-environment-sound-test-'))
    const originalFfprobePath = process.env.FFPROBE_PATH
    try {
      process.env.FFPROBE_PATH = path.join(directory, 'missing-ffprobe')

      await expect(probeEnvironmentSoundMedia(path.join(directory, 'input.mp4')))
        .rejects.toThrow('ENVIRONMENT_SOUND_FFMPEG_UNAVAILABLE')
    } finally {
      if (originalFfprobePath === undefined) delete process.env.FFPROBE_PATH
      else process.env.FFPROBE_PATH = originalFfprobePath
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it('builds an acrossfade chain that preserves transition order', () => {
    expect(buildEnvironmentSoundAcrossfadeFilter([1, 0.1])).toBe(
      '[0:a][1:a]acrossfade=d=1:c1=tri:c2=tri[a1];[a1][2:a]acrossfade=d=0.1:c1=tri:c2=tri[a2]',
    )
  })

  it('renders the localized environment analysis prompt with all factual inputs', () => {
    const prompt = buildPrompt({
      promptId: PROMPT_IDS.VIDEO_TOOLS_ENVIRONMENT_SOUND_ANALYSIS,
      locale: 'zh',
      variables: {
        video_duration: '120.000',
        frame_timestamps: '[0, 20, 40]',
        has_source_audio: 'true',
        source_audio_activity: '{"timelineAligned":true,"activeRatio":0.4}',
        script_dialogue: '角色走进雨夜街道。',
        voice_activity: '[{"startSeconds":0,"endSeconds":8}]',
      },
    })

    expect(prompt).toContain('120.000')
    expect(prompt).toContain('角色走进雨夜街道。')
    expect(prompt).toContain('"timelineAligned":true')
    expect(prompt).toContain('promptEn')
    expect(prompt).toContain('negativePromptEn')
  })
})
