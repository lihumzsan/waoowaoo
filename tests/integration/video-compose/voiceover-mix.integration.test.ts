import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFfmpegCommandRunner } from '@/lib/video-compose/ffmpeg-command'
import { muxVoiceoverVideo } from '@/lib/video-compose/voiceover-mix'

function parsePositiveDuration(value: string, label: string): number {
  const duration = Number.parseFloat(value.trim())
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`${label}_DURATION_INVALID:${value.trim()}`)
  return duration
}

describe('voiceover mix real media duration', () => {
  it('preserves a four-second audio stream when source audio ends before narration begins', { timeout: 60_000 }, async () => {
    const workDir = await mkdtemp(path.join(tmpdir(), 'waoowaoo-voiceover-mix-test-'))
    const sourcePath = path.join(workDir, 'source.mp4')
    const narrationPath = path.join(workDir, 'narration.wav')
    const outputPath = path.join(workDir, 'output.mp4')
    const runCommand = createFfmpegCommandRunner({ stage: 'voiceover_mix_duration_integration', expectedDurationSeconds: 4 })

    try {
      await runCommand('ffmpeg', [
        '-y',
        '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=24:d=4',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1',
        '-map', '0:v:0', '-map', '1:a:0',
        '-c:v', 'mpeg4', '-c:a', 'aac', '-t', '4.000',
        sourcePath,
      ])
      await runCommand('ffmpeg', [
        '-y', '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000:duration=0.5',
        '-c:a', 'pcm_s16le', narrationPath,
      ])

      await muxVoiceoverVideo({
        runCommand,
        videoPath: sourcePath,
        narrationPaths: [{ path: narrationPath, startSeconds: 2 }],
        outputPath,
        durationSeconds: 4,
      })

      const audioProbe = await runCommand('ffprobe', [
        '-v', 'error',
        '-select_streams', 'a:0',
        '-show_entries', 'stream=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        outputPath,
      ])
      const audioDurationSeconds = parsePositiveDuration(audioProbe.stdout, 'OUTPUT_AUDIO')
      expect(audioDurationSeconds).toBeGreaterThanOrEqual(3.9)
      expect(audioDurationSeconds).toBeLessThanOrEqual(4.1)
    } finally {
      await rm(workDir, { recursive: true, force: true })
    }
  })
})
