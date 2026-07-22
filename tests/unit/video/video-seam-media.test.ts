import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  buildVideoSeamComposeCommand,
  downloadVideoSeamFile,
  parseVideoSeamProbeJson,
  verifyVideoSeamOutput,
} from '@/lib/video/video-seam-media'
import { buildVideoSeamBridgePlan } from '@/lib/video-tools/seam-bridge-plan'

vi.mock('@/lib/storage', () => ({
  toFetchableUrl: (value: string) => value,
}))

async function withVideoSeamProbeJson<T>(raw: string, run: (outputPath: string) => Promise<T>): Promise<T> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'waoowaoo-video-seam-test-'))
  const executable = path.join(directory, 'ffprobe-fixture')
  const originalProbePath = process.env.FFPROBE_PATH
  const originalRaw = process.env.VIDEO_SEAM_TEST_PROBE_JSON
  try {
    await fs.writeFile(
      executable,
      '#!/usr/bin/env node\nprocess.stdout.write(process.env.VIDEO_SEAM_TEST_PROBE_JSON || \'\')\n',
      { mode: 0o755 },
    )
    process.env.FFPROBE_PATH = executable
    process.env.VIDEO_SEAM_TEST_PROBE_JSON = raw
    return await run(path.join(directory, 'output.mp4'))
  } finally {
    if (originalProbePath === undefined) delete process.env.FFPROBE_PATH
    else process.env.FFPROBE_PATH = originalProbePath
    if (originalRaw === undefined) delete process.env.VIDEO_SEAM_TEST_PROBE_JSON
    else process.env.VIDEO_SEAM_TEST_PROBE_JSON = originalRaw
    await fs.rm(directory, { recursive: true, force: true })
  }
}

describe('video seam local media adapter', () => {
  it('parses counted frames, rational FPS, dimensions, duration, and audio', () => {
    expect(parseVideoSeamProbeJson(JSON.stringify({
      streams: [
        { codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '30000/1001', nb_read_frames: '300' },
        { codec_type: 'audio' },
      ],
      format: { duration: '10.010000' },
    }))).toEqual({
      width: 1920, height: 1080, fps: 30000 / 1001, frameCount: 300,
      durationSeconds: 300 / (30000 / 1001), hasAudio: true,
    })
  })

  it.each([
    '{}',
    '{"streams":[{"codec_type":"video","width":1920,"height":1080,"avg_frame_rate":"0/0","nb_read_frames":"10"}]}',
    '{"streams":[{"codec_type":"video","width":1920,"height":1080,"avg_frame_rate":"24/1"}]}',
  ])('rejects incomplete probe output', (raw) => {
    expect(() => parseVideoSeamProbeJson(raw)).toThrow('VIDEO_SEAM_MEDIA_PROBE_FAILED')
  })

  it('builds seven visual ranges and synchronized audio', () => {
    const plan = buildVideoSeamBridgePlan({
      input1: { width: 1920, height: 1080, fps: 23.976, frameCount: 240, durationSeconds: 10.01, hasAudio: true },
      input2: { width: 1280, height: 720, fps: 24, frameCount: 300, durationSeconds: 12.5, hasAudio: true },
      trimEndFrames: 0, trimStartFrames: 1, durationSeconds: 4,
    })
    const command = buildVideoSeamComposeCommand({
      input1Path: '/tmp/input-1.mp4', bridgePath: '/tmp/bridge.mp4',
      input2Path: '/tmp/input-2.mp4', outputPath: '/tmp/output.mp4', plan,
    })
    const graph = command.args[command.args.indexOf('-filter_complex') + 1]
    for (const range of [
      'trim=start_frame=0:end_frame=234', 'trim=start_frame=1:end_frame=6',
      'trim=start_frame=239:end_frame=240', 'trim=start_frame=7:end_frame=90',
      'trim=start_frame=1:end_frame=2', 'trim=start_frame=91:end_frame=96', 'trim=start_frame=7',
    ]) expect(graph).toContain(range)
    expect(graph).toContain('concat=n=7:v=1:a=0')
    expect(graph).toContain('atempo=' + plan.video2AudioTempoFactor.toFixed(9))
    expect(graph).toContain('atrim=duration=' + plan.centralSilenceSeconds.toFixed(9))
    expect(command.args).toEqual(expect.arrayContaining(['libx264', 'yuv420p', '+faststart']))
  })

  it('omits audio only when both inputs are silent', () => {
    const plan = buildVideoSeamBridgePlan({
      input1: { width: 1280, height: 720, fps: 24, frameCount: 240, durationSeconds: 10, hasAudio: false },
      input2: { width: 1280, height: 720, fps: 24, frameCount: 240, durationSeconds: 10, hasAudio: false },
      trimEndFrames: 0, trimStartFrames: 1, durationSeconds: 4,
    })
    const command = buildVideoSeamComposeCommand({
      input1Path: '/tmp/a.mp4', bridgePath: '/tmp/g.mp4',
      input2Path: '/tmp/b.mp4', outputPath: '/tmp/o.mp4', plan,
    })
    expect(command.args).not.toContain('[aout]')
    expect(command.args).not.toContain('aac')
  })

  it('accepts FPS within 0.2% while keeping duration tolerance to one frame', async () => {
    const plan = buildVideoSeamBridgePlan({
      input1: { width: 1280, height: 720, fps: 120, frameCount: 10, durationSeconds: 1 / 12, hasAudio: false },
      input2: { width: 1280, height: 720, fps: 120, frameCount: 10, durationSeconds: 1 / 12, hasAudio: false },
      trimEndFrames: 0, trimStartFrames: 1, durationSeconds: 4,
    })
    const measuredDuration = plan.outputDurationSeconds + 0.9 / plan.outputFps
    const raw = JSON.stringify({
      streams: [{
        codec_type: 'video', width: plan.input1.width, height: plan.input1.height,
        avg_frame_rate: '1199/10', nb_read_frames: String(plan.outputFrameCount),
        duration: measuredDuration.toFixed(9),
      }],
      format: { duration: measuredDuration.toFixed(9) },
    })

    await withVideoSeamProbeJson(raw, async (outputPath) => {
      await expect(verifyVideoSeamOutput(outputPath, plan)).resolves.toMatchObject({ fps: 119.9 })
    })
  })

  it('rejects FPS outside 0.2% even when its numeric delta is under one frame', async () => {
    const plan = buildVideoSeamBridgePlan({
      input1: { width: 1280, height: 720, fps: 4, frameCount: 10, durationSeconds: 2.5, hasAudio: false },
      input2: { width: 1280, height: 720, fps: 4, frameCount: 10, durationSeconds: 2.5, hasAudio: false },
      trimEndFrames: 0, trimStartFrames: 1, durationSeconds: 4,
    })
    const raw = JSON.stringify({
      streams: [{
        codec_type: 'video', width: plan.input1.width, height: plan.input1.height,
        avg_frame_rate: '41/10', nb_read_frames: String(plan.outputFrameCount),
        duration: plan.outputDurationSeconds.toFixed(9),
      }],
      format: { duration: plan.outputDurationSeconds.toFixed(9) },
    })

    await withVideoSeamProbeJson(raw, async (outputPath) => {
      await expect(verifyVideoSeamOutput(outputPath, plan))
        .rejects.toThrow('VIDEO_SEAM_MEDIA_PROBE_FAILED')
    })
  })

  it.each([
    ['truncated container', 'containerDurationSeconds', -2],
    ['overlong audio', 'audioDurationSeconds', 2],
  ])('rejects %s even when the counted video frames match the plan', async (_name, changedDuration, frameDelta) => {
    const plan = buildVideoSeamBridgePlan({
      input1: { width: 1280, height: 720, fps: 24, frameCount: 240, durationSeconds: 10, hasAudio: true },
      input2: { width: 1280, height: 720, fps: 24, frameCount: 240, durationSeconds: 10, hasAudio: true },
      trimEndFrames: 0, trimStartFrames: 1, durationSeconds: 4,
    })
    const expectedDurationSeconds = plan.outputDurationSeconds
    const durations = {
      containerDurationSeconds: expectedDurationSeconds,
      videoDurationSeconds: expectedDurationSeconds,
      audioDurationSeconds: expectedDurationSeconds,
    }
    durations[changedDuration as keyof typeof durations] += frameDelta / plan.outputFps
    const raw = JSON.stringify({
      streams: [
        {
          codec_type: 'video', width: plan.input1.width, height: plan.input1.height,
          avg_frame_rate: '24/1', nb_read_frames: String(plan.outputFrameCount),
          duration: durations.videoDurationSeconds.toFixed(9),
        },
        { codec_type: 'audio', duration: durations.audioDurationSeconds.toFixed(9) },
      ],
      format: { duration: durations.containerDurationSeconds.toFixed(9) },
    })
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'waoowaoo-video-seam-test-'))
    const executable = path.join(directory, 'ffprobe-fixture')
    const originalProbePath = process.env.FFPROBE_PATH
    const originalRaw = process.env.VIDEO_SEAM_TEST_PROBE_JSON
    try {
      await fs.writeFile(executable, '#!/usr/bin/env node\nprocess.stdout.write(process.env.VIDEO_SEAM_TEST_PROBE_JSON || \'\')\n', { mode: 0o755 })
      process.env.FFPROBE_PATH = executable
      process.env.VIDEO_SEAM_TEST_PROBE_JSON = raw
      await expect(verifyVideoSeamOutput(path.join(directory, 'output.mp4'), plan))
        .rejects.toThrow('VIDEO_SEAM_MEDIA_PROBE_FAILED')
    } finally {
      if (originalProbePath === undefined) delete process.env.FFPROBE_PATH
      else process.env.FFPROBE_PATH = originalProbePath
      if (originalRaw === undefined) delete process.env.VIDEO_SEAM_TEST_PROBE_JSON
      else process.env.VIDEO_SEAM_TEST_PROBE_JSON = originalRaw
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it('preserves a pre-existing destination when URL resolution or fetch fails', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'waoowaoo-video-seam-test-'))
    const destinationPath = path.join(directory, 'existing.mp4')
    try {
      await fs.writeFile(destinationPath, 'preserve-me')
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network unavailable') }))
      await expect(downloadVideoSeamFile('https://example.test/input.mp4', destinationPath))
        .rejects.toThrow('VIDEO_SEAM_MEDIA_DOWNLOAD_FAILED')
      await expect(fs.readFile(destinationPath, 'utf8')).resolves.toBe('preserve-me')
    } finally {
      vi.unstubAllGlobals()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
