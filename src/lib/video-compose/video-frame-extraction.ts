import { stat } from 'node:fs/promises'
import type { VideoFrameSelector } from '@/lib/workspace-resource/video-frame-contract'
import type { FfmpegCommandRunner } from './ffmpeg-command'

function requireFilePath(value: string, field: 'source' | 'output'): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`VIDEO_FRAME_${field.toUpperCase()}_PATH_REQUIRED`)
  return normalized
}

function buildSelectionFfmpegArgs(selector: VideoFrameSelector): readonly string[] {
  switch (selector) {
    case 'first_decodable':
      return ['-frames:v', '1', '-update', '1']
    case 'last_decodable':
      return ['-update', '1']
    default: {
      const unsupportedSelector: never = selector
      throw new Error(`VIDEO_FRAME_SELECTOR_UNSUPPORTED:${String(unsupportedSelector)}`)
    }
  }
}

export function buildDecodableVideoFrameFfmpegArgs(input: {
  readonly selector: VideoFrameSelector
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
    ...buildSelectionFfmpegArgs(input.selector),
    outputPath,
  ]
}

export async function extractDecodableVideoFrame(input: {
  readonly runCommand: FfmpegCommandRunner
  readonly selector: VideoFrameSelector
  readonly sourcePath: string
  readonly outputPath: string
}): Promise<void> {
  await input.runCommand('ffmpeg', buildDecodableVideoFrameFfmpegArgs(input))
  try {
    const output = await stat(input.outputPath)
    if (!output.isFile() || output.size <= 0) throw new Error('VIDEO_FRAME_OUTPUT_INVALID')
  } catch (error) {
    if (error instanceof Error && error.message === 'VIDEO_FRAME_OUTPUT_INVALID') throw error
    throw new Error('VIDEO_FRAME_OUTPUT_MISSING', { cause: error })
  }
}
