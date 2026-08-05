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
import { getAssetImageFormatPolicy } from '@/lib/asset-generation'
import {
  readCreativeOutputDefinition,
  readCreativeOutputKind,
  safeParseCreativeOutput,
} from '@/lib/creative-skills/output-registry'
import type {
  WorkspaceResourceInputRef,
  WorkspaceResourceJsonValue,
  WorkspaceResourceMediaType,
} from '@/lib/workspace-resource/contracts'
import {
  workspaceResourceGenerationOptionsSchema,
  parseWorkspaceResourceGenerationRetrySource,
  parseWorkspaceResourceGenerationTaskPayload,
  type WorkspaceResourceGenerationTaskPayload,
} from '@/lib/workspace-resource/generation-contract'
import {
  audioGenerationBatchSchema,
  generationReferenceSchema,
  imageGenerationBatchSchema,
  videoGenerationBatchSchema,
  type GenerationItem,
} from '@/lib/workspace-resource/generation-request'
import { buildWorkspaceResourceId } from '@/lib/workspace-resource/identity'
import { resourceNameFromPath } from '@/lib/workspace-resource/path'
import {
  materializeWorkspaceResourceInTransaction,
  reserveWorkspaceResourceInTransaction,
  resolveGeneratedWorkspaceResourcePlacement,
  resolveSavedWorkspaceDocumentPlacement,
  resolveWorkspaceResourceInputs,
} from '@/lib/workspace-resource/persistence'
import {
  WORKSPACE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA,
  WORKSPACE_RESOURCE_SCHEMA,
  requireWorkspaceResourceSchema,
} from '@/lib/workspace-resource/schema-registry'
import { buildWorkspaceResourceLifecycleProjection } from '@/lib/workspace-resource/task-runtime-envelope'
import { defineOperation } from '@/lib/operations/define-operation'
import { resolveOperationLocale } from '@/lib/operations/environment-input'
import {
  PROJECT_VIDEO_RATIO_METADATA_KEY,
  PROJECT_VIDEO_RATIO_REQUIRED_METADATA_KEY,
  projectVideoRatioSnapshotSchema,
  readProjectVideoRatioSnapshot,
  type ProjectVideoRatioSnapshot,
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

const MAX_BATCH_ITEMS = OPERATION_EXECUTION_MAX_TASKS
const MEDIA_GENERATION_PLAN_CONTRACT_REVISION = 'workspace-resource-generation-batch/v3'

const workspaceResourceJsonValueSchema: z.ZodType<WorkspaceResourceJsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(workspaceResourceJsonValueSchema),
  z.record(z.string(), workspaceResourceJsonValueSchema),
]))

const retryMediaRequestSchema = z.object({
  kind: z.literal('retry'),
  resourceIds: z.array(z.string().trim().min(1).max(32)).min(1).max(MAX_BATCH_ITEMS),
}).strict()

function requireUniqueRetryResourceIds(value: { request: { kind: string; resourceIds?: string[] } }, context: z.RefinementCtx): void {
  if (value.request.kind === 'retry' && value.request.resourceIds
    && new Set(value.request.resourceIds).size !== value.request.resourceIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['request', 'resourceIds'],
      message: 'resourceIds must be unique',
    })
  }
}

const imageMediaRequestSchema = z.object({
  request: z.union([imageGenerationBatchSchema, retryMediaRequestSchema]),
}).strict().superRefine(requireUniqueRetryResourceIds)
const audioMediaRequestSchema = z.object({
  request: z.union([audioGenerationBatchSchema, retryMediaRequestSchema]),
}).strict().superRefine(requireUniqueRetryResourceIds)
const videoMediaRequestSchema = z.object({
  request: z.union([videoGenerationBatchSchema, retryMediaRequestSchema]),
}).strict().superRefine(requireUniqueRetryResourceIds)

const rerunFailedItemsInputSchema = z.object({
  resourceIds: z.array(z.string().trim().min(1).max(32)).min(1).max(MAX_BATCH_ITEMS),
  maxBudgetCredits: z.number().finite().positive().optional(),
}).strict().superRefine((value, context) => {
  if (new Set(value.resourceIds).size !== value.resourceIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['resourceIds'], message: 'resourceIds must be unique' })
  }
})

const saveProjectDocumentInputSchema = z.object({
  parentFolderId: z.string().trim().min(1).max(32).nullable().optional(),
  name: z.string().trim().min(1).max(300),
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
  | z.infer<typeof imageGenerationBatchSchema>
  | z.infer<typeof audioGenerationBatchSchema>
  | z.infer<typeof videoGenerationBatchSchema>

type PlannedResource = {
  readonly resourceId: string
  readonly workspacePath: string
  readonly mediaType: Exclude<WorkspaceResourceMediaType, 'text'>
  readonly schemaId: string
  readonly memberIndex: number
  readonly taskPlanId: string
  readonly alternatives: boolean
  readonly usesProjectVideoRatio: boolean
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
    usesProjectVideoRatio: z.boolean(),
  }).strict()).min(1),
  [PROJECT_VIDEO_RATIO_REQUIRED_METADATA_KEY]: z.boolean(),
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

function throwMediaPreflightError(
  error: unknown,
  input: {
    readonly mediaType: PlannedResource['mediaType']
    readonly modelKey?: string
    readonly aspectRatio?: string | null
    readonly ratioOwner?: 'project' | 'asset' | null
  },
): never {
  if (error instanceof ApiError || error instanceof AppError) throw error
  if (error instanceof AiOptionValidationError) {
    if (error.field === 'aspectRatio' && input.aspectRatio && input.modelKey) {
      if (input.ratioOwner === 'project') {
        throw new ApiError('INVALID_PARAMS', {
          code: 'PROJECT_VIDEO_RATIO_UNSUPPORTED_BY_MODEL',
          field: 'videoRatio',
          value: input.aspectRatio,
          modelKey: input.modelKey,
          correction: {
            interaction: 'codex_request_user_input',
            commitmentOperationId: 'update_project_config',
            commitmentInputField: 'videoRatio',
          },
          agentRetryableAfterCorrection: true,
        })
      }
      if (input.ratioOwner === 'asset') {
        throw new ApiError('INVALID_PARAMS', {
          code: 'ASSET_IMAGE_RATIO_UNSUPPORTED_BY_MODEL',
          field: 'modelKey',
          value: input.aspectRatio,
          modelKey: input.modelKey,
        })
      }
    }
    throw new ApiError('INVALID_PARAMS', {
      code: 'MEDIA_GENERATION_OPTION_INVALID',
      field: error.field ?? 'generation',
      reason: error.reason ?? error.failure,
      mediaType: input.mediaType,
    })
  }
  throw new ApiError('INVALID_PARAMS', {
    code: 'MEDIA_GENERATION_PREFLIGHT_FAILED',
    field: input.mediaType,
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
  readonly item: GenerationItem
  readonly aspectRatio: string | null
  readonly schemaId: string
  readonly modelKey: string
  readonly references: readonly z.infer<typeof generationReferenceSchema>[]
}): Promise<{
  readonly prompt: string
  readonly generationOptions: Record<string, string | number | boolean | null>
}> {
  const { item, modelKey } = input
  const aspectRatio = input.aspectRatio
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
      const providerConfigured = { ...configured }
      delete providerConfigured.generationMode
      requested = {
        ...providerConfigured,
        duration: item.durationSeconds,
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
    throwMediaPreflightError(error, {
      mediaType: item.mediaType,
      modelKey,
      aspectRatio,
      ratioOwner: item.mediaType === 'audio'
        ? null
        : item.mediaType === 'image' && item.assetKind !== null
          ? 'asset'
          : 'project',
    })
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
    throwMediaPreflightError(error, { mediaType: input.mediaType })
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
  readonly item: GenerationItem
  readonly memberIndex: number
  readonly alternatives: boolean
  readonly projectVideoRatio: ProjectVideoRatioSnapshot | null
}): Promise<{ readonly task: PlannedTask; readonly resource: PlannedResource }> {
  const mediaType = input.item.mediaType
  const schemaId = schemaForMedia(mediaType, input.item.schemaId)
  const requestedAssetKind = input.item.mediaType === 'image' ? input.item.assetKind : null
  const usesProjectVideoRatio = mediaType !== 'audio' && !requestedAssetKind
  const aspectRatio = mediaType === 'audio'
    ? null
    : requestedAssetKind
      ? getAssetImageFormatPolicy(requestedAssetKind).aspectRatio
      : input.projectVideoRatio?.value
        ?? (() => { throw new Error('PROJECT_VIDEO_RATIO_SNAPSHOT_REQUIRED') })()
  const item = input.item
  const resourceId = buildWorkspaceResourceId({
    operationId: input.operationId,
    requestId: `${input.requestId}:${input.item.itemId}`,
    memberIndex: input.memberIndex,
  })
  const workspacePath = await resolveGeneratedWorkspaceResourcePlacement(prisma, {
    userId: input.ctx.userId,
    projectId: input.ctx.projectId,
    parentFolderId: input.item.parentFolderId,
    name: input.item.name,
    resourceId,
    mediaType,
    schemaId,
  })
  const assetKind = item.mediaType === 'image' ? item.assetKind : null
  const modelKey = await modelForMedia(input.ctx, mediaType, assetKind)
  const publicReferences = item.references ?? []
  validateReferenceCapabilities({ mediaType, modelKey, references: publicReferences })
  const references = await freezeReferences(input.ctx, publicReferences)
  const compiled = await compileMediaExecution({
    ctx: input.ctx,
    item,
    aspectRatio,
    schemaId,
    modelKey,
    references: publicReferences,
  })
  const durationSeconds = 'durationSeconds' in item
    ? item.durationSeconds
    : undefined
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
    workspacePath,
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
      name: resourceNameFromPath(workspacePath),
    }]),
    protocol: 'workspace_resource_generation_v1',
    resource: resourcePayload,
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
      workspacePath,
      mediaType,
      schemaId,
      memberIndex: input.memberIndex,
      taskPlanId,
      alternatives: input.alternatives,
      usesProjectVideoRatio,
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
      code: 'WORKSPACE_RESOURCE_BATCH_BUDGET_EXCEEDED',
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
  readonly projectVideoRatio: ProjectVideoRatioSnapshot | null
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
      [PROJECT_VIDEO_RATIO_REQUIRED_METADATA_KEY]: input.resources.some(
        (resource) => resource.usesProjectVideoRatio,
      ),
      ...(input.projectVideoRatio
        ? { [PROJECT_VIDEO_RATIO_METADATA_KEY]: input.projectVideoRatio }
        : {}),
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
  const items = request.items as readonly GenerationItem[]
  if (items.some((item) => item.mediaType !== mediaType)) {
    throw new Error(`WORKSPACE_RESOURCE_GENERATION_MEDIA_TYPE_INVALID:${operationId}`)
  }
  const usesProjectVideoRatio = items.some((item) => (
    item.mediaType !== 'audio'
    && !(item.mediaType === 'image' && item.assetKind !== null)
  ))
  const projectVideoRatio = usesProjectVideoRatio
    ? await readProjectVideoRatioSnapshot({ projectId: ctx.projectId, userId: ctx.userId })
    : null
  const built = await Promise.all(items.flatMap((item) => (
    Array.from({ length: item.count }, (_, memberIndex) => buildPlannedItem({
      ctx,
      operationId,
      requestId,
      item,
      memberIndex,
      alternatives: item.count > 1,
      projectVideoRatio,
    }))
  )))
  assertBudget(built.map((entry) => entry.task), request.maxBudgetCredits)
  return buildPlan({
    ctx,
    operationId,
    requestId,
    tasks: built.map((entry) => entry.task),
    resources: built.map((entry) => entry.resource),
    retry: false,
    projectVideoRatio,
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
        usesProjectVideoRatio: false,
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
    projectVideoRatio: null,
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
    summary: `Generate a batch of ${input.mediaType} Resources from independent items. The server owns placement; retry accepts only failed Resource IDs.`,
    intent: 'act',
    channels: { tool: true, api: true, mcp: true },
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
    save_project_document: defineOperation({
      id: 'save_project_document',
      summary: 'Explicitly save one text or structured document as a canonical project Resource. Runtime scratch and Subagent results are never saved implicitly.',
      intent: 'act',
      channels: { tool: true, api: true, mcp: true },
      toolContractRevision: 'save_project_document/v1',
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
      inputSchema: saveProjectDocumentInputSchema,
      outputSchema: textOutputSchema,
      executeInTransaction: async (ctx, input, tx) => {
        let schemaId: string = WORKSPACE_RESOURCE_SCHEMA.GENERIC_TEXT
        if (input.content.kind === 'structured') {
          const outputKind = readCreativeOutputKind(input.content.data)
          if (outputKind) {
            const parsed = safeParseCreativeOutput(input.content.data)
            if (!parsed.success) {
              throw new ApiError('INVALID_PARAMS', {
                code: 'PROJECT_DOCUMENT_SCHEMA_INVALID',
                field: 'content.data',
                issues: parsed.error.issues.slice(0, 20).map((issue) => ({
                  path: issue.path.join('.'),
                  message: issue.message,
                })),
              })
            }
            schemaId = readCreativeOutputDefinition(outputKind).savedDocumentSchemaId
          } else if (
            input.content.data !== null
            && typeof input.content.data === 'object'
            && !Array.isArray(input.content.data)
            && Object.prototype.hasOwnProperty.call(input.content.data, 'outputKind')
          ) {
            throw new ApiError('INVALID_PARAMS', {
              code: 'PROJECT_DOCUMENT_OUTPUT_KIND_INVALID',
              field: 'content.data.outputKind',
            })
          }
        }
        const resourceId = buildWorkspaceResourceId({
          operationId: 'save_project_document',
          requestId: requestIdentity(ctx, 'save_project_document', input),
          memberIndex: 0,
        })
        const outputPath = await resolveSavedWorkspaceDocumentPlacement(tx, {
          userId: ctx.userId,
          projectId: ctx.projectId,
          parentFolderId: input.parentFolderId,
          name: input.name,
          resourceId,
          contentKind: input.content.kind,
          schemaId,
        })
        const references = await resolveWorkspaceResourceInputs(tx, {
          userId: ctx.userId,
          projectId: ctx.projectId,
          references: (input.references ?? []).map((reference) => ({
            resourceId: reference.resourceId,
            contentVersion: reference.contentVersion,
            role: reference.role,
            position: reference.position,
          })),
        })
        const reserved = await reserveWorkspaceResourceInTransaction(tx, {
          resourceId,
          userId: ctx.userId,
          projectId: ctx.projectId,
          outputPath,
          mediaType: 'text',
          schemaId,
          operationId: 'save_project_document',
          prompt: null,
          toolCallId: ctx.toolCallId?.trim() || null,
        })
        const content = input.content.kind === 'text'
          ? input.content
          : { kind: 'structured' as const, data: input.content.data }
        const materialized = await materializeWorkspaceResourceInTransaction(tx, {
          resourceId: reserved.resourceId,
          userId: ctx.userId,
          mediaType: 'text',
          schemaId,
          content,
          inputs: references,
          sourceTurnId: ctx.context.turnId?.trim() || null,
          provenance: {
            operationId: 'save_project_document',
            inputHash: stableArgsFingerprint(input),
            taskId: null,
            operationExecutionId: ctx.operationExecutionId ?? null,
            toolCallId: ctx.toolCallId?.trim() || null,
            prompt: null,
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
        schemaIds: WORKSPACE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA.image,
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
