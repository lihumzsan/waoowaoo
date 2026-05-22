import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { toFetchableUrl } from '@/lib/storage'

const execFileAsync = promisify(execFile)

type VideoSource = string | Buffer

function resolveFfmpegPath(): string {
  return process.env.FFMPEG_PATH || 'ffmpeg'
}

export function resolveFfprobePath(): string {
  return process.env.FFPROBE_PATH || 'ffprobe'
}

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), `waoo-video-${randomUUID()}-`))
  try {
    return await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function decodeDataUrl(source: string): Buffer | null {
  const match = source.match(/^data:([^;,]+)?(;base64)?,(.*)$/)
  if (!match) return null
  const isBase64 = Boolean(match[2])
  const payload = match[3] || ''
  return isBase64
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload))
}

async function writeVideoSource(source: VideoSource, targetPath: string): Promise<void> {
  if (Buffer.isBuffer(source)) {
    await writeFile(targetPath, source)
    return
  }

  const dataUrlBuffer = decodeDataUrl(source)
  if (dataUrlBuffer) {
    await writeFile(targetPath, dataUrlBuffer)
    return
  }

  const response = await fetch(toFetchableUrl(source))
  if (!response.ok) {
    throw new Error(`Failed to fetch video source for ffmpeg: HTTP ${response.status}`)
  }
  await writeFile(targetPath, Buffer.from(await response.arrayBuffer()))
}

function concatListPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/'/g, "'\\''")
}

async function runFfmpeg(args: string[]): Promise<void> {
  try {
    await execFileAsync(resolveFfmpegPath(), args, { windowsHide: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`ffmpeg failed: ${message}`)
  }
}

export async function extractVideoLastFrame(source: VideoSource): Promise<Buffer> {
  return await withTempDir(async (dir) => {
    const inputPath = path.join(dir, 'input.mp4')
    const outputPath = path.join(dir, 'last-frame.jpg')
    await writeVideoSource(source, inputPath)

    await runFfmpeg([
      '-y',
      '-sseof',
      '-0.1',
      '-i',
      inputPath,
      '-frames:v',
      '1',
      '-q:v',
      '2',
      outputPath,
    ])

    return await readFile(outputPath)
  })
}

export async function concatVideos(sources: VideoSource[]): Promise<Buffer> {
  if (sources.length === 0) {
    throw new Error('concatVideos requires at least one source video')
  }

  return await withTempDir(async (dir) => {
    const segmentPaths: string[] = []
    for (const [index, source] of sources.entries()) {
      const segmentPath = path.join(dir, `segment-${index}.mp4`)
      await writeVideoSource(source, segmentPath)
      segmentPaths.push(segmentPath)
    }

    const listPath = path.join(dir, 'concat.txt')
    const outputPath = path.join(dir, 'merged.mp4')
    await writeFile(
      listPath,
      segmentPaths.map((segmentPath) => `file '${concatListPath(segmentPath)}'`).join('\n'),
    )

    try {
      await runFfmpeg([
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        listPath,
        '-c',
        'copy',
        outputPath,
      ])
    } catch {
      await runFfmpeg([
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        listPath,
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        outputPath,
      ])
    }

    return await readFile(outputPath)
  })
}
