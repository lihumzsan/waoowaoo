import type { FfmpegCommandRunner } from './ffmpeg-command'
import type { VideoMergeAudioMode } from '@/lib/workspace-resource/video-merge-contract'

export type VideoMergeAudioCommandRunner = FfmpegCommandRunner

export type AudioLoudnessTarget = {
  readonly integratedLufs: number
  readonly truePeakDb: number
  readonly loudnessRange: number
}

export type AudioLoudnessMeasurement = {
  readonly inputIntegrated: number
  readonly inputTruePeak: number
  readonly inputLra: number
  readonly inputThreshold: number
  readonly targetOffset: number
}

export const MAIN_AUDIO_TARGET: AudioLoudnessTarget = {
  integratedLufs: -16,
  truePeakDb: -1.5,
  loudnessRange: 11,
}

export const BGM_AUDIO_TARGET: AudioLoudnessTarget = {
  integratedLufs: -6,
  truePeakDb: -1.5,
  loudnessRange: 11,
}

const BGM_DUCKING_THRESHOLD = 0.08
const BGM_DUCKING_RATIO = 3
const BGM_DUCKING_ATTACK_MS = 80
const BGM_DUCKING_RELEASE_MS = 450

async function hasAudioStream(runCommand: VideoMergeAudioCommandRunner, filePath: string): Promise<boolean> {
  const result = await runCommand('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=index',
    '-of',
    'csv=p=0',
    filePath,
  ])
  return result.stdout.trim().length > 0
}

function parseLoudnormNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseLoudnormMeasurement(stderr: string): AudioLoudnessMeasurement {
  let waitingForMeasurement = false
  let measurementLines: string[] | null = null
  for (const line of stderr.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('[Parsed_loudnorm_') && trimmed.endsWith(']')) {
      waitingForMeasurement = true
      measurementLines = null
      continue
    }
    if (waitingForMeasurement) {
      if (!trimmed) continue
      waitingForMeasurement = false
      if (trimmed === '{') measurementLines = [line]
      continue
    }
    if (!measurementLines) continue
    measurementLines.push(line)
    if (trimmed !== '}') continue

    let parsed: unknown
    try {
      parsed = JSON.parse(measurementLines.join('\n')) as unknown
    } catch {
      measurementLines = null
      continue
    }
    measurementLines = null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
    const record = parsed as Record<string, unknown>
    const inputIntegrated = parseLoudnormNumber(record.input_i)
    const inputTruePeak = parseLoudnormNumber(record.input_tp)
    const inputLra = parseLoudnormNumber(record.input_lra)
    const inputThreshold = parseLoudnormNumber(record.input_thresh)
    const targetOffset = parseLoudnormNumber(record.target_offset)
    if (
      inputIntegrated === null ||
      inputTruePeak === null ||
      inputLra === null ||
      inputThreshold === null ||
      targetOffset === null
    ) continue
    return {
      inputIntegrated,
      inputTruePeak,
      inputLra,
      inputThreshold,
      targetOffset,
    }
  }
  throw new Error('VIDEO_MERGE_LOUDNESS_ANALYSIS_FAILED')
}

function formatFilterNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error('VIDEO_MERGE_AUDIO_FILTER_NUMBER_INVALID')
  return value.toFixed(3)
}

function exactAudioDurationFilter(durationSeconds: number): string {
  const duration = formatFilterNumber(durationSeconds)
  return `apad=whole_dur=${duration},atrim=0:${duration},asetpts=PTS-STARTPTS`
}

function loudnormAnalyzeFilter(target: AudioLoudnessTarget): string {
  return [
    `I=${formatFilterNumber(target.integratedLufs)}`,
    `TP=${formatFilterNumber(target.truePeakDb)}`,
    `LRA=${formatFilterNumber(target.loudnessRange)}`,
    'print_format=json',
  ].join(':')
}

function loudnormNormalizeFilter(target: AudioLoudnessTarget): string {
  return loudnormAnalyzeFilter(target).replace(':print_format=json', '')
}

function loudnormApplyFilter(target: AudioLoudnessTarget, measurement: AudioLoudnessMeasurement): string {
  return [
    `I=${formatFilterNumber(target.integratedLufs)}`,
    `TP=${formatFilterNumber(target.truePeakDb)}`,
    `LRA=${formatFilterNumber(target.loudnessRange)}`,
    `measured_I=${formatFilterNumber(measurement.inputIntegrated)}`,
    `measured_TP=${formatFilterNumber(measurement.inputTruePeak)}`,
    `measured_LRA=${formatFilterNumber(measurement.inputLra)}`,
    `measured_thresh=${formatFilterNumber(measurement.inputThreshold)}`,
    `offset=${formatFilterNumber(measurement.targetOffset)}`,
    'linear=true',
    'print_format=summary',
  ].join(':')
}

async function analyzeAudioLoudness(
  runCommand: VideoMergeAudioCommandRunner,
  inputPath: string,
  target: AudioLoudnessTarget,
): Promise<AudioLoudnessMeasurement> {
  const result = await runCommand('ffmpeg', [
    '-hide_banner',
    '-nostats',
    '-i',
    inputPath,
    '-af',
    `loudnorm=${loudnormAnalyzeFilter(target)}`,
    '-f',
    'null',
    '-',
  ])
  return parseLoudnormMeasurement(result.stderr)
}

export async function renderVideoMergeClipAudio(input: {
  readonly runCommand: VideoMergeAudioCommandRunner
  readonly sourcePath: string
  readonly outputPath: string
  readonly durationSeconds: number
}): Promise<boolean> {
  const hasAudio = await hasAudioStream(input.runCommand, input.sourcePath)
  if (!hasAudio) {
    await input.runCommand('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-t',
      input.durationSeconds.toFixed(3),
      '-i',
      'anullsrc=r=48000:cl=stereo',
      '-c:a',
      'pcm_s16le',
      '-ar',
      '48000',
      '-ac',
      '2',
      input.outputPath,
    ])
    return false
  }

  await input.runCommand('ffmpeg', [
    '-y',
    '-i',
    input.sourcePath,
    '-t',
    input.durationSeconds.toFixed(3),
    '-vn',
    '-af',
    `aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,loudnorm=${loudnormNormalizeFilter(MAIN_AUDIO_TARGET)},${exactAudioDurationFilter(input.durationSeconds)}`,
    '-c:a',
    'pcm_s16le',
    '-ar',
    '48000',
    '-ac',
    '2',
    input.outputPath,
  ])
  return true
}

export async function concatVideoMergeAudioClips(input: {
  readonly runCommand: VideoMergeAudioCommandRunner
  readonly clipAudioPaths: readonly string[]
  readonly outputPath: string
  readonly durationSeconds: number
}): Promise<void> {
  if (input.clipAudioPaths.length === 0) throw new Error('VIDEO_MERGE_NO_AUDIO_CLIPS')
  const audioInputs = input.clipAudioPaths.flatMap((clipPath) => ['-i', clipPath])
  const filterInputs = input.clipAudioPaths.map((_, index) => `[${index}:a]`).join('')
  await input.runCommand('ffmpeg', [
    '-y',
    ...audioInputs,
    '-filter_complex',
    `${filterInputs}concat=n=${input.clipAudioPaths.length}:v=0:a=1,${exactAudioDurationFilter(input.durationSeconds)}[aout]`,
    '-map',
    '[aout]',
    '-c:a',
    'pcm_s16le',
    '-ar',
    '48000',
    '-ac',
    '2',
    input.outputPath,
  ])
}

export type VideoMergeMusicCueInput = {
  readonly musicPath: string
  readonly startMs: number
  readonly durationMs: number
  readonly fadeInMs: number
  readonly fadeOutMs: number
  readonly gainDb: number
}

function musicCueFilter(input: {
  readonly inputIndex: number
  readonly cueIndex: number
  readonly cue: VideoMergeMusicCueInput
  readonly measurement: AudioLoudnessMeasurement
}): string {
  const durationSeconds = input.cue.durationMs / 1000
  const filters = [
    `atrim=0:${formatFilterNumber(durationSeconds)}`,
    'asetpts=PTS-STARTPTS',
    'aresample=48000',
    'aformat=sample_fmts=fltp:channel_layouts=stereo',
    `loudnorm=${loudnormApplyFilter(BGM_AUDIO_TARGET, input.measurement)}`,
  ]
  if (input.cue.fadeInMs > 0) {
    filters.push(`afade=t=in:st=0:d=${formatFilterNumber(input.cue.fadeInMs / 1000)}`)
  }
  if (input.cue.fadeOutMs > 0) {
    filters.push(
      `afade=t=out:st=${formatFilterNumber((input.cue.durationMs - input.cue.fadeOutMs) / 1000)}`
      + `:d=${formatFilterNumber(input.cue.fadeOutMs / 1000)}`,
    )
  }
  filters.push(
    `volume=${formatFilterNumber(input.cue.gainDb)}dB`,
    exactAudioDurationFilter(durationSeconds),
    `adelay=delays=${String(input.cue.startMs)}:all=1`,
  )
  return `[${String(input.inputIndex)}:a]${filters.join(',')}[music_cue_${String(input.cueIndex)}]`
}

/**
 * Place independently generated score cues on one exact timeline. Cue gaps are
 * digital silence, overlaps mix deterministically, and source-audio ducking is
 * applied once to the completed BGM bus.
 */
export async function muxVideoMergeMusicCues(input: {
  readonly runCommand: VideoMergeAudioCommandRunner
  readonly stitchedPath: string
  readonly mainAudioPath: string
  readonly hasSourceAudio: boolean
  readonly musicCues: readonly VideoMergeMusicCueInput[]
  readonly outputPath: string
  readonly durationSeconds: number
}): Promise<{
  readonly hasSourceAudio: boolean
  readonly mainAudio?: AudioLoudnessMeasurement
  readonly bgm: readonly AudioLoudnessMeasurement[]
}> {
  if (input.musicCues.length === 0) throw new Error('VIDEO_MERGE_MUSIC_CUES_REQUIRED')
  const exactDurationFilter = exactAudioDurationFilter(input.durationSeconds)
  const bgmMeasurements = await Promise.all(input.musicCues.map(async (cue) => (
    await analyzeAudioLoudness(input.runCommand, cue.musicPath, BGM_AUDIO_TARGET)
  )))
  const mediaInputs = input.musicCues.flatMap((cue) => ['-i', cue.musicPath])
  const cueFilters = input.musicCues.map((cue, cueIndex) => musicCueFilter({
    inputIndex: cueIndex + 2,
    cueIndex,
    cue,
    measurement: bgmMeasurements[cueIndex]
      ?? (() => { throw new Error(`VIDEO_MERGE_MUSIC_CUE_MEASUREMENT_MISSING:${String(cueIndex)}`) })(),
  }))
  const cueLabels = input.musicCues.map((_, cueIndex) => `[music_cue_${String(cueIndex)}]`).join('')
  const silenceFilter = `anullsrc=r=48000:cl=stereo:d=${formatFilterNumber(input.durationSeconds)}[music_silence]`
  const bgmBusFilter = `[music_silence]${cueLabels}amix=inputs=${String(input.musicCues.length + 1)}:duration=first:dropout_transition=0:normalize=0,${exactDurationFilter}[bgm_bus]`

  if (!input.hasSourceAudio) {
    await input.runCommand('ffmpeg', [
      '-y',
      '-i', input.stitchedPath,
      '-i', input.mainAudioPath,
      ...mediaInputs,
      '-filter_complex',
      [...cueFilters, silenceFilter, bgmBusFilter, '[bgm_bus]alimiter=limit=0.95[aout]'].join(';'),
      '-map', '0:v:0',
      '-map', '[aout]',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      '-t', input.durationSeconds.toFixed(3),
      input.outputPath,
    ])
    return { hasSourceAudio: false, bgm: bgmMeasurements }
  }

  const mainMeasurement = await analyzeAudioLoudness(
    input.runCommand,
    input.mainAudioPath,
    MAIN_AUDIO_TARGET,
  )
  await input.runCommand('ffmpeg', [
    '-y',
    '-i', input.stitchedPath,
    '-i', input.mainAudioPath,
    ...mediaInputs,
    '-filter_complex',
    [
      ...cueFilters,
      silenceFilter,
      bgmBusFilter,
      `[1:a]loudnorm=${loudnormApplyFilter(MAIN_AUDIO_TARGET, mainMeasurement)},${exactDurationFilter}[main_norm]`,
      '[main_norm]asplit=2[main_mix][main_sidechain]',
      `[bgm_bus][main_sidechain]sidechaincompress=threshold=${BGM_DUCKING_THRESHOLD}:ratio=${BGM_DUCKING_RATIO}:attack=${BGM_DUCKING_ATTACK_MS}:release=${BGM_DUCKING_RELEASE_MS}[ducked_bgm]`,
      '[main_mix][ducked_bgm]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[aout]',
    ].join(';'),
    '-map', '0:v:0',
    '-map', '[aout]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    '-t', input.durationSeconds.toFixed(3),
    input.outputPath,
  ])
  return {
    hasSourceAudio: true,
    mainAudio: mainMeasurement,
    bgm: bgmMeasurements,
  }
}

export async function muxVideoMergeSourceAudio(input: {
  readonly runCommand: VideoMergeAudioCommandRunner
  readonly stitchedPath: string
  readonly mainAudioPath: string
  readonly hasSourceAudio: boolean
  readonly outputPath: string
  readonly durationSeconds: number
}): Promise<{ readonly hasSourceAudio: boolean; readonly mainAudio?: AudioLoudnessMeasurement }> {
  const exactDurationFilter = exactAudioDurationFilter(input.durationSeconds)
  if (!input.hasSourceAudio) {
    await input.runCommand('ffmpeg', [
      '-y',
      '-i',
      input.stitchedPath,
      '-i',
      input.mainAudioPath,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-af',
      exactDurationFilter,
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      '-t',
      input.durationSeconds.toFixed(3),
      input.outputPath,
    ])
    return { hasSourceAudio: false }
  }

  const mainMeasurement = await analyzeAudioLoudness(input.runCommand, input.mainAudioPath, MAIN_AUDIO_TARGET)
  await input.runCommand('ffmpeg', [
    '-y',
    '-i',
    input.stitchedPath,
    '-i',
    input.mainAudioPath,
    '-filter_complex',
    `[1:a]loudnorm=${loudnormApplyFilter(MAIN_AUDIO_TARGET, mainMeasurement)},${exactDurationFilter}[aout]`,
    '-map',
    '0:v:0',
    '-map',
    '[aout]',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    '-t',
    input.durationSeconds.toFixed(3),
    input.outputPath,
  ])
  return {
    hasSourceAudio: true,
    mainAudio: mainMeasurement,
  }
}

async function muxVideoMergeReplacementAudio(input: {
  readonly runCommand: VideoMergeAudioCommandRunner
  readonly stitchedPath: string
  readonly assemblyAudioPath: string
  readonly outputPath: string
  readonly durationSeconds: number
}): Promise<void> {
  const measurement = await analyzeAudioLoudness(input.runCommand, input.assemblyAudioPath, MAIN_AUDIO_TARGET)
  await input.runCommand('ffmpeg', [
    '-y', '-i', input.stitchedPath, '-i', input.assemblyAudioPath,
    '-filter_complex',
    `[1:a]loudnorm=${loudnormApplyFilter(MAIN_AUDIO_TARGET, measurement)},${exactAudioDurationFilter(input.durationSeconds)},alimiter=limit=0.95[aout]`,
    '-map', '0:v:0', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
    '-t', input.durationSeconds.toFixed(3), input.outputPath,
  ])
}

async function muxVideoMergeWithoutAudio(input: {
  readonly runCommand: VideoMergeAudioCommandRunner
  readonly stitchedPath: string
  readonly outputPath: string
  readonly durationSeconds: number
}): Promise<void> {
  await input.runCommand('ffmpeg', [
    '-y', '-i', input.stitchedPath, '-map', '0:v:0', '-c:v', 'copy', '-an', '-movflags', '+faststart',
    '-t', input.durationSeconds.toFixed(3), input.outputPath,
  ])
}

async function muxVideoMergeBackgroundMusic(input: {
  readonly runCommand: VideoMergeAudioCommandRunner
  readonly stitchedPath: string
  readonly mainAudioPath: string
  readonly hasSourceAudio: boolean
  readonly musicPath: string
  readonly outputPath: string
  readonly durationSeconds: number
}): Promise<void> {
  const fadeDuration = Math.min(2, Math.max(0.4, input.durationSeconds / 8))
  const fadeOutStart = Math.max(0, input.durationSeconds - fadeDuration)
  const exactDurationFilter = exactAudioDurationFilter(input.durationSeconds)
  const bgmMeasurement = await analyzeAudioLoudness(input.runCommand, input.musicPath, BGM_AUDIO_TARGET)
  const bgmFilter = [
    `atrim=0:${input.durationSeconds.toFixed(3)}`,
    'asetpts=PTS-STARTPTS',
    `afade=t=in:st=0:d=${fadeDuration.toFixed(3)}`,
    `afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeDuration.toFixed(3)}`,
    `loudnorm=${loudnormApplyFilter(BGM_AUDIO_TARGET, bgmMeasurement)}`,
    exactDurationFilter,
  ].join(',')

  if (!input.hasSourceAudio) {
    await input.runCommand('ffmpeg', [
      '-y', '-i', input.stitchedPath, '-i', input.musicPath,
      '-filter_complex', `[1:a]${bgmFilter},alimiter=limit=0.95[aout]`,
      '-map', '0:v:0', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart', '-t', input.durationSeconds.toFixed(3), input.outputPath,
    ])
    return
  }

  const mainMeasurement = await analyzeAudioLoudness(input.runCommand, input.mainAudioPath, MAIN_AUDIO_TARGET)
  await input.runCommand('ffmpeg', [
    '-y', '-i', input.stitchedPath, '-i', input.mainAudioPath, '-i', input.musicPath,
    '-filter_complex', [
      `[1:a]loudnorm=${loudnormApplyFilter(MAIN_AUDIO_TARGET, mainMeasurement)},${exactDurationFilter}[main_norm]`,
      `[2:a]${bgmFilter}[bgm_norm]`,
      '[main_norm]asplit=2[main_mix][main_sidechain]',
      `[bgm_norm][main_sidechain]sidechaincompress=threshold=${BGM_DUCKING_THRESHOLD}:ratio=${BGM_DUCKING_RATIO}:attack=${BGM_DUCKING_ATTACK_MS}:release=${BGM_DUCKING_RELEASE_MS}[ducked_bgm]`,
      '[main_mix][ducked_bgm]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[aout]',
    ].join(';'),
    '-map', '0:v:0', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart', '-t', input.durationSeconds.toFixed(3), input.outputPath,
  ])
}

export async function muxVideoMergeFinalAudio(input: {
  readonly runCommand: VideoMergeAudioCommandRunner
  readonly audioMode: VideoMergeAudioMode
  readonly stitchedPath: string
  readonly mainAudioPath: string | null
  readonly hasSourceAudio: boolean
  readonly assemblyAudioPath: string | null
  readonly outputPath: string
  readonly durationSeconds: number
}): Promise<void> {
  switch (input.audioMode) {
    case 'mute':
      await muxVideoMergeWithoutAudio(input)
      return
    case 'replace':
      if (!input.assemblyAudioPath) throw new Error('VIDEO_MERGE_REPLACEMENT_AUDIO_REQUIRED')
      await muxVideoMergeReplacementAudio({
        runCommand: input.runCommand,
        stitchedPath: input.stitchedPath,
        assemblyAudioPath: input.assemblyAudioPath,
        outputPath: input.outputPath,
        durationSeconds: input.durationSeconds,
      })
      return
    case 'mix':
      if (!input.mainAudioPath || !input.assemblyAudioPath) throw new Error('VIDEO_MERGE_BACKGROUND_MUSIC_INPUT_REQUIRED')
      await muxVideoMergeBackgroundMusic({
        runCommand: input.runCommand,
        stitchedPath: input.stitchedPath,
        mainAudioPath: input.mainAudioPath,
        hasSourceAudio: input.hasSourceAudio,
        musicPath: input.assemblyAudioPath,
        outputPath: input.outputPath,
        durationSeconds: input.durationSeconds,
      })
      return
    case 'preserve':
      if (!input.hasSourceAudio) {
        await muxVideoMergeWithoutAudio(input)
        return
      }
      if (!input.mainAudioPath) throw new Error('VIDEO_MERGE_SOURCE_AUDIO_REQUIRED')
      await muxVideoMergeSourceAudio({
        runCommand: input.runCommand,
        stitchedPath: input.stitchedPath,
        mainAudioPath: input.mainAudioPath,
        hasSourceAudio: input.hasSourceAudio,
        outputPath: input.outputPath,
        durationSeconds: input.durationSeconds,
      })
      return
    default: {
      const unsupportedMode: never = input.audioMode
      throw new Error(`VIDEO_MERGE_AUDIO_MODE_UNSUPPORTED:${String(unsupportedMode)}`)
    }
  }
}

export async function renderVideoMergeAutomatedAudio(input: {
  readonly runCommand: VideoMergeAudioCommandRunner
  readonly inputPath: string
  readonly outputPath: string
  readonly durationSeconds: number
  readonly volumeFilter: string
}): Promise<void> {
  await input.runCommand('ffmpeg', [
    '-y', '-i', input.inputPath, '-vn', '-af',
    `aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,${input.volumeFilter},${exactAudioDurationFilter(input.durationSeconds)}`,
    '-c:a', 'pcm_s24le', '-ar', '48000', '-ac', '2', '-t', input.durationSeconds.toFixed(3), input.outputPath,
  ])
}

export async function applyVideoMergeMasterAutomation(input: {
  readonly runCommand: VideoMergeAudioCommandRunner
  readonly inputPath: string
  readonly outputPath: string
  readonly durationSeconds: number
  readonly volumeFilter: string
}): Promise<void> {
  await input.runCommand('ffmpeg', [
    '-y', '-i', input.inputPath, '-filter_complex',
    `[0:a]${input.volumeFilter},${exactAudioDurationFilter(input.durationSeconds)},alimiter=limit=0.95[aout]`,
    '-map', '0:v:0', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
    '-t', input.durationSeconds.toFixed(3), input.outputPath,
  ])
}
