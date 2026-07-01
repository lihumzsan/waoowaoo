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

function hasOwnField(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function readRequiredStringField(record: Record<string, unknown>, key: string, error: string): string {
  const value = record[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(error)
  }
  return value
}

function readRequiredIntegerField(record: Record<string, unknown>, key: string, error: string): number {
  const value = record[key]
  if (!Number.isInteger(value)) {
    throw new Error(error)
  }
  return value
}

function readRequiredNullableIntegerField(record: Record<string, unknown>, key: string, error: string): number | null {
  if (!hasOwnField(record, key)) {
    throw new Error(error)
  }
  const value = record[key]
  if (value === null) return null
  if (!Number.isInteger(value)) {
    throw new Error(error)
  }
  return value
}

function readOptionalNullableStringField(record: Record<string, unknown>, key: string): string | null | undefined {
  if (!hasOwnField(record, key)) return undefined
  const value = record[key]
  if (value === null) return null
  if (typeof value === 'string') return value
  throw new Error(`MUTATION_PANEL_RESTORE_INVALID_${key}`)
}

function readOptionalNullableNumberField(record: Record<string, unknown>, key: string): number | null | undefined {
  if (!hasOwnField(record, key)) return undefined
  const value = record[key]
  if (value === null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new Error(`MUTATION_PANEL_RESTORE_INVALID_${key}`)
}

function readOptionalNullableIntegerField(record: Record<string, unknown>, key: string): number | null | undefined {
  if (!hasOwnField(record, key)) return undefined
  const value = record[key]
  if (value === null) return null
  if (Number.isInteger(value)) return value
  throw new Error(`MUTATION_PANEL_RESTORE_INVALID_${key}`)
}

function readOptionalJsonField(record: Record<string, unknown>, key: string): Prisma.InputJsonValue | undefined {
  if (!hasOwnField(record, key)) return undefined
  const value = record[key]
  if (value === null) return undefined
  return value as Prisma.InputJsonValue
}

function readOptionalDateField(record: Record<string, unknown>, key: string): Date | undefined {
  if (!hasOwnField(record, key)) return undefined
  const value = record[key]
  if (value instanceof Date) return value
  if (typeof value !== 'string') {
    throw new Error(`MUTATION_PANEL_RESTORE_INVALID_${key}`)
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`MUTATION_PANEL_RESTORE_INVALID_${key}`)
  }
  return date
}

function buildPanelRestoreData(payload: Record<string, unknown>, targetStoryboardId: string): Prisma.ProjectPanelUncheckedCreateInput {
  const panel = asRecord(payload.panel)
  const id = readRequiredStringField(panel, 'id', 'MUTATION_PANEL_RESTORE_MISSING_PANEL_ID')
  const storyboardId = readRequiredStringField(panel, 'storyboardId', 'MUTATION_PANEL_RESTORE_MISSING_STORYBOARD_ID')
  if (storyboardId !== targetStoryboardId) {
    throw new Error('MUTATION_PANEL_RESTORE_STORYBOARD_MISMATCH')
  }

  const panelIndex = readRequiredIntegerField(panel, 'panelIndex', 'MUTATION_PANEL_RESTORE_MISSING_PANEL_INDEX')
  const panelNumber = readRequiredNullableIntegerField(panel, 'panelNumber', 'MUTATION_PANEL_RESTORE_MISSING_PANEL_NUMBER')

  const shotType = readOptionalNullableStringField(panel, 'shotType')
  const cameraMove = readOptionalNullableStringField(panel, 'cameraMove')
  const description = readOptionalNullableStringField(panel, 'description')
  const location = readOptionalNullableStringField(panel, 'location')
  const characters = readOptionalNullableStringField(panel, 'characters')
  const props = readOptionalNullableStringField(panel, 'props')
  const srtSegment = readOptionalNullableStringField(panel, 'srtSegment')
  const imagePrompt = readOptionalNullableStringField(panel, 'imagePrompt')
  const imageUrl = readOptionalNullableStringField(panel, 'imageUrl')
  const imageMediaId = readOptionalNullableStringField(panel, 'imageMediaId')
  const videoPrompt = readOptionalNullableStringField(panel, 'videoPrompt')
  const videoUrl = readOptionalNullableStringField(panel, 'videoUrl')
  const videoMediaId = readOptionalNullableStringField(panel, 'videoMediaId')
  const sceneType = readOptionalNullableStringField(panel, 'sceneType')
  const candidateImages = readOptionalNullableStringField(panel, 'candidateImages')
  const sourceGenerationSegmentId = readOptionalNullableStringField(panel, 'sourceGenerationSegmentId')
  const actingNotes = readOptionalNullableStringField(panel, 'actingNotes')

  const srtStart = readOptionalNullableNumberField(panel, 'srtStart')
  const srtEnd = readOptionalNullableNumberField(panel, 'srtEnd')
  const duration = readOptionalNullableNumberField(panel, 'duration')
  const sourceShotNumber = readOptionalNullableIntegerField(panel, 'sourceShotNumber')

  const lastVideoGenerationOptions = readOptionalJsonField(panel, 'lastVideoGenerationOptions')
  const executionSnapshotJson = readOptionalJsonField(panel, 'executionSnapshotJson')
  const renderFactsJson = readOptionalJsonField(panel, 'renderFactsJson')
  const createdAt = readOptionalDateField(panel, 'createdAt')
  const updatedAt = readOptionalDateField(panel, 'updatedAt')

  return {
    id,
    storyboardId,
    panelIndex,
    panelNumber,
    ...(shotType !== undefined ? { shotType } : {}),
    ...(cameraMove !== undefined ? { cameraMove } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(location !== undefined ? { location } : {}),
    ...(characters !== undefined ? { characters } : {}),
    ...(props !== undefined ? { props } : {}),
    ...(srtSegment !== undefined ? { srtSegment } : {}),
    ...(srtStart !== undefined ? { srtStart } : {}),
    ...(srtEnd !== undefined ? { srtEnd } : {}),
    ...(duration !== undefined ? { duration } : {}),
    ...(imagePrompt !== undefined ? { imagePrompt } : {}),
    ...(imageUrl !== undefined ? { imageUrl } : {}),
    ...(imageMediaId !== undefined ? { imageMediaId } : {}),
    ...(videoPrompt !== undefined ? { videoPrompt } : {}),
    ...(videoUrl !== undefined ? { videoUrl } : {}),
    ...(lastVideoGenerationOptions !== undefined ? { lastVideoGenerationOptions } : {}),
    ...(videoMediaId !== undefined ? { videoMediaId } : {}),
    ...(sceneType !== undefined ? { sceneType } : {}),
    ...(candidateImages !== undefined ? { candidateImages } : {}),
    ...(sourceShotNumber !== undefined ? { sourceShotNumber } : {}),
    ...(sourceGenerationSegmentId !== undefined ? { sourceGenerationSegmentId } : {}),
    ...(executionSnapshotJson !== undefined ? { executionSnapshotJson } : {}),
    ...(renderFactsJson !== undefined ? { renderFactsJson } : {}),
    ...(actingNotes !== undefined ? { actingNotes } : {}),
    ...(createdAt !== undefined ? { createdAt } : {}),
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  }
}

async function restoreDeletedPanel(params: {
  entry: {
    targetType: string
    targetId: string
    projectId: string
    userId: string
  }
  payload: Record<string, unknown>
}): Promise<void> {
  if (params.entry.targetType !== 'ProjectStoryboard') {
    throw new Error('MUTATION_PANEL_RESTORE_TARGET_TYPE_INVALID')
  }

  const panelData = buildPanelRestoreData(params.payload, params.entry.targetId)
  const storyboard = await prisma.projectStoryboard.findFirst({
    where: {
      id: panelData.storyboardId,
      episode: {
        projectId: params.entry.projectId,
        project: {
          userId: params.entry.userId,
        },
      },
    },
    select: { id: true },
  })
  if (!storyboard) {
    throw new Error('MUTATION_PANEL_RESTORE_STORYBOARD_NOT_FOUND')
  }

  await prisma.$transaction(async (tx) => {
    const existingPanel = await tx.projectPanel.findUnique({
      where: { id: panelData.id },
      select: { id: true },
    })
    if (existingPanel) {
      throw new Error('MUTATION_PANEL_RESTORE_PANEL_ALREADY_EXISTS')
    }

    const maxPanel = await tx.projectPanel.findFirst({
      where: { storyboardId: panelData.storyboardId },
      orderBy: { panelIndex: 'desc' },
      select: { panelIndex: true },
    })
    const offset = (maxPanel?.panelIndex ?? -1) + 1000

    await tx.projectPanel.updateMany({
      where: {
        storyboardId: panelData.storyboardId,
        panelIndex: { gte: panelData.panelIndex },
      },
      data: {
        panelIndex: { increment: offset },
        panelNumber: { increment: offset },
      },
    })

    await tx.projectPanel.updateMany({
      where: {
        storyboardId: panelData.storyboardId,
        panelIndex: { gte: panelData.panelIndex + offset },
      },
      data: {
        panelIndex: { decrement: offset - 1 },
        panelNumber: { decrement: offset - 1 },
      },
    })

    await tx.projectPanel.create({ data: panelData })

    const panelCount = await tx.projectPanel.count({
      where: { storyboardId: panelData.storyboardId },
    })
    await tx.projectStoryboard.update({
      where: { id: panelData.storyboardId },
      data: { panelCount },
    })
  })
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
    case 'panel_delete_restore': {
      await restoreDeletedPanel({
        entry,
        payload,
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
