import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveFfmpegBinary } from '@/lib/video-compose/ffmpeg-binaries'

const originalFfmpegPath = process.env.FFMPEG_PATH
const originalFfprobePath = process.env.FFPROBE_PATH
const temporaryDirectories: string[] = []

afterEach(() => {
  restoreEnv('FFMPEG_PATH', originalFfmpegPath)
  restoreEnv('FFPROBE_PATH', originalFfprobePath)
  for (const directoryPath of temporaryDirectories.splice(0)) {
    rmSync(directoryPath, { recursive: true, force: true })
  }
})

function restoreEnv(name: 'FFMPEG_PATH' | 'FFPROBE_PATH', value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}

function createExecutable(name: string, exitCode: number = 0): string {
  const directoryPath = mkdtempSync(path.join(tmpdir(), 'waoowaoo-ffmpeg-bin-'))
  temporaryDirectories.push(directoryPath)
  const executablePath = path.join(directoryPath, name)
  writeFileSync(executablePath, `#!/bin/sh\nexit ${exitCode}\n`, 'utf8')
  chmodSync(executablePath, 0o755)
  return executablePath
}

describe('ffmpeg binary resolver', () => {
  it('uses explicit executable environment paths before bundled binaries', () => {
    const executablePath = createExecutable('custom-ffmpeg')
    process.env.FFMPEG_PATH = executablePath

    expect(resolveFfmpegBinary('ffmpeg')).toBe(executablePath)
  })

  it('fails explicitly when an explicit executable path is invalid', () => {
    process.env.FFMPEG_PATH = path.join(tmpdir(), 'missing-waoowaoo-ffmpeg')

    expect(() => resolveFfmpegBinary('ffmpeg')).toThrow('FFMPEG_BINARY_ENV_PATH_INVALID:ffmpeg')
  })

  it('resolves runnable Remotion compositor ffmpeg candidates before PATH candidates', () => {
    delete process.env.FFMPEG_PATH
    const remotionCandidate = createExecutable('remotion-ffmpeg')
    const pathCandidate = createExecutable('path-ffmpeg')

    expect(resolveFfmpegBinary('ffmpeg', {
      remotionCandidates: [remotionCandidate],
      pathCandidates: [pathCandidate],
    })).toBe(remotionCandidate)
  })

  it('skips broken bundled candidates and uses a runnable PATH candidate', () => {
    delete process.env.FFMPEG_PATH
    const brokenRemotionCandidate = createExecutable('broken-remotion-ffmpeg', 23)
    const pathCandidate = createExecutable('system-ffmpeg')

    expect(resolveFfmpegBinary('ffmpeg', {
      remotionCandidates: [brokenRemotionCandidate],
      pathCandidates: [pathCandidate],
    })).toBe(pathCandidate)
  })

  it('fails explicitly when every discovered candidate exists but cannot run', () => {
    delete process.env.FFPROBE_PATH
    const brokenRemotionCandidate = createExecutable('broken-remotion-ffprobe', 23)
    const brokenPathCandidate = createExecutable('broken-path-ffprobe', 24)

    expect(() => resolveFfmpegBinary('ffprobe', {
      remotionCandidates: [brokenRemotionCandidate],
      pathCandidates: [brokenPathCandidate],
    })).toThrow('FFMPEG_BINARY_NOT_FOUND:ffprobe')
  })
})
