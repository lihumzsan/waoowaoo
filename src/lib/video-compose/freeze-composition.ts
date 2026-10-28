import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AppError } from '@/lib/errors/app-error'
import { getObjectBuffer } from '@/lib/storage'
import { resolveWorkspaceResourceInputMedia } from '@/lib/workspace-resource/input-media'
import type { WorkspaceResourceInputRef } from '@/lib/workspace-resource/contracts'
import type {
  VideoComposition,
  CompositionSourceFacts,
} from './composition-contract'
import { probeVideoDimensions, probeVideoFrameRate } from './video-merge-ffmpeg'

/** Probe exact immutable versions before reserving the output or submitting work. */
export async function freezeCompositionSources(input: {
  userId: string
  projectId: string
  references: readonly WorkspaceResourceInputRef[]
  composition: VideoComposition
  maxInputBytes: number
}): Promise<CompositionSourceFacts[]> {
  const media = await resolveWorkspaceResourceInputMedia({
    ...input,
    expectedMediaType: 'video',
    references: input.references.filter((ref) => ref.role === 'source_video'),
  })
  const workspace = await mkdtemp(
    path.join(tmpdir(), 'wao-composition-preflight-'),
  )
  try {
    let bytes = 0
    const cache = new Map<string, Omit<CompositionSourceFacts, 'position'>>()
    const facts: CompositionSourceFacts[] = []
    for (const [index, item] of media.entries()) {
      const key = `${item.reference.resourceId}:${String(item.reference.contentVersion)}`
      let fact = cache.get(key)
      if (!fact) {
        if (
          item.sizeBytes !== null &&
          item.sizeBytes > BigInt(input.maxInputBytes - bytes)
        )
          throw new AppError('COMPOSITION_INPUT_TOO_LARGE')
        const buffer = await getObjectBuffer(item.storageKey, {
          maxBytes: input.maxInputBytes - bytes,
        })
        bytes += buffer.length
        if (bytes > input.maxInputBytes)
          throw new AppError('COMPOSITION_INPUT_TOO_LARGE')
        const file = path.join(workspace, `source-${String(index)}`)
        await writeFile(file, buffer)
        const [dimensions, frameRate] = await Promise.all([
          probeVideoDimensions(file),
          probeVideoFrameRate(file),
        ])
        if (
          item.durationMs === null ||
          !Number.isSafeInteger(item.durationMs) ||
          item.durationMs <= 0
        ) {
          throw new AppError('COMPOSITION_INPUT_INVALID', undefined, {
            details: {
              reasonCode: 'SOURCE_DURATION_MISSING',
              resourceId: item.reference.resourceId,
            },
          })
        }
        fact = {
          ...dimensions,
          durationMs: item.durationMs,
          frameRate,
        }
        cache.set(key, fact)
      }
      const clip = input.composition.clips[index]
      if (!clip || clip.sourceStartMs + clip.durationMs > fact.durationMs)
        throw new AppError('COMPOSITION_SOURCE_RANGE_INVALID', undefined, {
          details: {
            clipId: clip?.clipId ?? null,
            sourceDurationMs: fact.durationMs,
          },
        })
      facts.push({ ...fact, position: item.reference.position })
    }
    const clip = input.composition.clips[0]
    if (
      input.composition.audio.musicCues.length +
        input.composition.audio.soundCues.length >
        0 &&
      (!clip ||
        clip.sourceStartMs !== 0 ||
        clip.durationMs !== facts[0]?.durationMs)
    ) {
      throw new AppError('COMPOSITION_INPUT_INVALID', undefined, {
        details: { reasonCode: 'TIMED_CUES_REQUIRE_COMPLETE_SOURCE' },
      })
    }
    return facts
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}
