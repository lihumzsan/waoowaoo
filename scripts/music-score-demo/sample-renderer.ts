import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { ffmpegPath } from 'ffmpeg-ffprobe-static'
import { scoreToMidi } from './midi'
import type { CompiledScore, InstrumentId } from './types'

const SAMPLE_RATE = 48_000
const SOUNDFONT_URL = 'https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf3'
const SOUNDFONT_LICENSE_URL = 'https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General_License.md'
const SOUNDFONT_SHA256 = '5b85b6c2c61d10b2b91cddd41efcce7b25cd31c8271d511c73afafbef20b6fa3'

const stemFilters: Readonly<Record<InstrumentId, string>> = {
  felt_piano: 'highpass=f=45,lowpass=f=15000,volume=0.82',
  warm_pad: 'highpass=f=90,lowpass=f=13000,volume=0.62',
  soft_bass: 'highpass=f=28,lowpass=f=5000,volume=0.7',
  cello: 'highpass=f=48,lowpass=f=10500,volume=0.72',
  glass_mallet: 'highpass=f=120,lowpass=f=16000,volume=0.58',
  soft_pulse: 'highpass=f=50,lowpass=f=9000,volume=0.55',
  concert_grand: 'highpass=f=42,lowpass=f=15500,equalizer=f=280:t=q:w=1:g=-1.8,volume=0.82',
  string_ensemble: 'highpass=f=85,lowpass=f=13500,equalizer=f=2400:t=q:w=1.2:g=-1.5,volume=0.7',
  solo_cello: 'highpass=f=42,lowpass=f=9500,equalizer=f=180:t=q:w=1:g=1.2,volume=0.72',
  clarinet: 'highpass=f=110,lowpass=f=11500,equalizer=f=1800:t=q:w=1.1:g=-1,volume=0.68',
  french_horn: 'highpass=f=70,lowpass=f=10000,equalizer=f=650:t=q:w=1:g=1.2,volume=0.64',
  harp: 'highpass=f=100,lowpass=f=16000,equalizer=f=3500:t=q:w=1:g=1.2,volume=0.58',
  choir_aahs: 'highpass=f=130,lowpass=f=12000,equalizer=f=2200:t=q:w=1.2:g=-1.8,volume=0.48',
  timpani: 'highpass=f=30,lowpass=f=5000,equalizer=f=100:t=q:w=1:g=1.5,volume=0.62',
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`SAMPLED_RENDER_DOWNLOAD_FAILED:${response.status}:${url}`)
  return Buffer.from(await response.arrayBuffer())
}

async function ensureSoundfont(assetsDir: string): Promise<string> {
  await mkdir(assetsDir, { recursive: true })
  const soundfontPath = path.join(assetsDir, 'MuseScore_General.sf3')
  let current: Buffer | null = null
  try {
    current = await readFile(soundfontPath)
  } catch (error: unknown) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    if (code !== 'ENOENT') throw error
  }
  if (!current || sha256(current) !== SOUNDFONT_SHA256) {
    const downloaded = await download(SOUNDFONT_URL)
    if (sha256(downloaded) !== SOUNDFONT_SHA256) throw new Error('SAMPLED_RENDER_SOUNDFONT_HASH_MISMATCH')
    await writeFile(soundfontPath, downloaded)
  }
  const licensePath = path.join(assetsDir, 'MuseScore_General_License.md')
  try {
    await readFile(licensePath)
  } catch (error: unknown) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    if (code !== 'ENOENT') throw error
    await writeFile(licensePath, await download(SOUNDFONT_LICENSE_URL))
  }
  return soundfontPath
}

function run(command: string, args: readonly string[], errorCode: string): void {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error) throw new Error(`${errorCode}:${result.error.message}`)
  if (result.status !== 0) throw new Error(`${errorCode}:${result.stderr.trim() || result.stdout.trim()}`)
}

function resolveFluidSynth(): string {
  const command = process.env.FLUIDSYNTH_PATH?.trim() || 'fluidsynth'
  const probe = spawnSync(command, ['--version'], { encoding: 'utf8' })
  if (probe.error || probe.status !== 0) {
    throw new Error('FLUIDSYNTH_REQUIRED: install with `brew install fluid-synth` or set FLUIDSYNTH_PATH')
  }
  return command
}

function stemScore(score: CompiledScore, instrument: InstrumentId): CompiledScore {
  return { ...score, events: score.events.filter((event) => event.instrument === instrument) }
}

export async function renderSampledScore(input: {
  readonly score: CompiledScore
  readonly outputDir: string
  readonly assetsDir: string
  readonly outputName: string
}): Promise<{ readonly wavPath: string; readonly mp3Path: string; readonly midiPath: string }> {
  if (!ffmpegPath) throw new Error('BUNDLED_FFMPEG_PATH_MISSING')
  const fluidSynth = resolveFluidSynth()
  const soundfontPath = await ensureSoundfont(input.assetsDir)
  const workDir = path.join(input.outputDir, `${input.outputName}-stems`)
  await Promise.all([mkdir(input.outputDir, { recursive: true }), mkdir(workDir, { recursive: true })])
  const midiPath = path.join(input.outputDir, `${input.outputName}.mid`)
  await writeFile(midiPath, scoreToMidi(input.score))

  const instruments = [...new Set(input.score.events.map((event) => event.instrument))]
  const stemPaths: string[] = []
  for (const instrument of instruments) {
    const instrumentMidiPath = path.join(workDir, `${instrument}.mid`)
    const instrumentWavPath = path.join(workDir, `${instrument}.wav`)
    await writeFile(instrumentMidiPath, scoreToMidi(stemScore(input.score, instrument)))
    run(fluidSynth, [
      '-ni', '-q', '-R', '1', '-C', '1', '-r', String(SAMPLE_RATE),
      '-g', '0.65', '-F', instrumentWavPath, '-T', 'wav', '-O', 's16',
      soundfontPath, instrumentMidiPath,
    ], `FLUIDSYNTH_STEM_RENDER_FAILED:${instrument}`)
    stemPaths.push(instrumentWavPath)
  }

  const wavPath = path.join(input.outputDir, `${input.outputName}.wav`)
  const mp3Path = path.join(input.outputDir, `${input.outputName}.mp3`)
  const ffmpegInputs = stemPaths.flatMap((stemPath) => ['-i', stemPath])
  const filteredLabels = instruments.map((instrument, index) => {
    const label = `stem${index}`
    return `[${index}:a]atrim=duration=${input.score.durationSeconds},asetpts=PTS-STARTPTS,${stemFilters[instrument]}[${label}]`
  })
  const mixInputs = instruments.map((_, index) => `[stem${index}]`).join('')
  const filterComplex = [
    ...filteredLabels,
    `${mixInputs}amix=inputs=${instruments.length}:duration=longest:normalize=0,`
      + 'acompressor=threshold=0.16:ratio=2.2:attack=18:release=190:makeup=1.35,'
      + `afade=t=in:st=0:d=0.8,afade=t=out:st=${Math.max(0, input.score.durationSeconds - 2.7)}:d=2.7,`
      + 'loudnorm=I=-16:LRA=10:TP=-1.0,alimiter=limit=0.92[mix]',
  ].join(';')
  run(ffmpegPath, [
    '-nostdin', '-y', '-hide_banner', '-loglevel', 'error',
    ...ffmpegInputs,
    '-filter_complex', filterComplex,
    '-map', '[mix]', '-ar', String(SAMPLE_RATE), '-ac', '2', '-c:a', 'pcm_s24le',
    wavPath,
  ], 'SAMPLED_RENDER_MIX_FAILED')
  run(ffmpegPath, [
    '-nostdin', '-y', '-hide_banner', '-loglevel', 'error',
    '-i', wavPath, '-codec:a', 'libmp3lame', '-b:a', '256k', mp3Path,
  ], 'SAMPLED_RENDER_MP3_FAILED')
  return { wavPath, mp3Path, midiPath }
}
