import path from 'node:path'
import { z } from 'zod'
import {
  getProjectModelConfig,
  resolveProjectModelCapabilityGenerationOptions,
} from '@/lib/config-service'
import { AiOptionValidationError } from '@/lib/ai-exec/normalize'
import {
  preflightMediaGenerationOptions,
  preflightMediaProviderRoutes,
} from '@/lib/ai-exec/media-preflight'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'
import { supportsTextToVideoModel } from '@/lib/ai-registry/video-model-helpers'
import type { CapabilityValue } from '@/lib/ai-registry/types'
import { ApiError } from '@/lib/api-errors'
import type {
  WorkspaceResourceInputRef,
  WorkspaceResourceJsonValue,
  WorkspaceResourceMediaType,
} from '@/lib/workspace-resource/contracts'
import {
  workspaceResourceGenerationOptionsSchema,
  workspaceResourceInputRefSchema,
  parseWorkspaceResourceGenerationRetrySource,
  parseWorkspaceResourceGenerationTaskPayload,
  type WorkspaceResourceGenerationTaskPayload,
} from '@/lib/workspace-resource/generation-contract'
import {
  productionManifestSchema,
  submitProductionManifestInputSchema,
  type ProductionManifest,
  type ProductionManifestItem,
} from '@/lib/workspace-resource/production-manifest'
import { buildWorkspaceResourceId } from '@/lib/workspace-resource/identity'
import { resourceNameFromPath } from '@/lib/workspace-resource/path'
import {
  materializeWorkspaceResourceInTransaction,
  reserveWorkspaceResourceInTransaction,
  resolveWorkspaceResourceInputs,
  validateWorkspaceResourcePlacement,
} from '@/lib/workspace-resource/persistence'
import {
  WORKSPACE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA,
  WORKSPACE_RESOURCE_SCHEMA,
  requireWorkspaceResourceSchema,
} from '@/lib/workspace-resource/schema-registry'
import { buildWorkspaceResourceLifecycleProjection } from '@/lib/workspace-resource/task-runtime-envelope'
import { readWorkspaceResource } from '@/lib/workspace-resource/view-service'
import { defineOperation } from '@/lib/operations/define-operation'
import { resolveOperationLocale } from '@/lib/operations/environment-input'
import {
  PROJECT_VIDEO_RATIO_METADATA_KEY,
  projectVideoRatioSnapshotSchema,
  requireProjectVideoRatio,
} from '@/lib/operations/project-video-ratio-policy'
import {
  createPlannedTask,
  requirePlannedTaskBillingInfo,
  submitPlannedOperationTasks,
  type OperationPlan,
  type PlannedTask,
} from '@/lib/operations/planning'
import type {
  ProjectAgentOperationContext,
  ProjectAgentOperationRegistryDraft,
} from '@/lib/operations/types'
import { prisma } from '@/lib/prisma'
import { stableArgsFingerprint, stableArgsHash } from '@/lib/project-agent/stable-args-hash'
import { TASK_TYPE, type TaskType } from '@/lib/task/types'
import { OPERATION_EXECUTION_MAX_TASKS } from '@/lib/temporal/operation-execution/contracts'
import { resolveSystemModelKey } from '@/lib/model-access/system-model-resolver'
import { CREATIVE_VIDEO_SEGMENT_DURATION_CEILING_SECONDS } from '@/lib/workspace-resource/generation-contract'
import { AppError } from '@/lib/errors/app-error'
import { describeUnknownError } from '@/lib/errors/normalize'

const MAX_ALTERNATIVES = 6
const MAX_MANIFEST_ITEMS = OPERATION_EXECUTION_MAX_TASKS
const MEDIA_GENERATION_PLAN_CONTRACT_REVISION = 'workspace-resource-production/v1'
const DIRECT_IMAGE_SCHEMA_IDS = [
  WORKSPACE_RESOURCE_SCHEMA.GENERIC_IMAGE,
  WORKSPACE_RESOURCE_SCHEMA.STYLE,
] as const

const workspaceResourceJsonValueSchema: z.ZodType<WorkspaceResourceJsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(workspaceResourceJsonValueSchema),
  z.record(z.string(), workspaceResourceJsonValueSchema),
]))

const generationReferenceSchema = workspaceResourceInputRefSchema.extend({
  resourceId: workspaceResourceInputRefSchema.shape.resourceId
    .describe('Exact Resource identity copied from a ready .resource pointer.'),
  contentVersion: workspaceResourceInputRefSchema.shape.contentVersion
    .describe('Exact positive contentVersion copied from that ready pointer.'),
  workspacePath: workspaceResourceInputRefSchema.shape.workspacePath
    .describe('Current project-relative path of the same Resource pointer.'),
  role: workspaceResourceInputRefSchema.shape.role
    .describe('Semantic use. For a supported video frame pair use exactly first_frame or last_frame.'),
  position: workspaceResourceInputRefSchema.shape.position
    .describe('Unique zero-based input order across this item.'),
  channel: z.enum(['context', 'image', 'audio', 'video']),
}).strict()

const resourceOutputPathSchema = z.string().trim().min(1).max(512)
  .regex(/\.resource$/u, 'Media outputPath must end in .resource.')
  .describe('Complete project-relative output path ending in .resource; create its parent directory first.')

const baseMediaItemShape = {
  outputPath: resourceOutputPathSchema,
  prompt: z.string().trim().min(1).max(100_000)
    .describe('Complete final provider-ready creative prompt. The server validates and freezes it verbatim.'),
} as const

const imageNewMediaRequestSchema = z.object({
  kind: z.literal('new'),
  ...baseMediaItemShape,
  schemaId: z.enum(DIRECT_IMAGE_SCHEMA_IDS)
    .describe('Direct Canvas/API image generation is limited to generic images and style references. Reusable assets use a production manifest.'),
  references: z.array(generationReferenceSchema.extend({
    channel: z.enum(['context', 'image']),
  }).strict()).max(16).optional(),
  count: z.number().int().min(1).max(MAX_ALTERNATIVES).default(1),
}).strict()

const audioNewMediaRequestSchema = z.object({
  kind: z.literal('new'),
  ...baseMediaItemShape,
  schemaId: z.enum(WORKSPACE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA.audio)
    .describe('Generated music uses project.bgm_audio.'),
  references: z.array(generationReferenceSchema.extend({
    channel: z.enum(['context', 'video']),
  }).strict()).max(16).optional(),
  count: z.number().int().min(1).max(MAX_ALTERNATIVES).default(1),
  durationSeconds: z.number().int().min(1).max(600),
  vocalMode: z.enum(['instrumental', 'vocal']).default('instrumental'),
  genre: z.string().trim().min(1).max(200).optional(),
  mood: z.string().trim().min(1).max(200).optional(),
  bpm: z.number().int().min(20).max(300).optional(),
}).strict()

const videoNewMediaRequestSchema = z.object({
  kind: z.literal('new'),
  ...baseMediaItemShape,
  schemaId: z.enum(WORKSPACE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA.video)
    .describe('Choose the Resource semantic that matches the produced video; project.video_segment is the normal generated shot type.'),
  references: z.array(generationReferenceSchema.extend({
    channel: z.enum(['context', 'image', 'audio']),
  }).strict()).max(16).optional(),
  count: z.number().int().min(1).max(MAX_ALTERNATIVES).default(1),
  durationSeconds: z.number().int().min(1).max(CREATIVE_VIDEO_SEGMENT_DURATION_CEILING_SECONDS),
}).strict()

const retryMediaRequestSchema = z.object({
  kind: z.literal('retry'),
  resourceIds: z.array(z.string().trim().min(1).max(32)).min(1).max(MAX_MANIFEST_ITEMS),
}).strict()

function requireUniqueRetryResourceIds(
  value: { request: { kind: 'new' } | { kind: 'retry'; resourceIds: string[] } },
  context: z.RefinementCtx,
): void {
  if (value.request.kind === 'retry'
    && new Set(value.request.resourceIds).size !== value.request.resourceIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['request', 'resourceIds'],
      message: 'resourceIds must be unique',
    })
  }
}

function addDuplicateReferencePositionIssue(
  references: readonly { readonly position: number }[] | undefined,
  path: Array<string | number>,
  context: z.RefinementCtx,
): void {
  if (!references || new Set(references.map((reference) => reference.position)).size === references.length) return
  context.addIssue({
    code: z.ZodIssueCode.custom,
    path,
    message: 'Reference positions must be unique.',
  })
}

function validateMediaRequestReferences(
  value: { request: { kind: 'new'; references?: readonly { readonly position: number }[] } | { kind: 'retry'; resourceIds: string[] } },
  context: z.RefinementCtx,
): void {
  requireUniqueRetryResourceIds(value, context)
  if (value.request.kind === 'new') {
    addDuplicateReferencePositionIssue(value.request.references, ['request', 'references'], context)
  }
}

const imageMediaRequestSchema = z.object({
  request: z.discriminatedUnion('kind', [imageNewMediaRequestSchema, retryMediaRequestSchema]),
}).strict().superRefine(validateMediaRequestReferences)
const audioMediaRequestSchema = z.object({
  request: z.discriminatedUnion('kind', [audioNewMediaRequestSchema, retryMediaRequestSchema]),
}).strict().superRefine(validateMediaRequestReferences)
const videoMediaRequestSchema = z.object({
  request: z.discriminatedUnion('kind', [videoNewMediaRequestSchema, retryMediaRequestSchema]),
}).strict().superRefine(validateMediaRequestReferences)

const rerunFailedItemsInputSchema = z.object({
  resourceIds: z.array(z.string().trim().min(1).max(32)).min(1).max(MAX_MANIFEST_ITEMS),
  maxBudgetCredits: z.number().finite().positive().optional(),
}).strict().superRefine((value, context) => {
  if (new Set(value.resourceIds).size !== value.resourceIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['resourceIds'], message: 'resourceIds must be unique' })
  }
})

const textInputSchema = z.object({
  outputPath: z.string().trim().min(1).max(512),
  schemaId: z.enum(WORKSPACE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA.text).default(WORKSPACE_RESOURCE_SCHEMA.GENERIC_TEXT),
  prompt: z.string().trim().min(1).max(100_000).nullable().optional(),
  content: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('text'), text: z.string().max(4 * 1024 * 1024) }).strict(),
    z.object({ kind: z.literal('structured'), data: workspaceResourceJsonValueSchema }).strict(),
  ]),
  references: z.array(generationReferenceSchema).max(16).optional(),
}).strict()

const textOutputSchema = z.object({
  success: z.literal(true),
  resourceId: z.string().min(1),
  contentVersion: z.number().int().positive(),
  workspacePath: z.string().min(1),
}).strict()

const mediaOutputSchema = z.object({
  success: z.literal(true),
  async: z.literal(true),
  taskId: z.string().min(1),
  taskIds: z.array(z.string().min(1)).min(1),
  resources: z.array(z.object({
    resourceId: z.string().min(1),
    workspacePath: z.string().min(1),
    memberIndex: z.number().int().nonnegative(),
  }).strict()).min(1),
}).passthrough()

type NewMediaRequest =
  | z.infer<typeof imageNewMediaRequestSchema>
  | z.infer<typeof audioNewMediaRequestSchema>
  | z.infer<typeof videoNewMediaRequestSchema>
type ManifestItem = ProductionManifestItem

type FrozenProductionManifestSource = {
  readonly resourceId: string
  readonly contentVersion: number
  readonly workspacePath: string
  readonly sha256: string
  readonly manifestId: string
}

type PlannedResource = {
  readonly resourceId: string
  readonly workspacePath: string
  readonly mediaType: Exclude<WorkspaceResourceMediaType, 'text'>
  readonly schemaId: string
  readonly memberIndex: number
  readonly taskPlanId: string
  readonly alternatives: boolean
}

const productionPlanMetadataSchema = z.object({
  requestId: z.string().min(1),
  retry: z.boolean(),
  resources: z.array(z.object({
    resourceId: z.string().min(1),
    workspacePath: z.string().min(1),
    mediaType: z.enum(['image', 'audio', 'video']),
    schemaId: z.string().min(1),
    memberIndex: z.number().int().nonnegative(),
    taskPlanId: z.string().min(1),
    alternatives: z.boolean(),
  }).strict()).min(1),
  [PROJECT_VIDEO_RATIO_METADATA_KEY]: projectVideoRatioSnapshotSchema.optional(),
}).strict()

const MEDIA_EFFECTS = {
  writes: true,
  workspaceResourceImpact: 'none',
  billable: true,
  destructive: false,
  overwrite: false,
  bulk: true,
  externalSideEffects: true,
  longRunning: true,
} as const

function schemaForMedia(mediaType: PlannedResource['mediaType'], schemaId: string): string {
  const resolved = schemaId.trim()
  if (!resolved) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'WORKSPACE_RESOURCE_GENERATION_SCHEMA_REQUIRED',
      field: 'schemaId',
      mediaType,
    })
  }
  const schema = requireWorkspaceResourceSchema(resolved)
  if (schema.mediaType !== mediaType || !WORKSPACE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA[mediaType].includes(schema.schemaId)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'WORKSPACE_RESOURCE_GENERATION_SCHEMA_INVALID',
      field: 'schemaId',
      mediaType,
    })
  }
  return resolved
}

async function modelForMedia(
  ctx: ProjectAgentOperationContext,
  mediaType: PlannedResource['mediaType'],
  assetKind: 'character' | 'location' | 'prop' | null,
): Promise<string> {
  return await resolveSystemModelKey({
    userId: ctx.userId,
    projectId: ctx.projectId,
    purpose: mediaType === 'video'
      ? 'video'
      : mediaType === 'audio'
        ? 'music'
        : assetKind === 'character'
          ? 'character-image'
          : assetKind === 'location'
            ? 'location-image'
            : 'edit-image',
  })
}

function alternativePath(outputPath: string, memberIndex: number): string {
  if (memberIndex === 0) return outputPath
  const extension = path.posix.extname(outputPath)
  const stem = outputPath.slice(0, -extension.length)
  return `${stem}-${String(memberIndex + 1)}${extension}`
}

function providerPositions(
  references: readonly z.infer<typeof generationReferenceSchema>[],
  channel: 'image' | 'audio' | 'video',
): number[] {
  return references.filter((reference) => reference.channel === channel).map((reference) => reference.position)
}

function providerPlaceholderUrls(count: number, mediaType: 'image' | 'audio' | 'video'): string[] {
  return Array.from({ length: count }, (_, index) => (
    `https://preflight.invalid/${mediaType}/${String(index + 1)}`
  ))
}

function providerTransportPreflightOptions(input: {
  readonly mediaType: PlannedResource['mediaType']
  readonly options: Readonly<Record<string, unknown>>
  readonly imageCount: number
  readonly audioCount: number
  readonly videoCount: number
  readonly usesLastFrame: boolean
  readonly durationSeconds: number | null
}): Record<string, unknown> {
  return {
    ...input.options,
    ...(input.mediaType === 'image' && input.imageCount > 0
      ? { referenceImages: providerPlaceholderUrls(input.imageCount, 'image') }
      : {}),
    ...(input.mediaType === 'video' && input.imageCount > 1 && !input.usesLastFrame
      ? { referenceImages: providerPlaceholderUrls(input.imageCount, 'image') }
      : {}),
    ...(input.mediaType === 'video' && input.usesLastFrame
      ? { lastFrameImageUrl: providerPlaceholderUrls(1, 'image')[0] }
      : {}),
    ...(input.mediaType === 'video' && input.audioCount > 0
      ? { referenceAudios: providerPlaceholderUrls(input.audioCount, 'audio') }
      : {}),
    ...(input.mediaType === 'audio' && input.videoCount > 0
      ? {
          referenceVideoUrl: providerPlaceholderUrls(1, 'video')[0],
          referenceVideoDurationMs: Math.round((input.durationSeconds ?? 1) * 1000),
        }
      : {}),
  }
}

function frozenScalarOptions(value: Record<string, unknown> | undefined): Record<string, string | number | boolean | null> {
  const result: Record<string, string | number | boolean | null> = {}
  for (const [key, option] of Object.entries(value ?? {})) {
    if (
      typeof option === 'string'
      || typeof option === 'number'
      || typeof option === 'boolean'
      || option === null
    ) {
      result[key] = option
    }
  }
  return result
}

function throwMediaPreflightError(error: unknown, mediaType: PlannedResource['mediaType']): never {
  if (error instanceof ApiError || error instanceof AppError) throw error
  if (error instanceof AiOptionValidationError) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MEDIA_GENERATION_OPTION_INVALID',
      field: error.field ?? 'generation',
      reason: error.reason ?? error.failure,
      mediaType,
    })
  }
  throw new ApiError('INVALID_PARAMS', {
    code: 'MEDIA_GENERATION_PREFLIGHT_FAILED',
    field: mediaType,
    reason: describeUnknownError(error),
  })
}

function validateReferenceCapabilities(input: {
  readonly mediaType: PlannedResource['mediaType']
  readonly modelKey: string
  readonly references: readonly z.infer<typeof generationReferenceSchema>[]
}): void {
  const imageReferences = input.references.filter((reference) => reference.channel === 'image')
  const audioReferences = input.references.filter((reference) => reference.channel === 'audio')
  const videoReferences = input.references.filter((reference) => reference.channel === 'video')

  if (input.mediaType === 'video') {
    const capabilities = resolveBuiltinCapabilitiesByModelKey('video', input.modelKey)?.video
    const firstFrames = imageReferences.filter((reference) => reference.role === 'first_frame')
    const lastFrames = imageReferences.filter((reference) => reference.role === 'last_frame')
    const ordinaryImages = imageReferences.filter((reference) => reference.role !== 'first_frame' && reference.role !== 'last_frame')
    const usesFramePair = firstFrames.length > 0 || lastFrames.length > 0
    if (
      usesFramePair
      && (
        firstFrames.length !== 1
        || lastFrames.length !== 1
        || ordinaryImages.length > 0
        || capabilities?.firstlastframe !== true
      )
    ) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'VIDEO_MODEL_FIRST_LAST_FRAME_INVALID',
        field: 'references',
      })
    }
    const maxImages = usesFramePair ? 2 : capabilities?.maxReferenceImages ?? 1
    if (imageReferences.length > maxImages) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'VIDEO_MODEL_REFERENCE_LIMIT_EXCEEDED',
        field: 'references',
        limit: maxImages,
      })
    }
    const maxAudios = capabilities?.maxReferenceAudios ?? 0
    if (audioReferences.length > maxAudios) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'VIDEO_MODEL_AUDIO_REFERENCE_LIMIT_EXCEEDED',
        field: 'references',
        limit: maxAudios,
      })
    }
    if (imageReferences.length === 0 && !supportsTextToVideoModel(input.modelKey)) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'VIDEO_MODEL_TEXT_TO_VIDEO_UNSUPPORTED',
        field: 'references',
      })
    }
    if (audioReferences.length > 0 && imageReferences.length === 0) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'VIDEO_MODEL_REFERENCE_AUDIO_REQUIRES_IMAGE',
        field: 'references',
      })
    }
    if (audioReferences.length > 0 && usesFramePair) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'VIDEO_MODEL_REFERENCE_AUDIO_FRAME_ROLE_CONFLICT',
        field: 'references',
      })
    }
  }

  if (input.mediaType === 'audio') {
    const maxVideos = resolveBuiltinCapabilitiesByModelKey('music', input.modelKey)?.music?.maxReferenceVideos ?? 0
    if (videoReferences.length > maxVideos) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'MUSIC_MODEL_VIDEO_REFERENCE_LIMIT_EXCEEDED',
        field: 'references',
        limit: maxVideos,
      })
    }
  }
}

async function compileMediaExecution(input: {
  readonly ctx: ProjectAgentOperationContext
  readonly item: ManifestItem
  readonly schemaId: string
  readonly modelKey: string
  readonly references: readonly z.infer<typeof generationReferenceSchema>[]
}): Promise<{
  readonly prompt: string
  readonly generationOptions: Record<string, string | number | boolean | null>
}> {
  const { item, modelKey } = input
  const aspectRatio = item.mediaType === 'audio' ? null : item.aspectRatio
  const prompt = item.prompt

  try {
    let requested: Record<string, CapabilityValue>
    if (item.mediaType === 'image') {
      const configured = await resolveProjectModelCapabilityGenerationOptions({
        projectId: input.ctx.projectId,
        userId: input.ctx.userId,
        modelType: 'image',
        modelKey,
      })
      requested = {
        ...configured,
        ...(aspectRatio ? { aspectRatio } : {}),
      }
    } else if (item.mediaType === 'video') {
      const generationMode = input.references.some((reference) => reference.role === 'last_frame')
        ? 'firstlastframe'
        : 'normal'
      const configured = await resolveProjectModelCapabilityGenerationOptions({
        projectId: input.ctx.projectId,
        userId: input.ctx.userId,
        modelType: 'video',
        modelKey,
        runtimeSelections: {
          duration: item.durationSeconds,
          generationMode,
        },
      })
      requested = {
        ...configured,
        duration: item.durationSeconds,
        generationMode,
        ...(aspectRatio ? { aspectRatio } : {}),
      }
    } else {
      const config = await getProjectModelConfig(input.ctx.projectId, input.ctx.userId)
      requested = {
        ...(config.capabilityDefaults[modelKey] ?? {}),
        ...(config.capabilityOverrides[modelKey] ?? {}),
        durationSeconds: item.durationSeconds,
        vocalMode: item.vocalMode,
        ...(item.genre ? { genre: item.genre } : {}),
        ...(item.mood ? { mood: item.mood } : {}),
        ...(item.bpm ? { bpm: item.bpm } : {}),
      }
    }

    const imageCount = input.references.filter((reference) => reference.channel === 'image').length
    const audioCount = input.references.filter((reference) => reference.channel === 'audio').length
    const videoCount = input.references.filter((reference) => reference.channel === 'video').length
    const usesLastFrame = item.mediaType === 'video'
      && input.references.some((reference) => reference.role === 'last_frame')
    const durationSeconds = 'durationSeconds' in item ? item.durationSeconds : null
    const preflightOptions = providerTransportPreflightOptions({
      mediaType: item.mediaType,
      options: requested,
      imageCount,
      audioCount,
      videoCount,
      usesLastFrame,
      durationSeconds,
    })
    const preflight = await preflightMediaGenerationOptions({
      userId: input.ctx.userId,
      modelKey,
      modality: item.mediaType === 'audio' ? 'music' : item.mediaType,
      options: preflightOptions,
      prompt,
    })
    const frozenExecutionOptions = providerTransportPreflightOptions({
      mediaType: item.mediaType,
      options: frozenScalarOptions(preflight.options),
      imageCount,
      audioCount,
      videoCount,
      usesLastFrame,
      durationSeconds,
    })
    preflightMediaProviderRoutes({
      selection: preflight.selection,
      modality: item.mediaType === 'audio' ? 'music' : item.mediaType,
      options: frozenExecutionOptions,
      prompt,
    })
    return {
      prompt,
      generationOptions: frozenScalarOptions(preflight.options),
    }
  } catch (error) {
    throwMediaPreflightError(error, item.mediaType)
  }
}

async function preflightFrozenRetry(input: {
  readonly ctx: ProjectAgentOperationContext
  readonly mediaType: PlannedResource['mediaType']
  readonly modelKey: string
  readonly prompt: string
  readonly source: ReturnType<typeof parseWorkspaceResourceGenerationRetrySource>
  readonly generationOptions: z.infer<typeof workspaceResourceGenerationOptionsSchema>
}): Promise<void> {
  const imagePositions = new Set(input.source.resource.imageInputPositions)
  const audioPositions = new Set(input.source.resource.audioInputPositions)
  const videoPositions = new Set(input.source.resource.videoInputPositions)
  const references: Array<z.infer<typeof generationReferenceSchema>> = input.source.resource.inputs.map((reference) => ({
    ...reference,
    channel: imagePositions.has(reference.position)
      ? 'image'
      : audioPositions.has(reference.position)
        ? 'audio'
        : videoPositions.has(reference.position)
          ? 'video'
          : 'context',
  }))
  validateReferenceCapabilities({
    mediaType: input.mediaType,
    modelKey: input.modelKey,
    references,
  })
  const inputByPosition = new Map(
    input.source.resource.inputs.map((reference) => [reference.position, reference]),
  )
  const imageReferences = input.source.resource.imageInputPositions.map((position) => (
    inputByPosition.get(position)
  ))
  const usesLastFrame = imageReferences.some((reference) => reference?.role === 'last_frame')
  const options = providerTransportPreflightOptions({
    mediaType: input.mediaType,
    options: input.generationOptions,
    imageCount: input.source.resource.imageInputPositions.length,
    audioCount: input.source.resource.audioInputPositions.length,
    videoCount: input.source.resource.videoInputPositions.length,
    usesLastFrame,
    durationSeconds: input.source.durationSeconds ?? null,
  })
  try {
    const preflight = await preflightMediaGenerationOptions({
      userId: input.ctx.userId,
      modelKey: input.modelKey,
      modality: input.mediaType === 'audio' ? 'music' : input.mediaType,
      options,
      prompt: input.prompt,
    })
    preflightMediaProviderRoutes({
      selection: preflight.selection,
      modality: input.mediaType === 'audio' ? 'music' : input.mediaType,
      options,
      prompt: input.prompt,
    })
  } catch (error) {
    throwMediaPreflightError(error, input.mediaType)
  }
}

function taskTypeForMedia(mediaType: PlannedResource['mediaType']): TaskType {
  if (mediaType === 'image') return TASK_TYPE.WORKSPACE_RESOURCE_IMAGE
  if (mediaType === 'audio') return TASK_TYPE.WORKSPACE_RESOURCE_AUDIO
  return TASK_TYPE.WORKSPACE_RESOURCE_VIDEO
}

function modelPayload(mediaType: PlannedResource['mediaType'], modelKey: string): Record<string, string> {
  if (mediaType === 'image') return { imageModel: modelKey }
  if (mediaType === 'audio') return { musicModel: modelKey }
  return { videoModel: modelKey }
}

function generationInputFingerprint(input: {
  readonly mediaType: PlannedResource['mediaType']
  readonly schemaId: string
  readonly modelKey: string
  readonly prompt: string
  readonly references: readonly WorkspaceResourceInputRef[]
  readonly generationOptions: z.infer<typeof workspaceResourceGenerationOptionsSchema>
  readonly durationSeconds: number | null
}): string {
  return stableArgsFingerprint(input)
}

async function freezeReferences(
  ctx: ProjectAgentOperationContext,
  references: readonly z.infer<typeof generationReferenceSchema>[],
): Promise<readonly WorkspaceResourceInputRef[]> {
  const frozen = await resolveWorkspaceResourceInputs(prisma, {
    userId: ctx.userId,
    projectId: ctx.projectId,
    references: references.map((reference) => ({
      resourceId: reference.resourceId,
      contentVersion: reference.contentVersion,
      workspacePath: reference.workspacePath,
      role: reference.role,
      position: reference.position,
    })),
  })
  const resources = frozen.length === 0 ? [] : await prisma.workspaceResource.findMany({
    where: { id: { in: frozen.map((reference) => reference.resourceId) } },
    select: { id: true, mediaType: true },
  })
  const mediaById = new Map(resources.map((resource) => [resource.id, resource.mediaType]))
  for (const reference of references) {
    if (reference.channel === 'context') continue
    if (mediaById.get(reference.resourceId) !== reference.channel) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'WORKSPACE_RESOURCE_REFERENCE_CHANNEL_MISMATCH',
        field: 'references',
        resourceId: reference.resourceId,
      })
    }
  }
  return frozen
}

async function buildPlannedItem(input: {
  readonly ctx: ProjectAgentOperationContext
  readonly operationId: string
  readonly requestId: string
  readonly item: ManifestItem
  readonly memberIndex: number
  readonly outputPath: string
  readonly alternatives: boolean
  readonly productionManifestSource?: FrozenProductionManifestSource
}): Promise<{ readonly task: PlannedTask; readonly resource: PlannedResource }> {
  const mediaType = input.item.mediaType
  const schemaId = schemaForMedia(mediaType, input.item.schemaId)
  await validateWorkspaceResourcePlacement(prisma, {
    userId: input.ctx.userId,
    projectId: input.ctx.projectId,
    outputPath: input.outputPath,
    mediaType,
    schemaId,
  })
  const assetKind = mediaType === 'image' ? input.item.assetKind : null
  const modelKey = await modelForMedia(input.ctx, mediaType, assetKind)
  const publicReferences = input.item.references ?? []
  validateReferenceCapabilities({ mediaType, modelKey, references: publicReferences })
  const references = await freezeReferences(input.ctx, publicReferences)
  const compiled = await compileMediaExecution({
    ctx: input.ctx,
    item: input.item,
    schemaId,
    modelKey,
    references: publicReferences,
  })
  const durationSeconds = 'durationSeconds' in input.item
    ? input.item.durationSeconds
    : undefined
  const resourceId = buildWorkspaceResourceId({
    operationId: input.operationId,
    requestId: `${input.requestId}:${input.item.itemId}`,
    memberIndex: input.memberIndex,
  })
  const inputHash = generationInputFingerprint({
    mediaType,
    schemaId,
    modelKey,
    prompt: compiled.prompt,
    references,
    generationOptions: compiled.generationOptions,
    durationSeconds: durationSeconds ?? null,
  })
  const resourcePayload: WorkspaceResourceGenerationTaskPayload['resource'] = {
    resourceId,
    workspacePath: input.outputPath,
    mediaType,
    schemaId,
    inputHash,
    prompt: compiled.prompt,
    modelKey,
    inputs: [...references],
    imageInputPositions: providerPositions(publicReferences, 'image'),
    audioInputPositions: providerPositions(publicReferences, 'audio'),
    videoInputPositions: providerPositions(publicReferences, 'video'),
    toolCallId: input.ctx.toolCallId?.trim() || null,
    sourceTurnId: input.ctx.context.turnId?.trim() || null,
  }
  const payload: WorkspaceResourceGenerationTaskPayload = {
    lifecycleProjection: buildWorkspaceResourceLifecycleProjection([{
      resourceId,
      mediaType,
      schemaId,
      name: resourceNameFromPath(input.outputPath),
    }]),
    protocol: 'workspace_resource_generation_v1',
    resource: resourcePayload,
    ...(input.productionManifestSource
      ? { productionManifestSource: input.productionManifestSource }
      : {}),
    ...modelPayload(mediaType, modelKey),
    count: 1,
    generationOptions: compiled.generationOptions,
    ...(durationSeconds ? { durationSeconds } : {}),
    ...(typeof compiled.generationOptions.vocalMode === 'string'
      ? { vocalMode: compiled.generationOptions.vocalMode as 'instrumental' | 'vocal' }
      : {}),
    ...(typeof compiled.generationOptions.genre === 'string'
      ? { genre: compiled.generationOptions.genre }
      : {}),
    ...(typeof compiled.generationOptions.mood === 'string'
      ? { mood: compiled.generationOptions.mood }
      : {}),
    ...(typeof compiled.generationOptions.bpm === 'number'
      ? { bpm: compiled.generationOptions.bpm }
      : {}),
    ...(compiled.generationOptions.outputFormat === 'mp3' || compiled.generationOptions.outputFormat === 'wav'
      ? { outputFormat: compiled.generationOptions.outputFormat }
      : {}),
  }
  const taskType = taskTypeForMedia(mediaType)
  const taskPlanId = `${input.operationId}:${resourceId}`
  return {
    task: createPlannedTask({
      id: taskPlanId,
      taskType,
      targetType: 'WorkspaceResource',
      targetId: resourceId,
      payload,
      locale: resolveOperationLocale(input.ctx.context),
      dedupeKey: `${input.operationId}:${resourceId}:${inputHash}`,
      billingInfo: requirePlannedTaskBillingInfo({
        taskType,
        payload,
        allowedApiTypes: [mediaType === 'audio' ? 'music' : mediaType],
      }),
    }),
    resource: {
      resourceId,
      workspacePath: input.outputPath,
      mediaType,
      schemaId,
      memberIndex: input.memberIndex,
      taskPlanId,
      alternatives: input.alternatives,
    },
  }
}

function requestIdentity(ctx: ProjectAgentOperationContext, operationId: string, value: unknown): string {
  return [
    operationId,
    ctx.userId,
    ctx.projectId,
    ctx.context.turnId?.trim() || 'no-turn',
    ctx.toolCallId?.trim() || ctx.requestId?.trim() || stableArgsHash(value),
  ].join(':')
}

function assertBudget(tasks: readonly PlannedTask[], maxBudgetCredits: number | undefined): void {
  if (maxBudgetCredits === undefined) return
  const frozen = tasks.reduce((total, task) => (
    task.billingInfo.billable ? total + task.billingInfo.maxFrozenCost : total
  ), 0)
  if (frozen > maxBudgetCredits) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'WORKSPACE_RESOURCE_MANIFEST_BUDGET_EXCEEDED',
      field: 'maxBudgetCredits',
      requiredCredits: frozen,
      maxBudgetCredits,
    })
  }
}

function buildPlan(input: {
  readonly ctx: ProjectAgentOperationContext
  readonly operationId: string
  readonly requestId: string
  readonly tasks: readonly PlannedTask[]
  readonly resources: readonly PlannedResource[]
  readonly retry: boolean
}): OperationPlan {
  return {
    kind: 'task_submission',
    operationId: input.operationId,
    projectId: input.ctx.projectId,
    userId: input.ctx.userId,
    tasks: [...input.tasks],
    reservedIdentityIds: input.resources.map((resource) => resource.resourceId),
    metadata: productionPlanMetadataSchema.parse({
      requestId: input.requestId,
      retry: input.retry,
      resources: input.resources,
    }),
  }
}

async function planNewMedia(
  ctx: ProjectAgentOperationContext,
  operationId: 'create_image' | 'create_audio' | 'create_video',
  mediaType: PlannedResource['mediaType'],
  request: NewMediaRequest,
): Promise<OperationPlan> {
  const requestId = requestIdentity(ctx, operationId, request)
  let item: ManifestItem
  if (mediaType === 'image') {
    const parsed = imageNewMediaRequestSchema.parse(request)
    const projectConfig = await getProjectModelConfig(ctx.projectId, ctx.userId)
    item = {
      itemId: 'primary',
      mediaType,
      outputPath: parsed.outputPath,
      prompt: parsed.prompt,
      schemaId: parsed.schemaId,
      assetKind: null,
      aspectRatio: requireProjectVideoRatio(projectConfig.videoRatio).value,
      references: parsed.references,
    }
  } else if (mediaType === 'audio') {
    const parsed = audioNewMediaRequestSchema.parse(request)
    item = {
      itemId: 'primary',
      mediaType,
      outputPath: parsed.outputPath,
      prompt: parsed.prompt,
      schemaId: parsed.schemaId,
      references: parsed.references,
      durationSeconds: parsed.durationSeconds,
      vocalMode: parsed.vocalMode,
      genre: parsed.genre,
      mood: parsed.mood,
      bpm: parsed.bpm,
    }
  } else {
    const parsed = videoNewMediaRequestSchema.parse(request)
    const projectConfig = await getProjectModelConfig(ctx.projectId, ctx.userId)
    item = {
      itemId: 'primary',
      mediaType,
      outputPath: parsed.outputPath,
      prompt: parsed.prompt,
      schemaId: parsed.schemaId,
      aspectRatio: requireProjectVideoRatio(projectConfig.videoRatio).value,
      references: parsed.references,
      durationSeconds: parsed.durationSeconds,
    }
  }
  const built = await Promise.all(Array.from({ length: request.count }, async (_, memberIndex) => (
    await buildPlannedItem({
      ctx,
      operationId,
      requestId,
      item,
      memberIndex,
      outputPath: alternativePath(request.outputPath, memberIndex),
      alternatives: request.count > 1,
    })
  )))
  return buildPlan({
    ctx,
    operationId,
    requestId,
    tasks: built.map((entry) => entry.task),
    resources: built.map((entry) => entry.resource),
    retry: false,
  })
}

async function loadProductionManifest(
  ctx: ProjectAgentOperationContext,
  input: z.infer<typeof submitProductionManifestInputSchema>,
): Promise<{ readonly manifest: ProductionManifest; readonly source: FrozenProductionManifestSource }> {
  const resource = await readWorkspaceResource({
    userId: ctx.userId,
    projectId: ctx.projectId,
    workspacePath: input.manifestPath,
  })
  if (
    resource.resourceKind !== 'file'
    || resource.mediaType !== 'text'
    || resource.status !== 'ready'
    || resource.contentVersion < 1
    || !resource.current
  ) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PRODUCTION_MANIFEST_RESOURCE_NOT_READY',
      field: 'manifestPath',
    })
  }
  const content = resource.current.content
  if (!content || content.kind === 'media') {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PRODUCTION_MANIFEST_CONTENT_INVALID',
      field: 'manifestPath',
    })
  }
  let value: unknown
  try {
    value = content.kind === 'structured' ? content.data : JSON.parse(content.text)
  } catch (error) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PRODUCTION_MANIFEST_JSON_INVALID',
      field: 'manifestPath',
      reason: describeUnknownError(error),
    })
  }
  const parsed = productionManifestSchema.safeParse(value)
  if (!parsed.success) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PRODUCTION_MANIFEST_SCHEMA_INVALID',
      field: 'manifestPath',
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    })
  }
  const digest = resource.current.sha256
  if (!digest || !/^[a-f0-9]{64}$/u.test(digest)) {
    throw new Error('PRODUCTION_MANIFEST_DIGEST_MISSING')
  }
  return {
    manifest: parsed.data,
    source: {
      resourceId: resource.resourceId,
      contentVersion: resource.contentVersion,
      workspacePath: resource.workspacePath,
      sha256: digest,
      manifestId: parsed.data.manifestId,
    },
  }
}

async function planManifest(
  ctx: ProjectAgentOperationContext,
  input: z.infer<typeof submitProductionManifestInputSchema>,
): Promise<OperationPlan> {
  const operationId = 'submit_production_manifest'
  const loaded = await loadProductionManifest(ctx, input)
  const requestId = requestIdentity(ctx, operationId, loaded.source)
  const built = await Promise.all(loaded.manifest.items.map(async (item) => await buildPlannedItem({
    ctx,
    operationId,
    requestId,
    item,
    memberIndex: 0,
    outputPath: item.outputPath,
    alternatives: false,
    productionManifestSource: loaded.source,
  })))
  assertBudget(built.map((entry) => entry.task), input.maxBudgetCredits)
  return buildPlan({
    ctx,
    operationId,
    requestId,
    tasks: built.map((entry) => entry.task),
    resources: built.map((entry) => entry.resource),
    retry: false,
  })
}

async function loadFailedTasks(
  ctx: ProjectAgentOperationContext,
  resourceIds: readonly string[],
): Promise<Array<{ readonly resource: PlannedResource; readonly task: PlannedTask }>> {
  const resources = await prisma.workspaceResource.findMany({
    where: {
      id: { in: [...resourceIds] },
      userId: ctx.userId,
      projectId: ctx.projectId,
      resourceKind: 'file',
      status: { in: ['failed', 'canceled'] },
      deletedAt: null,
    },
    include: { task: { select: { id: true, type: true, payload: true } } },
  })
  const byId = new Map(resources.map((resource) => [resource.id, resource]))
  return await Promise.all(resourceIds.map(async (resourceId) => {
    const resource = byId.get(resourceId)
    if (!resource) throw new ApiError('WORKSPACE_RESOURCE_RETRY_TARGET_NOT_FOUND', { resourceId })
    if (!resource.task || !resource.mediaType) {
      throw new ApiError('WORKSPACE_RESOURCE_RETRY_TARGET_INVALID', { resourceId })
    }
    const taskType = taskTypeForMedia(resource.mediaType as PlannedResource['mediaType'])
    if (resource.task.type !== taskType) throw new Error(`WORKSPACE_RESOURCE_RETRY_TASK_TYPE_INVALID:${resourceId}`)
    const source = parseWorkspaceResourceGenerationRetrySource(resource.task.payload)
    if (source.resource.resourceId !== resource.id) {
      throw new Error(`WORKSPACE_RESOURCE_RETRY_TASK_TARGET_MISMATCH:${resourceId}`)
    }
    const mediaType = resource.mediaType as PlannedResource['mediaType']
    const prompt = resource.prompt?.trim()
    const modelKey = resource.modelKey?.trim()
    if (!prompt || !modelKey) {
      throw new ApiError('WORKSPACE_RESOURCE_RETRY_FROZEN_INPUT_MISSING', { resourceId })
    }
    const generationOptions = workspaceResourceGenerationOptionsSchema.parse(resource.generationOptions ?? {})
    if ((mediaType === 'audio' || mediaType === 'video') && !source.durationSeconds) {
      throw new Error(`WORKSPACE_RESOURCE_RETRY_DURATION_MISSING:${resourceId}`)
    }
    await preflightFrozenRetry({
      ctx,
      mediaType,
      modelKey,
      prompt,
      source,
      generationOptions,
    })
    const payload = parseWorkspaceResourceGenerationTaskPayload({
      lifecycleProjection: buildWorkspaceResourceLifecycleProjection([{
        resourceId: resource.id,
        mediaType,
        schemaId: resource.schemaId,
        name: resourceNameFromPath(resource.workspacePath),
      }]),
      protocol: 'workspace_resource_generation_v1',
      resource: {
        resourceId: resource.id,
        workspacePath: resource.workspacePath,
        mediaType,
        schemaId: resource.schemaId,
        inputHash: generationInputFingerprint({
          mediaType,
          schemaId: resource.schemaId,
          modelKey,
          prompt,
          references: source.resource.inputs,
          generationOptions,
          durationSeconds: source.durationSeconds ?? null,
        }),
        prompt,
        modelKey,
        inputs: source.resource.inputs,
        imageInputPositions: source.resource.imageInputPositions,
        audioInputPositions: source.resource.audioInputPositions,
        videoInputPositions: source.resource.videoInputPositions,
        toolCallId: ctx.toolCallId?.trim() || null,
        sourceTurnId: ctx.context.turnId?.trim() || null,
      },
      ...(source.productionManifestSource
        ? { productionManifestSource: source.productionManifestSource }
        : {}),
      ...modelPayload(mediaType, modelKey),
      count: 1,
      generationOptions,
      ...(source.durationSeconds ? { durationSeconds: source.durationSeconds } : {}),
      ...(source.vocalMode ? { vocalMode: source.vocalMode } : {}),
      ...(source.genre ? { genre: source.genre } : {}),
      ...(source.mood ? { mood: source.mood } : {}),
      ...(source.bpm ? { bpm: source.bpm } : {}),
      ...(source.outputFormat ? { outputFormat: source.outputFormat } : {}),
      ...(source.scoreCue ? { scoreCue: source.scoreCue } : {}),
    })
    const taskPlanId = `rerun_failed_production_items:${resourceId}`
    return {
      task: createPlannedTask({
        id: taskPlanId,
        taskType,
        targetType: 'WorkspaceResource',
        targetId: resource.id,
        payload,
        billingInfo: requirePlannedTaskBillingInfo({
          taskType,
          payload,
          allowedApiTypes: [mediaType === 'audio' ? 'music' : mediaType],
        }),
        locale: resolveOperationLocale(ctx.context),
        dedupeKey: `rerun:${resource.id}:${resource.task.id}`,
      }),
      resource: {
        resourceId: resource.id,
        workspacePath: resource.workspacePath,
        mediaType,
        schemaId: resource.schemaId,
        memberIndex: resource.memberIndex ?? 0,
        taskPlanId,
        alternatives: Boolean(resource.alternativeGroupExecutionId),
      },
    }
  }))
}

async function planRetry(
  ctx: ProjectAgentOperationContext,
  operationId: string,
  resourceIds: readonly string[],
  maxBudgetCredits?: number,
): Promise<OperationPlan> {
  const built = await loadFailedTasks(ctx, resourceIds)
  const expectedType = operationId === 'create_image'
    ? 'image'
    : operationId === 'create_audio'
      ? 'audio'
      : operationId === 'create_video'
        ? 'video'
        : null
  if (expectedType && built.some((entry) => entry.resource.mediaType !== expectedType)) {
    throw new Error(`WORKSPACE_RESOURCE_RETRY_MEDIA_TYPE_INVALID:${operationId}`)
  }
  assertBudget(built.map((entry) => entry.task), maxBudgetCredits)
  return buildPlan({
    ctx,
    operationId,
    requestId: requestIdentity(ctx, operationId, resourceIds),
    tasks: built.map((entry) => entry.task),
    resources: built.map((entry) => entry.resource),
    retry: true,
  })
}

async function commitProductionPlan(
  ctx: ProjectAgentOperationContext,
  operationId: string,
  plan: OperationPlan,
) {
  const authorization = ctx.executionAuthorization
  if (!authorization) throw new Error('OPERATION_EXECUTION_AUTHORIZATION_REQUIRED')
  const metadata = productionPlanMetadataSchema.parse(plan.metadata)
  if (!metadata.retry) {
    for (const resource of metadata.resources) {
      const task = plan.tasks.find((candidate) => candidate.id === resource.taskPlanId)
      if (!task) throw new Error(`WORKSPACE_RESOURCE_PLAN_TASK_MISSING:${resource.taskPlanId}`)
      const payload = task.payload as unknown as WorkspaceResourceGenerationTaskPayload
      await reserveWorkspaceResourceInTransaction(authorization.transaction, {
        resourceId: resource.resourceId,
        userId: ctx.userId,
        projectId: ctx.projectId,
        outputPath: resource.workspacePath,
        mediaType: resource.mediaType,
        schemaId: resource.schemaId,
        memberIndex: resource.memberIndex,
        operationExecutionId: authorization.operationExecutionId,
        alternativeGroupExecutionId: resource.alternatives ? authorization.operationExecutionId : null,
        toolCallId: ctx.toolCallId?.trim() || null,
        prompt: payload.resource.prompt,
        modelKey: payload.resource.modelKey,
        generationOptions: payload.generationOptions,
        operationId,
        inputHash: payload.resource.inputHash,
        taskId: null,
      })
    }
  } else {
    for (const resource of metadata.resources) {
      const task = plan.tasks.find((candidate) => candidate.id === resource.taskPlanId)
      if (!task) throw new Error(`WORKSPACE_RESOURCE_PLAN_TASK_MISSING:${resource.taskPlanId}`)
      const payload = parseWorkspaceResourceGenerationTaskPayload(task.payload)
      const updated = await authorization.transaction.workspaceResource.updateMany({
        where: {
          id: resource.resourceId,
          userId: ctx.userId,
          projectId: ctx.projectId,
          status: { in: ['failed', 'canceled'] },
          deletedAt: null,
        },
        data: {
          status: 'pending',
          errorCode: null,
          errorMessage: null,
          operationId,
          operationExecutionId: authorization.operationExecutionId,
          inputHash: payload.resource.inputHash,
          prompt: payload.resource.prompt,
          modelKey: payload.resource.modelKey,
          generationOptions: payload.generationOptions,
          toolCallId: ctx.toolCallId?.trim() || null,
        },
      })
      if (updated.count !== 1) throw new Error(`WORKSPACE_RESOURCE_RETRY_TARGET_CHANGED:${resource.resourceId}`)
    }
  }
  const submitted = await submitPlannedOperationTasks({ ctx, operationId })
  const results = plan.tasks.map((task) => {
    const result = submitted.get(task.id)
    if (!result) throw new Error(`WORKSPACE_RESOURCE_TASK_RESULT_MISSING:${task.id}`)
    return result
  })
  const first = results[0]
  if (!first) throw new Error('WORKSPACE_RESOURCE_PLAN_EMPTY')
  for (const resource of metadata.resources) {
    const submittedTask = submitted.get(resource.taskPlanId)
    if (!submittedTask) throw new Error(`WORKSPACE_RESOURCE_TASK_RESULT_MISSING:${resource.taskPlanId}`)
    const updated = await authorization.transaction.workspaceResource.updateMany({
      where: { id: resource.resourceId, userId: ctx.userId, projectId: ctx.projectId, status: 'pending' },
      data: { taskId: submittedTask.taskId },
    })
    if (updated.count !== 1) throw new Error(`WORKSPACE_RESOURCE_TASK_BINDING_CONFLICT:${resource.resourceId}`)
  }
  return mediaOutputSchema.parse({
    ...first,
    taskIds: results.map((result) => result.taskId),
    resources: metadata.resources.map((resource) => ({
      resourceId: resource.resourceId,
      workspacePath: resource.workspacePath,
      memberIndex: resource.memberIndex,
    })),
  })
}

function mediaOperationBase(input: {
  readonly operationId: 'create_image' | 'create_audio' | 'create_video'
  readonly mediaType: PlannedResource['mediaType']
  readonly schemaIds: readonly string[]
  readonly defaultSchemaId: string
  readonly mediaKind: 'image' | 'music' | 'video'
  readonly durationSeconds?: { readonly min: number; readonly max: number }
}) {
  return {
    id: input.operationId,
    summary: `Generate ${input.mediaType} files at explicit workspace paths. Inputs are exact Resource versions; retry accepts only failed Resource IDs.`,
    intent: 'act',
    channels: { tool: false, api: true, mcp: false },
    effects: MEDIA_EFFECTS,
    resourceContract: {
      kind: 'resource',
      assistantPresentation: 'created_resources',
      acceptsReferences: true,
      outputResourceKinds: ['file'],
      outputMediaTypes: [input.mediaType],
      outputSchemaIds: input.schemaIds,
      placement: 'required',
      alternativeGeneration: {
        kind: 'request_count',
        mediaKind: input.mediaKind,
        requestKind: 'new',
        defaultSchemaId: input.defaultSchemaId,
        minCount: 1,
        maxCount: 6,
        inputLimits: {
          promptMaxLength: 100_000,
          ...(input.durationSeconds ? { durationSeconds: input.durationSeconds } : {}),
        },
      },
    },
    confirmation: { kind: 'billable_media', required: true },
    planContractRevision: MEDIA_GENERATION_PLAN_CONTRACT_REVISION,
    outputSchema: mediaOutputSchema,
  } as const
}

export function createWorkspaceResourceGenerationOperations(): ProjectAgentOperationRegistryDraft {
  return {
    create_text: defineOperation({
      id: 'create_text',
      summary: 'Create one text/JSON workspace file at an explicit path. Only user content and exact input references are accepted; system identity/provenance fields are server-owned.',
      intent: 'act',
      channels: { tool: false, api: true, mcp: false },
      toolContractRevision: 'create_text/v3',
      effects: {
        writes: true,
        workspaceResourceImpact: 'workspace_resources',
        billable: false,
        destructive: false,
        overwrite: false,
        bulk: false,
        externalSideEffects: false,
        longRunning: false,
      },
      resourceContract: {
        kind: 'resource',
        assistantPresentation: 'created_resources',
        acceptsReferences: true,
        outputResourceKinds: ['file'],
        outputMediaTypes: ['text'],
        outputSchemaIds: WORKSPACE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA.text,
        placement: 'required',
      },
      confirmation: { kind: 'none', required: false },
      inputSchema: textInputSchema,
      outputSchema: textOutputSchema,
      executeInTransaction: async (ctx, input, tx) => {
        const references = await resolveWorkspaceResourceInputs(tx, {
          userId: ctx.userId,
          projectId: ctx.projectId,
          references: (input.references ?? []).map((reference) => ({
            resourceId: reference.resourceId,
            contentVersion: reference.contentVersion,
            workspacePath: reference.workspacePath,
            role: reference.role,
            position: reference.position,
          })),
        })
        const reserved = await reserveWorkspaceResourceInTransaction(tx, {
          userId: ctx.userId,
          projectId: ctx.projectId,
          outputPath: input.outputPath,
          mediaType: 'text',
          schemaId: input.schemaId,
          operationId: 'create_text',
          prompt: input.prompt ?? null,
          toolCallId: ctx.toolCallId?.trim() || null,
        })
        const content = input.content.kind === 'text'
          ? input.content
          : { kind: 'structured' as const, data: input.content.data }
        const materialized = await materializeWorkspaceResourceInTransaction(tx, {
          resourceId: reserved.resourceId,
          userId: ctx.userId,
          mediaType: 'text',
          schemaId: input.schemaId,
          content,
          inputs: references,
          sourceTurnId: ctx.context.turnId?.trim() || null,
          provenance: {
            operationId: 'create_text',
            inputHash: stableArgsFingerprint(input),
            taskId: null,
            operationExecutionId: ctx.operationExecutionId ?? null,
            toolCallId: ctx.toolCallId?.trim() || null,
            prompt: input.prompt ?? null,
            modelKey: null,
            generationOptions: null,
          },
        })
        return textOutputSchema.parse({ success: true, ...reserved, ...materialized })
      },
    }),
    create_image: defineOperation({
      ...mediaOperationBase({
        operationId: 'create_image',
        mediaType: 'image',
        mediaKind: 'image',
        schemaIds: DIRECT_IMAGE_SCHEMA_IDS,
        defaultSchemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_IMAGE,
      }),
      inputSchema: imageMediaRequestSchema,
      plan: async (ctx, value) => value.request.kind === 'retry'
        ? await planRetry(ctx, 'create_image', value.request.resourceIds)
        : await planNewMedia(ctx, 'create_image', 'image', value.request),
      commit: async (ctx, _value, plan) => await commitProductionPlan(ctx, 'create_image', plan),
    }),
    create_audio: defineOperation({
      ...mediaOperationBase({
        operationId: 'create_audio',
        mediaType: 'audio',
        mediaKind: 'music',
        schemaIds: WORKSPACE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA.audio,
        defaultSchemaId: WORKSPACE_RESOURCE_SCHEMA.BGM_AUDIO,
        durationSeconds: { min: 1, max: 600 },
      }),
      inputSchema: audioMediaRequestSchema,
      plan: async (ctx, value) => value.request.kind === 'retry'
        ? await planRetry(ctx, 'create_audio', value.request.resourceIds)
        : await planNewMedia(ctx, 'create_audio', 'audio', value.request),
      commit: async (ctx, _value, plan) => await commitProductionPlan(ctx, 'create_audio', plan),
    }),
    create_video: defineOperation({
      ...mediaOperationBase({
        operationId: 'create_video',
        mediaType: 'video',
        mediaKind: 'video',
        schemaIds: WORKSPACE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA.video,
        defaultSchemaId: WORKSPACE_RESOURCE_SCHEMA.VIDEO_SEGMENT,
        durationSeconds: { min: 1, max: CREATIVE_VIDEO_SEGMENT_DURATION_CEILING_SECONDS },
      }),
      inputSchema: videoMediaRequestSchema,
      plan: async (ctx, value) => value.request.kind === 'retry'
        ? await planRetry(ctx, 'create_video', value.request.resourceIds)
        : await planNewMedia(ctx, 'create_video', 'video', value.request),
      commit: async (ctx, _value, plan) => await commitProductionPlan(ctx, 'create_video', plan),
    }),
    submit_production_manifest: defineOperation({
      id: 'submit_production_manifest',
      summary: 'Load one professional Subagent-authored JSON manifest by workspace path, validate and freeze its exact version, quote one aggregate budget, then fan out all independent items through Temporal.',
      intent: 'act',
      channels: { tool: true, api: true, mcp: true },
      effects: MEDIA_EFFECTS,
      resourceContract: {
        kind: 'resource',
        assistantPresentation: 'created_resources',
        acceptsReferences: true,
        outputResourceKinds: ['file'],
        outputMediaTypes: ['image', 'audio', 'video'],
        outputSchemaIds: [
          ...WORKSPACE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA.image,
          ...WORKSPACE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA.audio,
          ...WORKSPACE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA.video,
        ],
        placement: 'required',
      },
      confirmation: { kind: 'billable_media', required: true },
      planContractRevision: MEDIA_GENERATION_PLAN_CONTRACT_REVISION,
      inputSchema: submitProductionManifestInputSchema,
      outputSchema: mediaOutputSchema,
      plan: async (ctx, input) => await planManifest(ctx, input),
      commit: async (ctx, _input, plan) => await commitProductionPlan(ctx, 'submit_production_manifest', plan),
    }),
    rerun_failed_production_items: defineOperation({
      id: 'rerun_failed_production_items',
      summary: 'Requote and rerun only exact failed/canceled production Resource IDs using their original frozen Task payloads.',
      intent: 'act',
      channels: { tool: true, api: true, mcp: true },
      effects: MEDIA_EFFECTS,
      resourceContract: { kind: 'none', reason: 'reruns existing failed Resource identities without creating new Resources' },
      confirmation: { kind: 'billable_media', required: true },
      planContractRevision: MEDIA_GENERATION_PLAN_CONTRACT_REVISION,
      inputSchema: rerunFailedItemsInputSchema,
      outputSchema: mediaOutputSchema,
      plan: async (ctx, input) => await planRetry(
        ctx,
        'rerun_failed_production_items',
        input.resourceIds,
        input.maxBudgetCredits,
      ),
      commit: async (ctx, _input, plan) => await commitProductionPlan(ctx, 'rerun_failed_production_items', plan),
    }),
  }
}
