import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { access, mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { spawnSync } from 'node:child_process'
import { ffmpegPath, ffprobePath } from 'ffmpeg-ffprobe-static'
import { ensureSoundfont, resolveFluidSynth } from './sample-renderer'

const SAMPLE_RATE = 48_000
const TARGET_LUFS = -22
const TARGET_LRA = 30
const TARGET_TRUE_PEAK = -1.2

const MIDI_URL = 'https://www.mutopiaproject.org/ftp/ChopinFF/O28/Chop-28-4a/Chop-28-4a.mid'
const MIDI_SHA256 = 'b19f8e0d783915e80e33cc4f622ef9623994ab89f114a53983c3f628265b798b'
const SALAMANDER_URL = 'https://freepats.zenvoid.org/Piano/SalamanderGrandPiano/SalamanderGrandPianoV3%2B20161209_44khz16bit.tar.xz'
const SALAMANDER_SHA256 = '58750eb1366761e187f71ddb9b932355ea894d28ec4331e74ab8acb44c819936'
const SALAMANDER_DIRECTORY = 'SalamanderGrandPianoV3_44.1khz16bit'
const MAESTRO_URL = 'https://storage.googleapis.com/magentadata/datasets/maestro/v3.0.0/maestro-v3.0.0-midi.zip'
const MAESTRO_SHA256 = '70470ee253295c8d2c71e6d9d4a815189e35c89624b76d22fce5a019d5dde12c'
const MAESTRO_ENTRY = 'maestro-v3.0.0/2009/'
  + 'MIDI-Unprocessed_02_R1_2009_03-06_ORIG_MID--AUDIO_02_R1_2009_02_R1_2009_05_WAV.midi'

interface LoudnessMeasurement {
  readonly input_i: string
  readonly input_lra: string
  readonly input_tp: string
  readonly input_thresh: string
  readonly target_offset: string
}

interface RenderVariant {
  readonly name: string
  readonly rawPath: string
  readonly wavPath: string
  readonly mp3Path: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, key: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`LOUDNESS_FIELD_INVALID:${key}`)
  return value
}

function run(command: string, args: readonly string[], errorCode: string): string {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
  if (result.error) throw new Error(`${errorCode}:${result.error.message}`)
  if (result.status !== 0) throw new Error(`${errorCode}:${result.stderr.trim() || result.stdout.trim()}`)
  return `${result.stdout}\n${result.stderr}`
}

function commandWorks(command: string, args: readonly string[]): boolean {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  return !result.error && result.status === 0
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch (error: unknown) {
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : ''
    if (code === 'ENOENT') return false
    throw error
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

async function ensurePinnedDownload(input: {
  readonly url: string
  readonly expectedSha256: string
  readonly destination: string
  readonly errorPrefix: string
}): Promise<void> {
  if (await fileExists(input.destination)) {
    const currentHash = await sha256File(input.destination)
    if (currentHash !== input.expectedSha256) throw new Error(`${input.errorPrefix}_EXISTING_HASH_MISMATCH`)
    return
  }

  const partialPath = `${input.destination}.part`
  await rm(partialPath, { force: true })
  const response = await fetch(input.url)
  if (!response.ok || !response.body) throw new Error(`${input.errorPrefix}_DOWNLOAD_FAILED:${response.status}`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partialPath, { flags: 'wx' }))
  const downloadedHash = await sha256File(partialPath)
  if (downloadedHash !== input.expectedSha256) {
    await rm(partialPath, { force: true })
    throw new Error(`${input.errorPrefix}_DOWNLOADED_HASH_MISMATCH`)
  }
  await rename(partialPath, input.destination)
}

function resolveSfizzRender(defaultBuildPath: string): string {
  const configured = process.env.SFIZZ_RENDER_PATH?.trim()
  const candidates = configured ? [configured] : [defaultBuildPath, 'sfizz_render']
  for (const candidate of candidates) {
    if (commandWorks(candidate, ['--help'])) return candidate
  }
  throw new Error(
    'SFIZZ_RENDER_REQUIRED: build sfizz_render as documented in scripts/music-score-demo/README.md '
      + 'or set SFIZZ_RENDER_PATH',
  )
}

function parseLoudnessMeasurement(output: string): LoudnessMeasurement {
  const start = output.lastIndexOf('{')
  const end = output.indexOf('}', start)
  if (start < 0 || end < 0) throw new Error('LOUDNESS_ANALYSIS_JSON_MISSING')
  const parsed: unknown = JSON.parse(output.slice(start, end + 1))
  if (!isRecord(parsed)) throw new Error('LOUDNESS_ANALYSIS_INVALID')
  return {
    input_i: requiredString(parsed.input_i, 'input_i'),
    input_lra: requiredString(parsed.input_lra, 'input_lra'),
    input_tp: requiredString(parsed.input_tp, 'input_tp'),
    input_thresh: requiredString(parsed.input_thresh, 'input_thresh'),
    target_offset: requiredString(parsed.target_offset, 'target_offset'),
  }
}

function probeDuration(filePath: string): number {
  if (!ffprobePath) throw new Error('BUNDLED_FFPROBE_PATH_MISSING')
  const output = run(ffprobePath, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
  ], 'BENCHMARK_DURATION_PROBE_FAILED')
  const duration = Number(output.trim())
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('BENCHMARK_DURATION_INVALID')
  return duration
}

function masterVariant(variant: RenderVariant, durationSeconds: number): LoudnessMeasurement {
  if (!ffmpegPath) throw new Error('BUNDLED_FFMPEG_PATH_MISSING')
  const fadeDuration = Math.min(1.5, durationSeconds)
  const fadeStart = Math.max(0, durationSeconds - fadeDuration)
  const preparation = `atrim=duration=${durationSeconds.toFixed(6)},asetpts=PTS-STARTPTS,`
    + `afade=t=out:st=${fadeStart.toFixed(6)}:d=${fadeDuration.toFixed(6)},`
    + 'highpass=f=25,lowpass=f=19000'
  const firstPass = run(ffmpegPath, [
    '-nostdin', '-hide_banner', '-nostats', '-i', variant.rawPath,
    '-af', `${preparation},loudnorm=I=${TARGET_LUFS}:LRA=${TARGET_LRA}:TP=${TARGET_TRUE_PEAK}:print_format=json`,
    '-f', 'null', '-',
  ], `BENCHMARK_LOUDNESS_ANALYSIS_FAILED:${variant.name}`)
  const measurement = parseLoudnessMeasurement(firstPass)
  const secondPass = `${preparation},loudnorm=I=${TARGET_LUFS}:LRA=${TARGET_LRA}:TP=${TARGET_TRUE_PEAK}:`
    + `measured_I=${measurement.input_i}:measured_LRA=${measurement.input_lra}:`
    + `measured_TP=${measurement.input_tp}:measured_thresh=${measurement.input_thresh}:`
    + `offset=${measurement.target_offset}:linear=true:print_format=summary`
  run(ffmpegPath, [
    '-nostdin', '-y', '-hide_banner', '-loglevel', 'error', '-i', variant.rawPath,
    '-af', secondPass, '-ar', String(SAMPLE_RATE), '-ac', '2', '-c:a', 'pcm_s24le', variant.wavPath,
  ], `BENCHMARK_MASTER_FAILED:${variant.name}`)
  run(ffmpegPath, [
    '-nostdin', '-y', '-hide_banner', '-loglevel', 'error', '-i', variant.wavPath,
    '-codec:a', 'libmp3lame', '-b:a', '256k', variant.mp3Path,
  ], `BENCHMARK_MP3_FAILED:${variant.name}`)
  return measurement
}

async function ensureMaestroPerformance(assetsDir: string): Promise<string> {
  const maestroDir = path.join(assetsDir, 'maestro')
  await mkdir(maestroDir, { recursive: true })
  const archivePath = path.join(maestroDir, 'maestro-v3.0.0-midi.zip')
  await ensurePinnedDownload({
    url: MAESTRO_URL,
    expectedSha256: MAESTRO_SHA256,
    destination: archivePath,
    errorPrefix: 'BENCHMARK_MAESTRO',
  })
  const destination = path.join(maestroDir, 'Scriabin-Op8-No13-human-performance.mid')
  if (await fileExists(destination)) return destination
  run('unzip', ['-j', archivePath, MAESTRO_ENTRY, '-d', maestroDir], 'BENCHMARK_MAESTRO_EXTRACT_FAILED')
  const extracted = path.join(maestroDir, path.basename(MAESTRO_ENTRY))
  if (!(await fileExists(extracted))) throw new Error('BENCHMARK_MAESTRO_MIDI_MISSING')
  await rename(extracted, destination)
  return destination
}

async function main(): Promise<void> {
  const supportedArguments = new Set(['--include-maestro-noncommercial'])
  const unknownArgument = process.argv.slice(2).find((argument) => !supportedArguments.has(argument))
  if (unknownArgument) throw new Error(`BENCHMARK_ARGUMENT_INVALID:${unknownArgument}`)
  const includeMaestro = process.argv.includes('--include-maestro-noncommercial')
  const repositoryRoot = process.cwd()
  const assetsDir = path.join(repositoryRoot, 'tmp/music-benchmark-assets')
  const outputDir = path.join(repositoryRoot, 'tmp/music-benchmark-output')
  await Promise.all([mkdir(assetsDir, { recursive: true }), mkdir(outputDir, { recursive: true })])

  const midiPath = path.join(assetsDir, 'Chopin-Op28-No4.mid')
  const salamanderArchivePath = path.join(assetsDir, 'SalamanderGrandPianoV3-44khz16bit.tar.xz')
  await ensurePinnedDownload({
    url: MIDI_URL,
    expectedSha256: MIDI_SHA256,
    destination: midiPath,
    errorPrefix: 'BENCHMARK_MIDI',
  })
  await ensurePinnedDownload({
    url: SALAMANDER_URL,
    expectedSha256: SALAMANDER_SHA256,
    destination: salamanderArchivePath,
    errorPrefix: 'BENCHMARK_SALAMANDER',
  })

  const salamanderDir = path.join(assetsDir, SALAMANDER_DIRECTORY)
  const salamanderSfzPath = path.join(salamanderDir, 'SalamanderGrandPianoV3.sfz')
  if (!(await fileExists(salamanderSfzPath))) {
    run('tar', ['-xJf', salamanderArchivePath, '-C', assetsDir], 'BENCHMARK_SALAMANDER_EXTRACT_FAILED')
  }
  if (!(await fileExists(salamanderSfzPath))) throw new Error('BENCHMARK_SALAMANDER_SFZ_MISSING')

  const fluidSynth = resolveFluidSynth()
  const soundfontPath = await ensureSoundfont(path.join(repositoryRoot, 'tmp/music-score-demo-assets'))
  const sfizzRender = resolveSfizzRender(path.join(assetsDir, 'sfizz-pinned-build/library/bin/sfizz_render'))
  const gmVariant: RenderVariant = {
    name: 'musescore-gm',
    rawPath: path.join(outputDir, 'chopin-op28-no4-gm-raw.wav'),
    wavPath: path.join(outputDir, '06a-chopin-op28-no4-musescore-gm.wav'),
    mp3Path: path.join(outputDir, '06a-chopin-op28-no4-musescore-gm.mp3'),
  }
  const sfzVariant: RenderVariant = {
    name: 'salamander-sfz',
    rawPath: path.join(outputDir, 'chopin-op28-no4-salamander-raw.wav'),
    wavPath: path.join(outputDir, '06b-chopin-op28-no4-salamander-sfz.wav'),
    mp3Path: path.join(outputDir, '06b-chopin-op28-no4-salamander-sfz.mp3'),
  }

  run(fluidSynth, [
    '-ni', '-q', '-R', '0', '-C', '0', '-r', String(SAMPLE_RATE), '-g', '0.65',
    '-F', gmVariant.rawPath, '-T', 'wav', '-O', 's16',
    soundfontPath, midiPath,
  ], 'BENCHMARK_FLUIDSYNTH_RENDER_FAILED')
  run(sfizzRender, [
    '--wav', sfzVariant.rawPath, '--sfz', salamanderSfzPath, '--midi', midiPath,
    '--samplerate', String(SAMPLE_RATE), '--use-eot',
  ], 'BENCHMARK_SFIZZ_RENDER_FAILED')

  const comparisonDuration = probeDuration(sfzVariant.rawPath)
  const gmMeasurement = masterVariant(gmVariant, comparisonDuration)
  const sfzMeasurement = masterVariant(sfzVariant, comparisonDuration)
  const outputLines = [
    `Source MIDI: ${midiPath}`,
    `A · MuseScore General / FluidSynth: ${gmVariant.mp3Path}`,
    `B · Salamander Grand Piano / sfizz: ${sfzVariant.mp3Path}`,
    `Common duration: ${comparisonDuration.toFixed(3)}s; linear normalization target: ${TARGET_LUFS} LUFS`,
    `Raw dynamics (LRA): A ${gmMeasurement.input_lra} LU / B ${sfzMeasurement.input_lra} LU`,
  ]
  if (includeMaestro) {
    const maestroMidiPath = await ensureMaestroPerformance(assetsDir)
    const humanVariant: RenderVariant = {
      name: 'maestro-human-performance',
      rawPath: path.join(outputDir, 'scriabin-op8-no13-maestro-salamander-raw.wav'),
      wavPath: path.join(outputDir, '06c-scriabin-op8-no13-maestro-salamander.wav'),
      mp3Path: path.join(outputDir, '06c-scriabin-op8-no13-maestro-salamander.mp3'),
    }
    run(sfizzRender, [
      '--wav', humanVariant.rawPath, '--sfz', salamanderSfzPath, '--midi', maestroMidiPath,
      '--samplerate', String(SAMPLE_RATE), '--use-eot',
    ], 'BENCHMARK_MAESTRO_SFIZZ_RENDER_FAILED')
    const humanDuration = probeDuration(humanVariant.rawPath)
    const humanMeasurement = masterVariant(humanVariant, humanDuration)
    outputLines.push(
      `C · MAESTRO human performance / Salamander / sfizz: ${humanVariant.mp3Path}`,
      `C duration: ${humanDuration.toFixed(3)}s; raw dynamics (LRA): ${humanMeasurement.input_lra} LU`,
      'C license boundary: MAESTRO v3 is CC BY-NC-SA 4.0; benchmark only, not a product asset.',
    )
  }
  process.stdout.write(`${outputLines.join('\n')}\n`)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
