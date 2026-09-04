import { beforeEach, describe, expect, it, vi } from 'vitest'

const { runFfmpegCommand } = vi.hoisted(() => ({
  runFfmpegCommand: vi.fn(),
}))

vi.mock('@/lib/video-compose/ffmpeg-command', () => ({
  runFfmpegCommand,
}))

import { probeVideoFrameRate } from '@/lib/video-compose/video-merge-ffmpeg'

describe('video merge frame-rate contract', () => {
  beforeEach(() => {
    runFfmpegCommand.mockReset()
  })

  it('preserves a supported fractional frame rate', async () => {
    runFfmpegCommand.mockResolvedValue({ stdout: '30000/1001\n', stderr: '' })

    await expect(probeVideoFrameRate('/unused/source.mp4')).resolves.toBe('30000/1001')
  })

  it('rejects a malformed ffprobe frame-rate value', async () => {
    runFfmpegCommand.mockResolvedValue({ stdout: '24fps/1\n', stderr: '' })

    await expect(probeVideoFrameRate('/unused/source.mp4')).rejects.toThrow(
      'WORKSPACE_RESOURCE_VIDEO_MERGE_FRAME_RATE_INVALID',
    )
  })

  it('rejects a frame rate above the supported encoding boundary', async () => {
    runFfmpegCommand.mockResolvedValue({ stdout: '240/1\n', stderr: '' })

    await expect(probeVideoFrameRate('/unused/source.mp4')).rejects.toThrow(
      'WORKSPACE_RESOURCE_VIDEO_MERGE_FRAME_RATE_INVALID',
    )
  })
})
