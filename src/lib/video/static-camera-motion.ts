import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { resolveFfmpegExecutable } from '@/lib/media/ffmpeg-runtime'
import { toFetchableUrl } from '@/lib/storage'

const execFileAsync = promisify(execFile)

export type StaticCameraMotion = 'slow_push_in'

export type StaticCameraMotionRenderOptions = {
  imageSource: string
  durationSeconds: number
  fps: number
  aspectRatio?: string | null
  resolution?: string | null
  motion: StaticCameraMotion
}

function normalizePositiveNumber(value: number, fallback: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.min(value, max)
}

function resolveOutputSize(aspectRatio: string | null | undefined, resolution: string | null | undefined): {
  width: number
  height: number
} {
  const longEdge = resolution === '1080p' ? 1920 : 1280
  const shortEdge = resolution === '1080p' ? 1080 : 720
  const normalizedRatio = (aspectRatio || '16:9').trim()

  if (normalizedRatio === '9:16') return { width: shortEdge, height: longEdge }
  if (normalizedRatio === '1:1') return { width: shortEdge, height: shortEdge }
  if (normalizedRatio === '3:2') return { width: 1080, height: 720 }
  if (normalizedRatio === '2:3') return { width: 720, height: 1080 }
  return { width: longEdge, height: shortEdge }
}

async function downloadSourceImage(imageSource: string): Promise<Buffer> {
  if (imageSource.startsWith('data:')) {
    const base64Start = imageSource.indexOf(';base64,')
    if (base64Start === -1) throw new Error('STATIC_CAMERA_IMAGE_DATA_URL_INVALID')
    return Buffer.from(imageSource.slice(base64Start + 8), 'base64')
  }

  const response = await fetch(toFetchableUrl(imageSource))
  if (!response.ok) {
    throw new Error(`STATIC_CAMERA_IMAGE_DOWNLOAD_FAILED: ${response.status} ${response.statusText}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

function buildSlowPushInFilter(params: {
  width: number
  height: number
  frameCount: number
  fps: number
}): string {
  const denominator = Math.max(params.frameCount - 1, 1)
  const maxZoomDelta = 0.028
  const zoomExpression = `1+${maxZoomDelta.toFixed(6)}*on/${denominator}`
  return [
    `scale=${params.width}:${params.height}:force_original_aspect_ratio=increase`,
    `crop=${params.width}:${params.height}`,
    `zoompan=z='${zoomExpression}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${params.frameCount}:s=${params.width}x${params.height}:fps=${params.fps}`,
    'format=yuv420p',
  ].join(',')
}

export async function renderStaticCameraMotionVideo(options: StaticCameraMotionRenderOptions): Promise<Buffer> {
  const durationSeconds = normalizePositiveNumber(options.durationSeconds, 12, 30)
  const fps = Math.round(normalizePositiveNumber(options.fps, 25, 60))
  const frameCount = Math.max(1, Math.round(durationSeconds * fps))
  const durationArg = durationSeconds.toFixed(3)
  const { width, height } = resolveOutputSize(options.aspectRatio, options.resolution)

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'waoo-static-camera-'))
  const inputPath = path.join(tempDir, 'source.png')
  const outputPath = path.join(tempDir, 'output.mp4')

  try {
    await fs.writeFile(inputPath, await downloadSourceImage(options.imageSource))

    const ffmpegPath = resolveFfmpegExecutable('ffmpeg')
    const videoFilter = buildSlowPushInFilter({ width, height, frameCount, fps })
    const args = [
      '-y',
      '-loop', '1',
      '-i', inputPath,
      '-f', 'lavfi',
      '-t', durationArg,
      '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-vf', videoFilter,
      '-frames:v', String(frameCount),
      '-t', durationArg,
      '-r', String(fps),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '96k',
      '-shortest',
      '-movflags', '+faststart',
      outputPath,
    ]

    await execFileAsync(ffmpegPath, args, {
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 8,
    })

    return await fs.readFile(outputPath)
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}
