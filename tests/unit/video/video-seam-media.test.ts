import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import {
  buildVideoSeamComposeCommand,
  composeVideoSeamOutput,
  downloadVideoSeamFile,
  extractVideoSeamAnchors,
  parseVideoSeamProbeJson,
  probeVideoSeamFile,
  verifyVideoSeamOutput,
} from '@/lib/video/video-seam-media'
import { buildVideoSeamBridgePlan } from '@/lib/video-tools/seam-bridge-plan'

vi.mock('@/lib/storage', () => ({
  toFetchableUrl: (value: string) => value,
}))

const execFileAsync = promisify(execFile)

async function withVideoSeamProbeJson<T>(raw: string, run: (outputPath: string) => Promise<T>): Promise<T> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'waoowaoo-video-seam-test-'))
  const executable = path.join(directory, 'ffprobe-fixture')
  const originalProbePath = process.env.FFPROBE_PATH
  const originalRaw = process.env.VIDEO_SEAM_TEST_PROBE_JSON
  const originalArgsPath = process.env.VIDEO_SEAM_TEST_PROBE_ARGS_PATH
  try {
    await fs.writeFile(
      executable,
      [
        '#!/usr/bin/env node',
        'const fs = require(\'node:fs\')',
        'if (process.env.VIDEO_SEAM_TEST_PROBE_ARGS_PATH) {',
        '  fs.writeFileSync(process.env.VIDEO_SEAM_TEST_PROBE_ARGS_PATH, JSON.stringify(process.argv.slice(2)))',
        '}',
        'process.stdout.write(process.env.VIDEO_SEAM_TEST_PROBE_JSON || \'\')',
        '',
      ].join('\n'),
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
    if (originalArgsPath === undefined) delete process.env.VIDEO_SEAM_TEST_PROBE_ARGS_PATH
    else process.env.VIDEO_SEAM_TEST_PROBE_ARGS_PATH = originalArgsPath
    await fs.rm(directory, { recursive: true, force: true })
  }
}

async function createRotatedVideoFixture(directory: string, rotation: 90 | 270): Promise<string> {
  const basePath = path.join(directory, 'base.mp4')
  const rotatedPath = path.join(directory, `rotated-${rotation}.mp4`)
  await execFileAsync(process.env.FFMPEG_PATH || 'ffmpeg', [
    '-v', 'error', '-y', '-f', 'lavfi',
    '-i', 'testsrc2=size=96x64:rate=24:duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', basePath,
  ])
  await execFileAsync(process.env.FFMPEG_PATH || 'ffmpeg', [
    '-v', 'error', '-y', '-display_rotation', String(rotation), '-i', basePath,
    '-c', 'copy', rotatedPath,
  ])
  return rotatedPath
}

async function createAudioPolicyVideoFixture(params: {
  directory: string
  name: string
  hasAudio: boolean
  audioDurationSeconds?: number
  frequency?: number
}): Promise<string> {
  const outputPath = path.join(params.directory, `${params.name}.mp4`)
  const args = [
    '-v', 'error', '-y', '-f', 'lavfi',
    '-i', 'testsrc2=size=96x64:rate=24:duration=2',
  ]
  if (params.hasAudio) {
    args.push(
      '-f', 'lavfi',
      '-i', `sine=frequency=${params.frequency || 440}:sample_rate=48000:duration=${params.audioDurationSeconds || 2}`,
      '-map', '0:v:0', '-map', '1:a:0',
    )
  }
  args.push(
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    ...(params.hasAudio ? ['-c:a', 'aac'] : []),
    outputPath,
  )
  await execFileAsync(process.env.FFMPEG_PATH || 'ffmpeg', args)
  return outputPath
}

async function createAudioPolicyBridgeFixture(directory: string): Promise<string> {
  const outputPath = path.join(directory, 'bridge.mp4')
  await execFileAsync(process.env.FFMPEG_PATH || 'ffmpeg', [
    '-v', 'error', '-y', '-f', 'lavfi',
    '-i', 'testsrc2=size=96x64:rate=24',
    '-frames:v', '97', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', outputPath,
  ])
  return outputPath
}

async function detectAudioSilenceIntervals(
  inputPath: string,
  minimumDurationSeconds: number,
): Promise<Array<{ startSeconds: number; endSeconds: number }>> {
  const { stderr } = await execFileAsync(process.env.FFMPEG_PATH || 'ffmpeg', [
    '-v', 'info', '-hide_banner', '-nostats', '-i', inputPath,
    '-map', '0:a:0',
    '-af', `silencedetect=noise=-50dB:d=${minimumDurationSeconds.toFixed(9)}`,
    '-f', 'null', '-',
  ])
  const intervals: Array<{ startSeconds: number; endSeconds: number }> = []
  let startSeconds: number | null = null
  for (const line of stderr.split(/\r?\n/)) {
    const startMatch = /silence_start:\s*([-+\d.eE]+)/.exec(line)
    if (startMatch) startSeconds = Number(startMatch[1])
    const endMatch = /silence_end:\s*([-+\d.eE]+)/.exec(line)
    if (endMatch && startSeconds !== null) {
      intervals.push({ startSeconds, endSeconds: Number(endMatch[1]) })
      startSeconds = null
    }
  }
  return intervals
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
    [90, 90],
    [-90, 270],
  ] as const)('reports display dimensions and explicit rotation for side-data angle %s', (
    sideDataRotation,
    displayRotationDegrees,
  ) => {
    expect(parseVideoSeamProbeJson(JSON.stringify({
      streams: [{
        codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '24/1',
        nb_read_frames: '240', side_data_list: [{ rotation: sideDataRotation }],
      }],
    }))).toEqual({
      width: 1080,
      height: 1920,
      fps: 24,
      frameCount: 240,
      durationSeconds: 10,
      hasAudio: false,
      displayRotationDegrees,
    })
  })

  it('requests display rotation side data from ffprobe', async () => {
    const raw = JSON.stringify({
      streams: [{
        codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '24/1',
        nb_read_frames: '240', side_data_list: [{ rotation: 90 }],
      }],
    })
    await withVideoSeamProbeJson(raw, async (outputPath) => {
      const argsPath = path.join(path.dirname(outputPath), 'probe-args.json')
      process.env.VIDEO_SEAM_TEST_PROBE_ARGS_PATH = argsPath
      await probeVideoSeamFile(outputPath)
      const args = JSON.parse(await fs.readFile(argsPath, 'utf8')) as string[]
      expect(args).toEqual(expect.arrayContaining([
        '-show_entries',
        'stream=codec_type,width,height,avg_frame_rate,nb_read_frames,duration:stream_side_data=rotation:format=duration',
      ]))
    })
  })

  it.each([
    '{}',
    '{"streams":[{"codec_type":"video","width":1920,"height":1080,"avg_frame_rate":"0/0","nb_read_frames":"10"}]}',
    '{"streams":[{"codec_type":"video","width":1920,"height":1080,"avg_frame_rate":"24/1"}]}',
    '{"streams":[{"codec_type":"video","width":1920,"height":1080,"avg_frame_rate":"24/1","nb_read_frames":"240","side_data_list":[{"rotation":45}]}]}',
  ])('rejects incomplete or unsupported probe output', (raw) => {
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

  it('bounds Video 2 audio in source time before atempo and in output time after atempo', () => {
    const plan = buildVideoSeamBridgePlan({
      input1: { width: 96, height: 64, fps: 24, frameCount: 48, durationSeconds: 2, hasAudio: true },
      input2: { width: 96, height: 64, fps: 23.976, frameCount: 48, durationSeconds: 2.002, hasAudio: true },
      trimEndFrames: 0, trimStartFrames: 1, durationSeconds: 4,
    })
    const command = buildVideoSeamComposeCommand({
      input1Path: '/tmp/a.mp4', bridgePath: '/tmp/g.mp4',
      input2Path: '/tmp/b.mp4', outputPath: '/tmp/o.mp4', plan,
    })
    const graph = command.args[command.args.indexOf('-filter_complex') + 1]
    const sourceStart = plan.sourceAnchors.input2Endpoint / plan.input2.fps
    const sourceDuration = plan.retainedVideo2FrameCount / plan.input2.fps
    const outputDuration = plan.retainedVideo2FrameCount / plan.outputFps
    expect(graph).toContain(
      `atrim=start=${sourceStart.toFixed(9)}:duration=${sourceDuration.toFixed(9)}`,
    )
    expect(graph).toMatch(new RegExp(
      `atrim=start=${sourceStart.toFixed(9)}:duration=${sourceDuration.toFixed(9)}`
      + `.*atempo=${plan.video2AudioTempoFactor.toFixed(9)}`
      + `.*atrim=duration=${outputDuration.toFixed(9)}`,
    ))
  })

  it.each([
    ['both', true, true, true],
    ['video1_only', true, false, true],
    ['video2_only', false, true, true],
    ['silent', false, false, false],
  ] as const)(
    'executes the %s audio policy and caps retained audio to the output timeline',
    async (expectedPolicy, input1HasAudio, input2HasAudio, outputHasAudio) => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'waoowaoo-video-seam-audio-policy-'))
      try {
        const input1Path = await createAudioPolicyVideoFixture({
          directory, name: 'input-1', hasAudio: input1HasAudio, frequency: 440,
        })
        const input2Path = await createAudioPolicyVideoFixture({
          directory,
          name: 'input-2',
          hasAudio: input2HasAudio,
          audioDurationSeconds: input2HasAudio ? 6 : undefined,
          frequency: 660,
        })
        const bridgePath = await createAudioPolicyBridgeFixture(directory)
        const [input1, input2] = await Promise.all([
          probeVideoSeamFile(input1Path),
          probeVideoSeamFile(input2Path),
        ])
        const plan = buildVideoSeamBridgePlan({
          input1, input2, trimEndFrames: 0, trimStartFrames: 1, durationSeconds: 4,
        })
        expect(plan.audioPolicy).toBe(expectedPolicy)
        const outputPath = path.join(directory, `output-${expectedPolicy}.mp4`)
        await composeVideoSeamOutput({ input1Path, bridgePath, input2Path, outputPath, plan })
        await expect(verifyVideoSeamOutput(outputPath, plan)).resolves.toMatchObject({
          hasAudio: outputHasAudio,
          frameCount: plan.outputFrameCount,
        })
      } finally {
        await fs.rm(directory, { recursive: true, force: true })
      }
    },
    30_000,
  )

  it.each([
    ['input 1', 0.75, 2],
    ['input 2', 2, 0.75],
  ] as const)(
    'keeps the central audio interval and output duration aligned when %s audio is shorter than its video',
    async (_shortInput, input1AudioDurationSeconds, input2AudioDurationSeconds) => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'waoowaoo-video-seam-short-audio-'))
      try {
        const input1Path = await createAudioPolicyVideoFixture({
          directory,
          name: 'input-1',
          hasAudio: true,
          audioDurationSeconds: input1AudioDurationSeconds,
          frequency: 440,
        })
        const input2Path = await createAudioPolicyVideoFixture({
          directory,
          name: 'input-2',
          hasAudio: true,
          audioDurationSeconds: input2AudioDurationSeconds,
          frequency: 660,
        })
        const bridgePath = await createAudioPolicyBridgeFixture(directory)
        const [input1, input2] = await Promise.all([
          probeVideoSeamFile(input1Path),
          probeVideoSeamFile(input2Path),
        ])
        const plan = buildVideoSeamBridgePlan({
          input1, input2, trimEndFrames: 0, trimStartFrames: 1, durationSeconds: 4,
        })
        const outputPath = path.join(directory, `output-${_shortInput.replace(' ', '-')}.mp4`)

        await composeVideoSeamOutput({ input1Path, bridgePath, input2Path, outputPath, plan })
        await expect(verifyVideoSeamOutput(outputPath, plan)).resolves.toMatchObject({
          hasAudio: true,
          frameCount: plan.outputFrameCount,
        })

        const expectedCentralStart = plan.retainedVideo1FrameCount / plan.outputFps
        const expectedCentralEnd = (plan.retainedVideo1FrameCount + plan.centralFrameCount)
          / plan.outputFps
        const oneFrame = 1 / plan.outputFps
        const intervals = await detectAudioSilenceIntervals(outputPath, oneFrame)
        expect(intervals.some((interval) => (
          (_shortInput !== 'input 2'
            || interval.startSeconds >= expectedCentralStart - oneFrame)
          && interval.startSeconds <= expectedCentralStart + oneFrame
          && interval.endSeconds >= expectedCentralEnd - oneFrame
          && interval.endSeconds <= expectedCentralEnd + oneFrame
        ))).toBe(true)
      } finally {
        await fs.rm(directory, { recursive: true, force: true })
      }
    },
    30_000,
  )

  it.each(['atempo', 'apad'])(
    'maps %s filter failures to the stable audio compose code with the original cause',
    async (filterName) => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'waoowaoo-video-seam-audio-error-'))
      const executable = path.join(directory, 'ffmpeg-audio-failure')
      const originalFfmpegPath = process.env.FFMPEG_PATH
      try {
        await fs.writeFile(executable, [
          '#!/usr/bin/env node',
          `process.stderr.write("Error initializing filter ${filterName}: Invalid argument\\n")`,
          'process.exit(1)',
          '',
        ].join('\n'), { mode: 0o755 })
        process.env.FFMPEG_PATH = executable
        const plan = buildVideoSeamBridgePlan({
          input1: { width: 96, height: 64, fps: 24, frameCount: 48, durationSeconds: 2, hasAudio: true },
          input2: { width: 96, height: 64, fps: 24, frameCount: 48, durationSeconds: 2, hasAudio: true },
          trimEndFrames: 0, trimStartFrames: 1, durationSeconds: 4,
        })
        let failure: unknown
        try {
          await composeVideoSeamOutput({
            input1Path: '/tmp/a.mp4', bridgePath: '/tmp/g.mp4',
            input2Path: '/tmp/b.mp4', outputPath: '/tmp/o.mp4', plan,
          })
        } catch (error) {
          failure = error
        }
        expect(failure).toBeInstanceOf(Error)
        expect((failure as Error).message).toBe('VIDEO_SEAM_AUDIO_COMPOSE_FAILED')
        expect((failure as Error).cause).toBeInstanceOf(Error)
        expect(String((failure as Error).cause)).toContain(filterName)
      } finally {
        if (originalFfmpegPath === undefined) delete process.env.FFMPEG_PATH
        else process.env.FFMPEG_PATH = originalFfmpegPath
        await fs.rm(directory, { recursive: true, force: true })
      }
    },
  )

  it('does not misclassify a video encoder failure as audio composition', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'waoowaoo-video-seam-video-error-'))
    const executable = path.join(directory, 'ffmpeg-video-failure')
    const originalFfmpegPath = process.env.FFMPEG_PATH
    try {
      await fs.writeFile(executable, [
        '#!/usr/bin/env node',
        'process.stderr.write("Error while opening encoder libx264 for output stream 0:0\\n")',
        'process.exit(1)',
        '',
      ].join('\n'), { mode: 0o755 })
      process.env.FFMPEG_PATH = executable
      const plan = buildVideoSeamBridgePlan({
        input1: { width: 96, height: 64, fps: 24, frameCount: 48, durationSeconds: 2, hasAudio: true },
        input2: { width: 96, height: 64, fps: 24, frameCount: 48, durationSeconds: 2, hasAudio: true },
        trimEndFrames: 0, trimStartFrames: 1, durationSeconds: 4,
      })
      await expect(composeVideoSeamOutput({
        input1Path: '/tmp/a.mp4', bridgePath: '/tmp/g.mp4',
        input2Path: '/tmp/b.mp4', outputPath: '/tmp/o.mp4', plan,
      })).rejects.not.toThrow('VIDEO_SEAM_AUDIO_COMPOSE_FAILED')
    } finally {
      if (originalFfmpegPath === undefined) delete process.env.FFMPEG_PATH
      else process.env.FFMPEG_PATH = originalFfmpegPath
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it('disables implicit autorotation and explicitly orients both source videos', () => {
    const plan = buildVideoSeamBridgePlan({
      input1: {
        width: 720, height: 1280, fps: 24, frameCount: 240, durationSeconds: 10,
        hasAudio: false, displayRotationDegrees: 90,
      },
      input2: {
        width: 720, height: 1280, fps: 24, frameCount: 240, durationSeconds: 10,
        hasAudio: false, displayRotationDegrees: 270,
      },
      trimEndFrames: 0, trimStartFrames: 1, durationSeconds: 4,
    })
    const command = buildVideoSeamComposeCommand({
      input1Path: '/tmp/a.mp4', bridgePath: '/tmp/g.mp4',
      input2Path: '/tmp/b.mp4', outputPath: '/tmp/o.mp4', plan,
    })
    const graph = command.args[command.args.indexOf('-filter_complex') + 1]
    expect(command.args.slice(3, 8)).toEqual([
      '-noautorotate', '-display_rotation', '0', '-i', '/tmp/a.mp4',
    ])
    expect(command.args).toEqual(expect.arrayContaining([
      '-noautorotate', '-display_rotation', '0', '-i', '/tmp/b.mp4',
    ]))
    expect(graph).toContain('[0:v]transpose=cclock,trim=start_frame=0')
    expect(graph).toContain('[2:v]transpose=clock,scale=720:1280')
  })

  it.each([90, 270] as const)(
    'probes, extracts, and composes a real %s-degree display-rotated fixture in display orientation',
    async (rotation) => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'waoowaoo-video-seam-rotation-test-'))
      try {
        const inputPath = await createRotatedVideoFixture(directory, rotation)
        const probe = await probeVideoSeamFile(inputPath)
        expect(probe).toMatchObject({
          width: 64,
          height: 96,
          fps: 24,
          frameCount: 48,
          displayRotationDegrees: rotation,
        })
        const plan = buildVideoSeamBridgePlan({
          input1: probe,
          input2: probe,
          trimEndFrames: 0,
          trimStartFrames: 1,
          durationSeconds: 4,
        })
        const rawOutputPaths: [string, string] = [
          path.join(directory, 'anchor-0.png'),
          path.join(directory, 'anchor-1.png'),
        ]
        await extractVideoSeamAnchors({
          inputPath,
          indices: [0, 1],
          rawOutputPaths,
          normalizedOutputPaths: [
            path.join(directory, 'anchor-normalized-0.png'),
            path.join(directory, 'anchor-normalized-1.png'),
          ],
          displayRotationDegrees: probe.displayRotationDegrees || 0,
          plan,
        })
        const metadata = await sharp(rawOutputPaths[0]).metadata()
        expect(metadata).toMatchObject({ width: 64, height: 96 })

        const referencePath = path.join(directory, 'reference.png')
        await execFileAsync(process.env.FFMPEG_PATH || 'ffmpeg', [
          '-v', 'error', '-y', '-i', inputPath,
          '-vf', 'select=eq(n\\,0)', '-frames:v', '1', '-fps_mode', 'passthrough', referencePath,
        ])
        const [actualPixels, referencePixels] = await Promise.all([
          sharp(rawOutputPaths[0]).raw().toBuffer(),
          sharp(referencePath).raw().toBuffer(),
        ])
        expect(actualPixels.equals(referencePixels)).toBe(true)

        const bridgePath = path.join(directory, 'bridge.mp4')
        await execFileAsync(process.env.FFMPEG_PATH || 'ffmpeg', [
          '-v', 'error', '-y', '-f', 'lavfi',
          '-i', `testsrc2=size=${plan.generationCanvas.width}x${plan.generationCanvas.height}:rate=${plan.outputFps}`,
          '-frames:v', String(plan.generatedFrameCount),
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', bridgePath,
        ])
        const outputPath = path.join(directory, 'output.mp4')
        const command = buildVideoSeamComposeCommand({
          input1Path: inputPath,
          bridgePath,
          input2Path: inputPath,
          outputPath,
          plan,
        })
        await execFileAsync(command.executable, command.args)
        const outputProbe = await probeVideoSeamFile(outputPath)
        expect(outputProbe).toMatchObject({
          width: 64,
          height: 96,
          fps: 24,
          frameCount: plan.outputFrameCount,
        })
        expect(outputProbe.displayRotationDegrees).toBeUndefined()
      } finally {
        await fs.rm(directory, { recursive: true, force: true })
      }
    },
  )

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

  it.each([
    { name: 'empty body', chunks: [] as number[][], contentLength: undefined },
    { name: 'body longer than declared', chunks: [[1, 2], [3]], contentLength: '2' },
    { name: 'truncated body', chunks: [[1, 2], [3]], contentLength: '4' },
    { name: 'non-numeric declared length', chunks: [[1, 2], [3]], contentLength: 'invalid' },
    { name: 'multiple declared lengths', chunks: [[1, 2], [3]], contentLength: '3, 3' },
  ])('rejects a successful response with an invalid $name', async ({ chunks, contentLength }) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'waoowaoo-video-seam-test-'))
    const destinationPath = path.join(directory, 'invalid.mp4')
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk))
        controller.close()
      },
    })
    let capturedSignal: AbortSignal | undefined
    try {
      vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedSignal = init?.signal || undefined
        return new Response(body, {
          status: 200,
          headers: contentLength === undefined ? undefined : { 'Content-Length': contentLength },
        })
      }))

      await expect(downloadVideoSeamFile('https://example.test/input.mp4', destinationPath))
        .rejects.toThrow('VIDEO_SEAM_MEDIA_DOWNLOAD_FAILED')

      expect(capturedSignal?.aborted).toBe(true)
      await expect(fs.access(destinationPath)).rejects.toThrow()
    } finally {
      vi.unstubAllGlobals()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it.each([
    { name: 'an exact declared length', chunks: [[1], [2, 3]], contentLength: '3' },
    { name: 'a nonempty chunked body', chunks: [[4, 5], [6]], contentLength: undefined },
  ])('downloads $name', async ({ chunks, contentLength }) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'waoowaoo-video-seam-test-'))
    const destinationPath = path.join(directory, 'valid.mp4')
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk))
        controller.close()
      },
    })
    try {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(body, {
        status: 200,
        headers: contentLength === undefined ? undefined : { 'Content-Length': contentLength },
      })))

      await downloadVideoSeamFile('https://example.test/input.mp4', destinationPath)

      await expect(fs.readFile(destinationPath)).resolves.toEqual(Buffer.from(chunks.flat()))
    } finally {
      vi.unstubAllGlobals()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it('aborts a hanging media download after the bounded timeout', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'waoowaoo-video-seam-test-'))
    const destinationPath = path.join(directory, 'timeout.mp4')
    let capturedSignal: AbortSignal | undefined
    vi.useFakeTimers()
    try {
      vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        capturedSignal = init?.signal || undefined
        return new Promise<Response>((_resolve, reject) => {
          capturedSignal?.addEventListener('abort', () => reject(capturedSignal?.reason), { once: true })
        })
      }))

      const download = downloadVideoSeamFile(
        'https://example.test/input.mp4',
        destinationPath,
        { timeoutMs: 25 },
      )
      await Promise.resolve()
      expect(capturedSignal).toBeInstanceOf(AbortSignal)
      const failedDownload = expect(download).rejects.toThrow('VIDEO_SEAM_MEDIA_DOWNLOAD_FAILED')
      await vi.advanceTimersByTimeAsync(25)

      await failedDownload
      expect(capturedSignal?.aborted).toBe(true)
      await expect(fs.access(destinationPath)).rejects.toThrow()
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it('cancels a non-success response body before reporting a download failure', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'waoowaoo-video-seam-test-'))
    const destinationPath = path.join(directory, 'failed.mp4')
    const cancelBody = vi.fn(async () => undefined)
    const body = new ReadableStream<Uint8Array>({ cancel: cancelBody })
    try {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 503 })))

      await expect(downloadVideoSeamFile('https://example.test/input.mp4', destinationPath))
        .rejects.toThrow('VIDEO_SEAM_MEDIA_DOWNLOAD_FAILED')

      expect(cancelBody).toHaveBeenCalledTimes(1)
      await expect(fs.access(destinationPath)).rejects.toThrow()
    } finally {
      vi.unstubAllGlobals()
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
})
