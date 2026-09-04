import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  probeGeneratedTemporaryVideoDurationMs,
  uploadVideoSourceToStorage,
} from '@/lib/task/execution/provider-media'
import {
  probeMediaDurationSeconds,
  runFfmpegCommand,
} from '@/lib/video-compose/ffmpeg-command'

describe('H3 generated duration preservation', () => {
  let workspaceDir = ''

  beforeEach(async () => {
    workspaceDir = await mkdtemp(path.join(tmpdir(), 'waoowaoo-h3-duration-preservation-'))
  })

  afterEach(async () => {
    if (workspaceDir) await rm(workspaceDir, { recursive: true, force: true })
  })

  it('observes all 107 video frames and audio packets after the requested four-second mark', async () => {
    const sourcePath = path.join(workspaceDir, 'source.mp4')
    await runFfmpegCommand('ffmpeg', [
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=black:s=320x180:r=24',
      '-f', 'lavfi',
      '-i', 'sine=frequency=880:sample_rate=48000',
      '-t', String(107 / 24),
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-shortest',
      sourcePath,
    ], {
      stage: 'h3_duration_preservation_fixture',
      expectedDurationSeconds: 107 / 24,
    })

    const durationMs = await probeGeneratedTemporaryVideoDurationMs({
      kind: 'temporary_file',
      path: sourcePath,
      directory: workspaceDir,
      contentType: 'video/mp4',
      byteLength: 1,
    })
    const durationSeconds = await probeMediaDurationSeconds(
      sourcePath,
      'h3_duration_preservation_probe',
    )
    const audioPackets = await runFfmpegCommand('ffprobe', [
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'packet=pts_time',
      '-of', 'csv=p=0',
      sourcePath,
    ], { stage: 'h3_duration_preservation_audio_packets' })
    const lastAudioPacketSeconds = Math.max(...audioPackets.stdout
      .trim()
      .split('\n')
      .map((value) => Number.parseFloat(value)))

    expect(durationMs).toBe(Math.round(durationSeconds * 1000))
    expect(durationSeconds).toBeGreaterThan(4.4)
    expect(lastAudioPacketSeconds).toBeGreaterThan(4)
  })

  it('removes the provider temporary directory when duration probing fails', async () => {
    const sourcePath = path.join(workspaceDir, 'invalid.mp4')
    await writeFile(sourcePath, 'not an mp4')

    await expect(uploadVideoSourceToStorage(
      {
        kind: 'temporary_file',
        path: sourcePath,
        directory: workspaceDir,
        contentType: 'video/mp4',
        byteLength: 10,
      },
      'workspace-resource',
      'resource-invalid-video',
      'preserve',
    )).rejects.toThrow()

    await expect(stat(workspaceDir)).rejects.toMatchObject({ code: 'ENOENT' })
    workspaceDir = ''
  })
})
