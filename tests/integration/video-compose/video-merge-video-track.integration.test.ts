import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runFfmpegCommand } from '@/lib/video-compose/ffmpeg-command'
import { composeVideoMergeVideoTrack } from '@/lib/video-compose/video-merge-ffmpeg'

const DURATION_SECONDS = 1

describe('video merge single-video track preparation', () => {
  let workspaceDir = ''

  afterEach(async () => {
    if (workspaceDir) await rm(workspaceDir, { recursive: true, force: true })
    workspaceDir = ''
  })

  it('keeps a compatible H.264 single-video stream at its original frame rate', async () => {
    workspaceDir = await mkdtemp(path.join(tmpdir(), 'waoowaoo-video-merge-track-'))
    const sourcePath = path.join(workspaceDir, 'source.mp4')
    await runFfmpegCommand('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', `color=c=black:s=320x180:r=24:d=${String(DURATION_SECONDS)}`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', sourcePath,
    ], { stage: 'video_merge_track_test_source', expectedDurationSeconds: DURATION_SECONDS })

    const result = await composeVideoMergeVideoTrack({
      sourcePaths: [sourcePath],
      durations: [DURATION_SECONDS],
      workspaceDir,
      width: 320,
      height: 180,
    })
    const probe = await runFfmpegCommand('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,r_frame_rate',
      '-of', 'default=noprint_wrappers=1', result,
    ], { stage: 'video_merge_track_test_probe' })

    expect(result).toBe(sourcePath)
    expect(probe.stdout).toContain('codec_name=h264')
    expect(probe.stdout).toContain('r_frame_rate=24/1')
  })
})
