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

function resolveEnvPath(binaryName: FfmpegBinaryName): string | null {
  const configuredPath = process.env[envVarName(binaryName)]?.trim()
  if (!configuredPath) return null
  if (isUsableFile(configuredPath)) return configuredPath
  throw new Error(`FFMPEG_BINARY_ENV_PATH_INVALID:${binaryName}:${configuredPath}`)
}

function resolveRemotionPackageBinary(binaryName: FfmpegBinaryName): string | null {
  const packageNames = REMOTION_COMPOSITOR_PACKAGES[`${process.platform}-${process.arch}`] ?? []
  for (const packageName of packageNames) {
    try {
      const packageJsonPath = requireFromCurrentModule.resolve(`${packageName}/package.json`)
      const binaryPath = path.join(path.dirname(packageJsonPath), binaryFileName(binaryName))
      if (isUsableFile(binaryPath)) return binaryPath
    } catch {
      continue
    }
  }
  return null
}

function pathExecutableNames(binaryName: FfmpegBinaryName): readonly string[] {
  if (process.platform !== 'win32') return [binaryName]
  const configuredExtensions = (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .map((extension) => extension.trim())
    .filter(Boolean)
  return configuredExtensions.map((extension) => `${binaryName}${extension.toLowerCase()}`)
}

function resolvePathBinary(binaryName: FfmpegBinaryName): string | null {
  const pathEntries = (process.env.PATH ?? '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
  for (const pathEntry of pathEntries) {
    for (const executableName of pathExecutableNames(binaryName)) {
      const candidatePath = path.join(pathEntry, executableName)
      if (existsSync(candidatePath) && isUsableFile(candidatePath)) return candidatePath
    }
  }
  return null
}

export function resolveFfmpegBinary(binaryName: FfmpegBinaryName): string {
  const envPath = resolveEnvPath(binaryName)
  if (envPath) return envPath

  const remotionPath = resolveRemotionPackageBinary(binaryName)
  if (remotionPath) return remotionPath

  const pathBinary = resolvePathBinary(binaryName)
  if (pathBinary) return pathBinary

  throw new Error(`FFMPEG_BINARY_NOT_FOUND:${binaryName}`)
}
