import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'
import { requireVideoModelMaxReferenceImages } from '@/lib/ai-registry/video-model-helpers'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { resolveProjectModelCapabilityGenerationOptions } from '@/lib/config-service'
import { EDIT_BIBLE_STATUS } from '@/lib/edit-bible/constraints'
import { calculateEditGenerationSegmentDuration } from '@/lib/edit-script/generation-segment-constraints'
import { normalizeEditScriptStructure, parsePersistedEditShotExecutionPlan } from '@/lib/edit-script/normalize'
import { editScriptStyleBibleSchema } from '@/lib/edit-script/types'
import { resolveEditScriptDialogueVoiceContext } from '@/lib/edit-script/voice-profiles'
import { hashCanonicalJson } from '@/lib/operation-plan-contract/canonical-json'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import {
  createPlannedTask,
  requirePlannedTaskBillingInfo,
  submitPlannedOperationTasks,
  type OperationPlan,
  type PlannedTask,
} from '@/lib/operations/planning'
import { requireOperationExecutionTransaction } from '@/lib/operations/planned-operation-invocation'
import { prisma } from '@/lib/prisma'
import { TASK_TYPE } from '@/lib/task/types'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { resolveSystemModelKey } from '@/lib/model-access/system-model-resolver'
import { buildVideoSegmentPrompt } from './prompt'
import {
  type VideoSegmentReferenceImage,
  type VideoSegmentTaskPayload,
  videoSegmentTaskPayloadSchema,
} from './types'

ensureAiCatalogsRegistered()

type UnknownObject = Record<string, unknown>

const plannedMetadataSchema = z.object({
  planTaskId: z.string().min(1),
  id: z.string().uuid(),
  projectId: z.string().min(1),
  episodeId: z.string().min(1),
  chapterId: z.string().min(1),
  editScriptId: z.string().min(1),
  segmentId: z.string().min(1),
  inputSignature: z.string().regex(/^[a-f0-9]{64}$/),
  durationSec: z.number().int().positive(),
}).strict()

export type PlannedVideoSegmentMetadata = z.infer<typeof plannedMetadataSchema>

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function resolveLocale(ctx: ProjectAgentOperationContext): 'en' | 'zh' {
  return ctx.context.locale === 'en' ? 'en' : 'zh'
}

function canonicalVideoSegmentId(editScriptId: string, segmentId: string): string {
  const hex = hashCanonicalJson({ kind: 'project_video_segment', editScriptId, segmentId }).slice(0, 32)
  const variant = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function parseStyleBible(value: unknown) {
  return editScriptStyleBibleSchema.parse({ styleBible: value }).styleBible
}

function readMetadata(plan: OperationPlan): PlannedVideoSegmentMetadata[] {
  const raw = plan.metadata?.videoSegments
  return z.array(plannedMetadataSchema).parse(raw ?? [])
}

function uniqueInOrder(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

type ReferenceCharacter = {
  readonly id: string
  readonly name: string
  readonly appearances: readonly {
    readonly imageMedia: { readonly id: string; readonly storageKey: string } | null
  }[]
}

type ReferenceLocation = {
  readonly id: string
  readonly name: string
  readonly selectedImage: {
    readonly imageMedia: { readonly id: string; readonly storageKey: string } | null
  } | null
}

function buildReferences(input: {
  readonly locationIds: readonly string[]
  readonly characterIds: readonly string[]
  readonly charactersById: ReadonlyMap<string, ReferenceCharacter>
  readonly locationsById: ReadonlyMap<string, ReferenceLocation>
}): VideoSegmentReferenceImage[] {
  const references: Omit<VideoSegmentReferenceImage, 'order'>[] = []
  for (const locationId of input.locationIds) {
    const location = input.locationsById.get(locationId)
    if (!location) throw new Error(`VIDEO_SEGMENT_LOCATION_NOT_FOUND:${locationId}`)
    const media = location.selectedImage?.imageMedia
    if (!media) throw new Error(`VIDEO_SEGMENT_LOCATION_REFERENCE_NOT_APPROVED:${locationId}`)
    references.push({
      kind: 'location',
      assetId: location.id,
      mediaId: media.id,
      name: location.name,
      source: media.storageKey,
    })
  }
  for (const characterId of input.characterIds) {
    const character = input.charactersById.get(characterId)
    if (!character) throw new Error(`VIDEO_SEGMENT_CHARACTER_NOT_FOUND:${characterId}`)
    const media = character.appearances[0]?.imageMedia
    if (!media) throw new Error(`VIDEO_SEGMENT_CHARACTER_REFERENCE_NOT_APPROVED:${characterId}`)
    references.push({
      kind: 'character',
      assetId: character.id,
      mediaId: media.id,
      name: character.name,
      source: media.storageKey,
    })
  }
  return references.map((reference, index) => ({ ...reference, order: index + 1 }))
}

async function buildGenerationOptions(input: {
  readonly projectId: string
  readonly userId: string
  readonly videoModel: string
  readonly durationSec: number
}): Promise<Record<string, string | number | boolean>> {
  const capabilities = resolveBuiltinCapabilitiesByModelKey('video', input.videoModel)?.video
  if (capabilities?.supportGenerateAudio !== true) {
    throw new Error(`VIDEO_SEGMENT_NATIVE_AUDIO_REQUIRED:${input.videoModel}`)
  }
  if (capabilities.assetReferenceMultiReference !== true) {
    throw new Error(`VIDEO_SEGMENT_FULL_REFERENCE_REQUIRED:${input.videoModel}`)
  }
  const options = await resolveProjectModelCapabilityGenerationOptions({
    projectId: input.projectId,
    userId: input.userId,
    modelType: 'video',
    modelKey: input.videoModel,
    runtimeSelections: {
      duration: input.durationSec,
      generationMode: 'normal',
      generateAudio: true,
    },
  })
  const normalized: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(options)) normalized[key] = value
  normalized.duration = input.durationSec
  normalized.generationMode = 'normal'
  normalized.generateAudio = true
  return normalized
}

export async function planGenerateVideoSegments(input: {
  readonly ctx: ProjectAgentOperationContext
  readonly operationId: 'generate_video_segments'
  readonly payload: UnknownObject
}): Promise<OperationPlan> {
  if (Object.prototype.hasOwnProperty.call(input.payload, 'videoModel')) {
    throw new Error('VIDEO_SEGMENT_MODEL_MANAGED_BY_PROJECT')
  }
  if (Object.prototype.hasOwnProperty.call(input.payload, 'generationOptions')) {
    throw new Error('VIDEO_SEGMENT_OPTIONS_MANAGED_BY_SYSTEM')
  }
  if (Object.prototype.hasOwnProperty.call(input.payload, 'generateAudio')) {
    throw new Error('VIDEO_SEGMENT_NATIVE_AUDIO_NOT_CONFIGURABLE')
  }
  const episodeId = normalizeString(input.payload.episodeId) || normalizeString(input.ctx.context.episodeId)
  const chapterId = normalizeString(input.payload.chapterId)
  if (!episodeId) throw new Error('VIDEO_SEGMENT_EPISODE_REQUIRED')

  const [project, bible, scripts, videoModel] = await Promise.all([
    prisma.project.findFirst({
      where: { id: input.ctx.projectId, userId: input.ctx.userId },
      select: { id: true, videoRatio: true },
    }),
    prisma.projectEditBible.findUnique({
      where: { episodeId },
      select: { bibleJson: true, styleBibleJson: true, status: true },
    }),
    prisma.projectEditScript.findMany({
      where: {
        projectId: input.ctx.projectId,
        episodeId,
        ...(chapterId ? { chapterId } : {}),
      },
      orderBy: { chapter: { chapterIndex: 'asc' } },
      select: {
        id: true,
        projectId: true,
        episodeId: true,
        chapterId: true,
        corePlanJson: true,
        assetReviewStatus: true,
        shotExecutionPlan: { select: { executionPlanJson: true, status: true } },
      },
    }),
    resolveSystemModelKey({
      userId: input.ctx.userId,
      projectId: input.ctx.projectId,
      purpose: 'video',
    }),
  ])
  if (!project) throw new Error('VIDEO_SEGMENT_PROJECT_NOT_FOUND')
  if (!bible || bible.status !== EDIT_BIBLE_STATUS.CONFIRMED) {
    throw new Error('VIDEO_SEGMENT_EDIT_BIBLE_NOT_READY')
  }
  if (scripts.length === 0) throw new Error('VIDEO_SEGMENT_EDIT_SCRIPT_REQUIRED')
  const styleBible = parseStyleBible(bible.styleBibleJson)

  const parsedScripts = scripts.map((script) => {
    if (script.assetReviewStatus !== 'approved') {
      throw new Error(`VIDEO_SEGMENT_ASSETS_NOT_APPROVED:${script.id}`)
    }
    if (!script.shotExecutionPlan || script.shotExecutionPlan.status !== 'ready') {
      throw new Error(`VIDEO_SEGMENT_EXECUTION_PLAN_NOT_READY:${script.id}`)
    }
    const core = normalizeEditScriptStructure(script.corePlanJson)
    const execution = parsePersistedEditShotExecutionPlan(
      script.shotExecutionPlan.executionPlanJson,
      core.shots,
      core.generationSegments,
    )
    return { script, core, execution }
  })

  const allShots = parsedScripts.flatMap(({ core }) => core.shots)
  const allCharacterIds = uniqueInOrder(allShots.flatMap((shot) => shot.characters.map((character) => character.characterId)))
  const allLocationIds = uniqueInOrder(allShots.map((shot) => shot.scene.locationId))
  const [characters, locations, existingSegments] = await Promise.all([
    prisma.projectCharacter.findMany({
      where: { projectId: input.ctx.projectId, id: { in: allCharacterIds } },
      select: {
        id: true,
        name: true,
        appearances: {
          orderBy: { appearanceIndex: 'asc' },
          take: 1,
          select: { imageMedia: { select: { id: true, storageKey: true } } },
        },
      },
    }),
    prisma.projectLocation.findMany({
      where: { projectId: input.ctx.projectId, id: { in: allLocationIds }, assetKind: 'location' },
      select: {
        id: true,
        name: true,
        selectedImage: { select: { imageMedia: { select: { id: true, storageKey: true } } } },
      },
    }),
    prisma.projectVideoSegment.findMany({
      where: { projectId: input.ctx.projectId, episodeId },
      select: {
        id: true,
        editScriptId: true,
        segmentId: true,
        inputSignature: true,
        status: true,
        videoMediaId: true,
      },
    }),
  ])
  const charactersById = new Map(characters.map((character) => [character.id, character]))
  const locationsById = new Map(locations.map((location) => [location.id, location]))
  const existingByIdentity = new Map(existingSegments.map((segment) => [`${segment.editScriptId}:${segment.segmentId}`, segment]))
  const maxReferenceImages = requireVideoModelMaxReferenceImages(videoModel)
  const tasks: PlannedTask[] = []
  const metadata: PlannedVideoSegmentMetadata[] = []

  for (const parsed of parsedScripts) {
    const voiceContext = resolveEditScriptDialogueVoiceContext({
      storyBibleJson: bible.bibleJson,
      shots: parsed.core.shots,
    })
    const shotsById = new Map(parsed.core.shots.map((shot) => [shot.shotId, shot]))
    const executionBySegmentId = new Map(parsed.execution.generationSegments.map((segment) => [segment.segmentId, segment]))
    for (const segment of parsed.core.generationSegments) {
      const shots = segment.shotIds.map((shotId) => {
        const shot = shotsById.get(shotId)
        if (!shot) throw new Error(`VIDEO_SEGMENT_SHOT_NOT_FOUND:${segment.segmentId}:${shotId}`)
        return shot
      })
      const execution = executionBySegmentId.get(segment.segmentId)
      if (!execution) throw new Error(`VIDEO_SEGMENT_EXECUTION_MISSING:${segment.segmentId}`)
      const references = buildReferences({
        locationIds: uniqueInOrder(shots.map((shot) => shot.scene.locationId)),
        characterIds: uniqueInOrder(shots.flatMap((shot) => shot.characters.map((character) => character.characterId))),
        charactersById,
        locationsById,
      })
      if (references.length > maxReferenceImages) {
        throw new Error(`VIDEO_SEGMENT_REFERENCE_IMAGE_LIMIT_EXCEEDED:${segment.segmentId}:${String(references.length)}:${String(maxReferenceImages)}`)
      }
      const durationSec = calculateEditGenerationSegmentDuration({ shots: parsed.core.shots, segment })
      const generationOptions = await buildGenerationOptions({
        projectId: input.ctx.projectId,
        userId: input.ctx.userId,
        videoModel,
        durationSec,
      })
      const prompt = buildVideoSegmentPrompt({
        visualStyle: styleBible.visualStyle,
        segment,
        execution,
        shots,
        references,
        voiceContext,
      })
      const inputSignature = hashCanonicalJson({
        protocol: 1,
        editScriptId: parsed.script.id,
        segment,
        shots,
        execution,
        visualStyle: styleBible.visualStyle,
        references,
        videoModel,
        generationOptions,
        aspectRatio: project.videoRatio,
        durationSec,
      })
      const existing = existingByIdentity.get(`${parsed.script.id}:${segment.segmentId}`)
      if (existing?.inputSignature === inputSignature && existing.status === 'completed') {
        if (!existing.videoMediaId) throw new Error(`VIDEO_SEGMENT_COMPLETED_MEDIA_MISSING:${existing.id}`)
        continue
      }
      if (
        existing
        && existing.inputSignature !== inputSignature
        && ['queued', 'processing', 'generating'].includes(existing.status)
      ) {
        throw new Error(`VIDEO_SEGMENT_REPLAN_IN_FLIGHT:${existing.id}`)
      }
      const id = existing?.id ?? canonicalVideoSegmentId(parsed.script.id, segment.segmentId)
      const taskPayload: VideoSegmentTaskPayload = videoSegmentTaskPayloadSchema.parse({
        episodeId,
        chapterId: parsed.script.chapterId,
        editScriptId: parsed.script.id,
        segmentId: segment.segmentId,
        inputSignature,
        durationSec,
        aspectRatio: project.videoRatio,
        prompt,
        referenceImages: references,
        videoModel,
        generationOptions,
      })
      const planTaskId = `${input.operationId}:${parsed.script.id}:${segment.segmentId}:${inputSignature.slice(0, 12)}`
      const payload = withTaskUiPayload(taskPayload, { hasOutputAtStart: Boolean(existing?.videoMediaId) })
      tasks.push(createPlannedTask({
        id: planTaskId,
        taskType: TASK_TYPE.VIDEO_SEGMENT,
        targetType: 'ProjectVideoSegment',
        targetId: id,
        payload,
        billingInfo: requirePlannedTaskBillingInfo({
          taskType: TASK_TYPE.VIDEO_SEGMENT,
          payload,
          allowedApiTypes: ['video'],
        }),
        locale: resolveLocale(input.ctx),
        episodeId,
        dedupeKey: `video_segment:${id}:${inputSignature}`,
      }))
      metadata.push({
        planTaskId,
        id,
        projectId: input.ctx.projectId,
        episodeId,
        chapterId: parsed.script.chapterId,
        editScriptId: parsed.script.id,
        segmentId: segment.segmentId,
        inputSignature,
        durationSec,
      })
    }
  }

  return {
    kind: 'task_submission',
    operationId: input.operationId,
    projectId: input.ctx.projectId,
    userId: input.ctx.userId,
    tasks,
    metadata: {
      episodeId,
      videoSegments: metadata,
      skippedCompletedCount: parsedScripts.reduce((count, parsed) => count + parsed.core.generationSegments.length, 0) - tasks.length,
    },
  }
}

async function prepareSegment(
  tx: Prisma.TransactionClient,
  metadata: PlannedVideoSegmentMetadata,
): Promise<void> {
  await tx.projectVideoSegment.upsert({
    where: {
      editScriptId_segmentId: {
        editScriptId: metadata.editScriptId,
        segmentId: metadata.segmentId,
      },
    },
    create: {
      id: metadata.id,
      projectId: metadata.projectId,
      episodeId: metadata.episodeId,
      chapterId: metadata.chapterId,
      editScriptId: metadata.editScriptId,
      segmentId: metadata.segmentId,
      inputSignature: metadata.inputSignature,
      durationSec: metadata.durationSec,
      status: 'queued',
    },
    update: {
      inputSignature: metadata.inputSignature,
      durationSec: metadata.durationSec,
      status: 'queued',
      generationTaskId: null,
      errorCode: null,
      errorMessage: null,
      videoMediaId: null,
    },
  })
}

export async function commitGenerateVideoSegments(input: {
  readonly ctx: ProjectAgentOperationContext
  readonly operationId: 'generate_video_segments'
  readonly plan: OperationPlan
}) {
  const tx = requireOperationExecutionTransaction(input.ctx)
  const metadata = readMetadata(input.plan)
  const metadataByTaskId = new Map(metadata.map((item) => [item.planTaskId, item]))
  for (const task of input.plan.tasks) {
    const item = metadataByTaskId.get(task.id)
    if (!item) throw new Error(`VIDEO_SEGMENT_PLAN_METADATA_MISSING:${task.id}`)
    await prepareSegment(tx, item)
  }
  const submitted = await submitPlannedOperationTasks({ ctx: input.ctx, operationId: input.operationId })
  const results = []
  for (const task of input.plan.tasks) {
    const item = metadataByTaskId.get(task.id)
    const result = submitted.get(task.id)
    if (!item || !result) throw new Error(`VIDEO_SEGMENT_TASK_SUBMISSION_MISSING:${task.id}`)
    await tx.projectVideoSegment.update({
      where: { id: item.id },
      data: { generationTaskId: result.taskId, status: result.status },
    })
    results.push({
      refId: item.segmentId,
      taskId: result.taskId,
      taskType: TASK_TYPE.VIDEO_SEGMENT,
      targetType: 'ProjectVideoSegment' as const,
      targetId: item.id,
      billingReceipt: result.billingReceiptView,
    })
  }
  return {
    success: true,
    async: true,
    total: results.length,
    taskIds: results.map((result) => result.taskId),
    results,
    skippedCompletedCount: Number(input.plan.metadata?.skippedCompletedCount ?? 0),
  }
}
