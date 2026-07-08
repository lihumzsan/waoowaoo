import { execFileSync } from 'node:child_process'
import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

export type FfmpegBinaryName = 'ffmpeg' | 'ffprobe'

const requireFromCurrentModule = createRequire(import.meta.url)

const REMOTION_COMPOSITOR_PACKAGES: Readonly<Record<string, readonly string[]>> = {
  'darwin-arm64': ['@remotion/compositor-darwin-arm64'],
  'darwin-x64': ['@remotion/compositor-darwin-x64'],
  'linux-arm64': [
    '@remotion/compositor-linux-arm64-gnu',
    '@remotion/compositor-linux-arm64-musl',
  ],
  'linux-x64': [
    '@remotion/compositor-linux-x64-gnu',
    '@remotion/compositor-linux-x64-musl',
  ],
  'win32-x64': ['@remotion/compositor-win32-x64-msvc'],
}

export type FfmpegBinaryResolverOptions = {
  readonly remotionCandidates?: readonly string[]
  readonly pathCandidates?: readonly string[]
}

const runnableBinaryCache = new Map<string, boolean>()

function envVarName(binaryName: FfmpegBinaryName): 'FFMPEG_PATH' | 'FFPROBE_PATH' {
  return binaryName === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH'
}

function binaryFileName(binaryName: FfmpegBinaryName): string {
  return process.platform === 'win32' ? `${binaryName}.exe` : binaryName
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

function isRunnableBinary(binaryName: FfmpegBinaryName, filePath: string): boolean {
  if (!isUsableFile(filePath)) return false
  const cacheKey = `${binaryName}:${filePath}`
  const cached = runnableBinaryCache.get(cacheKey)
  if (cached !== undefined) return cached
  try {
    execFileSync(filePath, ['-version'], {
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

function resolveEnvPath(binaryName: FfmpegBinaryName): string | null {
  const configuredPath = process.env[envVarName(binaryName)]?.trim()
  if (!configuredPath) return null
  if (isRunnableBinary(binaryName, configuredPath)) return configuredPath
  throw new Error(`FFMPEG_BINARY_ENV_PATH_INVALID:${binaryName}:${configuredPath}`)
}

function resolveFirstRunnableBinary(binaryName: FfmpegBinaryName, candidates: readonly string[]): string | null {
  for (const candidatePath of candidates) {
    if (isRunnableBinary(binaryName, candidatePath)) return candidatePath
  }
  return null
}

function resolveRemotionPackageBinary(binaryName: FfmpegBinaryName, candidates?: readonly string[]): string | null {
  if (candidates) return resolveFirstRunnableBinary(binaryName, candidates)
  const packageNames = REMOTION_COMPOSITOR_PACKAGES[`${process.platform}-${process.arch}`] ?? []
  const binaryPaths: string[] = []
  for (const packageName of packageNames) {
    try {
      const packageJsonPath = requireFromCurrentModule.resolve(`${packageName}/package.json`)
      const binaryPath = path.join(path.dirname(packageJsonPath), binaryFileName(binaryName))
      binaryPaths.push(binaryPath)
    } catch {
      continue
    }
  }
  return resolveFirstRunnableBinary(binaryName, binaryPaths)
}

function pathExecutableNames(binaryName: FfmpegBinaryName): readonly string[] {
  if (process.platform !== 'win32') return [binaryName]
  const configuredExtensions = (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .map((extension) => extension.trim())
    .filter(Boolean)
  return configuredExtensions.map((extension) => `${binaryName}${extension.toLowerCase()}`)
}

function resolvePathBinary(binaryName: FfmpegBinaryName, candidates?: readonly string[]): string | null {
  if (candidates) return resolveFirstRunnableBinary(binaryName, candidates)
  const pathEntries = (process.env.PATH ?? '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
  for (const pathEntry of pathEntries) {
    for (const executableName of pathExecutableNames(binaryName)) {
      const candidatePath = path.join(pathEntry, executableName)
      if (existsSync(candidatePath) && isRunnableBinary(binaryName, candidatePath)) return candidatePath
    }
  }
  return null
}

export function resolveFfmpegBinary(
  binaryName: FfmpegBinaryName,
  options: FfmpegBinaryResolverOptions = {},
): string {
  const envPath = resolveEnvPath(binaryName)
  if (envPath) return envPath

  const remotionPath = resolveRemotionPackageBinary(binaryName, options.remotionCandidates)
  if (remotionPath) return remotionPath

  const pathBinary = resolvePathBinary(binaryName, options.pathCandidates)
  if (pathBinary) return pathBinary

  throw new Error(`FFMPEG_BINARY_NOT_FOUND:${binaryName}`)
}
