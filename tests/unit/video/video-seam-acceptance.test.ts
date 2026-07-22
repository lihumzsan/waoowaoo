import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import {
  assertVideoSeamSsimThresholds,
  parseFfmpegSsimStats,
  verifyVideoSeamAcceptance,
} from '@/lib/video/video-seam-acceptance'
import { buildVideoSeamBridgePlan } from '@/lib/video-tools/seam-bridge-plan'
import {
  composeVideoSeamOutput,
  probeVideoSeamFile,
  verifyVideoSeamOutput,
} from '@/lib/video/video-seam-media'

const execFileAsync = promisify(execFile)

async function createAcceptanceSource(params: {
  directory: string
  name: string
  hasAudio: boolean
  frequency: number
}): Promise<string> {
  const outputPath = path.join(params.directory, `${params.name}.mp4`)
  const args = [
    '-v', 'error', '-y', '-f', 'lavfi',
    '-i', 'testsrc2=size=96x64:rate=24:duration=2',
  ]
  if (params.hasAudio) {
    args.push(
      '-f', 'lavfi',
      '-i', `sine=frequency=${params.frequency}:sample_rate=48000:duration=2`,
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

async function createAcceptanceFixture(params: {
  directory: string
  input1HasAudio: boolean
  input2HasAudio: boolean
}): Promise<{
  input1Path: string
  input2Path: string
  outputPath: string
  resultPath: string
  centralStartSeconds: number
  centralEndSeconds: number
  outputDurationSeconds: number
  audioPolicy: 'both' | 'video1_only' | 'video2_only' | 'silent'
}> {
  const input1Path = await createAcceptanceSource({
    directory: params.directory, name: 'input-1', hasAudio: params.input1HasAudio, frequency: 440,
  })
  const input2Path = await createAcceptanceSource({
    directory: params.directory, name: 'input-2', hasAudio: params.input2HasAudio, frequency: 660,
  })
  const bridgePath = path.join(params.directory, 'bridge.mp4')
  await execFileAsync(process.env.FFMPEG_PATH || 'ffmpeg', [
    '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=24',
    '-frames:v', '97', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', bridgePath,
  ])
  const [input1, input2] = await Promise.all([
    probeVideoSeamFile(input1Path),
    probeVideoSeamFile(input2Path),
  ])
  const plan = buildVideoSeamBridgePlan({
    input1, input2, trimEndFrames: 0, trimStartFrames: 1, durationSeconds: 4,
  })
  const outputPath = path.join(params.directory, 'output.mp4')
  await composeVideoSeamOutput({ input1Path, bridgePath, input2Path, outputPath, plan })
  const output = await verifyVideoSeamOutput(outputPath, plan)
  const resultPath = path.join(params.directory, 'task-result.json')
  await fs.writeFile(resultPath, JSON.stringify({
    id: 'task-1',
    status: 'completed',
    result: {
      mode: 'ai_bridge',
      probes: { input1, input2 },
      output,
      bridge: {
        requestedDurationSeconds: plan.requestedDurationSeconds,
        handleFrames: plan.handleFrames,
        generatedFrameCount: plan.generatedFrameCount,
        generationCanvas: plan.generationCanvas,
        sourceAnchors: plan.sourceAnchors,
        generatedAnchors: plan.generatedAnchors,
        centralFrameCount: plan.centralFrameCount,
        centralSilenceSeconds: plan.centralSilenceSeconds,
        video2AudioTempoFactor: plan.video2AudioTempoFactor,
        audioPolicy: plan.audioPolicy,
        targetBitrateMbps: plan.targetBitrateMbps,
      },
    },
  }))
  return {
    input1Path,
    input2Path,
    outputPath,
    resultPath,
    centralStartSeconds: plan.retainedVideo1FrameCount / plan.outputFps,
    centralEndSeconds: (plan.retainedVideo1FrameCount + plan.centralFrameCount) / plan.outputFps,
    outputDurationSeconds: plan.outputDurationSeconds,
    audioPolicy: plan.audioPolicy,
  }
}

async function createSilenceAnalysisWrapper(directory: string): Promise<string> {
  const executable = path.join(directory, 'ffmpeg-silence-wrapper')
  await fs.writeFile(executable, [
    '#!/usr/bin/env node',
    'const { spawnSync } = require("node:child_process")',
    'const args = process.argv.slice(2)',
    'if (args.some((value) => value.includes("silencedetect="))) {',
    '  process.stderr.write(process.env.VIDEO_SEAM_TEST_SILENCE_INTERVALS || "")',
    '  process.exit(0)',
    '}',
    'const result = spawnSync(process.env.VIDEO_SEAM_REAL_FFMPEG || "ffmpeg", args, { stdio: "inherit" })',
    'if (result.error) { process.stderr.write(String(result.error)); process.exit(1) }',
    'process.exit(result.status === null ? 1 : result.status)',
    '',
  ].join('\n'), { mode: 0o755 })
  return executable
}

describe('video seam real-media acceptance', () => {
  it('parses FFmpeg per-frame All SSIM values', () => {
    const raw = [
      'n:1 Y:0.999 U:0.999 V:0.999 All:0.999100 (40.45)',
      'n:2 Y:0.995 U:0.996 V:0.997 All:0.995500 (23.47)',
    ].join('\n')
    expect(parseFfmpegSsimStats(raw)).toEqual([0.9991, 0.9955])
  })

  it('rejects missing and non-finite FFmpeg SSIM values', () => {
    expect(() => parseFfmpegSsimStats('no frame stats'))
      .toThrow('VIDEO_SEAM_ACCEPTANCE_SSIM_PARSE_FAILED')
    expect(() => parseFfmpegSsimStats('n:1 All:nan'))
      .toThrow('VIDEO_SEAM_ACCEPTANCE_SSIM_PARSE_FAILED')
  })

  it('accepts anchors at 0.99 and fewer than five static pairs', () => {
    expect(() => assertVideoSeamSsimThresholds({
      anchorScores: [0.99, 0.995, 0.999, 1],
      adjacentBridgeScores: [0.999, 0.999, 0.999, 0.999, 0.997],
    })).not.toThrow()
  })

  it('rejects a weak anchor', () => {
    expect(() => assertVideoSeamSsimThresholds({
      anchorScores: [0.9899, 1, 1, 1], adjacentBridgeScores: [],
    })).toThrow('VIDEO_SEAM_ACCEPTANCE_ANCHOR_SSIM_FAILED')
  })

  it('rejects five nearly identical consecutive pairs', () => {
    expect(() => assertVideoSeamSsimThresholds({
      anchorScores: [1, 1, 1, 1],
      adjacentBridgeScores: [0.999, 0.999, 0.999, 0.999, 0.999],
    })).toThrow('VIDEO_SEAM_ACCEPTANCE_STATIC_HOLD')
  })

  it('requires exactly four finite anchor scores', () => {
    expect(() => assertVideoSeamSsimThresholds({
      anchorScores: [1, 1, 1], adjacentBridgeScores: [],
    })).toThrow('VIDEO_SEAM_ACCEPTANCE_ANCHOR_SSIM_FAILED')
    expect(() => assertVideoSeamSsimThresholds({
      anchorScores: [1, 1, 1, Number.NaN], adjacentBridgeScores: [],
    })).toThrow('VIDEO_SEAM_ACCEPTANCE_ANCHOR_SSIM_FAILED')
  })

  it('does not count adjacent scores at exactly 0.998 as static', () => {
    expect(() => assertVideoSeamSsimThresholds({
      anchorScores: [1, 1, 1, 1],
      adjacentBridgeScores: [0.999, 0.999, 0.999, 0.998, 0.999, 0.999, 0.999],
    })).not.toThrow()
  })

  it('rejects a task response whose result is not a validated AI bridge', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'video-seam-acceptance-test-'))
    const resultPath = path.join(directory, 'task-result.json')
    try {
      await fs.writeFile(resultPath, JSON.stringify({
        id: 'task-1', status: 'completed', result: { mode: 'direct' },
      }))
      await expect(verifyVideoSeamAcceptance({
        input1Path: path.join(directory, 'input-1.mp4'),
        input2Path: path.join(directory, 'input-2.mp4'),
        outputPath: path.join(directory, 'output.mp4'),
        resultPath,
      })).rejects.toThrow('VIDEO_SEAM_ACCEPTANCE_RESULT_INVALID')
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })

  it.each([
    ['both', true, true],
    ['video1_only', true, false],
    ['video2_only', false, true],
  ] as const)(
    'accepts codec-scale AAC boundary drift for the %s policy without treating it as context silence',
    async (policy, input1HasAudio, input2HasAudio) => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'video-seam-aac-boundary-'))
      const originalFfmpegPath = process.env.FFMPEG_PATH
      const originalRealFfmpeg = process.env.VIDEO_SEAM_REAL_FFMPEG
      const originalSilenceIntervals = process.env.VIDEO_SEAM_TEST_SILENCE_INTERVALS
      try {
        const fixture = await createAcceptanceFixture({ directory, input1HasAudio, input2HasAudio })
        expect(fixture.audioPolicy).toBe(policy)
        const tolerance = 4 / 48_000
        const start = input1HasAudio ? fixture.centralStartSeconds - tolerance : 0
        const end = input2HasAudio
          ? fixture.centralEndSeconds + tolerance
          : fixture.outputDurationSeconds
        process.env.VIDEO_SEAM_REAL_FFMPEG = originalFfmpegPath || 'ffmpeg'
        process.env.VIDEO_SEAM_TEST_SILENCE_INTERVALS = [
          `[silencedetect] silence_start: ${start.toFixed(9)}`,
          `[silencedetect] silence_end: ${end.toFixed(9)} | silence_duration: ${(end - start).toFixed(9)}`,
        ].join('\n')
        process.env.FFMPEG_PATH = await createSilenceAnalysisWrapper(directory)
        await expect(verifyVideoSeamAcceptance({
          input1Path: fixture.input1Path,
          input2Path: fixture.input2Path,
          outputPath: fixture.outputPath,
          resultPath: fixture.resultPath,
        })).resolves.toMatchObject({ passed: true })
      } finally {
        if (originalFfmpegPath === undefined) delete process.env.FFMPEG_PATH
        else process.env.FFMPEG_PATH = originalFfmpegPath
        if (originalRealFfmpeg === undefined) delete process.env.VIDEO_SEAM_REAL_FFMPEG
        else process.env.VIDEO_SEAM_REAL_FFMPEG = originalRealFfmpeg
        if (originalSilenceIntervals === undefined) delete process.env.VIDEO_SEAM_TEST_SILENCE_INTERVALS
        else process.env.VIDEO_SEAM_TEST_SILENCE_INTERVALS = originalSilenceIntervals
        await fs.rm(directory, { recursive: true, force: true })
      }
    },
    30_000,
  )

  it('preserves a primary acceptance error when temp cleanup also fails', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'video-seam-acceptance-test-'))
    const resultPath = path.join(directory, 'task-result.json')
    const realRm = fs.rm.bind(fs)
    let failedCleanupPath: string | undefined
    await fs.writeFile(resultPath, JSON.stringify({
      id: 'task-1', status: 'completed', result: { mode: 'direct' },
    }))
    const rmSpy = vi.spyOn(fs, 'rm').mockImplementation(async (target, options) => {
      if (String(target).includes('waoowaoo-video-seam-acceptance-')) {
        failedCleanupPath = String(target)
        throw new Error('acceptance temp cleanup failed')
      }
      return await realRm(target, options)
    })
    try {
      await expect(verifyVideoSeamAcceptance({
        input1Path: path.join(directory, 'input-1.mp4'),
        input2Path: path.join(directory, 'input-2.mp4'),
        outputPath: path.join(directory, 'output.mp4'),
        resultPath,
      })).rejects.toThrow('VIDEO_SEAM_ACCEPTANCE_RESULT_INVALID')
      expect(failedCleanupPath).toContain('waoowaoo-video-seam-acceptance-')
    } finally {
      rmSpy.mockRestore()
      if (failedCleanupPath) await realRm(failedCleanupPath, { recursive: true, force: true })
      await realRm(directory, { recursive: true, force: true })
    }
  })

  it('preserves a successful acceptance report when temp cleanup fails', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'video-seam-acceptance-cleanup-'))
    const originalFfmpegPath = process.env.FFMPEG_PATH
    const originalRealFfmpeg = process.env.VIDEO_SEAM_REAL_FFMPEG
    const originalSilenceIntervals = process.env.VIDEO_SEAM_TEST_SILENCE_INTERVALS
    const realRm = fs.rm.bind(fs)
    let failedCleanupPath: string | undefined
    let rmSpy: { mockRestore: () => void } | undefined
    try {
      const fixture = await createAcceptanceFixture({
        directory,
        input1HasAudio: true,
        input2HasAudio: true,
      })
      process.env.VIDEO_SEAM_REAL_FFMPEG = originalFfmpegPath || 'ffmpeg'
      process.env.VIDEO_SEAM_TEST_SILENCE_INTERVALS = [
        `[silencedetect] silence_start: ${fixture.centralStartSeconds.toFixed(9)}`,
        `[silencedetect] silence_end: ${fixture.centralEndSeconds.toFixed(9)}`,
      ].join('\n')
      process.env.FFMPEG_PATH = await createSilenceAnalysisWrapper(directory)
      rmSpy = vi.spyOn(fs, 'rm').mockImplementation(async (target, options) => {
        if (String(target).includes('waoowaoo-video-seam-acceptance-')) {
          failedCleanupPath = String(target)
          throw new Error('acceptance temp cleanup failed')
        }
        return await realRm(target, options)
      })

      await expect(verifyVideoSeamAcceptance({
        input1Path: fixture.input1Path,
        input2Path: fixture.input2Path,
        outputPath: fixture.outputPath,
        resultPath: fixture.resultPath,
      })).resolves.toMatchObject({ passed: true })
      expect(failedCleanupPath).toContain('waoowaoo-video-seam-acceptance-')
    } finally {
      rmSpy?.mockRestore()
      if (originalFfmpegPath === undefined) delete process.env.FFMPEG_PATH
      else process.env.FFMPEG_PATH = originalFfmpegPath
      if (originalRealFfmpeg === undefined) delete process.env.VIDEO_SEAM_REAL_FFMPEG
      else process.env.VIDEO_SEAM_REAL_FFMPEG = originalRealFfmpeg
      if (originalSilenceIntervals === undefined) delete process.env.VIDEO_SEAM_TEST_SILENCE_INTERVALS
      else process.env.VIDEO_SEAM_TEST_SILENCE_INTERVALS = originalSilenceIntervals
      if (failedCleanupPath) await realRm(failedCleanupPath, { recursive: true, force: true })
      await realRm(directory, { recursive: true, force: true })
    }
  }, 30_000)
})
