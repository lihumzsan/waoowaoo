import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { ffmpegPath } from 'ffmpeg-ffprobe-static'
import { parseAndCompileScore } from './compiler'
import { scoreToMidi } from './midi'
import { renderScoreToWav } from './synth'

const repositoryRoot = process.cwd()
const scriptDir = path.join(repositoryRoot, 'scripts/music-score-demo')
const outputDir = path.resolve(repositoryRoot, process.argv[2] || 'tmp/music-score-demo')
if (!ffmpegPath) throw new Error('BUNDLED_FFMPEG_PATH_MISSING')
const resolvedFfmpegPath = ffmpegPath

const sources = [
  { input: 'scores/01-note-events.json', output: '01-note-events' },
  { input: 'scores/02-motif-arrangement.json', output: '02-motif-arrangement' },
  { input: 'scores/03-emotion-procedural.json', output: '03-emotion-procedural' },
] as const

async function renderSource(inputPath: string, outputName: string): Promise<void> {
  const raw: unknown = JSON.parse(await readFile(path.join(scriptDir, inputPath), 'utf8'))
  const score = parseAndCompileScore(raw)
  const wavPath = path.join(outputDir, `${outputName}.wav`)
  const midiPath = path.join(outputDir, `${outputName}.mid`)
  const mp3Path = path.join(outputDir, `${outputName}.mp3`)
  await Promise.all([
    writeFile(wavPath, renderScoreToWav(score)),
    writeFile(midiPath, scoreToMidi(score)),
  ])
  const conversion = spawnSync(resolvedFfmpegPath, [
    '-nostdin', '-y', '-hide_banner', '-loglevel', 'error',
    '-i', wavPath,
    '-codec:a', 'libmp3lame', '-b:a', '192k',
    mp3Path,
  ], { encoding: 'utf8' })
  if (conversion.status !== 0) throw new Error(`MP3_CONVERSION_FAILED:${conversion.stderr.trim()}`)
  process.stdout.write(`${outputName}: ${score.events.length} events, ${score.durationSeconds}s, ${score.sourceKind}\n`)
}

async function main(): Promise<void> {
  await mkdir(outputDir, { recursive: true })
  for (const source of sources) await renderSource(source.input, source.output)
  process.stdout.write(`rendered → ${outputDir}\n`)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
