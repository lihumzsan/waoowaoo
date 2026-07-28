import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import {
  applyAssetImageFormatPolicy,
  getAssetImageFormatPolicy,
  resolveAssetImageKindForSchemaId,
} from '@/lib/asset-generation'
import {
  getCapabilityOptionFields,
  resolveBuiltinCapabilitiesByModelKey,
  resolveGenerationOptionsForModel,
} from '@/lib/ai-registry/capabilities-catalog'
import type {
  CapabilityValue,
  ModelCapabilities,
  UnifiedModelType,
} from '@/lib/ai-registry/types'
import { supportsTextToVideoModel } from '@/lib/ai-registry/video-model-helpers'
import { getProjectModelConfig } from '@/lib/config-service'
import type {
  CreativeResourceInputRef,
  CreativeResourceMediaType,
} from '@/lib/creative-resource/contracts'
import {
  CREATIVE_VIDEO_SEGMENT_DURATION_CEILING_SECONDS,
  creativeResourceInputRefSchema,
} from '@/lib/creative-resource/generation-contract'
import {
  buildCreativeResourceRetryTaskPayload,
  loadCreativeResourceRetryCandidates,
} from '@/lib/creative-resource/generation-retry'
import {
  buildCreativeResourceCandidateSetId,
  buildCreativeResourceId,
  resolveProjectCreativeResourceScope,
} from '@/lib/creative-resource/identity'
import {
  materializeCreativeResourceInTransaction,
  reserveCreativeResourcesInTransaction,
  validateCreativeResourceInputReferencesInTransaction,
} from '@/lib/creative-resource/persistence'
import {
  CREATIVE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA,
  CREATIVE_RESOURCE_SCHEMA,
  requireCreativeResourceSchema,
} from '@/lib/creative-resource/schema-registry'
import { creativeWorkOutputSchemas } from '@/lib/creative-worker'
import { matchCurrentUserText } from '@/lib/creative-resource/current-user-text'
import { buildCreativeResourceLifecycleProjection } from '@/lib/creative-resource/task-runtime-envelope'
import { resolveSystemModelKey, type SystemModelPurpose } from '@/lib/model-access/system-model-resolver'
import { defineOperation } from '@/lib/operations/define-operation'
import { resolveOperationLocale } from '@/lib/operations/environment-input'
import {
  createPlannedTask,
  requirePlannedTaskBillingInfo,
  submitPlannedOperationTasks,
  type OperationPlan,
} from '@/lib/operations/planning'
import { requireProjectVideoRatio } from '@/lib/operations/project-video-ratio-policy'
import {
  refineTaskSubmitOperationOutputSchema,
  taskSubmitOperationOutputSchemaBase,
} from '@/lib/operations/output-schemas'
import type {
  ProjectAgentOperationContext,
  ProjectAgentOperationRegistryDraft,
  ProjectAgentToolInputBinding,
  ProjectAgentToolInputBindingContext,
  RuntimeSchema,
} from '@/lib/operations/types'
import { prisma } from '@/lib/prisma'
import { stableArgsHash } from '@/lib/project-agent/stable-args-hash'
import { TASK_TYPE, type TaskType } from '@/lib/task/types'
import { createWorkspaceResourceBroadcastsInTransaction } from '@/lib/workspace-resource/resource-change-events'

const contextReferenceSchema = z.array(creativeResourceInputRefSchema)
  .max(8)
  .optional()
  .describe('Exact immutable Resources used as creative context and lineage only. Text, Creative Direction, audio, video, and image Resources are allowed here; these references are never sent to an image input channel.')

const imageReferenceSchema = z.array(creativeResourceInputRefSchema)
  .max(8)
  .optional()
  .describe('Exact ready image Resources to send through the provider image-input channel. Never put text, Creative Direction, audio, or video Resources here.')

const videoImageReferenceSchema = z.array(creativeResourceInputRefSchema)
  .max(8)
  .optional()
  .describe('Ordered exact ready image Resources sent to the configured video model and numbered as @ImageN. Never put text, Creative Direction, audio, or video Resources here.')

const videoAudioCompatibleImageReferenceSchema = z.object({
  resourceId: z.string().trim().min(1)
    .describe('Globally unique immutable image Resource identity.'),
  role: z.string().trim().min(1)
    .regex(/^(?!first_frame$|last_frame$).+$/)
    .optional()
    .describe('Optional semantic role; first_frame and last_frame are unavailable when audio references are present.'),
}).strict()

const audioVideoReferenceSchema = creativeResourceInputRefSchema
  .optional()
  .describe('Exact ready video Resource the configured music model watches to compose a matching soundtrack. Only present when the configured music capability supports video conditioning.')

const commonNewMediaGenerationShape = {
  kind: z.literal('new'),
  episodeId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).max(200).optional()
    .describe('Optional display name for the generated Resource or candidate set.'),
  prompt: z.string().trim().min(1)
    .describe('Complete generation instruction for the configured media model.'),
  contextReferences: contextReferenceSchema,
} as const

// Audio is deliberately excluded: create_audio produces exactly one Resource
// per call, so only image and video requests carry a candidate count.
const candidateCountSchema = z.number().int().min(1).max(6).optional()
  .describe('Number of new candidates to generate. Defaults to 1.')

const retryMediaGenerationRequestSchema = z.object({
  kind: z.literal('retry'),
  resourceIds: z.array(z.string().trim().min(1)).min(1).max(6)
    .describe('Exact failed Resource IDs whose original frozen generation inputs must be retried.'),
}).strict()

const independentImageSchemaIds = CREATIVE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA.image
  .filter((schemaId) => resolveAssetImageKindForSchemaId(schemaId) === null)
if (independentImageSchemaIds.length === 0) {
  throw new Error('CREATIVE_RESOURCE_INDEPENDENT_IMAGE_SCHEMA_REQUIRED')
}

const createTextInputSchema = z.object({
  episodeId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).max(200).optional()
    .describe('Optional display name for the text Resource or candidate set.'),
  prompt: z.string().trim().min(1)
    .describe('The user request or authoring instruction that produced this text.'),
  content: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('single'),
      text: z.string().trim().min(1).describe('One completed text result.'),
    }).strict(),
    z.object({
      kind: z.literal('candidates'),
      candidates: z.array(z.object({
        name: z.string().trim().min(1).max(200).optional()
          .describe('Optional candidate display name.'),
        text: z.string().trim().min(1)
          .describe('Completed candidate text.'),
      }).strict()).min(2).max(6)
        .describe('Two to six independently selectable completed text candidates.'),
    }).strict(),
    z.object({
      kind: z.literal('current_user_text'),
      scope: z.enum(['project', 'current_episode'])
        .describe('Persist the exact current-user text at project scope or the currently selected Episode scope.'),
      classification: z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('generic_text'),
        }).strict(),
        z.object({
          kind: z.literal('screenplay'),
          title: z.string().trim().min(1).max(300),
        }).strict(),
      ]).describe('Classify a complete project screenplay as screenplay; use generic_text for every other exact excerpt.'),
      text: z.string().trim().min(1)
        .describe('An exact contiguous excerpt of the visible user message that started this turn. Do not rewrite, summarize, normalize, or copy text from an earlier turn.'),
    }).strict(),
  ]).describe('Choose one completed result or a selectable candidate set.'),
  contextReferences: contextReferenceSchema,
}).strict()

const createImageNewRequestSchema = z.object({
  ...commonNewMediaGenerationShape,
  count: candidateCountSchema,
  imageReferences: imageReferenceSchema,
  schemaId: z.enum(independentImageSchemaIds as [string, ...string[]]).optional()
    .describe('Professional meaning of an independent image Resource. Omit to use generic.image.'),
  aspectRatio: z.string().trim().min(1).optional()
    .describe('Requested output aspect ratio such as 9:16 or 16:9. Omit to use the project ratio.'),
  resolution: z.string().trim().min(1).optional()
    .describe('Optional resolution supported by the configured image generation capability, such as 1K or 2K.'),
  quality: z.string().trim().min(1).optional()
    .describe('Optional quality tier supported by the configured image generation capability.'),
  size: z.string().trim().min(1).optional()
    .describe('Optional provider-independent image size supported by the configured image generation capability.'),
}).strict()

const createAssetImageRequestSchema = z.object({
  kind: z.literal('asset'),
  name: z.string().trim().min(1).max(200).optional()
    .describe('Optional display name for the generated asset image Resource.'),
  prompt: z.string().trim().min(1)
    .describe('Complete visual design instruction for this exact Project asset.'),
  contextReferences: contextReferenceSchema,
  imageReferences: imageReferenceSchema,
  assetBinding: z.object({
    assetKind: z.enum(['character', 'location', 'prop']),
    assetId: z.string().trim().min(1),
    variantId: z.string().trim().min(1),
    expectedVersion: z.number().int().nonnegative().nullable(),
  }).strict()
    .describe('Exact Project asset variant that receives the completed image Resource binding. It never changes the asset design.'),
}).strict()

const createImageInputSchema = z.object({
  request: z.discriminatedUnion('kind', [
    createImageNewRequestSchema,
    createAssetImageRequestSchema,
    retryMediaGenerationRequestSchema,
  ]),
}).strict()

const createAudioNewRequestSchema = z.object({
  ...commonNewMediaGenerationShape,
  videoReference: audioVideoReferenceSchema,
  durationSeconds: z.number().int().min(1).max(600)
    .describe('Requested audio duration in seconds.'),
  vocalMode: z.enum(['instrumental', 'vocal']).optional()
    .describe('Whether the configured music generation capability should produce instrumental or vocal audio.'),
  genre: z.string().trim().min(1).optional()
    .describe('Optional musical genre.'),
  mood: z.string().trim().min(1).optional()
    .describe('Optional musical mood.'),
  bpm: z.number().int().min(20).max(300).optional()
    .describe('Optional tempo in beats per minute.'),
  outputFormat: z.enum(['mp3', 'wav']).optional()
    .describe('Requested audio file format.'),
}).strict()

const createAudioInputSchema = z.object({
  request: z.discriminatedUnion('kind', [
    createAudioNewRequestSchema,
    retryMediaGenerationRequestSchema,
  ]),
}).strict()

const createVideoNewRequestBaseShape = {
  ...commonNewMediaGenerationShape,
  count: candidateCountSchema,
  schemaId: z.enum(CREATIVE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA.video as [string, ...string[]]).optional()
    .describe('Professional meaning of the video Resource. Omit to use generic.video.'),
  durationSeconds: z.number().int().min(1).max(CREATIVE_VIDEO_SEGMENT_DURATION_CEILING_SECONDS)
    .describe('Exact duration for this one generated video segment. It must match a duration supported by the server-configured video model and cannot exceed the product ceiling of 15 seconds.'),
  aspectRatio: z.string().trim().min(1).optional()
    .describe('Requested output aspect ratio such as 9:16 or 16:9. Omit to use the project ratio.'),
  resolution: z.string().trim().min(1).optional()
    .describe('Optional resolution supported by the configured video generation capability, such as 720p or 1080p.'),
  generateAudio: z.boolean().optional()
    .describe('Whether the configured video generation capability should generate synchronized native audio.'),
} as const

const createVideoWithoutAudioReferencesRequestSchema = z.object({
  ...createVideoNewRequestBaseShape,
  imageReferences: videoImageReferenceSchema,
}).strict()

const createVideoWithAudioReferencesRequestSchema = z.object({
  ...createVideoNewRequestBaseShape,
  imageReferences: z.array(videoAudioCompatibleImageReferenceSchema).min(1).max(8)
    .describe('At least one image reference is required when audioReferences are present.'),
  audioReferences: z.array(creativeResourceInputRefSchema).min(1).max(3),
}).strict()

const createVideoNewRequestSchema = z.union([
  createVideoWithoutAudioReferencesRequestSchema,
  createVideoWithAudioReferencesRequestSchema,
])

const createVideoPromptSetRequestSchema = z.object({
  kind: z.literal('prompt_set'),
  resourceId: z.string().trim().min(1).max(32)
    .describe('Exact ready project.video_prompt_set Resource. The server reads every segment prompt, duration, and media Resource ID directly and creates the video Tasks; do not copy or remap them.'),
}).strict()

const createVideoInputSchema = z.object({
  request: z.union([
    createVideoNewRequestSchema,
    createVideoPromptSetRequestSchema,
    retryMediaGenerationRequestSchema,
  ]),
}).strict()

type CreateTextInput = z.infer<typeof createTextInputSchema>
type CreateImageInput = z.infer<typeof createImageInputSchema>
type CreateAudioInput = z.infer<typeof createAudioInputSchema>
type CreateVideoInput = z.infer<typeof createVideoInputSchema>
type CreateImageNewRequest = z.infer<typeof createImageNewRequestSchema>
type CreateAssetImageRequest = z.infer<typeof createAssetImageRequestSchema>
type CreateAudioNewRequest = z.infer<typeof createAudioNewRequestSchema>
type CreateVideoNewRequest = z.infer<typeof createVideoNewRequestSchema>
type CreateVideoPromptSetRequest = z.infer<typeof createVideoPromptSetRequestSchema>
type RetryMediaGenerationRequest = z.infer<typeof retryMediaGenerationRequestSchema>
type MediaGenerationInput = CreateImageInput | CreateAudioInput | CreateVideoInput
type CreateImageGenerationRequest = CreateImageNewRequest | CreateAssetImageRequest
type NewMediaGenerationRequest = CreateImageGenerationRequest | CreateAudioNewRequest | CreateVideoNewRequest

const resourceRefOutputSchema = z.object({
  resourceId: z.string().min(1),
  candidateIndex: z.number().int().min(0).nullable(),
}).strict()

const createTextOutputSchema = z.object({
  success: z.literal(true),
  resources: z.array(resourceRefOutputSchema).min(1),
}).strict()

const mediaTaskOutputSchema = refineTaskSubmitOperationOutputSchema(
  taskSubmitOperationOutputSchemaBase.extend({
    taskIds: z.array(z.string().min(1)).min(1),
    resources: z.array(resourceRefOutputSchema).min(1),
  }).passthrough(),
)

const generationPlanResourceSchema = z.object({
  resourceId: z.string().min(1),
  name: z.string().min(1),
  candidateIndex: z.number().int().min(0),
}).strict()

const generationPlanMetadataBaseShape = {
  mediaType: z.enum(['image', 'audio', 'video']),
  schemaId: z.string().min(1),
  episodeId: z.string().nullable(),
  requestId: z.string().min(1),
  candidateSetId: z.string().nullable(),
  projectVideoRatio: z.object({
    value: z.string().min(1),
    fingerprint: z.string().length(64),
  }).strict().optional(),
} as const

const generationPlanMetadataSchema = z.discriminatedUnion('retry', [
  z.object({
    ...generationPlanMetadataBaseShape,
    retry: z.literal(false),
    resources: z.array(generationPlanResourceSchema).min(1),
  }).strict(),
  z.object({
    ...generationPlanMetadataBaseShape,
    retry: z.literal(true),
    resources: z.array(generationPlanResourceSchema.extend({
      sourceTaskId: z.string().min(1),
    }).strict()).min(1),
  }).strict(),
])

function resolveEpisodeId(input: { episodeId?: string }, ctx: ProjectAgentOperationContext): string | null {
  return input.episodeId?.trim() || ctx.context.episodeId?.trim() || null
}

function normalizeInputReferences(
  references: readonly z.infer<typeof creativeResourceInputRefSchema>[] | undefined,
  input: {
    readonly defaultRole: string
    readonly positionOffset: number
  },
): CreativeResourceInputRef[] {
  return (references ?? []).map((reference, position) => ({
    resourceId: reference.resourceId,
    role: reference.role ?? input.defaultRole,
    position: input.positionOffset + position,
  }))
}

function normalizeMediaInputReferences(input: NewMediaGenerationRequest): {
  readonly inputs: CreativeResourceInputRef[]
  readonly providerInputs: CreativeResourceInputRef[]
} {
  const contextInputs = normalizeInputReferences(input.contextReferences, {
    defaultRole: 'context',
    positionOffset: 0,
  })
  const rawProviderReferences = [
    ...('imageReferences' in input ? input.imageReferences ?? [] : []),
    ...('audioReferences' in input ? input.audioReferences ?? [] : []),
    ...('videoReference' in input && input.videoReference ? [input.videoReference] : []),
  ]
  const providerInputs = normalizeInputReferences(rawProviderReferences, {
    defaultRole: 'reference',
    positionOffset: contextInputs.length,
  })
  const seen = new Set<string>()
  for (const reference of [...contextInputs, ...providerInputs]) {
    const identity = reference.resourceId
    if (seen.has(identity)) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'CREATIVE_RESOURCE_INPUT_REFERENCE_DUPLICATE',
        field: 'contextReferences',
        resourceId: reference.resourceId,
        agentRetryableAfterCorrection: true,
      })
    }
    seen.add(identity)
  }
  return {
    inputs: [...contextInputs, ...providerInputs],
    providerInputs,
  }
}

async function assertInputReferences(
  userId: string,
  references: readonly CreativeResourceInputRef[],
  requiredMediaType: CreativeResourceMediaType | null,
  field: 'contextReferences' | 'imageReferences' | 'audioReferences' | 'videoReference',
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await validateCreativeResourceInputReferencesInTransaction(tx, userId, references)
    if (!requiredMediaType || references.length === 0) return
    const resources = await tx.creativeResource.findMany({
      where: { id: { in: references.map((reference) => reference.resourceId) } },
      select: { id: true, mediaType: true },
    })
    const mediaTypeById = new Map(resources.map((resource) => [resource.id, resource.mediaType]))
    for (const reference of references) {
      if (mediaTypeById.get(reference.resourceId) !== requiredMediaType) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'CREATIVE_RESOURCE_INPUT_MEDIA_TYPE_INVALID',
          field,
          resourceId: reference.resourceId,
          allowedValues: [requiredMediaType],
          agentRetryableAfterCorrection: true,
        })
      }
    }
  })
}

async function classifyProviderInputReferences(
  references: readonly CreativeResourceInputRef[],
  mediaType: CreativeResourceMediaType,
): Promise<{
  readonly imageInputs: CreativeResourceInputRef[]
  readonly audioInputs: CreativeResourceInputRef[]
  readonly videoInputs: CreativeResourceInputRef[]
  readonly imageInputPositions: number[]
  readonly audioInputPositions: number[]
  readonly videoInputPositions: number[]
}> {
  if (references.length === 0) {
    return {
      imageInputs: [],
      audioInputs: [],
      videoInputs: [],
      imageInputPositions: [],
      audioInputPositions: [],
      videoInputPositions: [],
    }
  }
  const resources = await prisma.creativeResource.findMany({
    where: { id: { in: references.map((reference) => reference.resourceId) } },
    select: { id: true, mediaType: true },
  })
  const mediaTypeById = new Map(resources.map((resource) => [resource.id, resource.mediaType]))
  const allowedMediaTypes: readonly CreativeResourceMediaType[] = mediaType === 'video'
    ? ['image', 'audio']
    : mediaType === 'image'
      ? ['image']
      : mediaType === 'audio'
        ? ['video']
        : []
  const field = mediaType === 'image'
    ? 'imageReferences'
    : mediaType === 'video'
      ? 'imageReferences'
      : 'videoReference'
  const imageInputs: CreativeResourceInputRef[] = []
  const audioInputs: CreativeResourceInputRef[] = []
  const videoInputs: CreativeResourceInputRef[] = []
  for (const reference of references) {
    const referenceMediaType = mediaTypeById.get(reference.resourceId)
    if (!referenceMediaType || !allowedMediaTypes.some((allowed) => allowed === referenceMediaType)) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'CREATIVE_RESOURCE_INPUT_MEDIA_TYPE_INVALID',
        field,
        resourceId: reference.resourceId,
        allowedValues: allowedMediaTypes,
        agentRetryableAfterCorrection: true,
      })
    }
    if (referenceMediaType === 'image') imageInputs.push(reference)
    if (referenceMediaType === 'audio') audioInputs.push(reference)
    if (referenceMediaType === 'video') videoInputs.push(reference)
  }
  return {
    imageInputs,
    audioInputs,
    videoInputs,
    imageInputPositions: imageInputs.map((reference) => reference.position),
    audioInputPositions: audioInputs.map((reference) => reference.position),
    videoInputPositions: videoInputs.map((reference) => reference.position),
  }
}

function requireSchemaForMedia(schemaId: string, mediaType: CreativeResourceMediaType): string {
  let schema: ReturnType<typeof requireCreativeResourceSchema>
  try {
    schema = requireCreativeResourceSchema(schemaId)
  } catch {
    throw new ApiError('INVALID_PARAMS', {
      code: 'CREATIVE_RESOURCE_SCHEMA_UNKNOWN',
      field: 'schemaId',
      requestedValue: schemaId,
      allowedValues: CREATIVE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA[mediaType],
      agentRetryableAfterCorrection: true,
    })
  }
  if (
    schema.mediaType !== mediaType
    || !CREATIVE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA[mediaType].includes(schema.schemaId)
  ) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'CREATIVE_RESOURCE_SCHEMA_MEDIA_MISMATCH',
      field: 'schemaId',
      requestedValue: schema.schemaId,
      allowedValues: CREATIVE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA[mediaType],
      agentRetryableAfterCorrection: true,
    })
  }
  return schema.schemaId
}

async function resolveGenerationModel(input: {
  readonly ctx: ProjectAgentOperationContext
  readonly purpose: SystemModelPurpose
}): Promise<string> {
  return await resolveSystemModelKey({
    userId: input.ctx.userId,
    projectId: input.ctx.projectId,
    purpose: input.purpose,
  })
}

function hashTaskInput(value: unknown): string {
  return stableArgsHash(value)
}

async function createTextResources(
  ctx: ProjectAgentOperationContext,
  input: CreateTextInput,
  tx: Parameters<NonNullable<ReturnType<typeof defineOperation>['executeInTransaction']>>[2],
) {
  const suppliedScreenplayTitle = input.content.kind === 'current_user_text'
    && input.content.classification.kind === 'screenplay'
    ? input.content.classification.title
    : null
  const suppliedScreenplay = suppliedScreenplayTitle !== null
  const schemaId = suppliedScreenplay
    ? CREATIVE_RESOURCE_SCHEMA.SCREENPLAY
    : CREATIVE_RESOURCE_SCHEMA.GENERIC_TEXT
  const currentUserTextMatch = input.content.kind === 'current_user_text'
    ? matchCurrentUserText({
        currentUserTurnText: ctx.context.userTurnText,
        requestedText: input.content.text,
      })
    : null
  if (currentUserTextMatch && !currentUserTextMatch.ok) {
    throw new ApiError('INVALID_PARAMS', {
      code: currentUserTextMatch.code,
      field: 'content.text',
      agentRetryableAfterCorrection: currentUserTextMatch.code === 'CURRENT_USER_TEXT_NOT_EXACT',
    })
  }
  const episodeId = input.content.kind === 'current_user_text'
    ? input.content.scope === 'project'
      ? null
      : ctx.context.episodeId?.trim() || null
    : resolveEpisodeId(input, ctx)
  if (input.content.kind === 'current_user_text' && input.content.scope === 'current_episode' && !episodeId) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'CURRENT_USER_TEXT_EPISODE_SCOPE_UNAVAILABLE',
      field: 'content.scope',
      allowedValues: ['project'],
      agentRetryableAfterCorrection: true,
    })
  }
  if (suppliedScreenplay && episodeId !== null) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'SCREENPLAY_PROJECT_SCOPE_REQUIRED',
      field: 'content.scope',
      allowedValues: ['project'],
      agentRetryableAfterCorrection: true,
    })
  }
  const scope = resolveProjectCreativeResourceScope({
    userId: ctx.userId,
    projectId: ctx.projectId,
    episodeId,
  })
  const references = normalizeInputReferences(input.contextReferences, {
    defaultRole: 'context',
    positionOffset: 0,
  })
  const candidates = input.content.kind === 'candidates'
    ? input.content.candidates
    : [{
        name: suppliedScreenplayTitle ?? input.name,
        text: currentUserTextMatch?.ok ? currentUserTextMatch.text : input.content.text,
      }]
  const requestId = ctx.toolCallId?.trim()
    ? `${ctx.context.runId ?? 'run'}:${ctx.toolCallId.trim()}`
    : randomUUID()
  const candidateSetId = candidates.length > 1
    ? buildCreativeResourceCandidateSetId({ operationId: 'create_text', requestId })
    : null
  const reserved = await reserveCreativeResourcesInTransaction(tx, {
    scope,
    mediaType: 'text',
    schemaId,
    operationId: 'create_text',
    requestId,
    candidateSetId,
    candidates: candidates.map((candidate, candidateIndex) => ({
      name: candidate.name ?? input.name ?? `Text ${String(candidateIndex + 1)}`,
      candidateIndex,
    })),
  })
  const inputHash = stableArgsHash(input)
  const resources = []
  for (const [candidateIndex, candidate] of candidates.entries()) {
    const reservedResource = reserved[candidateIndex]
    if (!reservedResource) throw new Error(`CREATIVE_RESOURCE_RESERVATION_MISSING:${String(candidateIndex)}`)
    const materialized = await materializeCreativeResourceInTransaction(tx, {
      resourceId: reservedResource.resourceId,
      userId: ctx.userId,
      mediaType: 'text',
      schemaId,
      content: suppliedScreenplay
        ? {
            kind: 'structured',
            data: {
              kind: 'screenplay',
              title: suppliedScreenplayTitle ?? candidate.text.trim().slice(0, 300),
              logline: null,
              synopsis: '',
              screenplayText: candidate.text,
              source: {
                kind: 'provided',
                label: suppliedScreenplayTitle ?? candidate.text.trim().slice(0, 500),
              },
              assumptions: [],
              openQuestions: [],
            },
          }
        : { kind: 'text', text: candidate.text },
      inputs: references,
      provenance: {
        operationId: 'create_text',
        inputHash,
        taskId: null,
        operationExecutionId: null,
        executionSegmentId: ctx.context.executionSegmentId ?? null,
        toolCallId: ctx.toolCallId ?? null,
        prompt: input.prompt,
        modelKey: null,
        generationOptions: input.content.kind === 'current_user_text'
          ? { source: 'current_user_turn' }
          : null,
      },
    })
    resources.push({ ...materialized, candidateIndex })
  }
  return createTextOutputSchema.parse({ success: true, resources })
}

interface MediaPlanConfig {
  readonly operationId: 'create_image' | 'create_audio' | 'create_video'
  readonly mediaType: 'image' | 'audio' | 'video'
  readonly schemaId: string
  readonly taskType: TaskType
  readonly modelPurpose: SystemModelPurpose
  readonly modelPayloadKey: 'imageModel' | 'musicModel' | 'videoModel'
}

type ProjectGenerationModelConfig = Awaited<ReturnType<typeof getProjectModelConfig>>

interface MediaGenerationBoundState {
  readonly kind: 'media_generation'
  readonly operationId: MediaPlanConfig['operationId']
  readonly modelKey: string
  readonly projectConfig: ProjectGenerationModelConfig
}

type MediaCapabilityModelType = 'image' | 'music' | 'video'

function requireMediaGenerationCapabilities(
  modelType: MediaCapabilityModelType,
  modelKey: string,
): ModelCapabilities {
  const capabilities = resolveBuiltinCapabilitiesByModelKey(modelType, modelKey)
  if (!capabilities?.[modelType]) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'CAPABILITY_MODEL_UNSUPPORTED',
      field: 'modelKey',
      modelKey,
      requiredCapability: modelType,
      agentRetryableAfterCorrection: false,
    })
  }
  return capabilities
}

function requirePositiveCapabilityLimit(input: {
  readonly field: string
  readonly value: number | undefined
  readonly modelKey: string
}): number {
  if (Number.isInteger(input.value) && input.value !== undefined && input.value > 0) {
    return input.value
  }
  throw new ApiError('INVALID_PARAMS', {
    code: 'CAPABILITY_REQUIRED',
    field: input.field,
    modelKey: input.modelKey,
    agentRetryableAfterCorrection: false,
  })
}

function readMediaGenerationBoundState(
  value: unknown,
  operationId: MediaPlanConfig['operationId'],
): MediaGenerationBoundState | null {
  if (value === undefined) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`CREATIVE_RESOURCE_BOUND_CONTRACT_INVALID:${operationId}`)
  }
  const candidate = value as Partial<MediaGenerationBoundState>
  if (
    candidate.kind !== 'media_generation'
    || candidate.operationId !== operationId
    || typeof candidate.modelKey !== 'string'
    || !candidate.modelKey.trim()
    || !candidate.projectConfig
    || typeof candidate.projectConfig !== 'object'
  ) {
    throw new Error(`CREATIVE_RESOURCE_BOUND_CONTRACT_INVALID:${operationId}`)
  }
  return candidate as MediaGenerationBoundState
}

function stringCapabilitySchema(
  values: readonly CapabilityValue[] | undefined,
): z.ZodType<string> | null {
  const options = (values ?? []).filter((value): value is string => typeof value === 'string')
  return options.length > 0
    ? z.literal(options as [string, ...string[]])
    : null
}

function numberCapabilitySchema(
  values: readonly CapabilityValue[] | undefined,
): z.ZodType<number> | null {
  const options = (values ?? []).filter((value): value is number => (
    typeof value === 'number' && Number.isFinite(value)
  ))
  return options.length > 0
    ? z.literal(options as [number, ...number[]])
    : null
}

function booleanCapabilitySchema(
  values: readonly CapabilityValue[] | undefined,
): z.ZodType<boolean> | null {
  const options = (values ?? []).filter((value): value is boolean => typeof value === 'boolean')
  return options.length > 0
    ? z.literal(options as [boolean, ...boolean[]])
    : null
}

function resolveProjectGenerationRatio(projectConfig: ProjectGenerationModelConfig): string {
  return requireProjectVideoRatio(projectConfig.videoRatio).value
}

async function resolveMediaGenerationBoundState(
  context: ProjectAgentToolInputBindingContext,
  config: MediaPlanConfig,
): Promise<MediaGenerationBoundState> {
  const [modelKey, projectConfig] = await Promise.all([
    resolveSystemModelKey({
      userId: context.userId,
      projectId: context.projectId,
      purpose: config.modelPurpose,
    }),
    getProjectModelConfig(context.projectId, context.userId),
  ])
  return {
    kind: 'media_generation',
    operationId: config.operationId,
    modelKey,
    projectConfig,
  }
}

function createBoundImageInputSchema(
  state: MediaGenerationBoundState,
): RuntimeSchema<CreateImageInput> {
  const capabilities = requireMediaGenerationCapabilities('image', state.modelKey)
  const optionFields = getCapabilityOptionFields('image', capabilities)
  const resolution = stringCapabilitySchema(optionFields.resolution)
  const quality = stringCapabilitySchema(optionFields.quality)
  const size = stringCapabilitySchema(optionFields.size)
  const capabilityShape = {
    ...(resolution ? { resolution: resolution.optional() } : {}),
    ...(quality ? { quality: quality.optional() } : {}),
    ...(size ? { size: size.optional() } : {}),
  }
  const newRequest = z.object({
    ...commonNewMediaGenerationShape,
    count: candidateCountSchema,
    imageReferences: imageReferenceSchema,
    schemaId: createImageNewRequestSchema.shape.schemaId,
    aspectRatio: z.literal(resolveProjectGenerationRatio(state.projectConfig)).optional()
      .describe('Omit to use this exact current project ratio, or copy the allowed value exactly.'),
    ...capabilityShape,
  }).strict()
  return z.object({
    request: z.discriminatedUnion('kind', [
      newRequest,
      createAssetImageRequestSchema,
      retryMediaGenerationRequestSchema,
    ]),
  }).strict() as unknown as RuntimeSchema<CreateImageInput>
}

function createBoundAudioInputSchema(
  state: MediaGenerationBoundState,
): RuntimeSchema<CreateAudioInput> {
  const capabilities = requireMediaGenerationCapabilities('music', state.modelKey)
  const optionFields = getCapabilityOptionFields('music', capabilities)
  const durationOptions = numberCapabilitySchema(optionFields.durationSeconds)
  const durationRange = capabilities?.music?.durationSecondsRange
  if (!durationOptions && !durationRange) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'CAPABILITY_REQUIRED',
      field: 'durationSeconds',
      modelKey: state.modelKey,
      agentRetryableAfterCorrection: false,
    })
  }
  const durationSeconds = durationOptions
    ?? z.number().int().min(Math.ceil(durationRange!.min)).max(Math.floor(durationRange!.max))
  const vocalMode = stringCapabilitySchema(optionFields.vocalMode)
  const outputFormat = stringCapabilitySchema(optionFields.outputFormat)
  const bpm = numberCapabilitySchema(optionFields.bpm)
  const capabilityShape = {
    ...(vocalMode ? { vocalMode: vocalMode.optional() } : {}),
    ...(outputFormat ? { outputFormat: outputFormat.optional() } : {}),
    ...(bpm ? { bpm: bpm.optional() } : {}),
    ...(capabilities.music?.maxReferenceVideos
      ? { videoReference: createAudioNewRequestSchema.shape.videoReference }
      : {}),
  }
  const newRequest = z.object({
    ...commonNewMediaGenerationShape,
    durationSeconds,
    genre: createAudioNewRequestSchema.shape.genre,
    mood: createAudioNewRequestSchema.shape.mood,
    ...capabilityShape,
  }).strict()
  return z.object({
    request: z.discriminatedUnion('kind', [
      newRequest,
      retryMediaGenerationRequestSchema,
    ]),
  }).strict() as unknown as RuntimeSchema<CreateAudioInput>
}

function createBoundVideoInputSchema(
  state: MediaGenerationBoundState,
): RuntimeSchema<CreateVideoInput> {
  const capabilities = requireMediaGenerationCapabilities('video', state.modelKey)
  const optionFields = getCapabilityOptionFields('video', capabilities)
  const durationOptions = numberCapabilitySchema(optionFields.duration)
  if (!durationOptions) {
    throw new Error(`CREATIVE_RESOURCE_VIDEO_DURATION_CAPABILITY_REQUIRED:${state.operationId}`)
  }
  const resolution = stringCapabilitySchema(optionFields.resolution)
  const generateAudio = booleanCapabilitySchema(optionFields.generateAudio)
  const capabilityShape = {
    ...(resolution ? { resolution: resolution.optional() } : {}),
    ...(generateAudio ? { generateAudio: generateAudio.optional() } : {}),
  }
  const commonShape = {
    ...commonNewMediaGenerationShape,
    count: candidateCountSchema,
    schemaId: createVideoNewRequestBaseShape.schemaId,
    durationSeconds: durationOptions
      ?? createVideoNewRequestBaseShape.durationSeconds,
    aspectRatio: z.literal(resolveProjectGenerationRatio(state.projectConfig)).optional()
      .describe('Omit to use this exact current project ratio, or copy the allowed value exactly.'),
    ...capabilityShape,
  } as const
  const maxReferenceImages = requirePositiveCapabilityLimit({
    field: 'maxReferenceImages',
    value: capabilities.video?.maxReferenceImages,
    modelKey: state.modelKey,
  })
  const maxReferenceAudios = capabilities?.video?.maxReferenceAudios ?? 0
  const imageReferences = z.array(creativeResourceInputRefSchema)
    .max(maxReferenceImages)
    .describe(`At most ${String(maxReferenceImages)} ready image Resources for the configured video capability.`)
  const noAudioRequest = z.object({
    ...commonShape,
    imageReferences: supportsTextToVideoModel(state.modelKey)
      ? imageReferences.optional()
      : imageReferences.min(1),
  }).strict()
  const newRequests = maxReferenceAudios > 0
    ? [
        noAudioRequest,
        z.object({
          ...commonShape,
          imageReferences: z.array(videoAudioCompatibleImageReferenceSchema)
            .min(1)
            .max(maxReferenceImages),
          audioReferences: z.array(creativeResourceInputRefSchema)
            .min(1)
            .max(maxReferenceAudios),
        }).strict(),
      ]
    : [noAudioRequest]
  return z.object({
    request: z.union([
      ...newRequests,
      createVideoPromptSetRequestSchema,
      retryMediaGenerationRequestSchema,
    ]),
  }).strict() as unknown as RuntimeSchema<CreateVideoInput>
}

async function bindImageGenerationToolInputSchema(
  context: ProjectAgentToolInputBindingContext,
): Promise<ProjectAgentToolInputBinding<CreateImageInput>> {
  const state = await resolveMediaGenerationBoundState(context, IMAGE_CONFIG)
  return { inputSchema: createBoundImageInputSchema(state), state }
}

async function bindAudioGenerationToolInputSchema(
  context: ProjectAgentToolInputBindingContext,
): Promise<ProjectAgentToolInputBinding<CreateAudioInput>> {
  const state = await resolveMediaGenerationBoundState(context, AUDIO_CONFIG)
  return { inputSchema: createBoundAudioInputSchema(state), state }
}

async function bindVideoGenerationToolInputSchema(
  context: ProjectAgentToolInputBindingContext,
): Promise<ProjectAgentToolInputBinding<CreateVideoInput>> {
  const state = await resolveMediaGenerationBoundState(context, VIDEO_CONFIG)
  return { inputSchema: createBoundVideoInputSchema(state), state }
}

function preferredCapabilityValue(
  values: readonly CapabilityValue[] | undefined,
  preferred: CapabilityValue,
): CapabilityValue | undefined {
  if (!values || values.length === 0) return undefined
  return values.includes(preferred) ? preferred : values[0]
}

function assertCapabilityResolution(
  modelKey: string,
  issues: ReturnType<typeof resolveGenerationOptionsForModel>['issues'],
  requestedSelections: Readonly<Record<string, CapabilityValue>>,
): void {
  const issue = issues[0]
  if (!issue) return
  const field = issue.field.split('.').at(-1) ?? issue.field
  throw new ApiError('INVALID_PARAMS', {
    code: issue.code,
    field,
    modelKey,
    requestedValue: requestedSelections[field] ?? null,
    allowedValues: issue.allowedValues ?? [],
    agentRetryableAfterCorrection: true,
  })
}

function requireCapabilityField(params: {
  readonly field: string
  readonly value: CapabilityValue | undefined
  readonly capabilitiesKnown: boolean
  readonly optionFields: Readonly<Record<string, readonly CapabilityValue[]>>
  readonly modelKey: string
}): void {
  if (params.value === undefined || !params.capabilitiesKnown || params.optionFields[params.field]) return
  throw new ApiError('INVALID_PARAMS', {
    code: 'CAPABILITY_FIELD_INVALID',
    field: params.field,
    modelKey: params.modelKey,
    requestedValue: params.value,
    allowedValues: [],
    agentRetryableAfterCorrection: true,
  })
}

async function resolveFrozenGenerationOptions(input: {
  readonly ctx: ProjectAgentOperationContext
  readonly config: MediaPlanConfig
  readonly schemaId: string
  readonly modelKey: string
  readonly publicInput: NewMediaGenerationRequest
  readonly projectConfig?: ProjectGenerationModelConfig
}): Promise<Record<string, string | number | boolean>> {
  const modelType: UnifiedModelType = input.config.mediaType === 'audio' ? 'music' : input.config.mediaType
  const projectConfig = input.projectConfig
    ?? await getProjectModelConfig(input.ctx.projectId, input.ctx.userId)
  const capabilities = requireMediaGenerationCapabilities(modelType, input.modelKey)
  const optionFields = getCapabilityOptionFields(modelType, capabilities)
  const optionFieldNames = new Set(Object.keys(optionFields))
  const explicitSelections: Record<string, CapabilityValue> = {}

  if (input.config.mediaType === 'image') {
    const publicInput = input.publicInput as CreateImageGenerationRequest
    if (publicInput.kind === 'new') {
      for (const field of ['resolution', 'quality', 'size'] as const) {
        requireCapabilityField({
          field,
          value: publicInput[field],
          capabilitiesKnown: true,
          optionFields,
          modelKey: input.modelKey,
        })
        if (publicInput[field] !== undefined) explicitSelections[field] = publicInput[field]
      }
    }
  } else if (input.config.mediaType === 'video') {
    const publicInput = input.publicInput as CreateVideoNewRequest
    const selections = {
      duration: publicInput.durationSeconds,
      resolution: publicInput.resolution,
      generateAudio: publicInput.generateAudio,
    } as const
    for (const [field, value] of Object.entries(selections)) {
      requireCapabilityField({
        field,
        value,
        capabilitiesKnown: true,
        optionFields,
        modelKey: input.modelKey,
      })
      if (value !== undefined) explicitSelections[field] = value
    }
  } else {
    const publicInput = input.publicInput as CreateAudioNewRequest
    const durationOptions = optionFields.durationSeconds
    const durationRange = capabilities?.music?.durationSecondsRange
    if (
      durationOptions
      && !durationOptions.some((value) => value === publicInput.durationSeconds)
    ) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'CAPABILITY_VALUE_NOT_ALLOWED',
        field: 'durationSeconds',
        modelKey: input.modelKey,
        requestedValue: publicInput.durationSeconds,
        allowedValues: durationOptions,
        agentRetryableAfterCorrection: true,
      })
    }
    if (
      durationRange
      && (
        publicInput.durationSeconds < durationRange.min
        || publicInput.durationSeconds > durationRange.max
      )
    ) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'CAPABILITY_VALUE_NOT_ALLOWED',
        field: 'durationSeconds',
        modelKey: input.modelKey,
        requestedValue: publicInput.durationSeconds,
        allowedValues: [durationRange.min, durationRange.max],
        agentRetryableAfterCorrection: true,
      })
    }
    if (optionFieldNames.has('durationSeconds')) {
      explicitSelections.durationSeconds = publicInput.durationSeconds
    }
    for (const [field, value] of Object.entries({
      vocalMode: publicInput.vocalMode,
      outputFormat: publicInput.outputFormat,
      bpm: publicInput.bpm,
    })) {
      requireCapabilityField({
        field,
        value,
        capabilitiesKnown: true,
        optionFields,
        modelKey: input.modelKey,
      })
      if (value !== undefined) {
        explicitSelections[field] = value
      }
    }
  }

  const partial = resolveGenerationOptionsForModel({
    modelType,
    modelKey: input.modelKey,
    capabilities,
    capabilityDefaults: projectConfig.capabilityDefaults,
    capabilityOverrides: projectConfig.capabilityOverrides,
    runtimeSelections: explicitSelections,
    requireAllFields: false,
  })
  assertCapabilityResolution(input.modelKey, partial.issues, explicitSelections)
  const completedSelections: Record<string, CapabilityValue> = { ...partial.options }

  const fill = (field: string, preferred: CapabilityValue): void => {
    if (completedSelections[field] !== undefined) return
    const value = preferredCapabilityValue(optionFields[field], preferred)
    if (value !== undefined) completedSelections[field] = value
  }
  if (modelType === 'video') {
    fill('generationMode', 'normal')
    fill('duration', 5)
    fill('resolution', '720p')
    fill('generateAudio', true)
  } else if (modelType === 'music') {
    fill('vocalMode', 'instrumental')
    fill('outputFormat', 'mp3')
  }

  const resolved = resolveGenerationOptionsForModel({
    modelType,
    modelKey: input.modelKey,
    capabilities,
    capabilityDefaults: projectConfig.capabilityDefaults,
    capabilityOverrides: projectConfig.capabilityOverrides,
    runtimeSelections: completedSelections,
    requireAllFields: true,
  })
  assertCapabilityResolution(input.modelKey, resolved.issues, completedSelections)

  const frozen: Record<string, string | number | boolean> = { ...resolved.options }
  const requestedAspectRatio = input.config.mediaType === 'image'
    ? (
        (input.publicInput as CreateImageGenerationRequest).kind === 'new'
          ? (input.publicInput as CreateImageNewRequest).aspectRatio?.trim()
          : undefined
      )
    : input.config.mediaType === 'video'
      ? (input.publicInput as CreateVideoNewRequest).aspectRatio?.trim()
      : undefined
  const isFramedMedia = input.config.mediaType === 'image' || input.config.mediaType === 'video'
  const assetImageKind = input.config.mediaType === 'image'
    ? resolveAssetImageKindForSchemaId(input.schemaId)
    : null
  const assetAspectRatio = assetImageKind
    ? getAssetImageFormatPolicy(assetImageKind).aspectRatio
    : null
  const projectAspectRatio = isFramedMedia && !assetAspectRatio
    ? requireProjectVideoRatio(projectConfig.videoRatio).value
    : null
  const requiredAspectRatio = assetAspectRatio ?? projectAspectRatio
  if (isFramedMedia && requestedAspectRatio && requestedAspectRatio !== requiredAspectRatio) {
    throw new ApiError('INVALID_PARAMS', {
      code: assetAspectRatio ? 'ASSET_IMAGE_RATIO_MISMATCH' : 'PROJECT_VIDEO_RATIO_MISMATCH',
      field: 'aspectRatio',
      requestedAspectRatio,
      requiredAspectRatio,
      agentRetryableAfterCorrection: true,
    })
  }
  const resolvedAspectRatio = requiredAspectRatio
  if (input.config.mediaType === 'image') {
    const publicInput = input.publicInput as CreateImageGenerationRequest
    frozen.aspectRatio = resolvedAspectRatio as string
    if (publicInput.kind === 'new' && publicInput.size) frozen.size = publicInput.size
  } else if (input.config.mediaType === 'video') {
    frozen.aspectRatio = resolvedAspectRatio as string
  } else {
    const publicInput = input.publicInput as CreateAudioNewRequest
    frozen.durationSeconds = publicInput.durationSeconds
    frozen.vocalMode = publicInput.vocalMode ?? String(frozen.vocalMode ?? 'instrumental')
    frozen.outputFormat = publicInput.outputFormat ?? String(frozen.outputFormat ?? 'mp3')
  }
  return frozen
}

async function planNewMediaGeneration(
  ctx: ProjectAgentOperationContext,
  input: NewMediaGenerationRequest,
  config: MediaPlanConfig,
): Promise<OperationPlan> {
  const assetImageRequest = input.kind === 'asset' ? input : null
  if (assetImageRequest && config.mediaType !== 'image') {
    throw new Error(`CREATIVE_RESOURCE_ASSET_IMAGE_MEDIA_INVALID:${config.mediaType}`)
  }
  const schemaId = input.kind === 'asset'
    ? getAssetImageFormatPolicy(input.assetBinding.assetKind).schemaId
    : requireSchemaForMedia(('schemaId' in input ? input.schemaId : undefined) ?? config.schemaId, config.mediaType)
  const requestedAssetBinding = assetImageRequest?.assetBinding
  const episodeId = input.kind === 'asset' ? null : resolveEpisodeId(input, ctx)
  const assetImageKind = config.mediaType === 'image'
    ? resolveAssetImageKindForSchemaId(schemaId)
    : null
  if (requestedAssetBinding) {
    const targetExists = requestedAssetBinding.assetKind === 'character'
      ? await prisma.characterAppearance.count({
          where: {
            id: requestedAssetBinding.variantId,
            characterId: requestedAssetBinding.assetId,
            character: { projectId: ctx.projectId, project: { userId: ctx.userId } },
          },
        })
      : await prisma.locationImage.count({
          where: {
            id: requestedAssetBinding.variantId,
            locationId: requestedAssetBinding.assetId,
            location: {
              projectId: ctx.projectId,
              assetKind: requestedAssetBinding.assetKind,
              project: { userId: ctx.userId },
            },
          },
        })
    if (targetExists !== 1) {
      throw new ApiError('NOT_FOUND', {
        code: 'ASSET_IMAGE_BINDING_TARGET_NOT_FOUND',
        field: 'assetBinding.variantId',
      })
    }
  }
  const prompt = assetImageKind
    ? applyAssetImageFormatPolicy({
        prompt: input.prompt,
        kind: assetImageKind,
        locale: resolveOperationLocale(ctx.context),
      })
    : input.prompt
  const effectiveInput = prompt === input.prompt ? input : { ...input, prompt }
  const normalizedReferences = normalizeMediaInputReferences(effectiveInput)
  const references = normalizedReferences.inputs
  await assertInputReferences(
    ctx.userId,
    references,
    null,
    'contextReferences',
  )
  const providerReferences = await classifyProviderInputReferences(
    normalizedReferences.providerInputs,
    config.mediaType,
  )
  const boundState = readMediaGenerationBoundState(
    ctx.boundToolContractState,
    config.operationId,
  )
  const modelKey = boundState?.modelKey
    ?? await resolveGenerationModel({
      ctx,
      purpose: config.modelPurpose,
    })
  if (config.mediaType === 'video') {
    if (providerReferences.audioInputs.length > 0 && providerReferences.imageInputs.length === 0) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'VIDEO_MODEL_REFERENCE_AUDIO_REQUIRES_IMAGE',
        field: 'audioReferences',
        modelKey,
        agentRetryableAfterCorrection: true,
      })
    }
    if (
      providerReferences.audioInputs.length > 0
      && providerReferences.imageInputs.some((reference) => (
        reference.role === 'first_frame' || reference.role === 'last_frame'
      ))
    ) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'VIDEO_MODEL_REFERENCE_AUDIO_FRAME_ROLE_CONFLICT',
        field: 'audioReferences',
        modelKey,
        agentRetryableAfterCorrection: true,
      })
    }
    if (providerReferences.imageInputs.length === 0 && !supportsTextToVideoModel(modelKey)) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'VIDEO_MODEL_TEXT_TO_VIDEO_UNSUPPORTED',
        field: 'imageReferences',
        modelKey,
        requiredCapability: 'textToVideo',
        agentRetryableAfterCorrection: true,
      })
    }
    const maxReferences = resolveBuiltinCapabilitiesByModelKey('video', modelKey)?.video?.maxReferenceImages ?? 1
    if (providerReferences.imageInputs.length > maxReferences) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'VIDEO_MODEL_REFERENCE_LIMIT_EXCEEDED',
        field: 'imageReferences',
        modelKey,
        requestedValue: providerReferences.imageInputs.length,
        allowedValues: [maxReferences],
        agentRetryableAfterCorrection: true,
      })
    }
    const maxReferenceAudios = resolveBuiltinCapabilitiesByModelKey('video', modelKey)?.video?.maxReferenceAudios
    if (
      providerReferences.audioInputs.length > 0
      && (!maxReferenceAudios || providerReferences.audioInputs.length > maxReferenceAudios)
    ) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'VIDEO_MODEL_AUDIO_REFERENCE_LIMIT_EXCEEDED',
        field: 'audioReferences',
        modelKey,
        requestedValue: providerReferences.audioInputs.length,
        allowedValues: [maxReferenceAudios ?? 0],
        agentRetryableAfterCorrection: true,
      })
    }
  }
  if (config.mediaType === 'audio') {
    const maxReferenceVideos = resolveBuiltinCapabilitiesByModelKey('music', modelKey)?.music?.maxReferenceVideos
    if (
      providerReferences.videoInputs.length > 0
      && (!maxReferenceVideos || providerReferences.videoInputs.length > maxReferenceVideos)
    ) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'MUSIC_MODEL_VIDEO_REFERENCE_LIMIT_EXCEEDED',
        field: 'videoReference',
        modelKey,
        requestedValue: providerReferences.videoInputs.length,
        allowedValues: [maxReferenceVideos ?? 0],
        agentRetryableAfterCorrection: true,
      })
    }
  }
  const generationOptions = await resolveFrozenGenerationOptions({
    ctx,
    config,
    schemaId,
    modelKey,
    publicInput: effectiveInput,
    projectConfig: boundState?.projectConfig,
  })
  const inputHash = hashTaskInput({
    operationId: config.operationId,
    prompt,
    modelKey,
    schemaId,
    references,
    imageInputPositions: providerReferences.imageInputPositions,
    audioInputPositions: providerReferences.audioInputPositions,
    videoInputPositions: providerReferences.videoInputPositions,
    generationOptions,
    assetBinding: requestedAssetBinding ?? null,
    ...(config.mediaType === 'audio' ? {
      durationSeconds: (effectiveInput as CreateAudioNewRequest).durationSeconds,
      vocalMode: (effectiveInput as CreateAudioNewRequest).vocalMode,
      genre: (effectiveInput as CreateAudioNewRequest).genre,
      mood: (effectiveInput as CreateAudioNewRequest).mood,
      bpm: (effectiveInput as CreateAudioNewRequest).bpm,
      outputFormat: (effectiveInput as CreateAudioNewRequest).outputFormat,
    } : {}),
  })
  const requestId = [
    'generation',
    config.operationId,
    ctx.userId,
    ctx.projectId,
    episodeId ?? 'project',
    ctx.context.runId?.trim() || 'no-run',
    ctx.toolCallId?.trim() || stableArgsHash({ input: effectiveInput, modelKey, schemaId, references, generationOptions }),
    inputHash,
  ].join(':')
  const count = 'count' in input ? input.count ?? 1 : 1
  const resources = Array.from({ length: count }, (_, candidateIndex) => ({
    resourceId: buildCreativeResourceId({
      operationId: config.operationId,
      requestId,
      candidateIndex,
    }),
    name: input.name ?? `${config.mediaType[0]?.toUpperCase() ?? ''}${config.mediaType.slice(1)} ${String(candidateIndex + 1)}`,
    candidateIndex,
  }))
  const candidateSetId = resources.length > 1
    ? buildCreativeResourceCandidateSetId({ operationId: config.operationId, requestId })
    : null
  const tasks = resources.map((resource) => {
    const resourcePayload = {
      resourceId: resource.resourceId,
      mediaType: config.mediaType,
      schemaId,
      prompt,
      modelKey,
      inputHash,
      inputs: references,
      imageInputPositions: providerReferences.imageInputPositions,
      audioInputPositions: providerReferences.audioInputPositions,
      videoInputPositions: providerReferences.videoInputPositions,
      generationOptions,
      // Approval revalidates the frozen plan in a later decision segment. The
      // stable toolCallId identifies the creative invocation across both
      // segments; the commit receives its own operationExecutionId.
      executionSegmentId: null,
      toolCallId: ctx.toolCallId?.trim() || null,
      ...(requestedAssetBinding ? {
        binding: {
          kind: 'project_asset_image' as const,
          ...requestedAssetBinding,
        },
      } : {}),
    }
    const payload = {
      lifecycleProjection: buildCreativeResourceLifecycleProjection([{
        resourceId: resource.resourceId,
        mediaType: config.mediaType,
        schemaId,
        name: resource.name,
      }]),
      resource: resourcePayload,
      [config.modelPayloadKey]: modelKey,
      prompt,
      count: 1 as const,
      generationOptions,
      ...(config.mediaType === 'audio' ? {
        durationSeconds: (effectiveInput as CreateAudioNewRequest).durationSeconds,
        ...((effectiveInput as CreateAudioNewRequest).vocalMode ? { vocalMode: (effectiveInput as CreateAudioNewRequest).vocalMode } : {}),
        ...((effectiveInput as CreateAudioNewRequest).genre ? { genre: (effectiveInput as CreateAudioNewRequest).genre } : {}),
        ...((effectiveInput as CreateAudioNewRequest).mood ? { mood: (effectiveInput as CreateAudioNewRequest).mood } : {}),
        ...(typeof (effectiveInput as CreateAudioNewRequest).bpm === 'number' ? { bpm: (effectiveInput as CreateAudioNewRequest).bpm } : {}),
        ...((effectiveInput as CreateAudioNewRequest).outputFormat ? { outputFormat: (effectiveInput as CreateAudioNewRequest).outputFormat } : {}),
      } : {}),
    }
    return createPlannedTask({
      id: `${config.operationId}:${resource.resourceId}`,
      taskType: config.taskType,
      targetType: 'CreativeResource',
      targetId: resource.resourceId,
      payload,
      locale: resolveOperationLocale(ctx.context),
      episodeId,
      dedupeKey: `${config.operationId}:${resource.resourceId}:${inputHash}`,
      billingInfo: requirePlannedTaskBillingInfo({
        taskType: config.taskType,
        payload,
        allowedApiTypes: [config.mediaType === 'audio' ? 'music' : config.mediaType],
      }),
    })
  })
  return {
    kind: 'task_submission',
    operationId: config.operationId,
    projectId: ctx.projectId,
    userId: ctx.userId,
    tasks,
    reservedIdentityIds: resources.map((resource) => resource.resourceId),
    metadata: {
      mediaType: config.mediaType,
      schemaId,
      episodeId,
      requestId,
      candidateSetId,
      retry: false,
      resources,
    },
  }
}

async function planMediaGenerationRetry(
  ctx: ProjectAgentOperationContext,
  input: RetryMediaGenerationRequest,
  config: MediaPlanConfig,
): Promise<OperationPlan> {
  const episodeId = ctx.context.episodeId?.trim() || null
  const candidates = await loadCreativeResourceRetryCandidates({
    userId: ctx.userId,
    projectId: ctx.projectId,
    episodeId,
    operationId: config.operationId,
    taskType: config.taskType,
    mediaType: config.mediaType,
    resourceIds: input.resourceIds,
  })
  const schemaIds = new Set(candidates.map((candidate) => candidate.schemaId))
  if (schemaIds.size !== 1) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'CREATIVE_RESOURCE_RETRY_SCHEMA_MIXED',
      field: 'request.resourceIds',
      requestedValue: input.resourceIds,
      agentRetryableAfterCorrection: true,
    })
  }
  const schemaId = requireSchemaForMedia(candidates[0]?.schemaId ?? config.schemaId, config.mediaType)
  for (const candidate of candidates) {
    const references = candidate.payload.resource.inputs
    const inputByPosition = new Map(references.map((reference) => [reference.position, reference]))
    const imageInputs = candidate.payload.resource.imageInputPositions.map((position) => {
      const reference = inputByPosition.get(position)
      if (!reference) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'CREATIVE_RESOURCE_RETRY_FROZEN_INPUT_INVALID',
          field: 'request.resourceIds',
          resourceId: candidate.resourceId,
          agentRetryableAfterCorrection: false,
        })
      }
      return reference
    })
    const audioInputs = candidate.payload.resource.audioInputPositions.map((position) => {
      const reference = inputByPosition.get(position)
      if (!reference) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'CREATIVE_RESOURCE_RETRY_FROZEN_INPUT_INVALID',
          field: 'request.resourceIds',
          resourceId: candidate.resourceId,
          agentRetryableAfterCorrection: false,
        })
      }
      return reference
    })
    const videoInputs = candidate.payload.resource.videoInputPositions.map((position) => {
      const reference = inputByPosition.get(position)
      if (!reference) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'CREATIVE_RESOURCE_RETRY_FROZEN_INPUT_INVALID',
          field: 'request.resourceIds',
          resourceId: candidate.resourceId,
          agentRetryableAfterCorrection: false,
        })
      }
      return reference
    })
    await assertInputReferences(ctx.userId, references, null, 'contextReferences')
    await assertInputReferences(
      ctx.userId,
      imageInputs,
      'image',
      'imageReferences',
    )
    await assertInputReferences(ctx.userId, audioInputs, 'audio', 'audioReferences')
    await assertInputReferences(ctx.userId, videoInputs, 'video', 'videoReference')
    if (config.mediaType === 'audio') {
      const maxReferenceVideos = resolveBuiltinCapabilitiesByModelKey('music', candidate.payload.resource.modelKey)
        ?.music?.maxReferenceVideos
      if (videoInputs.length > 0 && (!maxReferenceVideos || videoInputs.length > maxReferenceVideos)) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'MUSIC_MODEL_VIDEO_REFERENCE_LIMIT_EXCEEDED',
          field: 'request.resourceIds',
          modelKey: candidate.payload.resource.modelKey,
          resourceId: candidate.resourceId,
          agentRetryableAfterCorrection: false,
        })
      }
    }
    if (config.mediaType === 'video') {
      if (audioInputs.length > 0 && imageInputs.length === 0) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'VIDEO_MODEL_REFERENCE_AUDIO_REQUIRES_IMAGE',
          field: 'request.resourceIds',
          modelKey: candidate.payload.resource.modelKey,
          resourceId: candidate.resourceId,
          agentRetryableAfterCorrection: false,
        })
      }
      if (
        audioInputs.length > 0
        && imageInputs.some((reference) => reference.role === 'first_frame' || reference.role === 'last_frame')
      ) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'VIDEO_MODEL_REFERENCE_AUDIO_FRAME_ROLE_CONFLICT',
          field: 'request.resourceIds',
          modelKey: candidate.payload.resource.modelKey,
          resourceId: candidate.resourceId,
          agentRetryableAfterCorrection: false,
        })
      }
      const capabilities = resolveBuiltinCapabilitiesByModelKey('video', candidate.payload.resource.modelKey)?.video
      const maxReferenceImages = capabilities?.maxReferenceImages ?? 1
      const maxReferenceAudios = capabilities?.maxReferenceAudios
      if (imageInputs.length > maxReferenceImages) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'VIDEO_MODEL_REFERENCE_LIMIT_EXCEEDED',
          field: 'request.resourceIds',
          modelKey: candidate.payload.resource.modelKey,
          resourceId: candidate.resourceId,
          agentRetryableAfterCorrection: false,
        })
      }
      if (audioInputs.length > 0 && (!maxReferenceAudios || audioInputs.length > maxReferenceAudios)) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'VIDEO_MODEL_AUDIO_REFERENCE_LIMIT_EXCEEDED',
          field: 'request.resourceIds',
          modelKey: candidate.payload.resource.modelKey,
          resourceId: candidate.resourceId,
          agentRetryableAfterCorrection: false,
        })
      }
    }
  }
  const requestId = `generation-retry:${config.operationId}:${stableArgsHash({
    userId: ctx.userId,
    projectId: ctx.projectId,
    episodeId,
    runId: ctx.context.runId?.trim() || null,
    toolCallId: ctx.toolCallId?.trim() || null,
    resources: candidates.map((candidate) => ({
      resourceId: candidate.resourceId,
      sourceTaskId: candidate.sourceTaskId,
    })),
  })}`
  const tasks = candidates.map((candidate) => {
    const payload = buildCreativeResourceRetryTaskPayload({
      frozenPayload: candidate.payload,
      toolCallId: ctx.toolCallId?.trim() || null,
    })
    return createPlannedTask({
      id: `${config.operationId}:retry:${candidate.resourceId}`,
      taskType: config.taskType,
      targetType: 'CreativeResource',
      targetId: candidate.resourceId,
      payload,
      locale: resolveOperationLocale(ctx.context),
      episodeId,
      dedupeKey: `${config.operationId}:retry:${stableArgsHash({
        requestId,
        resourceId: candidate.resourceId,
        sourceTaskId: candidate.sourceTaskId,
      })}`,
      billingInfo: requirePlannedTaskBillingInfo({
        taskType: config.taskType,
        payload,
        allowedApiTypes: [config.mediaType === 'audio' ? 'music' : config.mediaType],
      }),
    })
  })
  const candidateSetIds = new Set(candidates.map((candidate) => candidate.candidateSetId))
  return {
    kind: 'task_submission',
    operationId: config.operationId,
    projectId: ctx.projectId,
    userId: ctx.userId,
    tasks,
    reservedIdentityIds: [],
    metadata: {
      mediaType: config.mediaType,
      schemaId,
      episodeId,
      requestId,
      candidateSetId: candidateSetIds.size === 1 ? candidates[0]?.candidateSetId ?? null : null,
      retry: true,
      resources: candidates.map((candidate) => ({
        resourceId: candidate.resourceId,
        name: candidate.name,
        candidateIndex: candidate.candidateIndex,
        sourceTaskId: candidate.sourceTaskId,
      })),
    },
  }
}

async function planVideoPromptSetGeneration(
  ctx: ProjectAgentOperationContext,
  input: CreateVideoPromptSetRequest,
): Promise<OperationPlan> {
  const promptSetResource = await prisma.creativeResource.findFirst({
    where: {
      id: input.resourceId,
      userId: ctx.userId,
      projectId: ctx.projectId,
      episodeId: { not: null },
      status: 'ready',
      materializedAt: { not: null },
      mediaType: 'text',
      schemaId: CREATIVE_RESOURCE_SCHEMA.VIDEO_PROMPT_SET,
      sourceType: 'CreativeWorkResult',
    },
    select: {
      id: true,
      episodeId: true,
      contentJson: true,
      outputLineage: {
        select: {
          inputResource: {
            select: {
              id: true,
              userId: true,
              projectId: true,
              episodeId: true,
              scopeKind: true,
              scopeId: true,
              status: true,
              materializedAt: true,
              mediaType: true,
              mediaId: true,
            },
          },
        },
      },
    },
  })
  if (!promptSetResource || !promptSetResource.episodeId || promptSetResource.contentJson === null) {
    throw new ApiError('NOT_FOUND', {
      code: 'VIDEO_PROMPT_SET_RESOURCE_NOT_FOUND',
      field: 'request.resourceId',
    })
  }
  const contextEpisodeId = ctx.context.episodeId?.trim() || null
  if (contextEpisodeId && contextEpisodeId !== promptSetResource.episodeId) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'VIDEO_PROMPT_SET_EPISODE_MISMATCH',
      field: 'request.resourceId',
      agentRetryableAfterCorrection: true,
    })
  }
  const promptSet = creativeWorkOutputSchemas.video_prompt_set.parse(promptSetResource.contentJson)
  const sourceById = new Map(
    promptSetResource.outputLineage.map((lineage) => [
      lineage.inputResource.id,
      lineage.inputResource,
    ]),
  )
  const boundState = readMediaGenerationBoundState(
    ctx.boundToolContractState,
    VIDEO_CONFIG.operationId,
  )
  const modelKey = boundState?.modelKey
    ?? await resolveGenerationModel({ ctx, purpose: VIDEO_CONFIG.modelPurpose })
  const capabilities = requireMediaGenerationCapabilities('video', modelKey).video
  if (!capabilities) throw new Error(`CREATIVE_RESOURCE_VIDEO_CAPABILITY_REQUIRED:${modelKey}`)
  const maxReferenceImages = requirePositiveCapabilityLimit({
    field: 'maxReferenceImages',
    value: capabilities.maxReferenceImages,
    modelKey,
  })
  const maxReferenceAudios = capabilities.maxReferenceAudios ?? 0
  const projectConfig = boundState?.projectConfig
    ?? await getProjectModelConfig(ctx.projectId, ctx.userId)
  const planFingerprint = stableArgsHash({
    promptSetResourceId: promptSetResource.id,
    promptSet,
    modelKey,
    projectVideoRatio: projectConfig.videoRatio,
  })
  const requestId = [
    'video-prompt-set',
    ctx.userId,
    ctx.projectId,
    promptSetResource.episodeId,
    ctx.context.runId?.trim() || 'no-run',
    ctx.toolCallId?.trim() || planFingerprint,
    planFingerprint,
  ].join(':')
  const resources = promptSet.segments.map((segment, candidateIndex) => ({
    resourceId: buildCreativeResourceId({
      operationId: VIDEO_CONFIG.operationId,
      requestId,
      candidateIndex,
    }),
    name: `Video ${segment.key}`.slice(0, 191),
    candidateIndex,
  }))
  const tasks = await Promise.all(promptSet.segments.map(async (segment, candidateIndex) => {
    const seen = new Set<string>()
    const mediaSources = segment.mediaResourceIds.map((resourceId) => {
      if (seen.has(resourceId)) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'VIDEO_PROMPT_SET_MEDIA_RESOURCE_DUPLICATE',
          field: 'request.resourceId',
          resourceId,
          agentRetryableAfterCorrection: false,
        })
      }
      seen.add(resourceId)
      const source = sourceById.get(resourceId)
      const sourceScopeAllowed = source
        ? (
            (
              source.scopeKind === 'user'
              && source.scopeId === ctx.userId
              && source.projectId === null
              && source.episodeId === null
            )
            || (
              source.scopeKind === 'project'
              && source.scopeId === ctx.projectId
              && source.projectId === ctx.projectId
              && source.episodeId === null
            )
            || (
              source.scopeKind === 'episode'
              && source.scopeId === promptSetResource.episodeId
              && source.projectId === ctx.projectId
              && source.episodeId === promptSetResource.episodeId
            )
          )
        : false
      if (
        !source
        || source.userId !== ctx.userId
        || !sourceScopeAllowed
        || source.status !== 'ready'
        || source.materializedAt === null
        || source.mediaId === null
        || (source.mediaType !== 'image' && source.mediaType !== 'audio')
      ) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'VIDEO_PROMPT_SET_MEDIA_RESOURCE_INVALID',
          field: 'request.resourceId',
          resourceId,
          agentRetryableAfterCorrection: false,
        })
      }
      return source
    })
    const imageSources = mediaSources.filter((source) => source.mediaType === 'image')
    const audioSources = mediaSources.filter((source) => source.mediaType === 'audio')
    if (audioSources.length > 0 && imageSources.length === 0) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'VIDEO_MODEL_REFERENCE_AUDIO_REQUIRES_IMAGE',
        field: 'request.resourceId',
        modelKey,
        agentRetryableAfterCorrection: false,
      })
    }
    if (imageSources.length === 0 && !supportsTextToVideoModel(modelKey)) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'VIDEO_MODEL_TEXT_TO_VIDEO_UNSUPPORTED',
        field: 'request.resourceId',
        modelKey,
        requiredCapability: 'textToVideo',
        agentRetryableAfterCorrection: false,
      })
    }
    if (imageSources.length > maxReferenceImages) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'VIDEO_MODEL_REFERENCE_LIMIT_EXCEEDED',
        field: 'request.resourceId',
        modelKey,
        requestedValue: imageSources.length,
        allowedValues: [maxReferenceImages],
        agentRetryableAfterCorrection: false,
      })
    }
    if (audioSources.length > maxReferenceAudios) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'VIDEO_MODEL_AUDIO_REFERENCE_LIMIT_EXCEEDED',
        field: 'request.resourceId',
        modelKey,
        requestedValue: audioSources.length,
        allowedValues: [maxReferenceAudios],
        agentRetryableAfterCorrection: false,
      })
    }
    const imageReferences = imageSources.map((source) => ({ resourceId: source.id }))
    const publicInput: CreateVideoNewRequest = audioSources.length > 0
      ? {
          kind: 'new',
          prompt: segment.prompt,
          durationSeconds: segment.durationSeconds,
          contextReferences: [{ resourceId: promptSetResource.id }],
          imageReferences,
          audioReferences: audioSources.map((source) => ({ resourceId: source.id })),
        }
      : {
          kind: 'new',
          prompt: segment.prompt,
          durationSeconds: segment.durationSeconds,
          contextReferences: [{ resourceId: promptSetResource.id }],
          imageReferences,
        }
    const generationOptions = await resolveFrozenGenerationOptions({
      ctx,
      config: VIDEO_CONFIG,
      schemaId: CREATIVE_RESOURCE_SCHEMA.GENERIC_VIDEO,
      modelKey,
      publicInput,
      projectConfig,
    })
    const inputs: CreativeResourceInputRef[] = [
      {
        resourceId: promptSetResource.id,
        role: 'video_prompt_set',
        position: 0,
      },
      ...mediaSources.map((source, index) => ({
        resourceId: source.id,
        role: 'reference',
        position: index + 1,
      })),
    ]
    const imageInputPositions = mediaSources.flatMap((source, index) => (
      source.mediaType === 'image' ? [index + 1] : []
    ))
    const audioInputPositions = mediaSources.flatMap((source, index) => (
      source.mediaType === 'audio' ? [index + 1] : []
    ))
    const inputHash = hashTaskInput({
      operationId: VIDEO_CONFIG.operationId,
      promptSetResourceId: promptSetResource.id,
      segmentKey: segment.key,
      prompt: segment.prompt,
      modelKey,
      inputs,
      imageInputPositions,
      audioInputPositions,
      generationOptions,
    })
    const resource = resources[candidateIndex]
    if (!resource) throw new Error(`VIDEO_PROMPT_SET_RESOURCE_PLAN_MISSING:${String(candidateIndex)}`)
    const payload = {
      lifecycleProjection: buildCreativeResourceLifecycleProjection([{
        resourceId: resource.resourceId,
        mediaType: 'video',
        schemaId: CREATIVE_RESOURCE_SCHEMA.GENERIC_VIDEO,
        name: resource.name,
      }]),
      resource: {
        resourceId: resource.resourceId,
        mediaType: 'video' as const,
        schemaId: CREATIVE_RESOURCE_SCHEMA.GENERIC_VIDEO,
        prompt: segment.prompt,
        modelKey,
        inputHash,
        inputs,
        imageInputPositions,
        audioInputPositions,
        videoInputPositions: [],
        generationOptions,
        executionSegmentId: null,
        toolCallId: ctx.toolCallId?.trim() || null,
      },
      videoModel: modelKey,
      prompt: segment.prompt,
      count: 1 as const,
      generationOptions,
    }
    return createPlannedTask({
      id: `${VIDEO_CONFIG.operationId}:${resource.resourceId}`,
      taskType: VIDEO_CONFIG.taskType,
      targetType: 'CreativeResource',
      targetId: resource.resourceId,
      payload,
      locale: resolveOperationLocale(ctx.context),
      episodeId: promptSetResource.episodeId,
      dedupeKey: `${VIDEO_CONFIG.operationId}:prompt-set:${resource.resourceId}:${inputHash}`,
      billingInfo: requirePlannedTaskBillingInfo({
        taskType: VIDEO_CONFIG.taskType,
        payload,
        allowedApiTypes: ['video'],
      }),
    })
  }))
  return {
    kind: 'task_submission',
    operationId: VIDEO_CONFIG.operationId,
    projectId: ctx.projectId,
    userId: ctx.userId,
    tasks,
    reservedIdentityIds: resources.map((resource) => resource.resourceId),
    metadata: {
      mediaType: 'video',
      schemaId: CREATIVE_RESOURCE_SCHEMA.GENERIC_VIDEO,
      episodeId: promptSetResource.episodeId,
      requestId,
      candidateSetId: null,
      retry: false,
      resources,
    },
  }
}

async function planMediaGeneration(
  ctx: ProjectAgentOperationContext,
  input: MediaGenerationInput,
  config: MediaPlanConfig,
): Promise<OperationPlan> {
  if (config.operationId === 'create_video' && input.request.kind === 'prompt_set') {
    return await planVideoPromptSetGeneration(ctx, input.request)
  }
  return input.request.kind === 'retry'
    ? await planMediaGenerationRetry(ctx, input.request, config)
    : await planNewMediaGeneration(ctx, input.request as NewMediaGenerationRequest, config)
}

async function commitMediaGeneration(
  ctx: ProjectAgentOperationContext,
  plan: OperationPlan,
  config: MediaPlanConfig,
) {
  const authorization = ctx.executionAuthorization
  if (!authorization) throw new Error('OPERATION_EXECUTION_AUTHORIZATION_REQUIRED')
  const metadata = generationPlanMetadataSchema.parse(plan.metadata)
  if (metadata.mediaType !== config.mediaType || metadata.schemaId !== requireSchemaForMedia(metadata.schemaId, config.mediaType)) {
    throw new Error(`CREATIVE_RESOURCE_PLAN_CONTRACT_INVALID:${config.operationId}`)
  }
  const scope = resolveProjectCreativeResourceScope({
    userId: ctx.userId,
    projectId: ctx.projectId,
    episodeId: metadata.episodeId,
  })
  if (!metadata.retry) {
    await reserveCreativeResourcesInTransaction(authorization.transaction, {
      scope,
      mediaType: config.mediaType,
      schemaId: metadata.schemaId,
      operationId: config.operationId,
      requestId: metadata.requestId,
      candidateSetId: metadata.candidateSetId,
      candidates: metadata.resources.map((resource) => ({
        resourceId: resource.resourceId,
        name: resource.name,
        candidateIndex: resource.candidateIndex,
      })),
    })
  } else {
    const retryable = await authorization.transaction.creativeResource.count({
      where: {
        id: { in: metadata.resources.map((resource) => resource.resourceId) },
        userId: ctx.userId,
        projectId: ctx.projectId,
        status: 'failed',
        mediaType: config.mediaType,
        schemaId: metadata.schemaId,
      },
    })
    if (retryable !== metadata.resources.length) {
      throw new Error(`CREATIVE_RESOURCE_RETRY_TARGET_CHANGED:${config.operationId}`)
    }
    await authorization.transaction.creativeResource.updateMany({
      where: { id: { in: metadata.resources.map((resource) => resource.resourceId) }, status: 'failed' },
      data: { status: 'pending', errorCode: null, errorMessage: null },
    })
  }
  const submitted = await submitPlannedOperationTasks({ ctx, operationId: config.operationId })
  await createWorkspaceResourceBroadcastsInTransaction({
    tx: authorization.transaction,
    invocationId: authorization.operationExecutionId,
    affectedResources: [{
      kind: 'creativeResources',
      projectId: ctx.projectId,
      episodeId: metadata.episodeId,
    }],
    userId: ctx.userId,
    operationId: config.operationId,
  })
  const results = plan.tasks.map((task) => {
    const result = submitted.get(task.id)
    if (!result) throw new Error(`CREATIVE_RESOURCE_TASK_RESULT_MISSING:${task.id}`)
    return result
  })
  const first = results[0]
  if (!first) throw new Error(`CREATIVE_RESOURCE_OPERATION_PLAN_EMPTY:${config.operationId}`)
  return mediaTaskOutputSchema.parse({
    ...first,
    taskIds: results.map((result) => result.taskId),
    resources: metadata.resources.map((resource) => ({
      resourceId: resource.resourceId,
      candidateIndex: resource.candidateIndex,
    })),
  })
}

const IMAGE_CONFIG: MediaPlanConfig = {
  operationId: 'create_image',
  mediaType: 'image',
  schemaId: CREATIVE_RESOURCE_SCHEMA.GENERIC_IMAGE,
  taskType: TASK_TYPE.CREATIVE_RESOURCE_IMAGE,
  modelPurpose: 'edit-image',
  modelPayloadKey: 'imageModel',
}

const AUDIO_CONFIG: MediaPlanConfig = {
  operationId: 'create_audio',
  mediaType: 'audio',
  schemaId: CREATIVE_RESOURCE_SCHEMA.BGM_AUDIO,
  taskType: TASK_TYPE.CREATIVE_RESOURCE_AUDIO,
  modelPurpose: 'music',
  modelPayloadKey: 'musicModel',
}

const VIDEO_CONFIG: MediaPlanConfig = {
  operationId: 'create_video',
  mediaType: 'video',
  schemaId: CREATIVE_RESOURCE_SCHEMA.GENERIC_VIDEO,
  taskType: TASK_TYPE.CREATIVE_RESOURCE_VIDEO,
  modelPurpose: 'video',
  modelPayloadKey: 'videoModel',
}

const MEDIA_EFFECTS = {
  writes: true,
  // The Operation transaction reserves pending identities and submits Tasks.
  // Ready/failed Resource facts are projected only by the Task terminal owner.
  workspaceResourceImpact: 'none',
  billable: true,
  destructive: false,
  overwrite: false,
  bulk: true,
  externalSideEffects: true,
  longRunning: true,
} as const

export function createCreativeResourceGenerationOperations(): ProjectAgentOperationRegistryDraft {
  return {
    create_text: defineOperation({
      id: 'create_text',
      summary: 'Persist one or more generic text Resources authored in this Agent turn, or persist an exact contiguous excerpt of the current visible user turn with content.kind=current_user_text. Classify a complete project screenplay as content.classification.kind=screenplay so it becomes the same project.screenplay Resource contract without a Creative Subagent; use generic_text for every other excerpt. Creative authoring and resource still belong to Creative Work; contextReferences record exact creative lineage and are never treated as media input.',
      intent: 'act',
      effects: {
        writes: true,
        workspaceResourceImpact: 'creative_resources',
        billable: false,
        destructive: false,
        overwrite: false,
        bulk: true,
        externalSideEffects: false,
        longRunning: false,
      },
      resourceContract: {
        kind: 'resource',
        assistantPresentation: 'created_resources',
        acceptsReferences: true,
        outputMediaTypes: ['text'],
        outputSchemaIds: [
          CREATIVE_RESOURCE_SCHEMA.GENERIC_TEXT,
          CREATIVE_RESOURCE_SCHEMA.SCREENPLAY,
        ],
        supportsCandidates: true,
      },
      confirmation: { kind: 'none', required: false },
      inputSchema: createTextInputSchema,
      outputSchema: createTextOutputSchema,
      executeInTransaction: async (ctx, input, tx) => await createTextResources(ctx, input, tx),
    }),
    create_image: defineOperation({
      id: 'create_image',
      summary: 'Generate image Resources. Use request.kind=new for independent images. Use request.kind=asset with the exact assetBinding for one Project asset reference image; the server derives its schema, count, fixed format, ratio, and generation defaults. To retry, use request.kind=retry with only exact failed Resource IDs.',
      intent: 'act',
      effects: MEDIA_EFFECTS,
      resourceContract: {
        kind: 'resource',
        assistantPresentation: 'created_resources',
        acceptsReferences: true,
        outputMediaTypes: ['image'],
        outputSchemaIds: Object.values(CREATIVE_RESOURCE_SCHEMA).filter((schemaId) => requireCreativeResourceSchema(schemaId).mediaType === 'image'),
        supportsCandidates: true,
      },
      confirmation: { kind: 'billable_media', required: true },
      bindToolInputSchema: bindImageGenerationToolInputSchema,
      inputSchema: createImageInputSchema,
      outputSchema: mediaTaskOutputSchema,
      plan: async (ctx, input) => await planMediaGeneration(ctx, input, IMAGE_CONFIG),
      commit: async (ctx, _input, plan) => await commitMediaGeneration(ctx, plan, IMAGE_CONFIG),
    }),
    create_audio: defineOperation({
      id: 'create_audio',
      summary: 'Generate one project.bgm_audio music Resource per call; the server owns the schema identity and audio has no candidate fan-out. For new generation, provide the complete prompt and lineage inside request.kind=new. When the server-configured music model supports video-conditioned soundtracks, pass one ready video Resource in videoReference and set durationSeconds to that video duration; the model watches the video and composes matching music. To retry, provide only exact failed Resource IDs in request.kind=retry; the server restores every frozen generation input.',
      intent: 'act',
      effects: MEDIA_EFFECTS,
      resourceContract: {
        kind: 'resource',
        assistantPresentation: 'created_resources',
        acceptsReferences: true,
        outputMediaTypes: ['audio'],
        outputSchemaIds: [CREATIVE_RESOURCE_SCHEMA.BGM_AUDIO],
        supportsCandidates: false,
      },
      confirmation: { kind: 'billable_media', required: true },
      bindToolInputSchema: bindAudioGenerationToolInputSchema,
      inputSchema: createAudioInputSchema,
      outputSchema: mediaTaskOutputSchema,
      plan: async (ctx, input) => await planMediaGeneration(ctx, input, AUDIO_CONFIG),
      commit: async (ctx, _input, plan) => await commitMediaGeneration(ctx, plan, AUDIO_CONFIG),
    }),
    create_video: defineOperation({
      id: 'create_video',
      summary: 'Generate video Resources. Use request.kind=prompt_set with one exact project.video_prompt_set Resource to let the server directly validate and execute every stored segment prompt, duration, and media Resource ID without Primary-Agent mapping. Use request.kind=new only for independent one-off video generation. To retry, provide only exact failed Resource IDs; the server restores every frozen input.',
      intent: 'act',
      effects: MEDIA_EFFECTS,
      resourceContract: {
        kind: 'resource',
        assistantPresentation: 'created_resources',
        acceptsReferences: true,
        outputMediaTypes: ['video'],
        outputSchemaIds: Object.values(CREATIVE_RESOURCE_SCHEMA).filter((schemaId) => requireCreativeResourceSchema(schemaId).mediaType === 'video'),
        supportsCandidates: true,
      },
      confirmation: { kind: 'billable_media', required: true },
      bindToolInputSchema: bindVideoGenerationToolInputSchema,
      inputSchema: createVideoInputSchema,
      outputSchema: mediaTaskOutputSchema,
      plan: async (ctx, input) => await planMediaGeneration(ctx, input, VIDEO_CONFIG),
      commit: async (ctx, _input, plan) => await commitMediaGeneration(ctx, plan, VIDEO_CONFIG),
    }),
  }
}
