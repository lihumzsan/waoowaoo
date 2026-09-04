import { copyFile, mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import {
  H3_CONTINUATION_GUIDE_FRAMES,
  H3_FRAMES_PER_SECOND,
  H3_MAX_SEGMENT_DURATION_SECONDS,
} from '@/lib/video-generation/h3-timeline'
import { probeMediaDurationSeconds, runFfmpegCommand } from './ffmpeg-command'
import { probeVideoDimensions } from './video-merge-ffmpeg'

const H3_CONTINUATION_TAIL_PADDING_FRAMES = H3_FRAMES_PER_SECOND
const H3_CONTINUATION_MAX_DECODED_FRAMES = (
  H3_CONTINUATION_GUIDE_FRAMES + H3_CONTINUATION_TAIL_PADDING_FRAMES
)
const H3_CONTINUATION_TAIL_WINDOW_SECONDS = (
  H3_CONTINUATION_MAX_DECODED_FRAMES / H3_FRAMES_PER_SECOND
)
const H3_CONTINUATION_DURATION_TOLERANCE_SECONDS = 1 / H3_FRAMES_PER_SECOND

function requireCanvasDimension(value: number, field: 'width' | 'height'): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value % 32 !== 0) {
    throw new Error(`H3_CONTINUATION_${field.toUpperCase()}_INVALID:${String(value)}`)
  }
  return value
}

export async function extractH3ContinuationGuide(input: {
  readonly inputPath: string
  readonly workspaceDir: string
  readonly width: number
  readonly height: number
}): Promise<readonly string[]> {
  const inputPath = input.inputPath.trim()
  const workspaceDir = input.workspaceDir.trim()
  if (!inputPath) throw new Error('H3_CONTINUATION_SOURCE_PATH_REQUIRED')
  if (!workspaceDir) throw new Error('H3_CONTINUATION_WORKSPACE_REQUIRED')
  const width = requireCanvasDimension(input.width, 'width')
  const height = requireCanvasDimension(input.height, 'height')
  await mkdir(workspaceDir, { recursive: true })
  const [sourceDurationSeconds, sourceDimensions] = await Promise.all([
    probeMediaDurationSeconds(inputPath, 'h3_continuation_probe_duration'),
    probeVideoDimensions(inputPath),
  ])
  if (sourceDimensions.width * height !== sourceDimensions.height * width) {
    throw new Error(
      `H3_CONTINUATION_SOURCE_DIMENSIONS_MISMATCH:${String(sourceDimensions.width)}x${String(sourceDimensions.height)}:${String(width)}x${String(height)}`,
    )
  }
  const minimumSourceDurationSeconds = H3_CONTINUATION_GUIDE_FRAMES / H3_FRAMES_PER_SECOND
  if (sourceDurationSeconds < minimumSourceDurationSeconds) {
    throw new Error(`H3_CONTINUATION_SOURCE_TOO_SHORT:${String(sourceDurationSeconds)}`)
  }
  if (
    sourceDurationSeconds
    > H3_MAX_SEGMENT_DURATION_SECONDS + H3_CONTINUATION_DURATION_TOLERANCE_SECONDS
  ) {
    throw new Error(`H3_CONTINUATION_SOURCE_TOO_LONG:${String(sourceDurationSeconds)}`)
  }
  const tailDurationSeconds = Math.min(
    sourceDurationSeconds,
    H3_CONTINUATION_TAIL_WINDOW_SECONDS,
  )
  const seekStartSeconds = Math.max(0, sourceDurationSeconds - tailDurationSeconds)

  await runFfmpegCommand('ffmpeg', [
    '-y',
    '-ss', seekStartSeconds.toFixed(6),
    '-i', inputPath,
    '-t', tailDurationSeconds.toFixed(6),
    '-map', '0:v:0',
    '-an', '-sn', '-dn',
    '-vf', `fps=${String(H3_FRAMES_PER_SECOND)},scale=${String(width)}:${String(height)}:force_original_aspect_ratio=increase,crop=${String(width)}:${String(height)},setsar=1`,
    '-frames:v', String(H3_CONTINUATION_MAX_DECODED_FRAMES),
    '-start_number', '0',
    path.join(workspaceDir, 'decoded-%06d.png'),
  ], {
    stage: 'h3_continuation_extract_guide',
    expectedDurationSeconds: tailDurationSeconds,
  })

  const decoded = (await readdir(workspaceDir))
    .filter((filename) => /^decoded-\d{6}\.png$/u.test(filename))
    .sort()
  if (decoded.length < H3_CONTINUATION_GUIDE_FRAMES) {
    throw new Error(`H3_CONTINUATION_SOURCE_TOO_SHORT:${String(decoded.length)}`)
  }
  const selected = decoded.slice(-H3_CONTINUATION_GUIDE_FRAMES)
  const result: string[] = []
  for (const [index, filename] of selected.entries()) {
    const outputPath = path.join(
      workspaceDir,
      `continuation-${String(index).padStart(2, '0')}.png`,
    )
    await copyFile(path.join(workspaceDir, filename), outputPath)
    result.push(outputPath)
  }
  return result
}
