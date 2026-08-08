import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { probeMediaDurationSeconds } from '@/lib/video-compose/ffmpeg-command'

export async function probeMediaBufferDurationMs(input: {
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
    const durationSeconds = await probeMediaDurationSeconds(sourcePath, input.stage)
    const durationMs = Math.round(durationSeconds * 1000)
    if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
      throw new Error('MEDIA_DURATION_INVALID')
    }
    return durationMs
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}
