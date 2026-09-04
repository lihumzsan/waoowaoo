import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { runFfmpegCommand } from './ffmpeg-command'

const MIN_VIDEO_FRAME_RATE = 1
const MAX_VIDEO_FRAME_RATE = 120
const FRAME_RATE_PATTERN = /^([1-9]\d*)\/([1-9]\d*)$/u

export async function probeVideoDimensions(filePath: string): Promise<{
  readonly width: number
  readonly height: number
}> {
  const result = await runFfmpegCommand('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height',
    '-of',
    'csv=p=0:s=x',
    filePath,
  ], { stage: 'workspace_resource_video_merge_probe_dimensions' })
  const [rawWidth, rawHeight] = result.stdout.trim().split('x')
  const width = Number.parseInt(rawWidth ?? '', 10)
  const height = Number.parseInt(rawHeight ?? '', 10)
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new Error('WORKSPACE_RESOURCE_VIDEO_MERGE_DIMENSIONS_INVALID')
  }
  return { width, height }
}

export async function normalizeVideoClip(input: {
  readonly sourcePath: string
  readonly outputPath: string
  readonly durationSeconds: number
  readonly width: number
  readonly height: number
  readonly frameRate: string
}): Promise<void> {
  await runFfmpegCommand('ffmpeg', [
    '-y',
    '-i',
    input.sourcePath,
    '-t',
    input.durationSeconds.toFixed(3),
    '-vf',
    `scale=${input.width}:${input.height}:force_original_aspect_ratio=decrease,pad=${input.width}:${input.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${input.frameRate},format=yuv420p`,
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    input.outputPath,
  ], {
    stage: 'workspace_resource_video_merge_normalize',
    expectedDurationSeconds: input.durationSeconds,
  })
}

export async function probeVideoFrameRate(filePath: string): Promise<string> {
  const result = await runFfmpegCommand('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=avg_frame_rate',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath,
  ], { stage: 'workspace_resource_video_merge_probe_fps' })
  const match = FRAME_RATE_PATTERN.exec(result.stdout.trim())
  const numerator = Number.parseInt(match?.[1] ?? '', 10)
  const denominator = Number.parseInt(match?.[2] ?? '', 10)
  const frameRate = numerator / denominator
  if (
    !match
    || !Number.isSafeInteger(numerator)
    || numerator <= 0
    || !Number.isSafeInteger(denominator)
    || denominator <= 0
    || !Number.isFinite(frameRate)
    || frameRate < MIN_VIDEO_FRAME_RATE
    || frameRate > MAX_VIDEO_FRAME_RATE
  ) {
    throw new Error('WORKSPACE_RESOURCE_VIDEO_MERGE_FRAME_RATE_INVALID')
  }
  return `${String(numerator)}/${String(denominator)}`
}

function escapeConcatPath(filePath: string): string {
  return filePath.replace(/'/g, "'\\''")
}

export async function concatVideoClips(input: {
  readonly clipPaths: readonly string[]
  readonly listPath: string
  readonly outputPath: string
  readonly durationSeconds: number
}): Promise<void> {
  if (input.clipPaths.length === 0) {
    throw new Error('WORKSPACE_RESOURCE_VIDEO_MERGE_INPUT_REQUIRED')
  }
  const lines = input.clipPaths.map((clipPath) => `file '${escapeConcatPath(clipPath)}'`).join('\n')
  await writeFile(input.listPath, `${lines}\n`, 'utf8')
  await runFfmpegCommand('ffmpeg', [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    input.listPath,
    '-c',
    'copy',
    input.outputPath,
  ], {
    stage: 'workspace_resource_video_merge_concat',
    expectedDurationSeconds: input.durationSeconds,
  })
}

async function probeVideoCodec(filePath: string): Promise<string> {
  const result = await runFfmpegCommand('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name',
    '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
  ], { stage: 'workspace_resource_video_merge_probe_codec' })
  const codec = result.stdout.trim().toLowerCase()
  if (!codec) throw new Error('WORKSPACE_RESOURCE_VIDEO_MERGE_CODEC_INVALID')
  return codec
}

export async function composeVideoMergeVideoTrack(input: {
  readonly sourcePaths: readonly string[]
  readonly durations: readonly number[]
  readonly workspaceDir: string
  readonly width: number
  readonly height: number
}): Promise<string> {
  const sourcePath = input.sourcePaths[0]
  if (!sourcePath || input.sourcePaths.length !== input.durations.length) {
    throw new Error('WORKSPACE_RESOURCE_VIDEO_MERGE_INPUT_INVALID')
  }
  if (input.sourcePaths.length === 1 && await probeVideoCodec(sourcePath) === 'h264') {
    return sourcePath
  }

  const frameRate = await probeVideoFrameRate(sourcePath)
  const normalizedPaths: string[] = []
  for (const [index, currentSourcePath] of input.sourcePaths.entries()) {
    const durationSeconds = input.durations[index]
    if (!durationSeconds) throw new Error(`WORKSPACE_RESOURCE_VIDEO_MERGE_DURATION_MISSING:${String(index)}`)
    const normalizedPath = path.join(input.workspaceDir, `normalized-${String(index)}.mp4`)
    await normalizeVideoClip({
      sourcePath: currentSourcePath,
      outputPath: normalizedPath,
      durationSeconds,
      width: input.width,
      height: input.height,
      frameRate,
    })
    normalizedPaths.push(normalizedPath)
  }
  const stitchedPath = path.join(input.workspaceDir, 'stitched.mp4')
  await concatVideoClips({
    clipPaths: normalizedPaths,
    listPath: path.join(input.workspaceDir, 'concat.txt'),
    outputPath: stitchedPath,
    durationSeconds: input.durations.reduce((sum, duration) => sum + duration, 0),
  })
  return stitchedPath
}
