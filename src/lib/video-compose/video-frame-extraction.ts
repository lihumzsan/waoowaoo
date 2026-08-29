import { stat } from 'node:fs/promises'
import type { FfmpegCommandRunner } from './ffmpeg-command'

function requireFilePath(value: string, field: 'source' | 'output'): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`VIDEO_FRAME_${field.toUpperCase()}_PATH_REQUIRED`)
  return normalized
}

export function buildLastDecodableFrameFfmpegArgs(input: {
  readonly sourcePath: string
  readonly outputPath: string
}): readonly string[] {
  const sourcePath = requireFilePath(input.sourcePath, 'source')
  const outputPath = requireFilePath(input.outputPath, 'output')
  return [
    '-y',
    '-i',
    sourcePath,
    '-map',
    '0:v:0',
    '-an',
    '-sn',
    '-dn',
    '-fps_mode',
    'passthrough',
    '-update',
    '1',
    outputPath,
  ]
}

export async function extractLastDecodableVideoFrame(input: {
  readonly runCommand: FfmpegCommandRunner
  readonly sourcePath: string
  readonly outputPath: string
}): Promise<void> {
  await input.runCommand('ffmpeg', buildLastDecodableFrameFfmpegArgs(input))
  try {
    const output = await stat(input.outputPath)
    if (!output.isFile() || output.size <= 0) throw new Error('VIDEO_FRAME_OUTPUT_INVALID')
  } catch (error) {
    if (error instanceof Error && error.message === 'VIDEO_FRAME_OUTPUT_INVALID') throw error
    throw new Error('VIDEO_FRAME_OUTPUT_MISSING', { cause: error })
  }
}
