import { type Job } from 'bullmq'
import type { Prisma } from '@prisma/client'
import sharp from 'sharp'
import { prisma } from '@/lib/prisma'
import { getObjectBuffer, generateUniqueKey, uploadObject } from '@/lib/storage'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '../shared'
import {
  resolveImageSourceFromGeneration,
  toSignedUrlIfCos,
  uploadImageSourceToCos,
} from '../utils'
import {
  normalizeReferenceImageItemsForGeneration,
  type ReferenceImageItem,
} from './image-task-handler-shared'
import {
  analyzeGridCoordinates,
  generateCameraPlan,
  generateGridFloorPlan,
} from '@/lib/edit-script/storyboard-consistency/model-generation'
import {
  resolveAspectRatioFromDimensions,
  resolveGridDensityFromDimensions,
} from '@/lib/edit-script/storyboard-consistency/strategies'
import {
  storyboardConsistencySourceSnapshotSchema,
  type StoryboardConsistencyAssetSnapshot,
  type StoryboardConsistencyModelConfigSnapshot,
  type StoryboardConsistencySourceSnapshot,
  type StoryboardPanelPromptDraft,
} from '@/lib/edit-script/storyboard-consistency/types'
import {
  upsertEditScriptStoryboardShell,
  upsertStoryboardPanelsFromPrompts,
} from '@/lib/edit-script/storyboard-consistency/persistence'
import { buildCoordinateGridOverlaySvgBuffer } from '@/lib/edit-script/storyboard-consistency/grid-overlay-svg'

type StoryboardWithArtifacts = NonNullable<Awaited<ReturnType<typeof loadStoryboardWithArtifacts>>>
type BlockingArtifactRecord = StoryboardWithArtifacts['blockingArtifacts'][number]

interface ParsedPayload {
  readonly editScriptId: string
  readonly sourceSnapshot: StoryboardConsistencySourceSnapshot
  readonly modelConfigSnapshot: StoryboardConsistencyModelConfigSnapshot
}

export async function runStoryboardConsistencyItemsInParallel<T>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const results = await Promise.allSettled(items.map((item, index) => worker(item, index)))
  const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (!failed) return
  throw failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason))
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const text = readString(item)
    return text ? [text] : []
  })
}

function readNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => (typeof item === 'number' && Number.isFinite(item) ? [item] : []))
}

function parsePayload(job: Job<TaskJobData>): ParsedPayload {
  const payload = readRecord(job.data.payload)
  const editScriptId = readString(payload.editScriptId) || job.data.targetId
  if (!editScriptId) throw new Error('EDIT_SCRIPT_STORYBOARD_EDIT_SCRIPT_ID_REQUIRED')
  const sourceSnapshot = storyboardConsistencySourceSnapshotSchema.parse(payload.sourceSnapshot)
  const modelConfigRaw = readRecord(payload.modelConfigSnapshot)
  const analysisModel = readString(modelConfigRaw.analysisModel)
  const storyboardModel = readString(modelConfigRaw.storyboardModel)
  if (!analysisModel) throw new Error('EDIT_SCRIPT_STORYBOARD_ANALYSIS_MODEL_REQUIRED')
  if (!storyboardModel) throw new Error('EDIT_SCRIPT_STORYBOARD_MODEL_REQUIRED')
  return {
    editScriptId,
    sourceSnapshot,
    modelConfigSnapshot: {
      analysisModel,
      storyboardModel,
    },
  }
}

function parseSnapshotFromStoryboard(storyboard: StoryboardWithArtifacts): StoryboardConsistencySourceSnapshot {
  const plan = readRecord(parseJson(storyboard.photographyPlan))
  const sourceSnapshot = storyboardConsistencySourceSnapshotSchema.safeParse(plan.sourceSnapshot)
  if (!sourceSnapshot.success) throw new Error('EDIT_SCRIPT_STORYBOARD_SOURCE_SNAPSHOT_INVALID')
  return sourceSnapshot.data
}

function parseModelConfigFromStoryboard(storyboard: StoryboardWithArtifacts): StoryboardConsistencyModelConfigSnapshot {
  const plan = readRecord(parseJson(storyboard.photographyPlan))
  const modelConfig = readRecord(plan.modelConfigSnapshot)
  const analysisModel = readString(modelConfig.analysisModel)
  const storyboardModel = readString(modelConfig.storyboardModel)
  if (!analysisModel) throw new Error('EDIT_SCRIPT_STORYBOARD_ANALYSIS_MODEL_REQUIRED')
  if (!storyboardModel) throw new Error('EDIT_SCRIPT_STORYBOARD_MODEL_REQUIRED')
  return { analysisModel, storyboardModel }
}

function parseJson(value: string | null): unknown {
  if (!value) return {}
  try {
    return JSON.parse(value)
  } catch {
    throw new Error('EDIT_SCRIPT_STORYBOARD_PHOTOGRAPHY_PLAN_INVALID')
  }
}

function buildPhotographyPlan(input: {
  readonly stage: string
  readonly sourceSnapshot: StoryboardConsistencySourceSnapshot
  readonly modelConfigSnapshot: StoryboardConsistencyModelConfigSnapshot
  readonly strategyOutput?: unknown
  readonly cameraPlanOutput?: unknown
  readonly errorMessage?: string | null
}) {
  return {
    source: 'edit_script',
    sourceType: 'editScriptStoryboard',
    consistencyMode: 'grid_coordinates',
    currentStage: input.stage,
    sourceSnapshot: input.sourceSnapshot,
    modelConfigSnapshot: input.modelConfigSnapshot,
    strategyOutput: input.strategyOutput ?? null,
    cameraPlanOutput: input.cameraPlanOutput ?? null,
    errorMessage: input.errorMessage ?? null,
  }
}

function compactCameraPlanPanelForStorage(value: unknown): Record<string, unknown> | null {
  const panel = readRecord(value)
  const panelIndex = typeof panel.panelIndex === 'number' ? panel.panelIndex : null
  const sourceShotNumber = typeof panel.sourceShotNumber === 'number' ? panel.sourceShotNumber : null
  const sourceVideoBlockId = readString(panel.sourceVideoBlockId)
  if (panelIndex === null || sourceShotNumber === null || !sourceVideoBlockId) return null
  return {
    panelIndex,
    sourceShotNumber,
    sourceVideoBlockId,
    shotScale: readString(panel.shotScale),
    cameraPosition: readString(panel.cameraPosition),
    cameraHeight: readString(panel.cameraHeight),
    cameraAngle: readString(panel.cameraAngle),
    composition: readString(panel.composition),
    cameraMovement: readString(panel.cameraMovement),
    lensAndDepth: readString(panel.lensAndDepth),
    screenDirection: readString(panel.screenDirection),
    aestheticIntent: readString(panel.aestheticIntent),
    emotionalEffect: readString(panel.emotionalEffect),
    continuityNote: readString(panel.continuityNote),
  }
}

function compactCameraPlanOutputForStorage(value: unknown): Record<string, unknown> {
  const output = readRecord(value)
  const panels = Array.isArray(output.panels)
    ? output.panels.flatMap((panel) => {
        const compact = compactCameraPlanPanelForStorage(panel)
        return compact ? [compact] : []
      })
    : []
  return {
    strategy: 'camera_plan',
    panels,
  }
}

async function loadStoryboardWithArtifacts(storyboardId: string, projectId: string) {
  return await prisma.projectStoryboard.findFirst({
    where: {
      id: storyboardId,
      episode: {
        projectId,
      },
    },
    include: {
      blockingArtifacts: {
        orderBy: [
          { createdAt: 'asc' },
          { groupIndex: 'asc' },
        ],
      },
    },
  })
}

function assetsForArtifact(snapshot: StoryboardConsistencySourceSnapshot, artifact: BlockingArtifactRecord): StoryboardConsistencyAssetSnapshot[] {
  const metadata = readRecord(artifact.metadataJson)
  const locationTargetId = readString(metadata.locationTargetId)
  if (locationTargetId) {
    return snapshot.assets.filter((asset) => asset.kind === 'location' && asset.targetId === locationTargetId)
  }
  const sourceShotNumbers = readNumberArray(metadata.sourceShotNumbers)
  if (sourceShotNumbers.length > 0) {
    return snapshot.assets.filter((asset) => (
      asset.kind === 'location'
      && asset.shotNumbers.some((shotNumber) => sourceShotNumbers.includes(shotNumber))
    ))
  }
  const block = snapshot.videoBlocks.find((item) => item.sourceVideoBlockId === artifact.sourceVideoBlockId)
  if (!block) throw new Error(`EDIT_SCRIPT_STORYBOARD_ARTIFACT_BLOCK_MISSING:${artifact.id}`)
  return snapshot.assets.filter((asset) => (
    asset.kind === 'location'
    && asset.shotNumbers.some((shotNumber) => block.shotNumbers.includes(shotNumber))
  ))
}

async function referenceImagesForArtifact(
  snapshot: StoryboardConsistencySourceSnapshot,
  artifact: BlockingArtifactRecord,
  locale: TaskJobData['locale'],
): Promise<string[]> {
  const assets = assetsForArtifact(snapshot, artifact)
  if (assets.length === 0) throw new Error(`EDIT_SCRIPT_STORYBOARD_FLOOR_PLAN_LOCATION_REQUIRED:${artifact.id}`)
  const items: ReferenceImageItem[] = assets.map((asset): ReferenceImageItem => {
    if (!asset.previewImageUrl) {
      throw new Error(`EDIT_SCRIPT_STORYBOARD_ASSET_PREVIEW_REQUIRED:${asset.kind}:${asset.name}`)
    }
    const signed = toSignedUrlIfCos(asset.previewImageUrl, 3600)
    if (!signed) throw new Error(`EDIT_SCRIPT_STORYBOARD_ASSET_PREVIEW_INVALID:${asset.kind}:${asset.name}`)
    return {
      url: signed,
      role: 'location',
      name: asset.name,
    }
  })
  const normalized = await normalizeReferenceImageItemsForGeneration(items, {
    locale,
    context: { taskType: 'edit_script_storyboard_floor_plan_image', scope: 'edit-script.storyboard.floor-plan.refs' },
  })
  return normalized.referenceImages
}

function bufferFromDataUrl(source: string): Buffer {
  const marker = ';base64,'
  const markerIndex = source.indexOf(marker)
  if (!source.startsWith('data:') || markerIndex === -1) {
    throw new Error('EDIT_SCRIPT_STORYBOARD_REFERENCE_IMAGE_DATA_URL_REQUIRED')
  }
  return Buffer.from(source.slice(markerIndex + marker.length), 'base64')
}

async function readImageAspectRatio(source: string): Promise<string> {
  const metadata = await sharp(bufferFromDataUrl(source)).metadata()
  const width = metadata.width
  const height = metadata.height
  if (!width || !height) throw new Error('EDIT_SCRIPT_STORYBOARD_REFERENCE_IMAGE_DIMENSIONS_REQUIRED')
  return resolveAspectRatioFromDimensions(width, height)
}

function buildFloorPlanImagePrompt(params: {
  readonly prompt: string
  readonly aspectRatio: string
  readonly locale: TaskJobData['locale']
}): string {
  const ratioInstruction = params.locale === 'en'
    ? `The output canvas must keep the same aspect ratio as the scene reference image: ${params.aspectRatio}. This reference-image ratio is authoritative; ignore any conflicting aspect ratio, grid density, or canvas size in the earlier prompt. Do not pad, crop, letterbox, pillarbox, or convert it to the project video ratio.`
    : `输出画布必须保持场景参考图的原始比例：${params.aspectRatio}。这个参考图比例是唯一权威；如果前面的提示词里有冲突的画幅比例、网格密度或画布尺寸，一律忽略。不要补边、裁切、加黑边/白边，也不要改成项目视频比例。`
  return `${params.prompt.trim()}\n\n${ratioInstruction}`
}

async function persistArtifactImage(params: {
  readonly artifact: BlockingArtifactRecord
  readonly storageKey: string
}) {
  const media = await ensureMediaObjectFromStorageKey(params.storageKey, {
    mimeType: 'image/png',
  })
  await prisma.projectStoryboardBlockingArtifact.update({
    where: { id: params.artifact.id },
    data: {
      imageUrl: media.url,
      imageMediaId: media.id,
      candidateImages: JSON.stringify([media.url]),
      status: 'ready',
      errorMessage: null,
    },
  })
  return media
}

async function createGridOverlayArtifact(params: {
  readonly storyboardId: string
  readonly floorPlan: BlockingArtifactRecord
  readonly fullStorageKey: string
  readonly fullImageUrl: string
  readonly fullMediaId: string
}) {
  const buffer = await getObjectBuffer(params.fullStorageKey)
  const metadata = await sharp(buffer).metadata()
  const width = metadata.width
  const height = metadata.height
  if (!width || !height) throw new Error('EDIT_SCRIPT_STORYBOARD_FLOOR_PLAN_DIMENSIONS_REQUIRED')
  const grid = resolveGridDensityFromDimensions(width, height)
  const gridJson = {
    columns: grid.columns,
    rows: grid.rows,
    ratio: grid.ratio,
    shortSideUnits: grid.shortSideUnits,
  }
  const overlay = await sharp(buffer)
    .composite([{
      input: buildCoordinateGridOverlaySvgBuffer({
        width,
        height,
        columns: grid.columns,
        rows: grid.rows,
      }),
      top: 0,
      left: 0,
    }])
    .png()
    .toBuffer()
  const storageKey = await uploadObject(
    overlay,
    generateUniqueKey(`images/edit-script-storyboard-grid-overlay/${params.floorPlan.id}`, 'png'),
    1,
    'image/png',
  )
  const media = await ensureMediaObjectFromStorageKey(storageKey, {
    mimeType: 'image/png',
  })
  await prisma.projectStoryboardBlockingArtifact.update({
    where: { id: params.floorPlan.id },
    data: {
      metadataJson: {
        ...readRecord(params.floorPlan.metadataJson),
        grid: gridJson,
      } as Prisma.InputJsonValue,
    },
  })
  await prisma.projectStoryboardBlockingArtifact.upsert({
    where: { id: `${params.floorPlan.id}:overlay` },
    update: {
      imageUrl: media.url,
      imageMediaId: media.id,
      candidateImages: JSON.stringify([media.url]),
      metadataJson: {
        ...readRecord(params.floorPlan.metadataJson),
        sourceFloorPlanArtifactId: params.floorPlan.id,
        sourceFloorPlanImageUrl: params.fullImageUrl,
        sourceFloorPlanImageMediaId: params.fullMediaId,
        grid: gridJson,
      } as Prisma.InputJsonValue,
      status: 'ready',
      errorMessage: null,
    },
    create: {
      id: `${params.floorPlan.id}:overlay`,
      storyboardId: params.storyboardId,
      kind: 'grid_coordinate_overlay',
      sourceVideoBlockId: params.floorPlan.sourceVideoBlockId,
      groupIndex: params.floorPlan.groupIndex,
      imageUrl: media.url,
      imageMediaId: media.id,
      candidateImages: JSON.stringify([media.url]),
      metadataJson: {
        ...readRecord(params.floorPlan.metadataJson),
        sourceFloorPlanArtifactId: params.floorPlan.id,
        sourceFloorPlanImageUrl: params.fullImageUrl,
        sourceFloorPlanImageMediaId: params.fullMediaId,
        grid: gridJson,
      } as Prisma.InputJsonValue,
      status: 'ready',
      errorMessage: null,
    },
  })
}

async function persistGeneratedPanels(params: {
  readonly locale: TaskJobData['locale']
  readonly storyboardId: string
  readonly snapshot: StoryboardConsistencySourceSnapshot
  readonly generatedPanels: readonly StoryboardPanelPromptDraft[]
}) {
  const panels = await upsertStoryboardPanelsFromPrompts({
    storyboardId: params.storyboardId,
    snapshot: params.snapshot,
    generatedPanels: params.generatedPanels,
    locale: params.locale,
  })
  return panels
}

export async function handleEditScriptStoryboardPrepareTask(job: Job<TaskJobData>) {
  const parsed = parsePayload(job)
  await reportTaskProgress(job, 12, { stage: 'edit_script_storyboard_prepare' })
  let storyboardId: string | null = null
  try {
    const storyboard = await upsertEditScriptStoryboardShell({
      snapshot: parsed.sourceSnapshot,
      photographyPlan: buildPhotographyPlan({
        stage: 'preparing',
        sourceSnapshot: parsed.sourceSnapshot,
        modelConfigSnapshot: parsed.modelConfigSnapshot,
      }),
    })
    storyboardId = storyboard.id
    const strategyOutput = await generateGridFloorPlan({
      userId: job.data.userId,
      projectId: job.data.projectId,
      model: parsed.modelConfigSnapshot.analysisModel,
      locale: job.data.locale,
      snapshot: parsed.sourceSnapshot,
    })
    await prisma.$transaction(async (tx) => {
      await tx.projectStoryboardBlockingArtifact.deleteMany({ where: { storyboardId: storyboard.id } })
      const floorPlanRows = strategyOutput.floorPlans.map((plan) => ({
        storyboardId: storyboard.id,
        kind: 'grid_floor_plan',
        sourceVideoBlockId: plan.sourceVideoBlockIds[0],
        groupIndex: plan.groupIndex,
        prompt: plan.skipped ? null : plan.prompt,
        metadataJson: {
          classification: plan.classification,
          location: plan.location,
          participants: plan.participants,
          anchors: plan.anchors,
          skipped: plan.skipped,
          reason: plan.reason,
          sourceVideoBlockIds: plan.sourceVideoBlockIds,
          sourceShotNumbers: Array.from(new Set(parsed.sourceSnapshot.videoBlocks
            .filter((block) => plan.sourceVideoBlockIds.includes(block.sourceVideoBlockId))
            .flatMap((block) => block.shotNumbers))).sort((left, right) => left - right),
          locationTargetId: parsed.sourceSnapshot.assets.find((asset) => asset.kind === 'location' && asset.name === plan.location)?.targetId ?? null,
          locationRequirementId: parsed.sourceSnapshot.assets.find((asset) => asset.kind === 'location' && asset.name === plan.location)?.requirementId ?? null,
          grid: strategyOutput.grid,
        } as Prisma.InputJsonValue,
        status: plan.skipped ? 'ready' : 'pending',
      }))
      if (floorPlanRows.length > 0) {
        await tx.projectStoryboardBlockingArtifact.createMany({ data: floorPlanRows })
      }
      await tx.projectStoryboard.update({
        where: { id: storyboard.id },
        data: {
          photographyPlan: JSON.stringify(buildPhotographyPlan({
            stage: 'floor_plan_prompts_ready',
            sourceSnapshot: parsed.sourceSnapshot,
            modelConfigSnapshot: parsed.modelConfigSnapshot,
            strategyOutput,
          })),
        },
      })
    })
    const activeFloorPlanCount = strategyOutput.floorPlans.filter((plan) => !plan.skipped).length
    if (activeFloorPlanCount === 0) {
      await prisma.projectStoryboard.update({
        where: { id: storyboard.id },
        data: {
          photographyPlan: JSON.stringify(buildPhotographyPlan({
            stage: 'grid_analyze_ready',
            sourceSnapshot: parsed.sourceSnapshot,
            modelConfigSnapshot: parsed.modelConfigSnapshot,
            strategyOutput,
          })),
        },
      })
      return { storyboardId: storyboard.id, floorPlanCount: 0, nextTaskId: null }
    }
    const submitted = await submitTask({
      userId: job.data.userId,
      locale: job.data.locale,
      projectId: job.data.projectId,
      episodeId: job.data.episodeId,
      type: TASK_TYPE.EDIT_SCRIPT_STORYBOARD_FLOOR_PLAN_IMAGE,
      targetType: 'ProjectStoryboard',
      targetId: storyboard.id,
      operationId: 'edit_script_storyboard_floor_plan_image',
      operationSource: 'edit-script-storyboard-grid',
      requestId: job.data.trace?.requestId || null,
      payload: {
        editScriptId: parsed.editScriptId,
        storyboardId: storyboard.id,
        sourceSnapshot: parsed.sourceSnapshot,
        modelConfigSnapshot: parsed.modelConfigSnapshot,
        count: activeFloorPlanCount,
      },
      dedupeKey: `edit_script_storyboard_floor_plan_image:${storyboard.id}`,
    })
    return { storyboardId: storyboard.id, floorPlanCount: activeFloorPlanCount, nextTaskId: submitted.taskId }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (storyboardId) {
      await prisma.projectStoryboard.update({
        where: { id: storyboardId },
        data: {
          lastError: message,
          photographyPlan: JSON.stringify(buildPhotographyPlan({
            stage: 'failed',
            sourceSnapshot: parsed.sourceSnapshot,
            modelConfigSnapshot: parsed.modelConfigSnapshot,
            errorMessage: message,
          })),
        },
      }).catch(() => undefined)
    }
    throw error
  }
}

export async function handleEditScriptStoryboardFloorPlanImageTask(job: Job<TaskJobData>) {
  const payload = readRecord(job.data.payload)
  const storyboardId = readString(payload.storyboardId) || job.data.targetId
  if (!storyboardId) throw new Error('EDIT_SCRIPT_STORYBOARD_ID_REQUIRED')
  const storyboard = await loadStoryboardWithArtifacts(storyboardId, job.data.projectId)
  if (!storyboard) throw new Error('EDIT_SCRIPT_STORYBOARD_NOT_FOUND')
  const snapshot = parseSnapshotFromStoryboard(storyboard)
  const modelConfig = parseModelConfigFromStoryboard(storyboard)
  const floorPlans = storyboard.blockingArtifacts.filter((artifact) => (
    artifact.kind === 'grid_floor_plan'
    && readRecord(artifact.metadataJson).skipped !== true
  ))
  if (floorPlans.length === 0) throw new Error('EDIT_SCRIPT_STORYBOARD_FLOOR_PLAN_PROMPTS_REQUIRED')
  try {
    await runStoryboardConsistencyItemsInParallel(floorPlans, async (artifact, index) => {
      if (!artifact.prompt?.trim()) throw new Error(`EDIT_SCRIPT_STORYBOARD_FLOOR_PLAN_PROMPT_REQUIRED:${artifact.id}`)
      await reportTaskProgress(job, 10 + Math.floor(index / Math.max(floorPlans.length, 1) * 70), {
        stage: 'edit_script_storyboard_floor_plan',
        artifactId: artifact.id,
      })
      await prisma.projectStoryboardBlockingArtifact.update({
        where: { id: artifact.id },
        data: { status: 'generating', errorMessage: null },
      })
      const referenceImages = await referenceImagesForArtifact(snapshot, artifact, job.data.locale)
      const primaryReferenceImage = referenceImages[0]
      if (!primaryReferenceImage) throw new Error(`EDIT_SCRIPT_STORYBOARD_FLOOR_PLAN_REFERENCE_IMAGE_REQUIRED:${artifact.id}`)
      const sourceAspectRatio = await readImageAspectRatio(primaryReferenceImage)
      const source = await resolveImageSourceFromGeneration(job, {
        userId: job.data.userId,
        modelId: modelConfig.storyboardModel,
        prompt: buildFloorPlanImagePrompt({
          prompt: artifact.prompt,
          aspectRatio: sourceAspectRatio,
          locale: job.data.locale,
        }),
        options: {
          referenceImages,
          aspectRatio: sourceAspectRatio,
        },
        allowTaskExternalIdResume: false,
        pollProgress: { start: 20, end: 78 },
      })
      const fullStorageKey = await uploadImageSourceToCos(
        source,
        'edit-script-storyboard-floor-plan',
        artifact.id,
      )
      const fullMedia = await persistArtifactImage({ artifact, storageKey: fullStorageKey })
      await reportTaskProgress(job, 82, {
        stage: 'edit_script_storyboard_floor_plan_overlay',
        artifactId: artifact.id,
      })
      await createGridOverlayArtifact({
        storyboardId: storyboard.id,
        floorPlan: artifact,
        fullStorageKey,
        fullImageUrl: fullMedia.url,
        fullMediaId: fullMedia.id,
      })
    })
    await prisma.projectStoryboard.update({
      where: { id: storyboard.id },
      data: {
        photographyPlan: JSON.stringify({
          ...readRecord(parseJson(storyboard.photographyPlan)),
          currentStage: 'floor_plans_ready',
          errorMessage: null,
        }),
        lastError: null,
      },
    })
    const submitted = await submitTask({
      userId: job.data.userId,
      locale: job.data.locale,
      projectId: job.data.projectId,
      episodeId: job.data.episodeId,
      type: TASK_TYPE.EDIT_SCRIPT_STORYBOARD_GRID_ANALYZE,
      targetType: 'ProjectStoryboard',
      targetId: storyboard.id,
      operationId: 'edit_script_storyboard_grid_analyze',
      operationSource: 'edit-script-storyboard-grid',
      requestId: job.data.trace?.requestId || null,
      payload: {
        storyboardId: storyboard.id,
      },
      dedupeKey: `edit_script_storyboard_grid_analyze:${storyboard.id}`,
    })
    return { storyboardId: storyboard.id, floorPlanCount: floorPlans.length, nextTaskId: submitted.taskId }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await prisma.projectStoryboard.update({
      where: { id: storyboard.id },
      data: { lastError: message },
    }).catch(() => undefined)
    await prisma.projectStoryboardBlockingArtifact.updateMany({
      where: { storyboardId: storyboard.id, status: 'generating' },
      data: { status: 'failed', errorMessage: message },
    }).catch(() => undefined)
    throw error
  }
}

export async function handleEditScriptStoryboardGridAnalyzeTask(job: Job<TaskJobData>) {
  const payload = readRecord(job.data.payload)
  const storyboardId = readString(payload.storyboardId) || job.data.targetId
  if (!storyboardId) throw new Error('EDIT_SCRIPT_STORYBOARD_ID_REQUIRED')
  const storyboard = await loadStoryboardWithArtifacts(storyboardId, job.data.projectId)
  if (!storyboard) throw new Error('EDIT_SCRIPT_STORYBOARD_NOT_FOUND')
  const snapshot = parseSnapshotFromStoryboard(storyboard)
  const modelConfig = parseModelConfigFromStoryboard(storyboard)
  const overlays = storyboard.blockingArtifacts.filter((artifact) => (
    artifact.kind === 'grid_coordinate_overlay'
    && artifact.status === 'ready'
    && artifact.imageUrl
  ))
  if (overlays.length === 0) throw new Error('EDIT_SCRIPT_STORYBOARD_GRID_OVERLAY_REQUIRED')
  const overlayImageUrls = overlays.map((artifact) => {
    if (!artifact.imageUrl) throw new Error(`EDIT_SCRIPT_STORYBOARD_GRID_OVERLAY_URL_REQUIRED:${artifact.id}`)
    const signed = toSignedUrlIfCos(artifact.imageUrl, 3600)
    if (!signed) throw new Error(`EDIT_SCRIPT_STORYBOARD_GRID_OVERLAY_URL_INVALID:${artifact.id}`)
    return signed
  })
  await reportTaskProgress(job, 20, { stage: 'edit_script_storyboard_grid_analyze' })
  try {
    const generated = await analyzeGridCoordinates({
      userId: job.data.userId,
      projectId: job.data.projectId,
      model: modelConfig.analysisModel,
      locale: job.data.locale,
      snapshot,
      overlayImageUrls,
      floorPlanArtifacts: storyboard.blockingArtifacts.map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind,
        sourceVideoBlockId: artifact.sourceVideoBlockId,
        sourceVideoBlockIds: readStringArray(readRecord(artifact.metadataJson).sourceVideoBlockIds),
        groupIndex: artifact.groupIndex,
        imageUrl: artifact.imageUrl,
        metadataJson: artifact.metadataJson,
      })),
    })
    await prisma.projectStoryboard.update({
      where: { id: storyboard.id },
      data: {
        photographyPlan: JSON.stringify({
          ...readRecord(parseJson(storyboard.photographyPlan)),
          currentStage: 'grid_analyze_ready',
          strategyOutput: generated.strategyOutput,
          errorMessage: null,
        }),
        lastError: null,
      },
    })
    return { storyboardId: storyboard.id, nextTaskId: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await prisma.projectStoryboard.update({
      where: { id: storyboard.id },
      data: {
        lastError: message,
        photographyPlan: JSON.stringify({
          ...readRecord(parseJson(storyboard.photographyPlan)),
          currentStage: 'failed',
          errorMessage: message,
        }),
      },
    }).catch(() => undefined)
    throw error
  }
}

export async function handleEditScriptStoryboardCameraPlanTask(job: Job<TaskJobData>) {
  const payload = readRecord(job.data.payload)
  const storyboardId = readString(payload.storyboardId) || job.data.targetId
  if (!storyboardId) throw new Error('EDIT_SCRIPT_STORYBOARD_ID_REQUIRED')
  const storyboard = await loadStoryboardWithArtifacts(storyboardId, job.data.projectId)
  if (!storyboard) throw new Error('EDIT_SCRIPT_STORYBOARD_NOT_FOUND')
  const snapshot = parseSnapshotFromStoryboard(storyboard)
  const modelConfig = parseModelConfigFromStoryboard(storyboard)
  const plan = readRecord(parseJson(storyboard.photographyPlan))
  const strategyOutput = plan.strategyOutput
  if (!strategyOutput || typeof strategyOutput !== 'object' || Array.isArray(strategyOutput)) {
    throw new Error('EDIT_SCRIPT_STORYBOARD_COORDINATE_OUTPUT_REQUIRED')
  }
  await reportTaskProgress(job, 20, { stage: 'edit_script_storyboard_camera_plan' })
  try {
    const generated = await generateCameraPlan({
      userId: job.data.userId,
      projectId: job.data.projectId,
      model: modelConfig.analysisModel,
      locale: job.data.locale,
      snapshot,
      coordinateStrategyOutput: strategyOutput,
    })
    const panels = await persistGeneratedPanels({
      locale: job.data.locale,
      storyboardId: storyboard.id,
      snapshot,
      generatedPanels: generated.panels,
    })
    await prisma.projectStoryboard.update({
      where: { id: storyboard.id },
      data: {
        photographyPlan: JSON.stringify({
          ...plan,
          currentStage: 'panel_prompts_ready',
          cameraPlanOutput: compactCameraPlanOutputForStorage(generated.cameraPlanOutput),
          errorMessage: null,
        }),
        lastError: null,
      },
    })
    return { storyboardId: storyboard.id, panelCount: panels.length }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await prisma.projectStoryboard.update({
      where: { id: storyboard.id },
      data: {
        lastError: message,
        photographyPlan: JSON.stringify({
          ...plan,
          currentStage: 'failed',
          errorMessage: message,
        }),
      },
    }).catch(() => undefined)
    throw error
  }
}
