import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  isFfmpegCommandProcessExitError,
  MediaDurationInvalidError,
  probeAudioStreamDurationSeconds,
} from '@/lib/video-compose/ffmpeg-command'

export class InvalidAudioMediaError extends Error {
  constructor(cause: unknown) {
    super('AUDIO_MEDIA_INVALID', { cause })
    this.name = 'InvalidAudioMediaError'
  }
}

export async function probeAudioBufferDurationMs(input: {
  readonly buffer: Uint8Array
  readonly extension: string
  readonly stage: string
}): Promise<number> {
  const extension = input.extension.trim().toLowerCase()
  if (!/^[a-z0-9]+$/u.test(extension)) throw new Error('MEDIA_DURATION_PROBE_EXTENSION_INVALID')
  const workDir = await mkdtemp(path.join(tmpdir(), 'waoowaoo-media-probe-'))
  try {
    const sourcePath = path.join(workDir, `source.${extension}`)
    await writeFile(sourcePath, input.buffer)
    try {
      const durationSeconds = await probeAudioStreamDurationSeconds(sourcePath, input.stage)
      const durationMs = Math.round(durationSeconds * 1000)
      if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
        throw new MediaDurationInvalidError('MEDIA_AUDIO_STREAM_DURATION_INVALID')
      }
      return durationMs
    } catch (error) {
      if (error instanceof MediaDurationInvalidError || isFfmpegCommandProcessExitError(error)) {
        throw new InvalidAudioMediaError(error)
      }
      throw error
    }
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}
