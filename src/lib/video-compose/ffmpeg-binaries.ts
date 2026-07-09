import { execFileSync, type ExecFileOptions } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

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

const requireFromCurrentModule = createRequire(import.meta.url)

export type FfmpegBinaryResolverOptions = {
  readonly remotionCandidates?: readonly FfmpegBinaryCandidate[]
}

const runnableBinaryCache = new Map<string, boolean>()

function binaryFileName(binaryName: FfmpegBinaryName): string {
  return process.platform === 'win32' ? `${binaryName}.exe` : binaryName
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLinuxMusl(): boolean {
  if (process.platform !== 'linux') return false
  const report = process.report?.getReport()
  if (typeof report === 'string' || !isRecord(report)) return false
  const header = isRecord(report.header) ? report.header : null
  return typeof header?.glibcVersionRuntime !== 'string'
}

function remotionCompositorPackageName(): string {
  switch (process.platform) {
    case 'darwin':
      if (process.arch === 'arm64') return '@remotion/compositor-darwin-arm64'
      if (process.arch === 'x64') return '@remotion/compositor-darwin-x64'
      break
    case 'linux':
      if (process.arch === 'arm64') {
        return isLinuxMusl()
          ? '@remotion/compositor-linux-arm64-musl'
          : '@remotion/compositor-linux-arm64-gnu'
      }
      if (process.arch === 'x64') {
        return isLinuxMusl()
          ? '@remotion/compositor-linux-x64-musl'
          : '@remotion/compositor-linux-x64-gnu'
      }
      break
    case 'win32':
      if (process.arch === 'x64') return '@remotion/compositor-win32-x64-msvc'
      break
  }
  throw new Error(`FFMPEG_REMOTION_PLATFORM_UNSUPPORTED:${process.platform}-${process.arch}`)
}

function remotionBinaryEnv(directoryPath: string): FfmpegBinaryEnv | undefined {
  if (process.platform !== 'darwin') return undefined
  const existingLibraryPath = process.env.DYLD_LIBRARY_PATH?.trim()
  return {
    DYLD_LIBRARY_PATH: existingLibraryPath
      ? `${directoryPath}${path.delimiter}${existingLibraryPath}`
      : directoryPath,
  }
}

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

function resolveRemotionPackageBinary(
  binaryName: FfmpegBinaryName,
  candidates?: readonly FfmpegBinaryCandidate[],
): FfmpegBinaryExecution {
  if (candidates) {
    const candidateExecution = resolveFirstRunnableBinary(binaryName, candidates)
    if (candidateExecution) return candidateExecution
    throw new Error(`FFMPEG_BINARY_NOT_FOUND:${binaryName}`)
  }

  const packageName = remotionCompositorPackageName()
  let packageJsonPath: string
  try {
    packageJsonPath = requireFromCurrentModule.resolve(`${packageName}/package.json`)
  } catch {
    throw new Error(`FFMPEG_REMOTION_PACKAGE_NOT_INSTALLED:${binaryName}:${packageName}`)
  }
  const packageDirectory = path.dirname(packageJsonPath)
  const execution: FfmpegBinaryExecution = {
    command: path.join(packageDirectory, binaryFileName(binaryName)),
    cwd: packageDirectory,
    env: remotionBinaryEnv(packageDirectory),
  }
  if (isRunnableBinary(binaryName, execution)) return execution
  throw new Error(`FFMPEG_REMOTION_BINARY_UNUSABLE:${binaryName}:${execution.command}`)
}

export function resolveFfmpegBinary(
  binaryName: FfmpegBinaryName,
  options: FfmpegBinaryResolverOptions = {},
): FfmpegBinaryExecution {
  assertLegacyEnvPathUnset(binaryName)
  return resolveRemotionPackageBinary(binaryName, options.remotionCandidates)
}
