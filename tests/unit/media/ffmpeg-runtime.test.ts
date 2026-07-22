import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { mapFfmpegExecutableError, resolveFfmpegExecutable } from '@/lib/media/ffmpeg-runtime'

const originalFfmpegPath = process.env.FFMPEG_PATH
const originalFfprobePath = process.env.FFPROBE_PATH

function restoreExecutablePaths(): void {
  if (originalFfmpegPath === undefined) delete process.env.FFMPEG_PATH
  else process.env.FFMPEG_PATH = originalFfmpegPath
  if (originalFfprobePath === undefined) delete process.env.FFPROBE_PATH
  else process.env.FFPROBE_PATH = originalFfprobePath
}

afterEach(restoreExecutablePaths)

describe('FFmpeg runtime configuration', () => {
  it('preserves native Windows executable paths including spaces', () => {
    process.env.FFMPEG_PATH = String.raw`C:\Program Files\FFmpeg\bin\ffmpeg.exe`
    process.env.FFPROBE_PATH = String.raw`D:\media tools\FFmpeg\bin\ffprobe.exe`

    expect(resolveFfmpegExecutable('ffmpeg')).toBe(String.raw`C:\Program Files\FFmpeg\bin\ffmpeg.exe`)
    expect(resolveFfmpegExecutable('ffprobe')).toBe(String.raw`D:\media tools\FFmpeg\bin\ffprobe.exe`)
  })

  it('resolves FFmpeg and FFprobe independently with PATH-compatible fallbacks', () => {
    process.env.FFMPEG_PATH = '/usr/local/bin/ffmpeg'
    delete process.env.FFPROBE_PATH

    expect(resolveFfmpegExecutable('ffmpeg')).toBe('/usr/local/bin/ffmpeg')
    expect(resolveFfmpegExecutable('ffprobe')).toBe('ffprobe')
  })

  it('maps only missing executable failures to the caller error contract', () => {
    const missingExecutable = Object.assign(new Error('spawn failed'), { code: 'ENOENT' })
    const permissionDenied = Object.assign(new Error('spawn failed'), { code: 'EACCES' })

    const mapped = mapFfmpegExecutableError(missingExecutable, 'ENVIRONMENT_SOUND_FFMPEG_UNAVAILABLE')

    expect(mapped).toMatchObject({ message: 'ENVIRONMENT_SOUND_FFMPEG_UNAVAILABLE' })
    expect(mapped?.cause).toBe(missingExecutable)
    expect(mapFfmpegExecutableError(permissionDenied, 'ENVIRONMENT_SOUND_FFMPEG_UNAVAILABLE')).toBeNull()
    expect(mapFfmpegExecutableError(null, 'ENVIRONMENT_SOUND_FFMPEG_UNAVAILABLE')).toBeNull()
  })

  it('documents both executable variables for macOS, native Windows, and WSL2', async () => {
    const example = await fs.readFile(path.resolve('.env.example'), 'utf8')

    expect(example).toContain('FFMPEG_PATH=')
    expect(example).toContain('FFPROBE_PATH=')
    expect(example).toContain('macOS')
    expect(example).toContain('Windows')
    expect(example).toContain('WSL2')
  })
})
