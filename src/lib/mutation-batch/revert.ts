import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { revertAssetRender } from '@/lib/assets/services/asset-actions'

export type MutationRevertResult = {
  ok: true
  reverted: number
} | {
  ok: false
  reverted: number
  error: string
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function revertMutationEntry(entry: {
  kind: string
  targetType: string
  targetId: string
  payload: unknown
  projectId: string
  userId: string
}): Promise<void> {
  const payload = asRecord(entry.payload)

  switch (entry.kind) {
    case 'asset_render_revert': {
      const kind = readString(payload.kind)
      const assetId = readString(payload.assetId) || entry.targetId
      const appearanceId = readString(payload.appearanceId)
      if (kind !== 'character' && kind !== 'location') {
        throw new Error('MUTATION_UNSUPPORTED_KIND')
      }
      await revertAssetRender({
        kind,
        assetId,
        body: {
          ...(appearanceId ? { appearanceId } : {}),
        },
        access: {
          scope: 'project',
          userId: entry.userId,
          projectId: entry.projectId,
        },
      })
      return
    }
    case 'panel_candidate_cancel': {
      const panelId = entry.targetId
      await prisma.projectPanel.update({
        where: { id: panelId },
        data: {
          candidateImages: null,
        },
      })
      return
    }
    case 'panel_prompt_restore': {
      const previousVideoPrompt = payload.previousVideoPrompt === null || typeof payload.previousVideoPrompt === 'string'
        ? payload.previousVideoPrompt
        : undefined
      const previousImagePrompt = payload.previousImagePrompt === null || typeof payload.previousImagePrompt === 'string'
        ? payload.previousImagePrompt
        : undefined

      await prisma.projectPanel.update({
        where: { id: entry.targetId },
        data: {
          ...(previousVideoPrompt !== undefined ? { videoPrompt: previousVideoPrompt } : {}),
          ...(previousImagePrompt !== undefined ? { imagePrompt: previousImagePrompt } : {}),
        },
      })
      return
    }
    case 'panel_candidates_restore': {
      const previousCandidateImages = payload.previousCandidateImages === null || typeof payload.previousCandidateImages === 'string'
        ? payload.previousCandidateImages
        : null
      await prisma.projectPanel.update({
        where: { id: entry.targetId },
        data: {
          candidateImages: previousCandidateImages,
        },
      })
      return
    }
    case 'panel_candidate_select_restore': {
      const previousImageUrl = payload.previousImageUrl === null || typeof payload.previousImageUrl === 'string'
        ? payload.previousImageUrl
        : null
      const previousCandidateImages = payload.previousCandidateImages === null || typeof payload.previousCandidateImages === 'string'
        ? payload.previousCandidateImages
        : null
      await prisma.projectPanel.update({
        where: { id: entry.targetId },
        data: {
          imageUrl: previousImageUrl,
          candidateImages: previousCandidateImages,
        },
      })
      return
    }
    case 'panel_video_restore': {
      const previousVideoUrl = payload.previousVideoUrl === null || typeof payload.previousVideoUrl === 'string'
        ? payload.previousVideoUrl
        : null
      const previousLastVideoGenerationOptions =
        payload.previousLastVideoGenerationOptions === null
          ? Prisma.DbNull
          : (typeof payload.previousLastVideoGenerationOptions === 'object' && !Array.isArray(payload.previousLastVideoGenerationOptions))
            ? payload.previousLastVideoGenerationOptions as Prisma.InputJsonObject
            : undefined
      await prisma.projectPanel.update({
        where: { id: entry.targetId },
        data: {
          videoUrl: previousVideoUrl,
          ...(previousLastVideoGenerationOptions !== undefined
            ? { lastVideoGenerationOptions: previousLastVideoGenerationOptions ?? Prisma.DbNull }
            : {}),
        },
      })
      return
    }
    default:
      throw new Error(`MUTATION_KIND_UNSUPPORTED:${entry.kind}`)
  }
}

export async function revertMutationBatch(params: {
  batchId: string
  projectId: string
  userId: string
}): Promise<MutationRevertResult> {
  const batch = await prisma.mutationBatch.findFirst({
    where: {
      id: params.batchId,
      projectId: params.projectId,
      userId: params.userId,
    },
    include: {
      entries: {
        orderBy: { createdAt: 'desc' },
      },
    },
  })
  if (!batch) {
    return { ok: false, reverted: 0, error: 'MUTATION_BATCH_NOT_FOUND' }
  }

  if (batch.status === 'reverted') {
    return { ok: true, reverted: 0 }
  }

  let reverted = 0
  try {
    for (const entry of batch.entries) {
      await revertMutationEntry({
        kind: entry.kind,
        targetType: entry.targetType,
        targetId: entry.targetId,
        payload: entry.payload,
        projectId: params.projectId,
        userId: params.userId,
      })
      reverted += 1
    }
    await prisma.mutationBatch.update({
      where: { id: batch.id },
      data: { status: 'reverted', revertedAt: new Date(), revertError: null },
    })
    return { ok: true, reverted }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await prisma.mutationBatch.update({
      where: { id: batch.id },
      data: { status: 'failed', revertError: message },
    })
    return { ok: false, reverted, error: message }
  }
}
