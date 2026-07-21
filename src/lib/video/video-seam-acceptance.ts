import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { mapFfmpegExecutableError, resolveFfmpegExecutable } from '@/lib/media/ffmpeg-runtime'
import {
  buildVideoSeamBridgePlan,
  VIDEO_SEAM_FPS_RELATIVE_TOLERANCE,
  type SeamProbeResult,
  type VideoSeamAudioPolicy,
  type VideoSeamBridgePlan,
  type VideoSeamGenerationCanvas,
} from '@/lib/video-tools/seam-bridge-plan'
import { isVideoSeamBridgeDuration } from '@/lib/video-tools/seam-bridge'
import { probeVideoSeamFile, verifyVideoSeamOutput } from '@/lib/video/video-seam-media'

const MINIMUM_ANCHOR_SSIM = 0.99
const STATIC_PAIR_SSIM = 0.998
const MAXIMUM_STATIC_RUN = 5
const OUTPUT_AUDIO_SAMPLE_RATE = 48_000
const AAC_BOUNDARY_TOLERANCE_SAMPLES = 4
const AUDIO_TIMESTAMP_ROUNDING_TOLERANCE_SECONDS = 1 / OUTPUT_AUDIO_SAMPLE_RATE
const execFileAsync = promisify(execFile)

type VideoSeamAnchorRole = 'input1_pre' | 'input1_endpoint' | 'input2_endpoint' | 'input2_post'

export type VideoSeamAcceptanceReport = {
  passed: true
  probes: {
    input1: SeamProbeResult
    input2: SeamProbeResult
    output: SeamProbeResult
  }
  anchors: Array<{
    role: VideoSeamAnchorRole
    sourceFrameIndex: number
    generatedFrameIndex: number
    outputFrameIndex: number
    ssim: number
  }>
  maximumStaticRun: number
  expectedDurationSeconds: number
  actualDurationSeconds: number
  expectedCentralAudioInterval: {
    startSeconds: number
    endSeconds: number
  }
  detectedSilenceIntervals: Array<{
    startSeconds: number
    endSeconds: number
  }>
}

type ValidatedTaskResult = {
  input1: SeamProbeResult
  input2: SeamProbeResult
  output: SeamProbeResult
  plan: VideoSeamBridgePlan
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPositiveInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0
}

function resultInvalid(): never {
  throw new Error('VIDEO_SEAM_ACCEPTANCE_RESULT_INVALID')
}

function readProbe(value: unknown): SeamProbeResult {
  if (!isRecord(value)
    || !isPositiveInteger(value.width)
    || !isPositiveInteger(value.height)
    || !isFiniteNumber(value.fps) || value.fps <= 0
    || !isPositiveInteger(value.frameCount)
    || !isFiniteNumber(value.durationSeconds) || value.durationSeconds <= 0
    || typeof value.hasAudio !== 'boolean') {
    return resultInvalid()
  }
  return {
    width: value.width,
    height: value.height,
    fps: value.fps,
    frameCount: value.frameCount,
    durationSeconds: value.durationSeconds,
    hasAudio: value.hasAudio,
  }
}

function readSourceAnchors(value: unknown): VideoSeamBridgePlan['sourceAnchors'] {
  if (!isRecord(value)
    || !isNonNegativeInteger(value.input1Pre)
    || !isNonNegativeInteger(value.input1Endpoint)
    || !isNonNegativeInteger(value.input2Endpoint)
    || !isNonNegativeInteger(value.input2Post)) {
    return resultInvalid()
  }
  return {
    input1Pre: value.input1Pre,
    input1Endpoint: value.input1Endpoint,
    input2Endpoint: value.input2Endpoint,
    input2Post: value.input2Post,
  }
}

function readGeneratedAnchors(value: unknown): [number, number, number, number] {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(isNonNegativeInteger)) {
    return resultInvalid()
  }
  return [value[0], value[1], value[2], value[3]]
}

function readGenerationCanvas(value: unknown): VideoSeamGenerationCanvas {
  if (!isRecord(value)
    || !isPositiveInteger(value.contentWidth)
    || !isPositiveInteger(value.contentHeight)
    || !isPositiveInteger(value.width)
    || !isPositiveInteger(value.height)
    || !isNonNegativeInteger(value.padLeft)
    || !isNonNegativeInteger(value.padTop)
    || !isNonNegativeInteger(value.padRight)
    || !isNonNegativeInteger(value.padBottom)) {
    return resultInvalid()
  }
  return {
    contentWidth: value.contentWidth,
    contentHeight: value.contentHeight,
    width: value.width,
    height: value.height,
    padLeft: value.padLeft,
    padTop: value.padTop,
    padRight: value.padRight,
    padBottom: value.padBottom,
  }
}

function readAudioPolicy(value: unknown): VideoSeamAudioPolicy {
  if (value !== 'both' && value !== 'video1_only' && value !== 'video2_only' && value !== 'silent') {
    return resultInvalid()
  }
  return value
}

function sameNumber(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-9
}

function sameRecordNumbers(
  left: Record<string, number>,
  right: Record<string, number>,
): boolean {
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length
    && keys.every((key) => sameNumber(left[key], right[key]))
}

function probeMatches(expected: SeamProbeResult, actual: SeamProbeResult): boolean {
  const durationToleranceSeconds = 1 / expected.fps
  const fpsRelativeDelta = Math.abs(actual.fps - expected.fps) / expected.fps
  return actual.width === expected.width
    && actual.height === expected.height
    && actual.frameCount === expected.frameCount
    && actual.hasAudio === expected.hasAudio
    && fpsRelativeDelta <= VIDEO_SEAM_FPS_RELATIVE_TOLERANCE
    && Math.abs(actual.durationSeconds - expected.durationSeconds) <= durationToleranceSeconds
}

function validateTaskResult(parsed: unknown): ValidatedTaskResult {
  if (!isRecord(parsed) || parsed.status !== 'completed' || !isRecord(parsed.result)) {
    return resultInvalid()
  }
  const result = parsed.result
  if (result.mode !== 'ai_bridge' || !isRecord(result.probes) || !isRecord(result.bridge)) {
    return resultInvalid()
  }

  const input1 = readProbe(result.probes.input1)
  const input2 = readProbe(result.probes.input2)
  const output = readProbe(result.output)
  const sourceAnchors = readSourceAnchors(result.bridge.sourceAnchors)
  const generatedAnchors = readGeneratedAnchors(result.bridge.generatedAnchors)
  const generationCanvas = readGenerationCanvas(result.bridge.generationCanvas)
  const audioPolicy = readAudioPolicy(result.bridge.audioPolicy)
  const duration = result.bridge.requestedDurationSeconds
  if (!isVideoSeamBridgeDuration(duration)
    || !isPositiveInteger(result.bridge.handleFrames)
    || !isPositiveInteger(result.bridge.generatedFrameCount)
    || !isPositiveInteger(result.bridge.centralFrameCount)
    || !isFiniteNumber(result.bridge.centralSilenceSeconds)
    || result.bridge.centralSilenceSeconds < 0
    || !isFiniteNumber(result.bridge.video2AudioTempoFactor)
    || result.bridge.video2AudioTempoFactor <= 0
    || !isFiniteNumber(result.bridge.targetBitrateMbps)
    || result.bridge.targetBitrateMbps <= 0) {
    return resultInvalid()
  }

  const trimEndFrames = input1.frameCount - sourceAnchors.input1Endpoint - 1
  let plan: VideoSeamBridgePlan
  try {
    plan = buildVideoSeamBridgePlan({
      input1,
      input2,
      trimEndFrames,
      trimStartFrames: sourceAnchors.input2Endpoint,
      durationSeconds: duration,
    })
  } catch {
    return resultInvalid()
  }

  const plannedOutput: SeamProbeResult = {
    width: plan.input1.width,
    height: plan.input1.height,
    fps: plan.outputFps,
    frameCount: plan.outputFrameCount,
    durationSeconds: plan.outputDurationSeconds,
    hasAudio: plan.audioPolicy !== 'silent',
  }
  if (trimEndFrames < 0
    || result.bridge.handleFrames !== plan.handleFrames
    || result.bridge.generatedFrameCount !== plan.generatedFrameCount
    || result.bridge.centralFrameCount !== plan.centralFrameCount
    || !sameNumber(result.bridge.centralSilenceSeconds, plan.centralSilenceSeconds)
    || !sameNumber(result.bridge.video2AudioTempoFactor, plan.video2AudioTempoFactor)
    || result.bridge.targetBitrateMbps !== plan.targetBitrateMbps
    || audioPolicy !== plan.audioPolicy
    || !sameRecordNumbers(sourceAnchors, plan.sourceAnchors)
    || !generatedAnchors.every((value, index) => value === plan.generatedAnchors[index])
    || !sameRecordNumbers(generationCanvas, plan.generationCanvas)
    || !probeMatches(plannedOutput, output)) {
    return resultInvalid()
  }
  return { input1, input2, output, plan }
}

async function readTaskResult(resultPath: string): Promise<ValidatedTaskResult> {
  let parsed: unknown
  try {
    const raw = await fs.readFile(resultPath, 'utf8')
    parsed = JSON.parse(raw)
  } catch {
    return resultInvalid()
  }
  return validateTaskResult(parsed)
}

function mapChildProcessError(error: unknown, failureCode: string): Error {
  return mapFfmpegExecutableError(error, 'VIDEO_SEAM_FFMPEG_UNAVAILABLE') || new Error(failureCode)
}

async function runChildProcess(
  executable: string,
  args: string[],
  failureCode: string,
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(executable, args, {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 8,
    })
    return { stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    throw mapChildProcessError(error, failureCode)
  }
}

async function extractFrame(params: {
  inputPath: string
  frameIndex: number
  outputPath: string
  outputSize?: { width: number; height: number }
}): Promise<void> {
  const filters = [`select=eq(n\\,${params.frameIndex})`]
  if (params.outputSize) {
    const size = `${params.outputSize.width}:${params.outputSize.height}`
    filters.push(`scale=${size}:force_original_aspect_ratio=increase:flags=lanczos`, `crop=${size}`)
  }
  await runChildProcess(resolveFfmpegExecutable('ffmpeg'), [
    '-v', 'error', '-y', '-i', params.inputPath,
    '-vf', filters.join(','), '-frames:v', '1', '-fps_mode', 'passthrough', params.outputPath,
  ], 'VIDEO_SEAM_ACCEPTANCE_FRAME_EXTRACT_FAILED')
  try {
    if ((await fs.stat(params.outputPath)).size <= 0) {
      throw new Error('VIDEO_SEAM_ACCEPTANCE_FRAME_EXTRACT_FAILED')
    }
  } catch {
    throw new Error('VIDEO_SEAM_ACCEPTANCE_FRAME_EXTRACT_FAILED')
  }
}

async function compareFrames(expectedPath: string, outputPath: string): Promise<number> {
  const result = await runChildProcess(resolveFfmpegExecutable('ffmpeg'), [
    '-v', 'error', '-i', expectedPath, '-i', outputPath,
    '-filter_complex', '[0:v][1:v]ssim=stats_file=-', '-f', 'null', '-',
  ], 'VIDEO_SEAM_ACCEPTANCE_SSIM_FAILED')
  const scores = parseFfmpegSsimStats(`${result.stdout}\n${result.stderr}`)
  if (scores.length !== 1) throw new Error('VIDEO_SEAM_ACCEPTANCE_SSIM_PARSE_FAILED')
  return scores[0]
}

async function compareAdjacentOutputFrames(params: {
  outputPath: string
  firstFrame: number
  finalFrame: number
}): Promise<number[]> {
  const filter = [
    '[0:v]split=2[earlier][later]',
    `[earlier]trim=start_frame=${params.firstFrame}:end_frame=${params.finalFrame},setpts=PTS-STARTPTS[a]`,
    `[later]trim=start_frame=${params.firstFrame + 1}:end_frame=${params.finalFrame + 1},setpts=PTS-STARTPTS[b]`,
    '[a][b]ssim=stats_file=-',
  ].join(';')
  const result = await runChildProcess(resolveFfmpegExecutable('ffmpeg'), [
    '-v', 'error', '-i', params.outputPath, '-filter_complex', filter, '-f', 'null', '-',
  ], 'VIDEO_SEAM_ACCEPTANCE_SSIM_FAILED')
  const scores = parseFfmpegSsimStats(`${result.stdout}\n${result.stderr}`)
  if (scores.length !== params.finalFrame - params.firstFrame) {
    throw new Error('VIDEO_SEAM_ACCEPTANCE_SSIM_PARSE_FAILED')
  }
  return scores
}

function maximumStaticRun(scores: number[]): number {
  let current = 0
  let maximum = 0
  for (const score of scores) {
    current = score > STATIC_PAIR_SSIM ? current + 1 : 0
    maximum = Math.max(maximum, current)
  }
  return maximum
}

function parseSilenceIntervals(raw: string, durationSeconds: number): Array<{
  startSeconds: number
  endSeconds: number
}> {
  const intervals: Array<{ startSeconds: number; endSeconds: number }> = []
  let startSeconds: number | null = null
  for (const line of raw.split(/\r?\n/)) {
    const startMatch = /silence_start:\s*([-+\d.eE]+)/.exec(line)
    if (startMatch) {
      const parsed = Number(startMatch[1])
      if (!Number.isFinite(parsed)) throw new Error('VIDEO_SEAM_ACCEPTANCE_AUDIO_ANALYSIS_FAILED')
      startSeconds = parsed
    }
    const endMatch = /silence_end:\s*([-+\d.eE]+)/.exec(line)
    if (endMatch) {
      const parsed = Number(endMatch[1])
      if (startSeconds === null || !Number.isFinite(parsed) || parsed < startSeconds) {
        throw new Error('VIDEO_SEAM_ACCEPTANCE_AUDIO_ANALYSIS_FAILED')
      }
      intervals.push({ startSeconds, endSeconds: parsed })
      startSeconds = null
    }
  }
  if (startSeconds !== null) intervals.push({ startSeconds, endSeconds: durationSeconds })
  return intervals
}

function overlapSeconds(
  interval: { startSeconds: number; endSeconds: number },
  window: { startSeconds: number; endSeconds: number },
): number {
  return Math.max(0, Math.min(interval.endSeconds, window.endSeconds)
    - Math.max(interval.startSeconds, window.startSeconds))
}

async function verifyOutputAudio(params: {
  outputPath: string
  plan: VideoSeamBridgePlan
  outputDurationSeconds: number
}): Promise<{
  expectedInterval: { startSeconds: number; endSeconds: number }
  detectedIntervals: Array<{ startSeconds: number; endSeconds: number }>
}> {
  const expectedInterval = {
    startSeconds: params.plan.retainedVideo1FrameCount / params.plan.outputFps,
    endSeconds: (params.plan.retainedVideo1FrameCount + params.plan.centralFrameCount)
      / params.plan.outputFps,
  }
  if (params.plan.audioPolicy === 'silent') {
    return { expectedInterval, detectedIntervals: [] }
  }

  const oneFrame = 1 / params.plan.outputFps
  const result = await runChildProcess(resolveFfmpegExecutable('ffmpeg'), [
    '-v', 'info', '-hide_banner', '-nostats', '-i', params.outputPath,
    '-map', '0:a:0', '-af', `silencedetect=noise=-50dB:d=${oneFrame.toFixed(9)}`,
    '-f', 'null', '-',
  ], 'VIDEO_SEAM_ACCEPTANCE_AUDIO_ANALYSIS_FAILED')
  const detectedIntervals = parseSilenceIntervals(result.stderr, params.outputDurationSeconds)
  const audioBoundaryTolerance = Math.min(
    AAC_BOUNDARY_TOLERANCE_SAMPLES / OUTPUT_AUDIO_SAMPLE_RATE,
    oneFrame,
  )
  const centralIsSilent = detectedIntervals.some((interval) => (
    interval.startSeconds <= expectedInterval.startSeconds + audioBoundaryTolerance
    && interval.endSeconds >= expectedInterval.endSeconds - audioBoundaryTolerance
  ))
  if (!centralIsSilent) throw new Error('VIDEO_SEAM_ACCEPTANCE_CENTRAL_AUDIO_NOT_SILENT')

  const windows = [
    params.plan.input1.hasAudio ? {
      startSeconds: expectedInterval.startSeconds - 0.5,
      endSeconds: expectedInterval.startSeconds - audioBoundaryTolerance,
    } : null,
    params.plan.input2.hasAudio ? {
      startSeconds: expectedInterval.endSeconds + audioBoundaryTolerance,
      endSeconds: expectedInterval.endSeconds + 0.5,
    } : null,
  ].filter((window): window is { startSeconds: number; endSeconds: number } => window !== null)
  if (windows.some((window) => window.startSeconds < 0
    || window.endSeconds > params.outputDurationSeconds
    || detectedIntervals.some((interval) => (
      overlapSeconds(interval, window) > AUDIO_TIMESTAMP_ROUNDING_TOLERANCE_SECONDS
    )))) {
    throw new Error('VIDEO_SEAM_ACCEPTANCE_AUDIO_CONTEXT_FAILED')
  }
  return { expectedInterval, detectedIntervals }
}

export function parseFfmpegSsimStats(raw: string): number[] {
  const scores: number[] = []
  const matches = raw.matchAll(/\bAll:([^\s]+)/g)
  for (const match of matches) {
    const score = Number(match[1])
    if (!Number.isFinite(score)) {
      throw new Error('VIDEO_SEAM_ACCEPTANCE_SSIM_PARSE_FAILED')
    }
    scores.push(score)
  }
  if (scores.length === 0) {
    throw new Error('VIDEO_SEAM_ACCEPTANCE_SSIM_PARSE_FAILED')
  }
  return scores
}

export function assertVideoSeamSsimThresholds(input: {
  anchorScores: [number, number, number, number] | number[]
  adjacentBridgeScores: number[]
}): void {
  if (input.anchorScores.length !== 4
    || input.anchorScores.some((score) => !Number.isFinite(score) || score < MINIMUM_ANCHOR_SSIM)) {
    throw new Error('VIDEO_SEAM_ACCEPTANCE_ANCHOR_SSIM_FAILED')
  }

  let staticRun = 0
  for (const score of input.adjacentBridgeScores) {
    staticRun = score > STATIC_PAIR_SSIM ? staticRun + 1 : 0
    if (staticRun >= MAXIMUM_STATIC_RUN) {
      throw new Error('VIDEO_SEAM_ACCEPTANCE_STATIC_HOLD')
    }
  }
}

export async function verifyVideoSeamAcceptance(params: {
  input1Path: string
  input2Path: string
  outputPath: string
  resultPath: string
}): Promise<VideoSeamAcceptanceReport> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'waoowaoo-video-seam-acceptance-'))
  try {
    const validated = await readTaskResult(params.resultPath)
    const [input1, input2, output] = await Promise.all([
      probeVideoSeamFile(params.input1Path),
      probeVideoSeamFile(params.input2Path),
      verifyVideoSeamOutput(params.outputPath, validated.plan),
    ])
    if (!probeMatches(validated.input1, input1)) {
      throw new Error('VIDEO_SEAM_ACCEPTANCE_INPUT1_METADATA_MISMATCH')
    }
    if (!probeMatches(validated.input2, input2)) {
      throw new Error('VIDEO_SEAM_ACCEPTANCE_INPUT2_METADATA_MISMATCH')
    }
    if (!probeMatches(validated.output, output)) {
      throw new Error('VIDEO_SEAM_ACCEPTANCE_OUTPUT_METADATA_MISMATCH')
    }
    const actualDurationSeconds = output.durationSeconds

    const outputBEndpoint = validated.plan.retainedVideo1FrameCount
      + validated.plan.centralFrameCount
    const outputBPost = outputBEndpoint + validated.plan.handleFrames
    const anchorSpecs: Array<{
      role: VideoSeamAnchorRole
      sourcePath: string
      sourceFrameIndex: number
      generatedFrameIndex: number
      outputFrameIndex: number
      normalizeToOutput: boolean
    }> = [
      {
        role: 'input1_pre',
        sourcePath: params.input1Path,
        sourceFrameIndex: validated.plan.sourceAnchors.input1Pre,
        generatedFrameIndex: validated.plan.generatedAnchors[0],
        outputFrameIndex: validated.plan.sourceAnchors.input1Pre,
        normalizeToOutput: false,
      },
      {
        role: 'input1_endpoint',
        sourcePath: params.input1Path,
        sourceFrameIndex: validated.plan.sourceAnchors.input1Endpoint,
        generatedFrameIndex: validated.plan.generatedAnchors[1],
        outputFrameIndex: validated.plan.sourceAnchors.input1Endpoint,
        normalizeToOutput: false,
      },
      {
        role: 'input2_endpoint',
        sourcePath: params.input2Path,
        sourceFrameIndex: validated.plan.sourceAnchors.input2Endpoint,
        generatedFrameIndex: validated.plan.generatedAnchors[2],
        outputFrameIndex: outputBEndpoint,
        normalizeToOutput: true,
      },
      {
        role: 'input2_post',
        sourcePath: params.input2Path,
        sourceFrameIndex: validated.plan.sourceAnchors.input2Post,
        generatedFrameIndex: validated.plan.generatedAnchors[3],
        outputFrameIndex: outputBPost,
        normalizeToOutput: true,
      },
    ]
    const anchors: VideoSeamAcceptanceReport['anchors'] = []
    for (const [index, spec] of anchorSpecs.entries()) {
      const expectedPath = path.join(directory, `anchor-${index}-expected.png`)
      const actualPath = path.join(directory, `anchor-${index}-output.png`)
      await extractFrame({
        inputPath: spec.sourcePath,
        frameIndex: spec.sourceFrameIndex,
        outputPath: expectedPath,
        ...(spec.normalizeToOutput ? {
          outputSize: { width: validated.plan.input1.width, height: validated.plan.input1.height },
        } : {}),
      })
      await extractFrame({
        inputPath: params.outputPath,
        frameIndex: spec.outputFrameIndex,
        outputPath: actualPath,
      })
      anchors.push({
        role: spec.role,
        sourceFrameIndex: spec.sourceFrameIndex,
        generatedFrameIndex: spec.generatedFrameIndex,
        outputFrameIndex: spec.outputFrameIndex,
        ssim: await compareFrames(expectedPath, actualPath),
      })
    }

    const adjacentBridgeScores = await compareAdjacentOutputFrames({
      outputPath: params.outputPath,
      firstFrame: validated.plan.sourceAnchors.input1Pre,
      finalFrame: outputBPost,
    })
    assertVideoSeamSsimThresholds({
      anchorScores: anchors.map((anchor) => anchor.ssim),
      adjacentBridgeScores,
    })
    const audio = await verifyOutputAudio({
      outputPath: params.outputPath,
      plan: validated.plan,
      outputDurationSeconds: actualDurationSeconds,
    })
    return {
      passed: true,
      probes: { input1, input2, output },
      anchors,
      maximumStaticRun: maximumStaticRun(adjacentBridgeScores),
      expectedDurationSeconds: validated.plan.outputDurationSeconds,
      actualDurationSeconds,
      expectedCentralAudioInterval: audio.expectedInterval,
      detectedSilenceIntervals: audio.detectedIntervals,
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }
}
