import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveFfmpegBinary } from '@/lib/video-compose/ffmpeg-binaries'

const originalFfmpegPath = process.env.FFMPEG_PATH
const originalFfprobePath = process.env.FFPROBE_PATH

afterEach(() => {
  process.env.FFMPEG_PATH = originalFfmpegPath
  process.env.FFPROBE_PATH = originalFfprobePath
})

function createExecutable(name: string): string {
  const directoryPath = mkdtempSync(path.join(tmpdir(), 'waoowaoo-ffmpeg-bin-'))
  const executablePath = path.join(directoryPath, name)
  writeFileSync(executablePath, '#!/bin/sh\nexit 0\n', 'utf8')
  chmodSync(executablePath, 0o755)
  return executablePath
}

describe('ffmpeg binary resolver', () => {
  it('uses explicit executable environment paths before bundled binaries', () => {
    const executablePath = createExecutable('custom-ffmpeg')
    process.env.FFMPEG_PATH = executablePath

    expect(resolveFfmpegBinary('ffmpeg')).toBe(executablePath)

    rmSync(path.dirname(executablePath), { recursive: true, force: true })
  })

  it('fails explicitly when an explicit executable path is invalid', () => {
    process.env.FFMPEG_PATH = path.join(tmpdir(), 'missing-waoowaoo-ffmpeg')

    expect(() => resolveFfmpegBinary('ffmpeg')).toThrow('FFMPEG_BINARY_ENV_PATH_INVALID:ffmpeg')
  })

  it('resolves Remotion compositor ffmpeg when no explicit path is configured', () => {
    delete process.env.FFMPEG_PATH

    expect(resolveFfmpegBinary('ffmpeg')).toContain('@remotion')
    expect(resolveFfmpegBinary('ffmpeg')).toContain('ffmpeg')
  })

  it('resolves Remotion compositor ffprobe when no explicit path is configured', () => {
    delete process.env.FFPROBE_PATH

    expect(resolveFfmpegBinary('ffprobe')).toContain('@remotion')
    expect(resolveFfmpegBinary('ffprobe')).toContain('ffprobe')
  })
})
