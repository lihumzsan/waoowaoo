import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseAndCompileScore } from './compiler'
import { renderSampledScore } from './sample-renderer'

const repositoryRoot = process.cwd()
const scriptDir = path.join(repositoryRoot, 'scripts/music-score-demo')

async function main(): Promise<void> {
  const raw: unknown = JSON.parse(await readFile(path.join(scriptDir, 'scores/04-upper-bound-continuous.json'), 'utf8'))
  const score = parseAndCompileScore(raw)
  if (score.sourceKind !== 'cinematic-continuous/v1') throw new Error('UPPER_BOUND_SCORE_KIND_INVALID')
  const result = await renderSampledScore({
    score,
    outputDir: path.join(repositoryRoot, 'tmp/music-score-demo'),
    assetsDir: path.join(repositoryRoot, 'tmp/music-score-demo-assets'),
    outputName: '04-upper-bound-continuous',
  })
  process.stdout.write(
    `04-upper-bound-continuous: ${score.events.length} events, ${score.durationSeconds}s, sampled stems\n`
      + `wav → ${result.wavPath}\nmp3 → ${result.mp3Path}\nmidi → ${result.midiPath}\n`,
  )
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
