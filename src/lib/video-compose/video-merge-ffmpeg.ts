import { z } from 'zod'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ResolvedCompositionTiming } from './composition-timing'
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

export async function probeVideoDurationSeconds(filePath: string): Promise<number> {
  const result = await runFfmpegCommand('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
  ], { stage: 'workspace_resource_video_merge_probe_video_duration' })
  const duration = Number(result.stdout.trim())
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('WORKSPACE_RESOURCE_VIDEO_MERGE_VIDEO_DURATION_INVALID')
  }
  return duration
}

export async function normalizeVideoClip(input: {
  readonly sourcePath: string
  readonly outputPath: string
  readonly sourceDurationSeconds: number
  readonly sourceStartSeconds: number
  readonly videoFrameCount: number
  readonly width: number
  readonly height: number
  readonly frameRate: string
}): Promise<void> {
  // Retain the preceding keyframe context; trim by source timestamps before
  // rebasing so an off-grid start keeps its covering frame, including at EOF.
  // The input duration bounds decoding from the earlier seek point; trim owns
  // the exact source endpoint, while fps alone projects onto the output grid.
  const sourceEndSeconds = input.sourceStartSeconds + input.sourceDurationSeconds
  await runFfmpegCommand(
    'ffmpeg',
    [
      '-y',
      '-copyts',
      '-start_at_zero',
      '-noaccurate_seek',
      '-ss',
      input.sourceStartSeconds.toFixed(3),
      '-t',
      sourceEndSeconds.toFixed(3),
      '-i',
      input.sourcePath,
      '-vf',
      `trim=end=${sourceEndSeconds.toFixed(3)},setpts=PTS-${input.sourceStartSeconds.toFixed(3)}/TB,scale=${input.width}:${input.height}:force_original_aspect_ratio=decrease,pad=${input.width}:${input.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,tpad=stop_mode=clone:stop=-1,fps=${input.frameRate}:start_time=0:round=near:eof_action=pass,format=yuv420p`,
      '-frames:v',
      String(input.videoFrameCount),
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      input.outputPath,
    ],
    {
      stage: 'workspace_resource_video_merge_normalize',
      expectedDurationSeconds: input.sourceDurationSeconds,
    },
  )
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

const encodedVideoTimingSchema = z.object({
  streams: z.tuple([
    z.object({
      nb_frames: z.string().regex(/^[1-9]\d*$/u),
      duration: z
        .string()
        .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0),
    }),
  ]),
})

export async function composeVideoMergeVideoTrack(input: {
  readonly sourcePaths: readonly string[]
  readonly timeline: ResolvedCompositionTiming
  readonly workspaceDir: string
  readonly width: number
  readonly height: number
}): Promise<{ readonly stitchedPath: string; readonly encodedDurationMs: number }> {
  const { timeline } = input
  if (input.sourcePaths.length !== timeline.clips.length) {
    throw new Error('WORKSPACE_RESOURCE_VIDEO_MERGE_INPUT_INVALID')
  }
  const normalizedPaths: string[] = []
  for (const [index, sourcePath] of input.sourcePaths.entries()) {
    const clip = timeline.clips[index]
    if (!clip) throw new Error('WORKSPACE_RESOURCE_VIDEO_MERGE_INPUT_INVALID')
    const normalizedPath = path.join(
      input.workspaceDir,
      `normalized-${String(index)}.mp4`,
    )
    await normalizeVideoClip({
      sourcePath,
      outputPath: normalizedPath,
      sourceDurationSeconds: clip.durationMs / 1000,
      sourceStartSeconds: clip.sourceStartMs / 1000,
      videoFrameCount: clip.videoFrameCount,
      width: input.width,
      height: input.height,
      frameRate: timeline.frameRate,
    })
    normalizedPaths.push(normalizedPath)
  }
  const stitchedPath = path.join(input.workspaceDir, 'stitched.mp4')
  await concatVideoClips({
    clipPaths: normalizedPaths,
    listPath: path.join(input.workspaceDir, 'concat.txt'),
    outputPath: stitchedPath,
    durationSeconds: timeline.videoDurationUs / 1000000,
  })
  // Validate encoded facts; never turn them into a second placement authority.
  const probe = await runFfmpegCommand(
    'ffprobe',
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=nb_frames,duration',
      '-of',
      'json',
      stitchedPath,
    ],
    { stage: 'workspace_resource_video_merge_verify_timing' },
  )
  const data: unknown = JSON.parse(probe.stdout)
  const parsed = encodedVideoTimingSchema.parse(data)
  const stream = parsed.streams[0]
  const frameDurationUs = timeline.videoDurationUs / timeline.videoFrameCount
  if (
    Number(stream.nb_frames) !== timeline.videoFrameCount ||
    Math.abs(Number(stream.duration) * 1000000 - timeline.videoDurationUs) >
      frameDurationUs / 2
  ) {
    throw new Error('WORKSPACE_RESOURCE_VIDEO_MERGE_OUTPUT_TIMING_MISMATCH')
  }
  return { stitchedPath, encodedDurationMs: Math.round(Number(stream.duration) * 1000) }
}
