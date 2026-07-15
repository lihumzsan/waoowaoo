import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'
import { buildFfmpegExecFileOptions, resolveFfmpegBinary } from '@/lib/video-compose/ffmpeg-binaries'
import { BGM_DESIGN_SAMPLE_RATE } from './types'

const execFileAsync = promisify(execFile)

export type ScoreDurationConformance = {
  readonly sourceDurationSeconds: number
  readonly targetDurationSeconds: number
  readonly tempoRatio: number
  readonly method: 'none' | 'trim' | 'tempo'
}

export function resolveScoreProviderDurationSeconds(input: {
  readonly musicModel: string
  readonly targetDurationSeconds: number
}): number {
  const musicModel = input.musicModel.trim()
  const targetDurationSeconds = input.targetDurationSeconds
  if (!musicModel) throw new Error('AUDIO_SCORE_MUSIC_MODEL_REQUIRED')
  if (!Number.isFinite(targetDurationSeconds) || targetDurationSeconds <= 0) {
    throw new Error('AUDIO_SCORE_TARGET_DURATION_INVALID')
  }
  ensureAiCatalogsRegistered()
  const range = resolveBuiltinCapabilitiesByModelKey('music', musicModel)?.music?.durationSecondsRange
  if (!range) throw new Error(`AUDIO_SCORE_CONTINUOUS_DURATION_CAPABILITY_REQUIRED:${musicModel}`)
  if (targetDurationSeconds > range.max) {
    throw new Error(`AUDIO_SCORE_DURATION_EXCEEDS_MODEL_RANGE:${targetDurationSeconds.toFixed(3)}:${range.max}`)
  }
  return Math.max(range.min, targetDurationSeconds)
}

export function resolveScoreDurationConformance(input: {
  readonly sourceDurationSeconds: number
  readonly targetDurationSeconds: number
}): ScoreDurationConformance {
  if (!Number.isFinite(input.sourceDurationSeconds) || input.sourceDurationSeconds <= 0) throw new Error('AUDIO_SCORE_SOURCE_DURATION_INVALID')
  if (!Number.isFinite(input.targetDurationSeconds) || input.targetDurationSeconds <= 0) throw new Error('AUDIO_SCORE_TARGET_DURATION_INVALID')
  const difference = input.sourceDurationSeconds - input.targetDurationSeconds
  if (Math.abs(difference) <= 1 / BGM_DESIGN_SAMPLE_RATE) {
    return { ...input, tempoRatio: 1, method: 'none' }
  }
  if (difference > 0) {
    return { ...input, tempoRatio: 1, method: 'trim' }
  }
  const tempoRatio = input.sourceDurationSeconds / input.targetDurationSeconds
  if (tempoRatio < 0.95) throw new Error(`AUDIO_SCORE_DURATION_CONFORMANCE_OUT_OF_RANGE:${tempoRatio.toFixed(6)}`)
  return { ...input, tempoRatio, method: 'tempo' }
}

function audioExtension(mimeType: string): 'mp3' | 'wav' | 'm4a' {
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3'
  if (mimeType.includes('wav')) return 'wav'
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a'
  throw new Error(`AUDIO_SCORE_DURATION_MIME_UNSUPPORTED:${mimeType}`)
}

export async function conformScoreDuration(input: {
  readonly audio: { readonly buffer: Buffer; readonly mimeType: string }
  readonly workspaceDir: string
  readonly fileName: string
  readonly sourceDurationSeconds: number
  readonly targetDurationSeconds: number
}): Promise<{
  readonly audio: { readonly buffer: Buffer; readonly mimeType: string }
  readonly conformance: ScoreDurationConformance
}> {
  const conformance = resolveScoreDurationConformance(input)
  if (conformance.method === 'none') return { audio: input.audio, conformance }
  const sourcePath = path.join(input.workspaceDir, `${input.fileName}-duration-source.${audioExtension(input.audio.mimeType)}`)
  const outputPath = path.join(input.workspaceDir, `${input.fileName}-duration-conformed.wav`)
  const targetSamples = Math.round(input.targetDurationSeconds * BGM_DESIGN_SAMPLE_RATE)
  const filter = conformance.method === 'trim'
    ? `atrim=end_sample=${targetSamples}`
    : `atempo=${conformance.tempoRatio.toFixed(9)},apad,atrim=end_sample=${targetSamples}`
  await writeFile(sourcePath, input.audio.buffer)
  const execution = resolveFfmpegBinary('ffmpeg')
  await execFileAsync(execution.command, [
    '-y', '-v', 'error', '-i', sourcePath, '-vn', '-af', filter,
    '-ar', String(BGM_DESIGN_SAMPLE_RATE), '-c:a', 'pcm_s24le', outputPath,
  ], buildFfmpegExecFileOptions(execution))
  return {
    audio: { buffer: await readFile(outputPath), mimeType: 'audio/wav' },
    conformance,
  }
}
