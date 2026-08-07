import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { buildFfmpegExecFileOptions, resolveFfmpegBinary, type FfmpegBinaryName } from './ffmpeg-binaries'

export type FfmpegCommandResult = {
  readonly stdout: string
  readonly stderr: string
}

export type FfmpegCommandRunner = (command: FfmpegBinaryName, args: readonly string[]) => Promise<FfmpegCommandResult>

export type FfmpegCommandContext = {
  readonly stage: string
  readonly expectedDurationSeconds?: number
}

const execFileAsync = promisify(execFile)
const FFMPEG_MAX_BUFFER_BYTES = 32 * 1024 * 1024
const FFPROBE_TIMEOUT_MS = 30_000
const FFMPEG_BASE_TIMEOUT_MS = 30_000
const FFMPEG_TIMEOUT_MS_PER_MEDIA_SECOND = 2_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeStage(stage: string): string {
  const normalized = stage.trim()
  if (!normalized) throw new Error('FFMPEG_COMMAND_STAGE_REQUIRED')
  if (!/^[a-z0-9_:-]+$/i.test(normalized)) throw new Error('FFMPEG_COMMAND_STAGE_INVALID')
  return normalized
}

export function resolveFfmpegCommandTimeoutMs(command: FfmpegBinaryName, expectedDurationSeconds?: number): number {
  if (command === 'ffprobe') return FFPROBE_TIMEOUT_MS
  if (typeof expectedDurationSeconds !== 'number' || !Number.isFinite(expectedDurationSeconds) || expectedDurationSeconds <= 0) {
    throw new Error('FFMPEG_COMMAND_EXPECTED_DURATION_INVALID')
  }
  return Math.ceil(FFMPEG_BASE_TIMEOUT_MS + expectedDurationSeconds * FFMPEG_TIMEOUT_MS_PER_MEDIA_SECOND)
}

function isTimeoutTermination(error: unknown): boolean {
  if (!isRecord(error)) return false
  return error.killed === true && error.signal === 'SIGKILL'
}

export async function runFfmpegCommand(command: FfmpegBinaryName, args: readonly string[], context: FfmpegCommandContext): Promise<FfmpegCommandResult> {
  const stage = normalizeStage(context.stage)
  const timeoutMs = resolveFfmpegCommandTimeoutMs(command, context.expectedDurationSeconds)
  const execution = resolveFfmpegBinary(command)
  const commandArgs = command === 'ffmpeg' ? ['-nostdin', ...args] : [...args]

  try {
    const result = await execFileAsync(
      execution.command,
      commandArgs,
      buildFfmpegExecFileOptions(execution, {
        maxBuffer: FFMPEG_MAX_BUFFER_BYTES,
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
      }),
    )
    return {
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
    }
  } catch (error) {
    if (isTimeoutTermination(error)) {
      throw new Error(`FFMPEG_COMMAND_TIMEOUT:${stage}:${timeoutMs}`, { cause: error })
    }
    throw error
  }
}

export async function probeMediaDurationSeconds(
  filePath: string,
  stage = 'media_probe_duration',
): Promise<number> {
  const result = await runFfmpegCommand('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath,
  ], { stage })
  const duration = Number.parseFloat(result.stdout.trim())
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('MEDIA_DURATION_INVALID')
  return duration
}

export function createFfmpegCommandRunner(context: FfmpegCommandContext): FfmpegCommandRunner {
  return async (command, args) => await runFfmpegCommand(command, args, context)
}
