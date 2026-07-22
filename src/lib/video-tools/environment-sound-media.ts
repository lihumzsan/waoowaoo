import { execFile } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { promisify } from 'node:util'
import {
  mapFfmpegExecutableError,
  resolveFfmpegExecutable,
  type FfmpegExecutable,
} from '@/lib/media/ffmpeg-runtime'

const execFileAsync = promisify(execFile)
const MAX_ANALYSIS_FRAMES = 12
const MAX_COMMAND_BUFFER = 32 * 1024 * 1024
const UNIFORM_FRAME_ANCHORS = 6
const PROBE_TIMEOUT_MS = 30_000
const ANALYSIS_TIMEOUT_MS = 10 * 60_000
const FRAME_TIMEOUT_MS = 2 * 60_000
const COMPOSE_TIMEOUT_MS = 20 * 60_000

export type EnvironmentSoundMediaProbe = {
  durationSeconds: number
  hasAudio: boolean
}

export type EnvironmentSoundActivityRange = {
  startSeconds: number
  endSeconds: number
}

export type EnvironmentSoundVoiceActivitySummary = {
  voiceDurationSeconds: number
  activeSeconds: number
  activeRatio: number
  timelineAligned: boolean
  activeRanges: EnvironmentSoundActivityRange[]
}

export type EnvironmentSoundSourceAudioActivitySummary = {
  audioDurationSeconds: number
  activeSeconds: number
  activeRatio: number
  timelineAligned: true
  activeRanges: EnvironmentSoundActivityRange[]
}

export type EnvironmentSoundAudioLevel = {
  maxVolumeDb: number
}

export type EnvironmentSoundFrame = {
  timestampSeconds: number
  filePath: string
}

function roundTime(value: number): number {
  return Math.round(value * 1000) / 1000
}

function readPositiveDuration(value: unknown, code: string): number {
  const duration = typeof value === 'string' || typeof value === 'number' ? Number(value) : Number.NaN
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(code)
  return roundTime(duration)
}

export function buildEnvironmentSoundCommandOptions(timeoutMs: number) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('ENVIRONMENT_SOUND_COMMAND_TIMEOUT_INVALID')
  }
  return {
    windowsHide: true,
    maxBuffer: MAX_COMMAND_BUFFER,
    timeout: timeoutMs,
    killSignal: 'SIGKILL' as const,
  }
}

async function runEnvironmentSoundCommand(
  executable: FfmpegExecutable,
  args: string[],
  timeoutMs: number,
) {
  try {
    return await execFileAsync(
      resolveFfmpegExecutable(executable),
      args,
      buildEnvironmentSoundCommandOptions(timeoutMs),
    )
  } catch (error) {
    throw mapFfmpegExecutableError(error, 'ENVIRONMENT_SOUND_FFMPEG_UNAVAILABLE') || error
  }
}

export function parseEnvironmentSoundMaxVolume(stderr: string): number {
  const matches = Array.from(stderr.matchAll(/\bmax_volume:\s*(-inf|-?[0-9]+(?:\.[0-9]+)?)\s*dB/gi))
  const raw = matches.at(-1)?.[1]?.toLowerCase()
  if (!raw) throw new Error('ENVIRONMENT_SOUND_AUDIO_LEVEL_INVALID')
  if (raw === '-inf') return Number.NEGATIVE_INFINITY
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new Error('ENVIRONMENT_SOUND_AUDIO_LEVEL_INVALID')
  return value
}

export function parseSceneChangeTimes(stderr: string): number[] {
  const timestamps = new Set<number>()
  for (const match of stderr.matchAll(/\bpts_time:([0-9]+(?:\.[0-9]+)?)/g)) {
    const value = Number(match[1])
    if (Number.isFinite(value) && value >= 0) timestamps.add(roundTime(value))
  }
  return Array.from(timestamps).sort((left, right) => left - right)
}

export function parseVoiceActivity(stderr: string, durationSeconds: number): EnvironmentSoundActivityRange[] {
  const duration = readPositiveDuration(durationSeconds, 'ENVIRONMENT_SOUND_VOICE_DURATION_INVALID')
  const events = Array.from(stderr.matchAll(/silence_(start|end):\s*([0-9]+(?:\.[0-9]+)?)/g))
    .map((match) => ({ kind: match[1] as 'start' | 'end', time: Math.min(duration, roundTime(Number(match[2]))) }))
    .filter((event) => Number.isFinite(event.time) && event.time >= 0)

  const active: EnvironmentSoundActivityRange[] = []
  let activeStart = 0
  let inSilence = false
  for (const event of events) {
    if (event.kind === 'start' && !inSilence) {
      if (event.time > activeStart) active.push({ startSeconds: activeStart, endSeconds: event.time })
      inSilence = true
      continue
    }
    if (event.kind === 'end' && inSilence) {
      activeStart = event.time
      inSilence = false
    }
  }
  if (!inSilence && activeStart < duration) {
    active.push({ startSeconds: activeStart, endSeconds: duration })
  }
  return active.filter((range) => range.endSeconds - range.startSeconds >= 0.05)
}

export function summarizeEnvironmentSoundVoiceActivity(
  ranges: EnvironmentSoundActivityRange[],
  voiceDurationSeconds: number,
  videoDurationSeconds?: number,
): EnvironmentSoundVoiceActivitySummary {
  void videoDurationSeconds
  const voiceDuration = readPositiveDuration(voiceDurationSeconds, 'ENVIRONMENT_SOUND_VOICE_DURATION_INVALID')
  const activeSeconds = roundTime(ranges.reduce((total, range) => {
    return total + Math.max(0, Math.min(voiceDuration, range.endSeconds) - Math.max(0, range.startSeconds))
  }, 0))
  return {
    voiceDurationSeconds: voiceDuration,
    activeSeconds,
    activeRatio: Math.round(Math.min(1, activeSeconds / voiceDuration) * 1000) / 1000,
    timelineAligned: false,
    activeRanges: [],
  }
}

export function summarizeEnvironmentSoundSourceAudioActivity(
  ranges: EnvironmentSoundActivityRange[],
  durationSeconds: number,
): EnvironmentSoundSourceAudioActivitySummary {
  const duration = readPositiveDuration(durationSeconds, 'ENVIRONMENT_SOUND_VIDEO_DURATION_INVALID')
  const activeSeconds = roundTime(ranges.reduce((total, range) => {
    return total + Math.max(0, Math.min(duration, range.endSeconds) - Math.max(0, range.startSeconds))
  }, 0))
  return {
    audioDurationSeconds: duration,
    activeSeconds,
    activeRatio: Math.round(Math.min(1, activeSeconds / duration) * 1000) / 1000,
    timelineAligned: true,
    activeRanges: ranges,
  }
}

export function selectEnvironmentSoundFrameTimes(
  durationSeconds: number,
  sceneChangeTimes: number[],
): number[] {
  const duration = readPositiveDuration(durationSeconds, 'ENVIRONMENT_SOUND_VIDEO_DURATION_INVALID')
  const lastTimestamp = roundTime(Math.max(0, duration - 0.1))
  const normalizedScenes = Array.from(new Set(sceneChangeTimes
    .filter((value) => Number.isFinite(value) && value > 0 && value < lastTimestamp)
    .map(roundTime)))
    .sort((left, right) => left - right)

  const uniformAnchors = Array.from({ length: UNIFORM_FRAME_ANCHORS }, (_, index) => {
    return roundTime(lastTimestamp * index / (UNIFORM_FRAME_ANCHORS - 1))
  })
  const selected = new Set<number>(uniformAnchors)
  const remainingScenes = [...normalizedScenes]

  while (selected.size < MAX_ANALYSIS_FRAMES && remainingScenes.length > 0) {
    let bestIndex = 0
    let bestDistance = -1
    for (let index = 0; index < remainingScenes.length; index += 1) {
      const candidate = remainingScenes[index]!
      const distance = Math.min(...Array.from(selected, (value) => Math.abs(value - candidate)))
      if (distance > bestDistance) {
        bestDistance = distance
        bestIndex = index
      }
    }
    const [candidate] = remainingScenes.splice(bestIndex, 1)
    if (candidate !== undefined && bestDistance >= 0.2) selected.add(candidate)
  }

  for (let index = 1; selected.size < MAX_ANALYSIS_FRAMES && index < MAX_ANALYSIS_FRAMES * 4; index += 1) {
    const timestamp = roundTime(lastTimestamp * index / (MAX_ANALYSIS_FRAMES - 1))
    if (Array.from(selected).every((value) => Math.abs(value - timestamp) >= 0.2)) selected.add(timestamp)
  }

  return Array.from(selected).sort((left, right) => left - right).slice(0, MAX_ANALYSIS_FRAMES)
}

export function buildEnvironmentSoundAcrossfadeFilter(transitions: number[]): string {
  return transitions.map((duration, index) => {
    const left = index === 0 ? '[0:a]' : `[a${index}]`
    const right = `[${index + 1}:a]`
    return `${left}${right}acrossfade=d=${duration}:c1=tri:c2=tri[a${index + 1}]`
  }).join(';')
}

export async function downloadEnvironmentSoundSource(sourceUrl: string, outputPath: string): Promise<void> {
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(`ENVIRONMENT_SOUND_SOURCE_DOWNLOAD_FAILED: ${response.status}`)
  }
  await pipeline(Readable.fromWeb(response.body as NodeReadableStream), createWriteStream(outputPath))
}

export async function probeEnvironmentSoundMedia(filePath: string): Promise<EnvironmentSoundMediaProbe> {
  const { stdout } = await runEnvironmentSoundCommand('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_type',
    '-of', 'json',
    filePath,
  ], PROBE_TIMEOUT_MS)
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: unknown }
    streams?: Array<{ codec_type?: unknown }>
  }
  return {
    durationSeconds: readPositiveDuration(parsed.format?.duration, 'ENVIRONMENT_SOUND_VIDEO_DURATION_INVALID'),
    hasAudio: parsed.streams?.some((stream) => stream.codec_type === 'audio') === true,
  }
}

export async function detectEnvironmentSoundSceneChanges(filePath: string): Promise<number[]> {
  const { stderr } = await runEnvironmentSoundCommand('ffmpeg', [
    '-hide_banner',
    '-i', filePath,
    '-vf', "select='gt(scene,0.32)',showinfo",
    '-an',
    '-f', 'null',
    '-',
  ], ANALYSIS_TIMEOUT_MS)
  return parseSceneChangeTimes(stderr)
}

export async function detectEnvironmentSoundVoiceActivity(
  filePath: string,
  durationSeconds: number,
): Promise<EnvironmentSoundActivityRange[]> {
  const { stderr } = await runEnvironmentSoundCommand('ffmpeg', [
    '-hide_banner',
    '-i', filePath,
    '-af', 'silencedetect=noise=-40dB:d=0.25',
    '-f', 'null',
    '-',
  ], ANALYSIS_TIMEOUT_MS)
  return parseVoiceActivity(stderr, durationSeconds)
}

export const detectEnvironmentSoundAudioActivity = detectEnvironmentSoundVoiceActivity

export async function measureEnvironmentSoundAudioLevel(
  filePath: string,
): Promise<EnvironmentSoundAudioLevel> {
  const { stderr } = await runEnvironmentSoundCommand('ffmpeg', [
    '-hide_banner',
    '-i', filePath,
    '-af', 'volumedetect',
    '-f', 'null',
    '-',
  ], ANALYSIS_TIMEOUT_MS)
  return { maxVolumeDb: parseEnvironmentSoundMaxVolume(stderr) }
}

export async function extractEnvironmentSoundFrames(
  filePath: string,
  outputDir: string,
  durationSeconds: number,
  sceneChangeTimes: number[],
): Promise<EnvironmentSoundFrame[]> {
  const times = selectEnvironmentSoundFrameTimes(durationSeconds, sceneChangeTimes)
  const frames: EnvironmentSoundFrame[] = []
  await fs.mkdir(outputDir, { recursive: true })

  for (let index = 0; index < times.length; index += 1) {
    const timestampSeconds = times[index]!
    const outputPath = path.join(outputDir, `frame-${String(index + 1).padStart(2, '0')}.jpg`)
    await runEnvironmentSoundCommand('ffmpeg', [
      '-y',
      '-ss', timestampSeconds.toFixed(3),
      '-i', filePath,
      '-frames:v', '1',
      '-vf', 'scale=1280:-2:force_original_aspect_ratio=decrease',
      '-q:v', '3',
      outputPath,
    ], FRAME_TIMEOUT_MS)
    frames.push({ timestampSeconds, filePath: outputPath })
  }
  return frames
}

export async function composeEnvironmentSoundMp3(params: {
  inputPaths: string[]
  transitions: number[]
  outputPath: string
  durationSeconds: number
}): Promise<void> {
  if (params.inputPaths.length === 0 || params.transitions.length !== params.inputPaths.length - 1) {
    throw new Error('ENVIRONMENT_SOUND_COMPOSE_INPUT_INVALID')
  }
  const duration = readPositiveDuration(params.durationSeconds, 'ENVIRONMENT_SOUND_COMPOSE_DURATION_INVALID')
  const args = ['-y']
  for (const inputPath of params.inputPaths) args.push('-i', inputPath)

  const acrossfade = buildEnvironmentSoundAcrossfadeFilter(params.transitions)
  const source = params.inputPaths.length === 1 ? '[0:a]' : `[a${params.inputPaths.length - 1}]`
  const finalFilter = `${source}apad=whole_dur=${duration},atrim=duration=${duration},aresample=44100,aformat=channel_layouts=stereo[final]`
  args.push(
    '-filter_complex', acrossfade ? `${acrossfade};${finalFilter}` : finalFilter,
    '-map', '[final]',
    '-c:a', 'libmp3lame',
    '-q:a', '0',
    '-ar', '44100',
    '-ac', '2',
    params.outputPath,
  )
  await runEnvironmentSoundCommand('ffmpeg', args, COMPOSE_TIMEOUT_MS)
}
