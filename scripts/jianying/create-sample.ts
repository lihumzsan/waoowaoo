/** Standalone Codex probe, using the same sealed exporter as Wao. No database or UI access. */
import { resolveProjectVideoCanvas } from '../../src/lib/operations/project-video-ratio-policy'
import { probeMediaDurationSeconds } from '../../src/lib/video-compose/ffmpeg-command'
import { z } from 'zod'
import { parseArgs } from 'node:util'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { freezeJianyingProfile } from '../../src/lib/jianying/profile'
import { exportJianyingProject } from '../../src/lib/jianying/export-project'
import { videoCompositionSchema } from '../../src/lib/video-compose/composition-contract'
import { validateCompositionTarget } from '../../src/lib/video-compose/composition-target-registry'
import {
  probeVideoDimensions,
  probeVideoFrameRate,
} from '../../src/lib/video-compose/video-merge-ffmpeg'

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      first: { type: 'string' },
      second: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      out: { type: 'string' },
      locale: { type: 'string' },
      ratio: { type: 'string' },
      resolution: { type: 'string' },
    },
    strict: true,
  })
  if (!values.first || !values.second || !values.name || !values.out) {
    throw new Error(
      'Usage: create-sample.ts --first <video> --second <video> --name <caption> [--description <caption>] --locale <zh|en> --ratio <W:H> --resolution <720p> --out <NEW zip>',
    )
  }
  const locale = z.enum(['zh', 'en']).parse(values.locale)
  const profile = await freezeJianyingProfile()
  const sourcePaths = [path.resolve(values.first), path.resolve(values.second)]
  const sourceFacts = await Promise.all(
    sourcePaths.map(async (file, position) => ({
      ...(await probeVideoDimensions(file)),
      position,
      durationMs: Math.round((await probeMediaDurationSeconds(file)) * 1000),
      frameRate: await probeVideoFrameRate(file),
    })),
  )
  const firstSource = sourceFacts[0]
  if (!firstSource) throw new Error('COMPOSITION_SOURCE_FACTS_MISSING')
  const format = {
    ...resolveProjectVideoCanvas({
      aspectRatio: z.string().min(1).parse(values.ratio),
      resolution: z.string().min(1).parse(values.resolution),
    }),
    frameRate: firstSource.frameRate,
  }
  const composition = videoCompositionSchema.parse({
    schemaVersion: 1,
    clips: sourceFacts.map((source, index) => ({
      clipId: `sample-${String(index)}`,
      source: {
        resourceId: `sample-source-${String(index)}`,
        contentVersion: 1,
      },
      sourceStartMs: 0,
      durationMs: Math.min(source.durationMs, 5000),
    })),
    textLayers: [
      {
        layerId: 'sample-caption',
        clipId: 'sample-1',
        startOffsetMs: 0,
        durationMs: Math.min(sourceFacts[1]?.durationMs ?? 0, 3000),
        name: values.name,
        description: values.description ?? null,
        nameSource: { kind: 'user_instruction' },
        styleKey: 'lower_third',
        placementKey: 'bottom_left',
        intro: { kind: 'fade', durationMs: 300 },
        outro: { kind: 'fade', durationMs: 300 },
      },
    ],
    audio: { mode: 'preserve', musicCues: [], soundCues: [] },
    contextReferences: [],
  })
  validateCompositionTarget('jianying_project', composition)
  const workspaceDir = await mkdtemp(
    path.join(tmpdir(), 'wao-jianying-sample-'),
  )
  try {
    const bytes = await exportJianyingProject({
      identity: 'wao-jianying-phase1-sample',
      name: values.name,
      locale,
      composition,
      profile,
      sourceFacts,
      format,
      sourcePaths,
      workspaceDir,
    })
    await writeFile(path.resolve(values.out), bytes, { flag: 'wx' })
    process.stdout.write(
      `${path.resolve(values.out)}\nNative Jianying playback has not been verified.\n`,
    )
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
}
void main().catch((error: unknown) => {
  const detail =
    error instanceof Error
      ? `${error.message}${error.cause instanceof Error ? `\n${error.cause.message}` : ''}`
      : String(error)
  process.stderr.write(`${detail}\n`)
  process.exitCode = 1
})
