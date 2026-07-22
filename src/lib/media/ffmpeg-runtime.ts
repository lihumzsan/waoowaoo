export type FfmpegExecutable = 'ffmpeg' | 'ffprobe'

const EXECUTABLE_ENV_KEYS: Record<FfmpegExecutable, 'FFMPEG_PATH' | 'FFPROBE_PATH'> = {
  ffmpeg: 'FFMPEG_PATH',
  ffprobe: 'FFPROBE_PATH',
}

export function resolveFfmpegExecutable(executable: FfmpegExecutable): string {
  return process.env[EXECUTABLE_ENV_KEYS[executable]]?.trim() || executable
}

export function mapFfmpegExecutableError(error: unknown, errorCode: string): Error | null {
  if (error === null || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') {
    return null
  }
  return new Error(errorCode, { cause: error })
}
