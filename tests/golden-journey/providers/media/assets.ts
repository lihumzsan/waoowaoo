import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface GoldenMediaAssets {
  readonly png: Buffer
  readonly mp4: Buffer
  readonly mp3: Buffer
}

async function runFfmpeg(args: readonly string[]): Promise<void> {
  await execFileAsync(process.env.FFMPEG_PATH?.trim() || 'ffmpeg', [...args], {
    timeout: 30_000,
  })
}

export async function createGoldenMediaAssets(): Promise<GoldenMediaAssets> {
  const directory = await mkdtemp(path.join(tmpdir(), 'waoowaoo-golden-media-'))
  const pngPath = path.join(directory, 'golden.png')
  const mp4Path = path.join(directory, 'golden.mp4')
  const mp3Path = path.join(directory, 'golden.mp3')
  try {
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=0.1',
      '-frames:v', '1', '-y', pngPath,
    ])
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=12:d=0.5',
      '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=44100:duration=0.5',
      '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-ac', '2', '-movflags', '+faststart', '-y', mp4Path,
    ])
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5',
      '-c:a', 'libmp3lame', '-b:a', '64k', '-y', mp3Path,
    ])
    const [png, mp4, mp3] = await Promise.all([
      readFile(pngPath),
      readFile(mp4Path),
      readFile(mp3Path),
    ])
    return { png, mp4, mp3 }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
