import { describe, expect, it, vi } from 'vitest'
import {
  buildSoundscapeFilterComplex,
  buildSoundscapeSectionDspFilters,
  renderSoundscapeMix,
} from '@/lib/soundscape/mixer'
import type { SoundscapeResolvedSection } from '@/lib/soundscape/timeline'
import type { SoundscapeSourceAsset } from '@/lib/soundscape/types'

const source: SoundscapeSourceAsset = {
  sourceId: 'city_wind',
  environmentFingerprint: 'night_city_wind',
  prompt: 'Seamless loop of steady city wind, no music, no voices, no footsteps.',
  mediaId: 'media-source-1',
  url: 'https://cdn.example/source.mp3',
  storageKey: 'soundscape/source.mp3',
  mimeType: 'audio/mpeg',
  durationMs: 30000,
  loopDurationSeconds: 30,
  promptInfluence: 0.55,
  soundEffectModel: 'elevenlabs::eleven_text_to_sound_v2',
}

const section: SoundscapeResolvedSection = {
  index: 0,
  startSeconds: 2.5,
  endSeconds: 6.5,
  durationSeconds: 4,
  sourceClipOrders: [2],
  shotIds: ['shot_002'],
  shotNumbers: [2],
  section: {
    sourceId: 'city_wind',
    fromShotId: 'shot_002',
    toShotId: 'shot_002',
    perspective: 'interior_behind_window',
    intensity: 'high',
    transitionIn: 'fade',
    transitionOut: 'crossfade',
  },
}

describe('soundscape mixer', () => {
  it('maps perspective and intensity to fixed deterministic DSP filters', () => {
    expect(buildSoundscapeSectionDspFilters(section)).toEqual([
      'volume=0.126',
      'lowpass=f=2200',
      'stereotools=slev=0.400',
      'afade=t=in:st=0:d=0.750',
      'afade=t=out:st=3.250:d=0.750',
    ])
  })

  it('builds a concrete ffmpeg filtergraph with episode-continuous loop timing', () => {
    expect(buildSoundscapeFilterComplex({
      sources: [source],
      sections: [section],
      durationSeconds: 10,
    })).toBe([
      '[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:10.000,asetpts=PTS-STARTPTS[src0_0]',
      '[src0_0]atrim=start=2.500:end=6.500,asetpts=PTS-STARTPTS,volume=0.126,lowpass=f=2200,stereotools=slev=0.400,afade=t=in:st=0:d=0.750,afade=t=out:st=3.250:d=0.750,adelay=2500|2500[sec0]',
      '[sec0]amix=inputs=1:duration=longest:dropout_transition=0,atrim=0:10.000,asetpts=PTS-STARTPTS,loudnorm=I=-24:TP=-2:LRA=11,alimiter=limit=0.95[aout]',
    ].join(';'))
  })

  it('passes stream_loop inputs and exact filtergraph to ffmpeg', async () => {
    const runCommand = vi.fn(async () => ({ stdout: '', stderr: '' }))

    await renderSoundscapeMix({
      runCommand,
      sourcePaths: ['/tmp/source.mp3'],
      sources: [source],
      sections: [section],
      outputPath: '/tmp/soundscape.m4a',
      durationSeconds: 10,
    })

    expect(runCommand).toHaveBeenCalledWith('ffmpeg', [
      '-y',
      '-stream_loop',
      '-1',
      '-i',
      '/tmp/source.mp3',
      '-filter_complex',
      buildSoundscapeFilterComplex({
        sources: [source],
        sections: [section],
        durationSeconds: 10,
      }),
      '-map',
      '[aout]',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '/tmp/soundscape.m4a',
    ])
  })

  it('rejects transitions longer than the resolved section', () => {
    expect(() => buildSoundscapeSectionDspFilters({
      ...section,
      durationSeconds: 1,
    })).toThrow('SOUNDSCAPE_SECTION_TRANSITION_TOO_LONG:shot_002:shot_002')
  })
})
