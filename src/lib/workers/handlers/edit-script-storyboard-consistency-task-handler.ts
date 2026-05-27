import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '../shared'
import { generateCameraPlan } from '@/lib/edit-script/storyboard-consistency/model-generation'
import {
  storyboardConsistencySourceSnapshotSchema,
  type StoryboardConsistencyModelConfigSnapshot,
  type StoryboardConsistencySourceSnapshot,
  type StoryboardPanelPromptDraft,
} from '@/lib/edit-script/storyboard-consistency/types'
import {
  upsertEditScriptStoryboardShell,
  upsertStoryboardPanelsFromPrompts,
} from '@/lib/edit-script/storyboard-consistency/persistence'

type StoryboardWithArtifacts = NonNullable<Awaited<ReturnType<typeof loadStoryboardWithArtifacts>>>

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
    consistencyMode: 'spatial_text_blocking',
    currentStage: input.stage,
    sourceSnapshot: input.sourceSnapshot,
    modelConfigSnapshot: input.modelConfigSnapshot,
    strategyOutput: input.strategyOutput ?? null,
    cameraPlanOutput: input.cameraPlanOutput ?? null,
    errorMessage: input.errorMessage ?? null,
  }
}

function buildSpatialProfileStrategyOutput(snapshot: StoryboardConsistencySourceSnapshot): Record<string, unknown> {
  const locations = snapshot.assets
    .filter((asset) => asset.kind === 'location')
    .map((asset) => {
      if (!asset.spatialProfile) {
        throw new Error(`LOCATION_SPATIAL_PROFILE_REQUIRED:${asset.name}`)
      }
      return {
        requirementId: asset.requirementId,
        targetId: asset.targetId,
        name: asset.name,
        description: asset.description,
        shotNumbers: asset.shotNumbers,
        spatialProfile: asset.spatialProfile,
      }
    })
  if (locations.length === 0) throw new Error('LOCATION_SPATIAL_PROFILE_REQUIRED')
  return {
    strategy: 'spatial_text_blocking',
    locations,
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
    shotBlocking: readRecord(panel.shotBlocking),
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
    strategy: 'spatial_text_blocking',
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
    const strategyOutput = buildSpatialProfileStrategyOutput(parsed.sourceSnapshot)
    await prisma.$transaction(async (tx) => {
      await tx.projectStoryboardBlockingArtifact.deleteMany({ where: { storyboardId: storyboard.id } })
      await tx.projectStoryboard.update({
        where: { id: storyboard.id },
        data: {
          photographyPlan: JSON.stringify(buildPhotographyPlan({
            stage: 'spatial_profile_ready',
            sourceSnapshot: parsed.sourceSnapshot,
            modelConfigSnapshot: parsed.modelConfigSnapshot,
            strategyOutput,
          })),
        },
      })
    })
    const submitted = await submitTask({
      userId: job.data.userId,
      locale: job.data.locale,
      projectId: job.data.projectId,
      episodeId: job.data.episodeId,
      type: TASK_TYPE.EDIT_SCRIPT_STORYBOARD_CAMERA_PLAN,
      targetType: 'ProjectStoryboard',
      targetId: storyboard.id,
      operationId: 'edit_script_storyboard_spatial_text_blocking',
      operationSource: 'edit-script-storyboard-spatial-profile',
      requestId: job.data.trace?.requestId || null,
      payload: {
        editScriptId: parsed.editScriptId,
        storyboardId: storyboard.id,
        sourceSnapshot: parsed.sourceSnapshot,
        modelConfigSnapshot: parsed.modelConfigSnapshot,
      },
      dedupeKey: `edit_script_storyboard_spatial_text_blocking:${storyboard.id}`,
    })
    return { storyboardId: storyboard.id, spatialProfileCount: parsed.sourceSnapshot.assets.filter((asset) => asset.kind === 'location').length, nextTaskId: submitted.taskId }
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
    throw new Error('LOCATION_SPATIAL_PROFILE_REQUIRED')
  }
  await reportTaskProgress(job, 20, { stage: 'edit_script_storyboard_camera_plan' })
  try {
    const generated = await generateCameraPlan({
      userId: job.data.userId,
      projectId: job.data.projectId,
      model: modelConfig.analysisModel,
      locale: job.data.locale,
      snapshot,
      spatialProfileStrategyOutput: strategyOutput,
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
