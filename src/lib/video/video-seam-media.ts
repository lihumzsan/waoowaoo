import { execFile } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { toFetchableUrl } from '@/lib/storage'
import type { SeamProbeResult, VideoSeamBridgePlan } from '@/lib/video-tools/seam-bridge-plan'

const execFileAsync = promisify(execFile)

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

function mediaProbeError(): Error {
  return new Error('VIDEO_SEAM_MEDIA_PROBE_FAILED')
}

function ffmpegUnavailable(error: unknown): Error | null {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
    ? new Error('VIDEO_SEAM_FFMPEG_UNAVAILABLE')
    : null
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

function formatSeconds(seconds: number): string {
  return seconds.toFixed(9)
}

async function runFfmpeg(args: string[]): Promise<void> {
  const executable = process.env.FFMPEG_PATH || 'ffmpeg'
  try {
    await execFileAsync(executable, args, { windowsHide: true, maxBuffer: 1024 * 1024 * 8 })
  } catch (error) {
    throw ffmpegUnavailable(error) || error
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

export async function downloadVideoSeamFile(sourceUrl: string, destinationPath: string): Promise<void> {
  try {
    const response = await fetch(toFetchableUrl(sourceUrl))
    if (!response.ok || !response.body) throw new Error('VIDEO_SEAM_MEDIA_DOWNLOAD_FAILED')
    await pipeline(
      Readable.fromWeb(response.body as unknown as import('node:stream/web').ReadableStream),
      createWriteStream(destinationPath, { flags: 'wx' }),
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      await fs.unlink(destinationPath).catch(() => undefined)
    }
    throw new Error('VIDEO_SEAM_MEDIA_DOWNLOAD_FAILED')
  }
}

export function parseVideoSeamProbeJson(raw: string): SeamProbeResult {
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
    return {
      width,
      height,
      fps,
      frameCount,
      durationSeconds: frameCount / fps,
      hasAudio: streams.some((stream) => stream.codec_type === 'audio'),
    }
  } catch {
    throw mediaProbeError()
  }
}

export async function probeVideoSeamFile(filePath: string): Promise<SeamProbeResult> {
  const executable = process.env.FFPROBE_PATH || 'ffprobe'
  const args = [
    '-v', 'error', '-count_frames',
    '-show_entries', 'stream=codec_type,width,height,avg_frame_rate,nb_read_frames,duration:format=duration',
    '-of', 'json', filePath,
  ]
  try {
    const { stdout } = await execFileAsync(executable, args, { windowsHide: true, maxBuffer: 1024 * 1024 * 8 })
    return parseVideoSeamProbeJson(stdout)
  } catch (error) {
    throw ffmpegUnavailable(error) || mediaProbeError()
  }
}

export async function extractVideoSeamAnchors(params: {
  inputPath: string
  indices: [number, number]
  rawOutputPaths: [string, string]
  normalizedOutputPaths: [string, string]
  plan: VideoSeamBridgePlan
}): Promise<void> {
  const select = 'select=eq(n\\,' + params.indices[0] + ')+eq(n\\,' + params.indices[1] + ')'
  const args = [
    '-v', 'error', '-y', '-i', params.inputPath, '-vf', select,
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
  const bridgeFilter = [
    `crop=${canvas.contentWidth}:${canvas.contentHeight}:${canvas.padLeft}:${canvas.padTop}`,
    `scale=${outputSize}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${outputSize}`,
  ].join(',')
  const videoFilters = [
    `[0:v]trim=start_frame=0:end_frame=${input1Pre + 1},${setpts}[v0]`,
    `[1:v]${bridgeFilter},trim=start_frame=1:end_frame=${plan.handleFrames},${setpts}[v1]`,
    `[0:v]trim=start_frame=${input1Endpoint}:end_frame=${input1Endpoint + 1},${setpts}[v2]`,
    `[1:v]${bridgeFilter},trim=start_frame=${bridgeCentralStart}:end_frame=${bridgeCentralEnd},${setpts}[v3]`,
    `[2:v]scale=${outputSize}:force_original_aspect_ratio=increase:flags=lanczos,crop=${outputSize},trim=start_frame=${input2Endpoint}:end_frame=${input2Endpoint + 1},${setpts}[v4]`,
    `[1:v]${bridgeFilter},trim=start_frame=${bridgeOutgoingStart}:end_frame=${plan.generatedFrameCount - 1},${setpts}[v5]`,
    `[2:v]scale=${outputSize}:force_original_aspect_ratio=increase:flags=lanczos,crop=${outputSize},trim=start_frame=${input2Post},${setpts}[v6]`,
    '[v0][v1][v2][v3][v4][v5][v6]concat=n=7:v=1:a=0[vout]',
  ]
  const audioFilters = plan.audioPolicy === 'silent' ? [] : [
    plan.input1.hasAudio
      ? `[0:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=duration=${formatSeconds((input1Endpoint + 1) / plan.input1.fps)},asetpts=N/SR/TB[a0]`
      : `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${formatSeconds((input1Endpoint + 1) / plan.outputFps)}[a0]`,
    `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${formatSeconds(plan.centralSilenceSeconds)}[ac]`,
    plan.input2.hasAudio
      ? `[2:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=start=${formatSeconds(input2Endpoint / plan.input2.fps)},asetpts=N/SR/TB,atempo=${formatSeconds(plan.video2AudioTempoFactor)}[a2]`
      : `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${formatSeconds(plan.retainedVideo2FrameCount / plan.outputFps)}[a2]`,
    '[a0][ac][a2]concat=n=3:v=0:a=1[aout]',
  ]
  const args = [
    '-v', 'error', '-y', '-i', params.input1Path, '-i', params.bridgePath, '-i', params.input2Path,
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
  return { executable: process.env.FFMPEG_PATH || 'ffmpeg', args }
}

export async function composeVideoSeamOutput(
  params: Parameters<typeof buildVideoSeamComposeCommand>[0],
): Promise<void> {
  const command = buildVideoSeamComposeCommand(params)
  try {
    await execFileAsync(command.executable, command.args, { windowsHide: true, maxBuffer: 1024 * 1024 * 8 })
  } catch (error) {
    throw ffmpegUnavailable(error) || error
  }
}

export async function verifyVideoSeamOutput(filePath: string, plan: VideoSeamBridgePlan): Promise<SeamProbeResult> {
  const probe = await probeVideoSeamFile(filePath)
  const maxDeviation = 1 / plan.outputFps
  const expectedAudio = plan.audioPolicy !== 'silent'
  if (probe.width !== plan.input1.width || probe.height !== plan.input1.height
    || probe.frameCount !== plan.outputFrameCount || probe.hasAudio !== expectedAudio
    || Math.abs(probe.fps - plan.outputFps) > maxDeviation
    || Math.abs(probe.durationSeconds - plan.outputDurationSeconds) > maxDeviation) {
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
