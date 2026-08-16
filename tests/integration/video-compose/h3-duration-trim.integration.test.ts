import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { probeMediaDurationSeconds, runFfmpegCommand } from '@/lib/video-compose/ffmpeg-command'
import { trimH3VideoToRequestedDuration } from '@/lib/video-compose/h3-duration-trim'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => await rm(directory, { recursive: true, force: true })))
})

describe('H3 final-duration trim', () => {
  it('re-encodes the H3-grid output to the requested whole-second video and audio duration', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'waoowaoo-h3-duration-trim-'))
    temporaryDirectories.push(directory)
    const sourcePath = path.join(directory, 'grid-duration.mp4')
    const outputPath = path.join(directory, 'requested-duration.mp4')
    await runFfmpegCommand('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=24:d=4.458333',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=32000:duration=4.448',
      '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', sourcePath,
    ], { stage: 'h3_duration_trim_test_source', expectedDurationSeconds: 5 })

    await trimH3VideoToRequestedDuration({ inputPath: sourcePath, outputPath, durationSeconds: 4 })

    expect(await probeMediaDurationSeconds(outputPath, 'h3_duration_trim_test_probe')).toBeCloseTo(4, 1)
  })
})
