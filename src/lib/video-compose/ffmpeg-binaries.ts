import { execFileSync, type ExecFileOptions } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { ffmpegPath, ffprobePath } from 'ffmpeg-ffprobe-static'

export type FfmpegBinaryName = 'ffmpeg' | 'ffprobe'
export type FfmpegBinaryEnv = Readonly<Record<string, string>>

export type FfmpegBinaryExecution = {
  readonly command: string
  readonly cwd?: string
  readonly env?: FfmpegBinaryEnv
}

export type FfmpegBinaryCandidate = {
  readonly command: string
  readonly cwd?: string
  readonly env?: FfmpegBinaryEnv
}

export type FfmpegBinaryResolverOptions = {
  readonly bundledCandidates?: readonly FfmpegBinaryCandidate[]
}

const STATIC_BINARY_PATHS: Readonly<Record<FfmpegBinaryName, string | null>> = {
  ffmpeg: ffmpegPath,
  ffprobe: ffprobePath,
}

const runnableBinaryCache = new Map<string, boolean>()

function mergeExecutionEnv(
  executionEnv: FfmpegBinaryEnv | undefined,
  optionsEnv: ExecFileOptions['env'],
): ExecFileOptions['env'] {
  if (!executionEnv) return optionsEnv
  return {
    ...process.env,
    ...(optionsEnv ?? {}),
    ...executionEnv,
  }
}

export function buildFfmpegExecFileOptions(
  execution: FfmpegBinaryExecution,
  options: ExecFileOptions = {},
): ExecFileOptions {
  const env = mergeExecutionEnv(execution.env, options.env)
  return {
    ...options,
    cwd: execution.cwd ?? options.cwd,
    ...(env ? { env } : {}),
  }
}

function isUsableFile(filePath: string): boolean {
  try {
    if (!statSync(filePath).isFile()) return false
    accessSync(filePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function executionCacheKey(binaryName: FfmpegBinaryName, execution: FfmpegBinaryExecution): string {
  const envKey = execution.env
    ? Object.entries(execution.env)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join('\0')
    : ''
  return [binaryName, execution.command, execution.cwd ?? '', envKey].join('\0')
}

function isRunnableBinary(binaryName: FfmpegBinaryName, execution: FfmpegBinaryExecution): boolean {
  if (!isUsableFile(execution.command)) return false
  const cacheKey = executionCacheKey(binaryName, execution)
  const cached = runnableBinaryCache.get(cacheKey)
  if (cached !== undefined) return cached
  try {
    const options = buildFfmpegExecFileOptions(execution)
    execFileSync(execution.command, ['-version'], {
      cwd: options.cwd,
      env: options.env,
      stdio: 'ignore',
      timeout: 5000,
    })
    runnableBinaryCache.set(cacheKey, true)
    return true
  } catch {
    runnableBinaryCache.set(cacheKey, false)
    return false
  }
}

function assertLegacyEnvPathUnset(binaryName: FfmpegBinaryName): void {
  const legacyEnvName = binaryName === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH'
  const configuredPath = process.env[legacyEnvName]?.trim()
  if (configuredPath) {
    throw new Error(`FFMPEG_BINARY_ENV_PATH_UNSUPPORTED:${binaryName}:${legacyEnvName}`)
  }
}

function resolveFirstRunnableBinary(
  binaryName: FfmpegBinaryName,
  candidates: readonly FfmpegBinaryCandidate[],
): FfmpegBinaryExecution | null {
  for (const candidate of candidates) {
    const execution: FfmpegBinaryExecution = {
      ...candidate,
    }
    if (isRunnableBinary(binaryName, execution)) return execution
  }
  return null
}

function resolveStaticPackageBinary(
  binaryName: FfmpegBinaryName,
  candidates?: readonly FfmpegBinaryCandidate[],
): FfmpegBinaryExecution {
  if (candidates) {
    const candidateExecution = resolveFirstRunnableBinary(binaryName, candidates)
    if (candidateExecution) return candidateExecution
    throw new Error(`FFMPEG_BINARY_NOT_FOUND:${binaryName}`)
  }

  const command = STATIC_BINARY_PATHS[binaryName]
  if (!command) {
    throw new Error(`FFMPEG_STATIC_PLATFORM_UNSUPPORTED:${binaryName}:${process.platform}-${process.arch}`)
  }

  const execution: FfmpegBinaryExecution = { command }
  if (isRunnableBinary(binaryName, execution)) return execution
  throw new Error(`FFMPEG_STATIC_BINARY_UNUSABLE:${binaryName}:${command}`)
}

export function resolveFfmpegBinary(
  binaryName: FfmpegBinaryName,
  options: FfmpegBinaryResolverOptions = {},
): FfmpegBinaryExecution {
  assertLegacyEnvPathUnset(binaryName)
  return resolveStaticPackageBinary(binaryName, options.bundledCandidates)
}
