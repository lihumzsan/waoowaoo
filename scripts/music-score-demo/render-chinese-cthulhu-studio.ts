import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import {
  access,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { spawnSync } from 'node:child_process'
import { ffmpegPath, ffprobePath } from 'ffmpeg-ffprobe-static'
import { parseAndCompileScore } from './compiler'
import { scoreToMidi } from './midi'
import type { CompiledScore, InstrumentId } from './types'

const SAMPLE_RATE = 48_000
const TARGET_LUFS = -20
const VSCO_COMMIT = '440300901dfe9275fd84e0b7763af1f8443ae62e'
const GUQIN_URL = 'https://cdn.freesound.org/previews/176/176266_3274730-hq.mp3'
const GUQIN_SHA256 = '47f037058591c38815d8e82c22c92c910958816f94457c27d868b398affd7b41'
const SALAMANDER_URL = 'https://freepats.zenvoid.org/Piano/SalamanderGrandPiano/SalamanderGrandPianoV3%2B20161209_44khz16bit.tar.xz'
const SALAMANDER_SHA256 = '58750eb1366761e187f71ddb9b932355ea894d28ec4331e74ab8acb44c819936'
const SALAMANDER_DIRECTORY = 'SalamanderGrandPianoV3_44.1khz16bit'

interface PinnedAsset {
  readonly relativePath: string
  readonly sha256: string
}

interface LoudnessMeasurement {
  readonly input_i: string
  readonly input_lra: string
  readonly input_tp: string
  readonly input_thresh: string
  readonly target_offset: string
}

const vscoAssets: readonly PinnedAsset[] = [
  { relativePath: 'LICENSE', sha256: '36ffd9dc085d529a7e60e1276d73ae5a030b020313e6c5408593a6ae2af39673' },
  { relativePath: 'Woodwinds/Flute/expvib/LDFlute_expvib_C3_v1_1.wav', sha256: '5fde88f6ce3994f8a5c3b38d2c31e3245f2fcd563d6334e598d38bb9d6004af6' },
  { relativePath: 'Woodwinds/Flute/expvib/LDFlute_expvib_E3_v1_1.wav', sha256: 'ceea6c5a734afa7764172191c34369f8266036acf58410cba066ae73554b7b3c' },
  { relativePath: 'Woodwinds/Flute/expvib/LDFlute_expvib_A3_v1_1.wav', sha256: '6f7566797c5ac37172189ab375d28f0068232b74f5611e16da217055d3da6420' },
  { relativePath: 'Woodwinds/Flute/expvib/LDFlute_expvib_C4_v1_1.wav', sha256: 'af29be391cd3de946c8ff263a05f349a3c85e7298deed183339004a2ab1cad26' },
  { relativePath: 'Woodwinds/Flute/expvib/LDFlute_expvib_E4_v1_1.wav', sha256: '76ddf8704b6725b0f601fd70394503a5f2dd767881a0a70e6fd90315d3d96757' },
  { relativePath: 'Strings/Solo Contrabass/SusVib/BKCtbss_SusVib_C1_v1_rr1.wav', sha256: '35031ed9356f18b2ad4de86fff3192fe0cbcf79d5d63c079285246b51472f280' },
  { relativePath: 'Strings/Solo Contrabass/SusVib/BKCtbss_SusVib_D1_v1_rr1.wav', sha256: '02aafdc953cd07649f4e0be571a5569c80665cf61ac6062b6bae22c302289d2f' },
  { relativePath: 'Strings/Solo Contrabass/SusVib/BKCtbss_SusVib_E1_v1_rr1.wav', sha256: 'ffe06f830d10a24f04beb4683d5aae7516810d27c38dba3cc7a55d1c785840cd' },
  { relativePath: 'Strings/Solo Contrabass/SusVib/BKCtbss_SusVib_G#1_v1_rr1.wav', sha256: '601eda5755db1d15efa3203d457a8c43eb26f85ffe19455bf4efa895ed54adc6' },
  { relativePath: 'Strings/Cello Section/trem/trem_D2_v1_1.wav', sha256: 'eedd9f86e01a16828982ebb543eb3e0321f48b02f7ab987909dbd8ea81c6ac4f' },
  { relativePath: 'Strings/Cello Section/trem/trem_F2_v1_1.wav', sha256: '4dc64fd269ed7e86c5db56e99b5e6291c15e8d3b39876d064eee07e5be08cad2' },
  { relativePath: 'Strings/Cello Section/trem/trem_A2_v1_1.wav', sha256: '30824d7a9448a5ec21e261e5ba051190bf68fa295d9e4b0c6ee2550496a6af3d' },
  { relativePath: 'Strings/Cello Section/trem/trem_C3_v1_1.wav', sha256: '8ec0d3efd685d0989723e26dfdcfc523e0a6c1de1618186b48222ce38c34caf9' },
  { relativePath: 'Percussion/gongHit_p.wav', sha256: '3d103e1a7af12eeb17e0c5488f11933ca92b9fbdefa39b8020b64238da2db0d0' },
  { relativePath: 'Percussion/gongHit_mf.wav', sha256: '7e520ad14acda55db7906984f7efc2430961419435d951f55c8cdd9cd7a71108' },
  { relativePath: 'Percussion/gongHit_fff.wav', sha256: '998b27e21ee1639a73c1d71c8093e98cab4a10223640a59e8902ecfc557f74ac' },
  { relativePath: 'Percussion/gongscrape_mf.wav', sha256: '3e30f51d3667cde89d3fd3424e878a554ab26ff4ea882686cfbe887aaf2267b0' },
  { relativePath: 'VSCO 1 Percussion/drums/other/ethnic/giant/mallet/EthnicLargeMallet_hit_pp_1.wav', sha256: '118b1a8af1cdcdc6c3fdebaf1a9e3439a8d305bf5a650ea11fb20a2b6129a532' },
  { relativePath: 'VSCO 1 Percussion/drums/other/ethnic/giant/mallet/EthnicLargeMallet_hit_mf_1.wav', sha256: '11fbb9f2ba0df0a8069efcaa7d228bb12b74bcfc31fd88bd662d53bc5d5eb011' },
  { relativePath: 'VSCO 1 Percussion/drums/other/ethnic/giant/mallet/EthnicLargeMallet_hit_ff_1.wav', sha256: '6c31f340ef3da62b99759ad2dadfded7e58086d3dc7b710eaaf7eb03d67db6d1' },
]

const guqinSlices = [
  { name: 'C2', root: 36, start: 0.086, end: 0.887 },
  { name: 'D2', root: 38, start: 0.887, end: 1.804 },
  { name: 'F2', root: 41, start: 1.804, end: 2.617 },
  { name: 'G2', root: 43, start: 2.617, end: 3.546 },
  { name: 'A2', root: 45, start: 3.546, end: 4.521 },
  { name: 'C3', root: 48, start: 4.521, end: 5.601 },
  { name: 'D3', root: 50, start: 5.601, end: 7.124 },
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, key: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`STUDIO_LOUDNESS_FIELD_INVALID:${key}`)
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

  await mkdir(path.dirname(input.destination), { recursive: true })
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

function vscoUrl(relativePath: string): string {
  const encodedPath = relativePath.split('/').map(encodeURIComponent).join('/')
  return `https://raw.githubusercontent.com/sgossner/VSCO-2-CE/${VSCO_COMMIT}/${encodedPath}`
}

function resolveSfizzRender(repositoryRoot: string): string {
  const configured = process.env.SFIZZ_RENDER_PATH?.trim()
  const defaultPath = path.join(repositoryRoot, 'tmp/music-benchmark-assets/sfizz-pinned-build/library/bin/sfizz_render')
  const candidates = configured ? [configured] : [defaultPath, 'sfizz_render']
  for (const candidate of candidates) {
    if (commandWorks(candidate, ['--help'])) return candidate
  }
  throw new Error('SFIZZ_RENDER_REQUIRED: run `npx tsx scripts/music-score-demo/setup-sfizz-render.ts` first')
}

async function prepareAssets(repositoryRoot: string): Promise<Readonly<Record<InstrumentId, string | null>>> {
  if (!ffmpegPath) throw new Error('BUNDLED_FFMPEG_PATH_MISSING')
  const studioRoot = path.join(repositoryRoot, 'tmp/chinese-cthulhu-studio-assets')
  const sourceRoot = path.join(studioRoot, 'source')
  const vscoRoot = path.join(sourceRoot, 'vsco')
  const preparedRoot = path.join(studioRoot, 'prepared')
  const sfzRoot = path.join(studioRoot, 'sfz')
  const benchmarkRoot = path.join(repositoryRoot, 'tmp/music-benchmark-assets')
  await Promise.all([
    mkdir(vscoRoot, { recursive: true }),
    mkdir(preparedRoot, { recursive: true }),
    mkdir(sfzRoot, { recursive: true }),
    mkdir(benchmarkRoot, { recursive: true }),
  ])

  for (const asset of vscoAssets) {
    await ensurePinnedDownload({
      url: vscoUrl(asset.relativePath),
      expectedSha256: asset.sha256,
      destination: path.join(vscoRoot, asset.relativePath),
      errorPrefix: `STUDIO_VSCO:${asset.relativePath}`,
    })
  }
  const guqinSource = path.join(sourceRoot, 'guqin-open-strings-hq.mp3')
  await ensurePinnedDownload({
    url: GUQIN_URL,
    expectedSha256: GUQIN_SHA256,
    destination: guqinSource,
    errorPrefix: 'STUDIO_GUQIN',
  })

  const salamanderArchive = path.join(benchmarkRoot, 'SalamanderGrandPianoV3-44khz16bit.tar.xz')
  await ensurePinnedDownload({
    url: SALAMANDER_URL,
    expectedSha256: SALAMANDER_SHA256,
    destination: salamanderArchive,
    errorPrefix: 'STUDIO_SALAMANDER',
  })
  const salamanderSfz = path.join(benchmarkRoot, SALAMANDER_DIRECTORY, 'SalamanderGrandPianoV3.sfz')
  if (!(await fileExists(salamanderSfz))) {
    run('tar', ['-xJf', salamanderArchive, '-C', benchmarkRoot], 'STUDIO_SALAMANDER_EXTRACT_FAILED')
  }
  if (!(await fileExists(salamanderSfz))) throw new Error('STUDIO_SALAMANDER_SFZ_MISSING')

  const preparedCopies = [
    ['Woodwinds/Flute/expvib/LDFlute_expvib_C3_v1_1.wav', 'xiao-C4.wav'],
    ['Woodwinds/Flute/expvib/LDFlute_expvib_E3_v1_1.wav', 'xiao-E4.wav'],
    ['Woodwinds/Flute/expvib/LDFlute_expvib_A3_v1_1.wav', 'xiao-A4.wav'],
    ['Woodwinds/Flute/expvib/LDFlute_expvib_C4_v1_1.wav', 'xiao-C5.wav'],
    ['Woodwinds/Flute/expvib/LDFlute_expvib_E4_v1_1.wav', 'xiao-E5.wav'],
    ['Strings/Solo Contrabass/SusVib/BKCtbss_SusVib_C1_v1_rr1.wav', 'bass-C2.wav'],
    ['Strings/Solo Contrabass/SusVib/BKCtbss_SusVib_D1_v1_rr1.wav', 'bass-D2.wav'],
    ['Strings/Solo Contrabass/SusVib/BKCtbss_SusVib_E1_v1_rr1.wav', 'bass-E2.wav'],
    ['Strings/Solo Contrabass/SusVib/BKCtbss_SusVib_G#1_v1_rr1.wav', 'bass-Gs2.wav'],
    ['Strings/Cello Section/trem/trem_D2_v1_1.wav', 'trem-D3.wav'],
    ['Strings/Cello Section/trem/trem_F2_v1_1.wav', 'trem-F3.wav'],
    ['Strings/Cello Section/trem/trem_A2_v1_1.wav', 'trem-A3.wav'],
    ['Strings/Cello Section/trem/trem_C3_v1_1.wav', 'trem-C4.wav'],
    ['Percussion/gongHit_p.wav', 'gong-p.wav'],
    ['Percussion/gongHit_mf.wav', 'gong-mf.wav'],
    ['Percussion/gongHit_fff.wav', 'gong-fff.wav'],
    ['Percussion/gongscrape_mf.wav', 'gong-scrape.wav'],
    ['VSCO 1 Percussion/drums/other/ethnic/giant/mallet/EthnicLargeMallet_hit_pp_1.wav', 'drum-pp.wav'],
    ['VSCO 1 Percussion/drums/other/ethnic/giant/mallet/EthnicLargeMallet_hit_mf_1.wav', 'drum-mf.wav'],
    ['VSCO 1 Percussion/drums/other/ethnic/giant/mallet/EthnicLargeMallet_hit_ff_1.wav', 'drum-ff.wav'],
  ] as const
  for (const [sourceName, destinationName] of preparedCopies) {
    await copyFile(path.join(vscoRoot, sourceName), path.join(preparedRoot, destinationName))
  }

  for (const slice of guqinSlices) {
    const destination = path.join(preparedRoot, `guqin-${slice.name}.wav`)
    const fadeOutStart = Math.max(0.1, slice.end - slice.start - 0.08)
    run(ffmpegPath, [
      '-nostdin', '-y', '-hide_banner', '-loglevel', 'error',
      '-ss', slice.start.toFixed(3), '-to', slice.end.toFixed(3), '-i', guqinSource,
      '-af', `afade=t=in:st=0:d=0.008,afade=t=out:st=${fadeOutStart.toFixed(3)}:d=0.07`,
      '-ar', String(SAMPLE_RATE), '-ac', '2', '-c:a', 'pcm_s24le', destination,
    ], `STUDIO_GUQIN_SLICE_FAILED:${slice.name}`)
  }

  const writeSfz = async (name: string, body: string): Promise<string> => {
    const sfzPath = path.join(sfzRoot, `${name}.sfz`)
    await writeFile(sfzPath, `${body.trim()}\n`)
    return sfzPath
  }
  const guqinSfz = await writeSfz('guqin', `
<global> loop_mode=one_shot ampeg_release=0.9
<region> sample=../prepared/guqin-C2.wav  lokey=24 hikey=37 pitch_keycenter=36
<region> sample=../prepared/guqin-D2.wav  lokey=38 hikey=39 pitch_keycenter=38
<region> sample=../prepared/guqin-F2.wav  lokey=40 hikey=42 pitch_keycenter=41
<region> sample=../prepared/guqin-G2.wav  lokey=43 hikey=44 pitch_keycenter=43
<region> sample=../prepared/guqin-A2.wav  lokey=45 hikey=46 pitch_keycenter=45
<region> sample=../prepared/guqin-C3.wav  lokey=47 hikey=49 pitch_keycenter=48
<region> sample=../prepared/guqin-D3.wav  lokey=50 hikey=108 pitch_keycenter=50
  `)
  const xiaoSfz = await writeSfz('xiao', `
<global> ampeg_attack=0.045 ampeg_release=0.32
<region> sample=../prepared/xiao-C4.wav lokey=24 hikey=62 pitch_keycenter=60
<region> sample=../prepared/xiao-E4.wav lokey=63 hikey=66 pitch_keycenter=64
<region> sample=../prepared/xiao-A4.wav lokey=67 hikey=70 pitch_keycenter=69
<region> sample=../prepared/xiao-C5.wav lokey=71 hikey=74 pitch_keycenter=72
<region> sample=../prepared/xiao-E5.wav lokey=75 hikey=108 pitch_keycenter=76
  `)
  const bassSfz = await writeSfz('low-string-drone', `
<global> ampeg_attack=0.16 ampeg_release=0.72
<region> sample=../prepared/bass-C2.wav  lokey=24 hikey=36 pitch_keycenter=36
<region> sample=../prepared/bass-D2.wav  lokey=37 hikey=39 pitch_keycenter=38
<region> sample=../prepared/bass-E2.wav  lokey=40 hikey=41 pitch_keycenter=40
<region> sample=../prepared/bass-Gs2.wav lokey=42 hikey=108 pitch_keycenter=44
  `)
  const tremoloSfz = await writeSfz('string-tremolo', `
<global> ampeg_attack=0.12 ampeg_release=0.5
<region> sample=../prepared/trem-D3.wav lokey=24 hikey=51 pitch_keycenter=50
<region> sample=../prepared/trem-F3.wav lokey=52 hikey=54 pitch_keycenter=53
<region> sample=../prepared/trem-A3.wav lokey=55 hikey=58 pitch_keycenter=57
<region> sample=../prepared/trem-C4.wav lokey=59 hikey=108 pitch_keycenter=60
  `)
  const gongSfz = await writeSfz('ritual-gong', `
<global> loop_mode=one_shot ampeg_release=1.4
<region> sample=../prepared/gong-scrape.wav key=47
<region> sample=../prepared/gong-p.wav   key=48 lovel=1  hivel=45
<region> sample=../prepared/gong-mf.wav  key=48 lovel=46 hivel=79
<region> sample=../prepared/gong-fff.wav key=48 lovel=80 hivel=127
  `)
  const drumSfz = await writeSfz('temple-drum', `
<global> loop_mode=one_shot ampeg_release=0.7
<region> sample=../prepared/drum-pp.wav key=36 lovel=1  hivel=44
<region> sample=../prepared/drum-mf.wav key=36 lovel=45 hivel=68
<region> sample=../prepared/drum-ff.wav key=36 lovel=69 hivel=127
  `)

  return {
    felt_piano: null,
    warm_pad: null,
    soft_bass: null,
    cello: null,
    glass_mallet: null,
    soft_pulse: null,
    concert_grand: salamanderSfz,
    string_ensemble: null,
    solo_cello: null,
    clarinet: null,
    french_horn: null,
    harp: null,
    choir_aahs: null,
    timpani: null,
    shakuhachi: null,
    koto: null,
    shamisen: null,
    taiko: null,
    woodblock: null,
    tubular_bells: null,
    contrabass: null,
    bassoon: null,
    choir_oohs: null,
    dulcimer: null,
    string_tremolo: tremoloSfz,
    guqin: guqinSfz,
    xiao: xiaoSfz,
    ritual_gong: gongSfz,
    temple_drum: drumSfz,
    low_string_drone: bassSfz,
  }
}

const stemFilters: Readonly<Record<InstrumentId, string>> = {
  felt_piano: '',
  warm_pad: '',
  soft_bass: '',
  cello: '',
  glass_mallet: '',
  soft_pulse: '',
  concert_grand: 'highpass=f=30,lowpass=f=10500,equalizer=f=220:t=q:w=1:g=-2.3,volume=0.5',
  string_ensemble: '',
  solo_cello: '',
  clarinet: '',
  french_horn: '',
  harp: '',
  choir_aahs: '',
  timpani: '',
  shakuhachi: '',
  koto: '',
  shamisen: '',
  taiko: '',
  woodblock: '',
  tubular_bells: '',
  contrabass: '',
  bassoon: '',
  choir_oohs: '',
  dulcimer: '',
  string_tremolo: 'highpass=f=72,lowpass=f=9600,equalizer=f=2100:t=q:w=1.1:g=-2,volume=0.53',
  guqin: 'highpass=f=52,lowpass=f=13500,equalizer=f=310:t=q:w=1:g=-1.2,aecho=0.8:0.75:91|181:0.12|0.055,volume=0.92',
  xiao: 'highpass=f=155,lowpass=f=11000,equalizer=f=2300:t=q:w=1.1:g=-1.6,aecho=0.8:0.76:127|263:0.1|0.045,volume=0.62',
  ritual_gong: 'highpass=f=32,lowpass=f=14500,equalizer=f=380:t=q:w=1:g=-1.5,volume=0.57',
  temple_drum: 'highpass=f=28,lowpass=f=6000,equalizer=f=92:t=q:w=1:g=1.8,volume=0.68',
  low_string_drone: 'highpass=f=24,lowpass=f=4800,equalizer=f=82:t=q:w=1:g=1.2,volume=0.62',
}

function stemScore(score: CompiledScore, instrument: InstrumentId): CompiledScore {
  return { ...score, events: score.events.filter((event) => event.instrument === instrument) }
}

function parseLoudnessMeasurement(output: string): LoudnessMeasurement {
  const start = output.lastIndexOf('{')
  const end = output.indexOf('}', start)
  if (start < 0 || end < 0) throw new Error('STUDIO_LOUDNESS_ANALYSIS_JSON_MISSING')
  const parsed: unknown = JSON.parse(output.slice(start, end + 1))
  if (!isRecord(parsed)) throw new Error('STUDIO_LOUDNESS_ANALYSIS_INVALID')
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
  ], 'STUDIO_DURATION_PROBE_FAILED')
  const duration = Number(output.trim())
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('STUDIO_DURATION_INVALID')
  return duration
}

function masterMix(rawPath: string, wavPath: string, mp3Path: string, durationSeconds: number): LoudnessMeasurement {
  if (!ffmpegPath) throw new Error('BUNDLED_FFMPEG_PATH_MISSING')
  const fadeStart = Math.max(0, durationSeconds - 1.9)
  const preparation = `atrim=duration=${durationSeconds.toFixed(6)},asetpts=PTS-STARTPTS,`
    + `afade=t=in:st=0:d=0.45,afade=t=out:st=${fadeStart.toFixed(6)}:d=1.9,highpass=f=22,lowpass=f=18500`
  const firstPass = run(ffmpegPath, [
    '-nostdin', '-hide_banner', '-nostats', '-i', rawPath,
    '-af', `${preparation},loudnorm=I=${TARGET_LUFS}:LRA=30:TP=-1.2:print_format=json`,
    '-f', 'null', '-',
  ], 'STUDIO_LOUDNESS_ANALYSIS_FAILED')
  const measurement = parseLoudnessMeasurement(firstPass)
  const secondPass = `${preparation},loudnorm=I=${TARGET_LUFS}:LRA=30:TP=-1.2:`
    + `measured_I=${measurement.input_i}:measured_LRA=${measurement.input_lra}:`
    + `measured_TP=${measurement.input_tp}:measured_thresh=${measurement.input_thresh}:`
    + `offset=${measurement.target_offset}:linear=true:print_format=summary`
  run(ffmpegPath, [
    '-nostdin', '-y', '-hide_banner', '-loglevel', 'error', '-i', rawPath,
    '-af', secondPass, '-ar', String(SAMPLE_RATE), '-ac', '2', '-c:a', 'pcm_s24le', wavPath,
  ], 'STUDIO_MASTER_FAILED')
  run(ffmpegPath, [
    '-nostdin', '-y', '-hide_banner', '-loglevel', 'error', '-i', wavPath,
    '-codec:a', 'libmp3lame', '-b:a', '256k', mp3Path,
  ], 'STUDIO_MP3_FAILED')
  return measurement
}

async function main(): Promise<void> {
  if (!ffmpegPath) throw new Error('BUNDLED_FFMPEG_PATH_MISSING')
  const repositoryRoot = process.cwd()
  const scoreArgument = process.argv[2]?.trim()
  const scorePath = scoreArgument
    ? path.resolve(repositoryRoot, scoreArgument)
    : path.join(repositoryRoot, 'scripts/music-score-demo/scores/06-chinese-cthulhu-studio.json')
  const outputName = process.argv[3]?.trim() || path.basename(scorePath, path.extname(scorePath))
  if (!/^[a-z0-9][a-z0-9-]*$/.test(outputName)) throw new Error('STUDIO_OUTPUT_NAME_INVALID')
  const rawScore: unknown = JSON.parse(await readFile(scorePath, 'utf8'))
  const score = parseAndCompileScore(rawScore)
  if (score.sourceKind !== 'cinematic-continuous/v1') throw new Error('STUDIO_SCORE_KIND_INVALID')

  const sfizzRender = resolveSfizzRender(repositoryRoot)
  const sfzByInstrument = await prepareAssets(repositoryRoot)
  const outputDir = path.join(repositoryRoot, 'tmp/music-score-demo')
  const stemDir = path.join(outputDir, `${outputName}-studio-stems`)
  await Promise.all([mkdir(outputDir, { recursive: true }), rm(stemDir, { recursive: true, force: true })])
  await mkdir(stemDir, { recursive: true })

  const midiPath = path.join(outputDir, `${outputName}.mid`)
  await writeFile(midiPath, scoreToMidi(score))
  const instruments = [...new Set(score.events.map((event) => event.instrument))]
  const stemPaths: string[] = []
  for (const instrument of instruments) {
    const sfzPath = sfzByInstrument[instrument]
    if (!sfzPath) throw new Error(`STUDIO_INSTRUMENT_UNSUPPORTED:${instrument}`)
    const instrumentMidi = path.join(stemDir, `${instrument}.mid`)
    const instrumentWav = path.join(stemDir, `${instrument}.wav`)
    await writeFile(instrumentMidi, scoreToMidi(stemScore(score, instrument)))
    run(sfizzRender, [
      '--wav', instrumentWav,
      '--sfz', sfzPath,
      '--midi', instrumentMidi,
      '--samplerate', String(SAMPLE_RATE),
      '--use-eot',
    ], `STUDIO_SFIZZ_RENDER_FAILED:${instrument}`)
    stemPaths.push(instrumentWav)
  }

  const rawMixPath = path.join(stemDir, 'unmastered-mix.wav')
  const inputArgs = stemPaths.flatMap((stemPath) => ['-i', stemPath])
  const filtered = instruments.map((instrument, index) => {
    const filter = stemFilters[instrument]
    if (!filter) throw new Error(`STUDIO_STEM_FILTER_MISSING:${instrument}`)
    return `[${index}:a]atrim=duration=${score.durationSeconds},asetpts=PTS-STARTPTS,${filter}[s${index}]`
  })
  const mixInputs = instruments.map((_, index) => `[s${index}]`).join('')
  const filterComplex = [
    ...filtered,
    `${mixInputs}amix=inputs=${instruments.length}:duration=longest:normalize=0[mix]`,
  ].join(';')
  run(ffmpegPath, [
    '-nostdin', '-y', '-hide_banner', '-loglevel', 'error',
    ...inputArgs,
    '-filter_complex', filterComplex,
    '-map', '[mix]', '-ar', String(SAMPLE_RATE), '-ac', '2', '-c:a', 'pcm_f32le', rawMixPath,
  ], 'STUDIO_STEM_MIX_FAILED')

  const wavPath = path.join(outputDir, `${outputName}.wav`)
  const mp3Path = path.join(outputDir, `${outputName}.mp3`)
  const measurement = masterMix(rawMixPath, wavPath, mp3Path, score.durationSeconds)
  const duration = probeDuration(wavPath)
  process.stdout.write(
    `${outputName}: ${score.events.length} events / ${instruments.length} studio instruments / ${duration.toFixed(3)}s\n`
      + `raw dynamics: ${measurement.input_lra} LU LRA; linear master: ${TARGET_LUFS} LUFS\n`
      + `wav → ${wavPath}\nmp3 → ${mp3Path}\nmidi → ${midiPath}\n`,
  )
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
