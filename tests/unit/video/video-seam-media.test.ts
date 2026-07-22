import { describe, expect, it } from 'vitest'
import { buildVideoSeamComposeCommand, parseVideoSeamProbeJson } from '@/lib/video/video-seam-media'
import { buildVideoSeamBridgePlan } from '@/lib/video-tools/seam-bridge-plan'

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
})
