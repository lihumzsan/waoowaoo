import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { ffmpegPath } from 'ffmpeg-ffprobe-static'

const execFileAsync = promisify(execFile)

export interface GoldenMediaAssets {
  readonly png: Buffer
  readonly mp4: Buffer
  readonly mp3: Buffer
}

async function runFfmpeg(args: readonly string[]): Promise<void> {
  const binary = process.env.FFMPEG_PATH?.trim() || ffmpegPath
  if (!binary) throw new Error('GOLDEN_MEDIA_FFMPEG_UNAVAILABLE')
  await execFileAsync(binary, [...args], {
    timeout: 30_000,
  })
}

export async function createGoldenMediaAssets(): Promise<GoldenMediaAssets> {
  const directory = await mkdtemp(path.join(tmpdir(), 'waoowaoo-golden-media-'))
  const pngPath = path.join(directory, 'golden.png')
  const mp4Path = path.join(directory, 'golden.mp4')
  const mp3Path = path.join(directory, 'golden.mp3')
  const normalizedAudioPath = path.join(directory, 'golden-normalized.m4a')
  const decodedAudioPath = path.join(directory, 'golden-decoded.wav')
  try {
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=0.1',
      '-frames:v', '1', '-y', pngPath,
    ])
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=12:d=12',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=12',
      '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-ac', '2', '-movflags', '+faststart', '-y', mp4Path,
    ])
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error',
      '-i', mp4Path, '-t', '12.000', '-vn',
      '-af', 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,loudnorm=I=-16.000:TP=-1.500:LRA=11.000',
      '-c:a', 'aac', '-b:a', '192k', '-y', normalizedAudioPath,
    ])
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=30',
      '-c:a', 'libmp3lame', '-b:a', '64k', '-y', mp3Path,
    ])
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error',
      '-i', mp3Path, '-t', '12.000', '-ac', '2', '-ar', '48000', '-y', decodedAudioPath,
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
