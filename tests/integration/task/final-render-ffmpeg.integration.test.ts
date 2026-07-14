import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { muxFinalRenderAudio, renderFinalRenderClipAudio } from '@/lib/video-compose/final-render-audio'
import { createFfmpegCommandRunner, runFfmpegCommand } from '@/lib/video-compose/ffmpeg-command'

type ProbeStream = {
  readonly codec_name?: string
  readonly codec_type?: string
  readonly sample_rate?: string
}

type ProbeResult = {
  readonly format?: {
    readonly duration?: string
  }
  readonly streams?: readonly ProbeStream[]
}

async function probeMedia(filePath: string): Promise<ProbeResult> {
  const result = await runFfmpegCommand('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,codec_type,sample_rate', '-of', 'json', filePath], { stage: 'critical_final_render_probe' })
  return JSON.parse(result.stdout) as ProbeResult
}

describe('final render FFmpeg composition', () => {
  it('keeps the canonical video duration when source audio is shorter than M4A music layers', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'final-render-ffmpeg-'))
    const durationSeconds = 2
    const sourcePath = path.join(workspace, 'source.mp4')
    const stitchedPath = path.join(workspace, 'stitched.mp4')
    const mainAudioPath = path.join(workspace, 'main-audio.wav')
    const musicPath = path.join(workspace, 'music.m4a')
    const ambientSoundPath = path.join(workspace, 'ambient-sound.m4a')
    const outputPath = path.join(workspace, 'final.mp4')

    try {
      await Promise.all([
        runFfmpegCommand('ffmpeg', ['-y', '-f', 'lavfi', '-i', `color=c=black:s=320x180:r=24:d=${durationSeconds}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', stitchedPath], {
          stage: 'critical_final_render_stitched_fixture',
          expectedDurationSeconds: durationSeconds,
        }),
        runFfmpegCommand('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=24:d=1.500', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=1.500', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', sourcePath], {
          stage: 'critical_final_render_source_fixture',
          expectedDurationSeconds: 1.5,
        }),
        runFfmpegCommand('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=44100:duration=2.040', '-c:a', 'aac', musicPath], {
          stage: 'critical_final_render_music_fixture',
          expectedDurationSeconds: 2.04,
        }),
        runFfmpegCommand('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=110:sample_rate=96000:duration=2.010', '-c:a', 'aac', ambientSoundPath], {
          stage: 'critical_final_render_ambient_fixture',
          expectedDurationSeconds: 2.01,
        }),
      ])

      const hasSourceAudio = await renderFinalRenderClipAudio({
        runCommand: createFfmpegCommandRunner({
          stage: 'critical_final_render_clip_audio',
          expectedDurationSeconds: durationSeconds,
        }),
        sourcePath,
        outputPath: mainAudioPath,
        durationSeconds,
      })
      expect(hasSourceAudio).toBe(true)

      const intermediate = await probeMedia(mainAudioPath)
      expect(intermediate.streams).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            codec_name: 'pcm_s16le',
            codec_type: 'audio',
            sample_rate: '48000',
          }),
        ]),
      )

      await muxFinalRenderAudio({
        runCommand: createFfmpegCommandRunner({
          stage: 'critical_final_render_mux',
          expectedDurationSeconds: durationSeconds,
        }),
        stitchedPath,
        mainAudioPath,
        hasSourceAudio,
        musicPath,
        ambientSoundPath,
        outputPath,
        durationSeconds,
        volume: 1,
      })

      const finalMedia = await probeMedia(outputPath)
      expect(Number.parseFloat(finalMedia.format?.duration ?? '')).toBeCloseTo(durationSeconds, 1)
      expect(new Set(finalMedia.streams?.map((stream) => stream.codec_type))).toEqual(new Set(['video', 'audio']))
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  }, 45_000)
})
