import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildFfmpegExecFileOptions,
  resolveFfmpegBinary,
} from '@/lib/video-compose/ffmpeg-binaries'

const originalFfmpegPath = process.env.FFMPEG_PATH
const originalFfprobePath = process.env.FFPROBE_PATH
const originalPath = process.env.PATH
const temporaryDirectories: string[] = []

afterEach(() => {
  restoreEnv('FFMPEG_PATH', originalFfmpegPath)
  restoreEnv('FFPROBE_PATH', originalFfprobePath)
  restoreEnv('PATH', originalPath)
  for (const directoryPath of temporaryDirectories.splice(0)) {
    rmSync(directoryPath, { recursive: true, force: true })
  }
})

function restoreEnv(name: 'FFMPEG_PATH' | 'FFPROBE_PATH' | 'PATH', value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}

function createExecutable(name: string, exitCode: number = 0): string {
  const directoryPath = mkdtempSync(path.join(tmpdir(), 'waoowaoo-ffmpeg-bin-'))
  temporaryDirectories.push(directoryPath)
  return createExecutableAt(directoryPath, name, `#!/bin/sh\nexit ${exitCode}\n`)
}

function createExecutableAt(directoryPath: string, name: string, script: string): string {
  const executablePath = path.join(directoryPath, name)
  writeFileSync(executablePath, script, 'utf8')
  chmodSync(executablePath, 0o755)
  return executablePath
}

describe('ffmpeg binary resolver', () => {
  it('rejects legacy executable environment paths instead of using system ffmpeg', () => {
    const executablePath = createExecutable('custom-ffmpeg')
    process.env.FFMPEG_PATH = executablePath

    expect(() => resolveFfmpegBinary('ffmpeg')).toThrow('FFMPEG_BINARY_ENV_PATH_UNSUPPORTED:ffmpeg:FFMPEG_PATH')
  })

  it('rejects legacy ffprobe environment paths before bundled discovery', () => {
    process.env.FFPROBE_PATH = path.join(tmpdir(), 'missing-waoowaoo-ffprobe')

    expect(() => resolveFfmpegBinary('ffprobe')).toThrow('FFMPEG_BINARY_ENV_PATH_UNSUPPORTED:ffprobe:FFPROBE_PATH')
  })

  it('resolves Remotion compositor candidates with their execution environment', () => {
    delete process.env.FFMPEG_PATH
    const directoryPath = mkdtempSync(path.join(tmpdir(), 'waoowaoo-remotion-ffmpeg-bin-'))
    temporaryDirectories.push(directoryPath)
    writeFileSync(path.join(directoryPath, 'remotion-marker'), 'ok', 'utf8')
    const remotionCandidate = createExecutableAt(
      directoryPath,
      'remotion-ffmpeg',
      '#!/bin/sh\n[ -f "./remotion-marker" ] || exit 31\n[ "$REMOTION_TEST_LIBRARY_PATH" = "enabled" ] || exit 32\nexit 0\n',
    )

    const execution = resolveFfmpegBinary('ffmpeg', {
      remotionCandidates: [{
        command: remotionCandidate,
        cwd: directoryPath,
        env: { REMOTION_TEST_LIBRARY_PATH: 'enabled' },
      }],
    })
    const execOptions = buildFfmpegExecFileOptions(execution, {
      env: { ...process.env, CALLER_ENV: 'preserved' },
    })

    expect(execution).toEqual(expect.objectContaining({
      command: remotionCandidate,
      cwd: directoryPath,
    }))
    expect(execOptions.cwd).toBe(directoryPath)
    expect(execOptions.env?.REMOTION_TEST_LIBRARY_PATH).toBe('enabled')
    expect(execOptions.env?.CALLER_ENV).toBe('preserved')
  })

  it('does not use system PATH ffmpeg when bundled candidates are unavailable', () => {
    delete process.env.FFMPEG_PATH
    const brokenRemotionCandidate = createExecutable('broken-remotion-ffmpeg', 23)
    const systemDirectory = mkdtempSync(path.join(tmpdir(), 'waoowaoo-system-ffmpeg-bin-'))
    temporaryDirectories.push(systemDirectory)
    createExecutableAt(systemDirectory, 'ffmpeg', '#!/bin/sh\nexit 0\n')
    process.env.PATH = systemDirectory

    expect(() => resolveFfmpegBinary('ffmpeg', {
      remotionCandidates: [{ command: brokenRemotionCandidate }],
    })).toThrow('FFMPEG_BINARY_NOT_FOUND:ffmpeg')
  })

  it('fails explicitly when every discovered candidate exists but cannot run', () => {
    delete process.env.FFPROBE_PATH
    const brokenRemotionCandidate = createExecutable('broken-remotion-ffprobe', 23)

    expect(() => resolveFfmpegBinary('ffprobe', {
      remotionCandidates: [{ command: brokenRemotionCandidate }],
    })).toThrow('FFMPEG_BINARY_NOT_FOUND:ffprobe')
  })
})
