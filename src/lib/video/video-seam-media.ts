import { execFile } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { mapFfmpegExecutableError, resolveFfmpegExecutable } from '@/lib/media/ffmpeg-runtime'
import { toFetchableUrl } from '@/lib/storage'
import {
  VIDEO_SEAM_FPS_RELATIVE_TOLERANCE,
  type SeamProbeResult,
  type VideoSeamBridgePlan,
  type VideoSeamDisplayRotationDegrees,
} from '@/lib/video-tools/seam-bridge-plan'

const execFileAsync = promisify(execFile)
const VIDEO_SEAM_DOWNLOAD_TIMEOUT_MS = 120_000

export type VideoSeamWorkspace = {
  directory: string
  input1Path: string
  input2Path: string
  input1AnchorPaths: [string, string]
  input2AnchorPaths: [string, string]
  normalizedAnchorPaths: [string, string, string, string]
  bridgePath: string
  outputPath: string
  cleanup: () => Promise<void>
}

export type VideoSeamComposeCommand = { executable: string; args: string[] }

type VideoSeamProbeTiming = {
  containerDurationSeconds: number | null
  videoDurationSeconds: number | null
  audioDurationSeconds: number | null
}

type VideoSeamProbeDetails = {
  probe: SeamProbeResult
  timing: VideoSeamProbeTiming
}

function mediaProbeError(): Error {
  return new Error('VIDEO_SEAM_MEDIA_PROBE_FAILED')
}

function isAudioComposeFailure(error: unknown): boolean {
  const stderr = (error as { stderr?: unknown }).stderr
  const detail = typeof stderr === 'string'
    ? stderr
    : Buffer.isBuffer(stderr)
      ? stderr.toString('utf8')
      : ''
  return /\b(?:aformat|apad|atrim|asetpts|atempo|anullsrc)\b/i.test(detail)
    || /(?:stream specifier|input pad|output pad).*(?:\baudio\b|:a\b)/i.test(detail)
    || /\baudio\b.*(?:filter|stream|concat|merge|trim|tempo)/i.test(detail)
}

function parseRational(raw: unknown): number | null {
  if (typeof raw !== 'string') return null
  const match = /^(\d+)\/(\d+)$/.exec(raw)
  if (!match) return null
  const numerator = Number(match[1])
  const denominator = Number(match[2])
  const value = numerator / denominator
  return Number.isFinite(value) && value > 0 ? value : null
}

function parsePositiveInteger(raw: unknown): number | null {
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

function parsePositiveSeconds(raw: unknown): number | null {
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN
  return Number.isFinite(value) && value > 0 ? value : null
}

function formatSeconds(seconds: number): string {
  return seconds.toFixed(9)
}

function parseDisplayRotationDegrees(video: Record<string, unknown>): VideoSeamDisplayRotationDegrees {
  const sideData = Array.isArray(video.side_data_list) ? video.side_data_list : []
  const rotationEntry = sideData.find((entry) => (
    entry !== null && typeof entry === 'object' && 'rotation' in entry
  )) as Record<string, unknown> | undefined
  if (!rotationEntry) return 0
  const value = typeof rotationEntry.rotation === 'number'
    ? rotationEntry.rotation
    : typeof rotationEntry.rotation === 'string'
      ? Number(rotationEntry.rotation)
      : Number.NaN
  if (!Number.isFinite(value)) throw mediaProbeError()
  const quarterTurns = Math.round(value / 90)
  if (Math.abs(value - quarterTurns * 90) > 0.01) throw mediaProbeError()
  return (((quarterTurns % 4) + 4) % 4 * 90) as VideoSeamDisplayRotationDegrees
}

function displayRotationFilter(rotation: VideoSeamDisplayRotationDegrees): string | null {
  if (rotation === 90) return 'transpose=cclock'
  if (rotation === 180) return 'hflip,vflip'
  if (rotation === 270) return 'transpose=clock'
  return null
}

async function runFfmpeg(args: string[]): Promise<void> {
  const executable = resolveFfmpegExecutable('ffmpeg')
  try {
    await execFileAsync(executable, args, { windowsHide: true, maxBuffer: 1024 * 1024 * 8 })
  } catch (error) {
    throw mapFfmpegExecutableError(error, 'VIDEO_SEAM_FFMPEG_UNAVAILABLE') || error
  }
}

function buildAnchorOutputPattern(rawOutputPaths: [string, string]): string {
  const pattern = rawOutputPaths[0].replace(/\d+(?=\.[^.]+$)/, '%d')
  if (pattern === rawOutputPaths[0]) throw new Error('VIDEO_SEAM_ANCHOR_OUTPUT_MISSING')
  return pattern
}

export async function createVideoSeamWorkspace(): Promise<VideoSeamWorkspace> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'waoowaoo-video-seam-'))
  return {
    directory,
    input1Path: path.join(directory, 'input-1.mp4'),
    input2Path: path.join(directory, 'input-2.mp4'),
    input1AnchorPaths: [
      path.join(directory, 'input-1-anchor-0.png'),
      path.join(directory, 'input-1-anchor-1.png'),
    ],
    input2AnchorPaths: [
      path.join(directory, 'input-2-anchor-0.png'),
      path.join(directory, 'input-2-anchor-1.png'),
    ],
    normalizedAnchorPaths: [
      path.join(directory, 'anchor-0-normalized.png'),
      path.join(directory, 'anchor-1-normalized.png'),
      path.join(directory, 'anchor-2-normalized.png'),
      path.join(directory, 'anchor-3-normalized.png'),
    ],
    bridgePath: path.join(directory, 'bridge.mp4'),
    outputPath: path.join(directory, 'output.mp4'),
    cleanup: async () => await fs.rm(directory, { recursive: true, force: true }),
  }
}

export async function downloadVideoSeamFile(
  sourceUrl: string,
  destinationPath: string,
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<void> {
  let createdDestination = false
  const controller = new AbortController()
  const parentSignal = options?.signal
  const abortFromParent = () => controller.abort(parentSignal?.reason)
  if (parentSignal?.aborted) abortFromParent()
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true })
  const requestedTimeoutMs = options?.timeoutMs
  const timeoutMs = typeof requestedTimeoutMs === 'number'
    && Number.isFinite(requestedTimeoutMs)
    && requestedTimeoutMs > 0
    ? Math.min(requestedTimeoutMs, VIDEO_SEAM_DOWNLOAD_TIMEOUT_MS)
    : VIDEO_SEAM_DOWNLOAD_TIMEOUT_MS
  const timeout = setTimeout(() => {
    controller.abort(new Error('VIDEO_SEAM_MEDIA_DOWNLOAD_TIMEOUT'))
  }, timeoutMs)
  try {
    const response = await fetch(toFetchableUrl(sourceUrl), { signal: controller.signal })
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error('VIDEO_SEAM_MEDIA_DOWNLOAD_FAILED')
    }
    if (!response.body) throw new Error('VIDEO_SEAM_MEDIA_DOWNLOAD_FAILED')
    const rawContentLength = response.headers.get('content-length')
    let declaredContentLength: number | null = null
    if (rawContentLength !== null) {
      declaredContentLength = /^\d+$/.test(rawContentLength) ? Number(rawContentLength) : Number.NaN
      if (!Number.isSafeInteger(declaredContentLength) || declaredContentLength < 0) {
        await response.body.cancel().catch(() => undefined)
        controller.abort(new Error('VIDEO_SEAM_MEDIA_DOWNLOAD_FAILED'))
        throw new Error('VIDEO_SEAM_MEDIA_DOWNLOAD_FAILED')
      }
    }
    let downloadedBytes = 0
    const byteCounter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        downloadedBytes += chunk.length
        callback(null, chunk)
      },
    })
    const destination = createWriteStream(destinationPath, { flags: 'wx' })
    destination.once('open', () => { createdDestination = true })
    await pipeline(
      Readable.fromWeb(response.body as unknown as import('node:stream/web').ReadableStream),
      byteCounter,
      destination,
    )
    if (
      downloadedBytes === 0
      || (declaredContentLength !== null && downloadedBytes !== declaredContentLength)
    ) {
      controller.abort(new Error('VIDEO_SEAM_MEDIA_DOWNLOAD_FAILED'))
      throw new Error('VIDEO_SEAM_MEDIA_DOWNLOAD_FAILED')
    }
  } catch {
    if (createdDestination) {
      await fs.unlink(destinationPath).catch(() => undefined)
    }
    throw new Error('VIDEO_SEAM_MEDIA_DOWNLOAD_FAILED')
  } finally {
    clearTimeout(timeout)
    parentSignal?.removeEventListener('abort', abortFromParent)
  }
}

function parseVideoSeamProbeDetails(raw: string): VideoSeamProbeDetails {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { streams?: unknown }).streams)) {
      throw mediaProbeError()
    }
    const streams = (parsed as { streams: Array<Record<string, unknown>> }).streams
    const video = streams.find((stream) => stream.codec_type === 'video')
    if (!video) throw mediaProbeError()
    const width = parsePositiveInteger(video.width)
    const height = parsePositiveInteger(video.height)
    const fps = parseRational(video.avg_frame_rate)
    const frameCount = parsePositiveInteger(video.nb_read_frames)
    if (!width || !height || !fps || !frameCount) throw mediaProbeError()
    const displayRotationDegrees = parseDisplayRotationDegrees(video)
    const displayWidth = displayRotationDegrees === 90 || displayRotationDegrees === 270
      ? height
      : width
    const displayHeight = displayRotationDegrees === 90 || displayRotationDegrees === 270
      ? width
      : height
    const audio = streams.find((stream) => stream.codec_type === 'audio')
    const format = (parsed as { format?: unknown }).format
    return {
      probe: {
        width: displayWidth,
        height: displayHeight,
        fps,
        frameCount,
        durationSeconds: frameCount / fps,
        hasAudio: Boolean(audio),
        ...(displayRotationDegrees === 0 ? {} : { displayRotationDegrees }),
      },
      timing: {
        containerDurationSeconds: format && typeof format === 'object'
          ? parsePositiveSeconds((format as { duration?: unknown }).duration)
          : null,
        videoDurationSeconds: parsePositiveSeconds(video.duration),
        audioDurationSeconds: audio ? parsePositiveSeconds(audio.duration) : null,
      },
    }
  } catch {
    throw mediaProbeError()
  }
}

export function parseVideoSeamProbeJson(raw: string): SeamProbeResult {
  return parseVideoSeamProbeDetails(raw).probe
}

async function readVideoSeamProbeJson(filePath: string): Promise<string> {
  const executable = resolveFfmpegExecutable('ffprobe')
  const args = [
    '-v', 'error', '-count_frames',
    '-show_entries', 'stream=codec_type,width,height,avg_frame_rate,nb_read_frames,duration:stream_side_data=rotation:format=duration',
    '-of', 'json', filePath,
  ]
  try {
    const { stdout } = await execFileAsync(executable, args, { windowsHide: true, maxBuffer: 1024 * 1024 * 8 })
    return stdout
  } catch (error) {
    throw mapFfmpegExecutableError(error, 'VIDEO_SEAM_FFMPEG_UNAVAILABLE') || mediaProbeError()
  }
}

export async function probeVideoSeamFile(filePath: string): Promise<SeamProbeResult> {
  return parseVideoSeamProbeJson(await readVideoSeamProbeJson(filePath))
}

export async function extractVideoSeamAnchors(params: {
  inputPath: string
  indices: [number, number]
  rawOutputPaths: [string, string]
  normalizedOutputPaths: [string, string]
  displayRotationDegrees: VideoSeamDisplayRotationDegrees
  plan: VideoSeamBridgePlan
}): Promise<void> {
  const select = 'select=eq(n\\,' + params.indices[0] + ')+eq(n\\,' + params.indices[1] + ')'
  const rotationFilter = displayRotationFilter(params.displayRotationDegrees)
  const args = [
    '-v', 'error', '-y', '-noautorotate', '-display_rotation', '0', '-i', params.inputPath,
    '-vf', [rotationFilter, select].filter(Boolean).join(','),
    '-frames:v', '2', '-fps_mode', 'passthrough', '-start_number', '0',
    buildAnchorOutputPattern(params.rawOutputPaths),
  ]
  await runFfmpeg(args)

  const rawSizes = await Promise.all(params.rawOutputPaths.map(async (filePath) => {
    try {
      return (await fs.stat(filePath)).size
    } catch {
      return 0
    }
  }))
  if (rawSizes.some((size) => size <= 0)) throw new Error('VIDEO_SEAM_ANCHOR_OUTPUT_MISSING')

  const canvas = params.plan.generationCanvas
  await Promise.all(params.rawOutputPaths.map(async (rawPath, index) => {
    const normalizedPath = params.normalizedOutputPaths[index]
    await sharp(rawPath)
      .resize(canvas.contentWidth, canvas.contentHeight, {
        fit: 'cover', position: 'centre', kernel: sharp.kernel.lanczos3,
      })
      .extend({
        left: canvas.padLeft, top: canvas.padTop, right: canvas.padRight, bottom: canvas.padBottom,
        extendWith: 'mirror',
      })
      .png()
      .toFile(normalizedPath)
  }))
}

export async function readVideoSeamAnchorDataUrl(filePath: string): Promise<string> {
  return 'data:image/png;base64,' + (await fs.readFile(filePath)).toString('base64')
}

export function buildVideoSeamComposeCommand(params: {
  input1Path: string
  bridgePath: string
  input2Path: string
  outputPath: string
  plan: VideoSeamBridgePlan
}): VideoSeamComposeCommand {
  const { plan } = params
  const { input1Pre, input1Endpoint, input2Endpoint, input2Post } = plan.sourceAnchors
  const bridgeCentralStart = plan.handleFrames + 1
  const bridgeCentralEnd = plan.generatedFrameCount - plan.handleFrames - 1
  const bridgeOutgoingStart = plan.generatedFrameCount - plan.handleFrames
  const canvas = plan.generationCanvas
  const outputSize = `${plan.input1.width}:${plan.input1.height}`
  const setpts = `setpts=N/(${plan.outputFps}*TB)`
  const input1Rotation = displayRotationFilter(plan.input1.displayRotationDegrees || 0)
  const input2Rotation = displayRotationFilter(plan.input2.displayRotationDegrees || 0)
  const input1Filter = input1Rotation ? `${input1Rotation},` : ''
  const input2Filter = input2Rotation ? `${input2Rotation},` : ''
  const input2AudioStartSeconds = input2Endpoint / plan.input2.fps
  const input2SourceAudioDurationSeconds = plan.retainedVideo2FrameCount / plan.input2.fps
  const input2OutputAudioDurationSeconds = plan.retainedVideo2FrameCount / plan.outputFps
  const bridgeFilter = [
    `crop=${canvas.contentWidth}:${canvas.contentHeight}:${canvas.padLeft}:${canvas.padTop}`,
    `scale=${outputSize}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${outputSize}`,
  ].join(',')
  const videoFilters = [
    `[0:v]${input1Filter}trim=start_frame=0:end_frame=${input1Pre + 1},${setpts}[v0]`,
    `[1:v]${bridgeFilter},trim=start_frame=1:end_frame=${plan.handleFrames},${setpts}[v1]`,
    `[0:v]${input1Filter}trim=start_frame=${input1Endpoint}:end_frame=${input1Endpoint + 1},${setpts}[v2]`,
    `[1:v]${bridgeFilter},trim=start_frame=${bridgeCentralStart}:end_frame=${bridgeCentralEnd},${setpts}[v3]`,
    `[2:v]${input2Filter}scale=${outputSize}:force_original_aspect_ratio=increase:flags=lanczos,crop=${outputSize},trim=start_frame=${input2Endpoint}:end_frame=${input2Endpoint + 1},${setpts}[v4]`,
    `[1:v]${bridgeFilter},trim=start_frame=${bridgeOutgoingStart}:end_frame=${plan.generatedFrameCount - 1},${setpts}[v5]`,
    `[2:v]${input2Filter}scale=${outputSize}:force_original_aspect_ratio=increase:flags=lanczos,crop=${outputSize},trim=start_frame=${input2Post},${setpts}[v6]`,
    '[v0][v1][v2][v3][v4][v5][v6]concat=n=7:v=1:a=0[vout]',
  ]
  const audioFilters = plan.audioPolicy === 'silent' ? [] : [
    plan.input1.hasAudio
      ? `[0:a]aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=duration=${formatSeconds((input1Endpoint + 1) / plan.input1.fps)},asetpts=N/SR/TB[a0]`
      : `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${formatSeconds((input1Endpoint + 1) / plan.outputFps)}[a0]`,
    `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${formatSeconds(plan.centralSilenceSeconds)}[ac]`,
    plan.input2.hasAudio
      ? `[2:a]aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=start=${formatSeconds(input2AudioStartSeconds)}:duration=${formatSeconds(input2SourceAudioDurationSeconds)},asetpts=N/SR/TB,atempo=${formatSeconds(plan.video2AudioTempoFactor)},atrim=duration=${formatSeconds(input2OutputAudioDurationSeconds)},asetpts=N/SR/TB[a2]`
      : `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${formatSeconds(input2OutputAudioDurationSeconds)}[a2]`,
    '[a0][ac][a2]concat=n=3:v=0:a=1[aout]',
  ]
  const args = [
    '-v', 'error', '-y',
    '-noautorotate', '-display_rotation', '0', '-i', params.input1Path,
    '-noautorotate', '-i', params.bridgePath,
    '-noautorotate', '-display_rotation', '0', '-i', params.input2Path,
    '-filter_complex', [...videoFilters, ...audioFilters].join(';'),
    '-map', '[vout]',
    ...(plan.audioPolicy === 'silent' ? [] : ['-map', '[aout]']),
    '-fps_mode', 'cfr', '-frames:v', String(plan.outputFrameCount),
    '-c:v', 'libx264', '-preset', 'medium',
    '-b:v', plan.targetBitrateMbps + 'M', '-maxrate', plan.targetBitrateMbps + 'M',
    '-bufsize', plan.targetBitrateMbps * 2 + 'M', '-pix_fmt', 'yuv420p',
    ...(plan.audioPolicy === 'silent' ? [] : ['-c:a', 'aac', '-b:a', '192k']),
    '-movflags', '+faststart', params.outputPath,
  ]
  return { executable: resolveFfmpegExecutable('ffmpeg'), args }
}

export async function composeVideoSeamOutput(
  params: Parameters<typeof buildVideoSeamComposeCommand>[0],
): Promise<void> {
  const command = buildVideoSeamComposeCommand(params)
  try {
    await execFileAsync(command.executable, command.args, { windowsHide: true, maxBuffer: 1024 * 1024 * 8 })
  } catch (error) {
    const unavailable = mapFfmpegExecutableError(error, 'VIDEO_SEAM_FFMPEG_UNAVAILABLE')
    if (unavailable) throw unavailable
    if (params.plan.audioPolicy !== 'silent' && isAudioComposeFailure(error)) {
      throw new Error('VIDEO_SEAM_AUDIO_COMPOSE_FAILED', { cause: error })
    }
    throw error
  }
}

export async function verifyVideoSeamOutput(filePath: string, plan: VideoSeamBridgePlan): Promise<SeamProbeResult> {
  const { probe, timing } = parseVideoSeamProbeDetails(await readVideoSeamProbeJson(filePath))
  const durationToleranceSeconds = 1 / plan.outputFps
  const fpsRelativeDelta = Math.abs(probe.fps - plan.outputFps) / plan.outputFps
  const expectedAudio = plan.audioPolicy !== 'silent'
  const measuredDurations = [timing.containerDurationSeconds, timing.videoDurationSeconds]
  if (expectedAudio) measuredDurations.push(timing.audioDurationSeconds)
  if (probe.width !== plan.input1.width || probe.height !== plan.input1.height
    || probe.frameCount !== plan.outputFrameCount || probe.hasAudio !== expectedAudio
    || fpsRelativeDelta > VIDEO_SEAM_FPS_RELATIVE_TOLERANCE
    || Math.abs(probe.durationSeconds - plan.outputDurationSeconds) > durationToleranceSeconds
    || measuredDurations.some((duration) => duration === null
      || Math.abs(duration - plan.outputDurationSeconds) > durationToleranceSeconds)
    || measuredDurations.some((duration, index) => measuredDurations
      .slice(index + 1)
      .some((otherDuration) => duration === null || otherDuration === null
        || Math.abs(duration - otherDuration) > durationToleranceSeconds))) {
    throw mediaProbeError()
  }
  return probe
}

export async function openVideoSeamOutput(filePath: string): Promise<{
  body: ReadableStream<Uint8Array>
  contentLength: number
  mimeType: 'video/mp4'
}> {
  const { size } = await fs.stat(filePath)
  return {
    body: Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>,
    contentLength: size,
    mimeType: 'video/mp4',
  }
}
