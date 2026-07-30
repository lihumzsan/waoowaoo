import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import {
  compileAssetImagePrompt,
  getAssetImageFormatPolicy,
  resolveAssetImageKindForSchemaId,
} from '@/lib/asset-generation'
import { PRIMARY_APPEARANCE_INDEX } from '@/lib/constants'
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
import { creativeDirectionSchema } from '@/lib/creative-direction/contracts'
import {
  CREATIVE_RESOURCE_ASSET_IMAGE_BINDING_ROLE,
  CREATIVE_RESOURCE_CANONICAL_BINDINGS,
  type CreativeResourceInputRef,
  type CreativeResourceMediaType,
  type CreativeResourceScopeRef,
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
import { readProjectCreativeResourceLinkViews } from '@/lib/creative-resource/assistant-link-view'
import { creativeWorkOutputSchemas } from '@/lib/creative-worker'
import { assetManifestSchema, validateAssetManifest } from '@/lib/screenplay'
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
} from '@/lib/operations/types'
import { prisma } from '@/lib/prisma'
import { stableArgsHash } from '@/lib/project-agent/stable-args-hash'
import { TASK_TYPE, type TaskType } from '@/lib/task/types'
import { createWorkspaceResourceBroadcastsInTransaction } from '@/lib/workspace-resource/resource-change-events'

const contextReferenceSchema = z.array(creativeResourceInputRefSchema)
  .max(8)
  .optional()
  .describe('Exact immutable Resources used as creative context and lineage only. Text, Creative Direction, audio, video, and image Resources are allowed here; these references are never sent to an image input channel. An empty array means none.')

const imageReferenceSchema = z.array(creativeResourceInputRefSchema)
  .max(8)
  .optional()
  .describe('Exact ready image Resources to send through the provider image-input channel. Never put text, Creative Direction, audio, or video Resources here. An empty array means none.')

const videoImageReferenceSchema = z.array(creativeResourceInputRefSchema)
  .max(8)
  .optional()
  .describe('Ordered exact ready image Resources sent to the configured video model and numbered as @ImageN. Never put text, Creative Direction, audio, or video Resources here. An empty array means none.')

const audioVideoReferencesSchema = z.array(creativeResourceInputRefSchema)
  .max(1)
  .optional()
  .describe('Exact ready video Resource the configured music model watches to compose a matching soundtrack. An empty array means none. Only usable when the configured music capability supports video conditioning.')

/**
 * Model-facing sentinel meaning "the server decides this capability option".
 * Canonical schemas accept it and the single plan owner strips it back to
 * absence before freezing generation options.
 */
const CAPABILITY_AUTO = 'auto'

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
    z.object({
      kind: z.literal('current_user_media_transcription'),
      scope: z.enum(['project', 'current_episode'])
        .describe('Persist a faithful transcription of the current attached image at project scope or the currently selected Episode scope.'),
      sourceResourceId: z.string().trim().min(1)
        .describe('Exact image Resource attached to the current user message and transcribed into this text.'),
      classification: z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('generic_text'),
        }).strict(),
        z.object({
          kind: z.literal('screenplay'),
          title: z.string().trim().min(1).max(300),
        }).strict(),
      ]).describe('Classify a complete project screenplay as screenplay; use generic_text for every other transcription.'),
      text: z.string().trim().min(1)
        .describe('Faithful transcription of the current attached image. Do not rewrite, summarize, or invent text that is not visible in that image.'),
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
  resolution: z.string().trim().min(1).optional()
    .describe('Optional resolution supported by the configured image generation capability, such as 1K or 2K. Use auto to let the system decide.'),
  quality: z.string().trim().min(1).optional()
    .describe('Optional quality tier supported by the configured image generation capability. Use auto to let the system decide.'),
}).strict()

const createAssetImageRequestSchema = z.object({
  kind: z.literal('asset'),
  name: z.string().trim().min(1).max(200).optional()
    .describe('Optional display name for the generated asset image Resource.'),
  prompt: z.string().trim().min(1)
    .describe('Stable visible design of this exact Project asset. Do not include aspect ratio, layout, background format, multi-view instructions, or provider parameters; the server compiles the final prompt.'),
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

const createImageManifestAssetsRequestSchema = z.object({
  kind: z.literal('manifest_assets'),
  resourceId: z.string().trim().min(1).max(32)
    .describe('Exact currently adopted project.asset_manifest Resource. The server compiles every selected asset from stableDescription, its frozen Creative Direction, and the asset-format policy, then creates one image Task per asset.'),
  manifestAssetIds: z.array(z.string().trim().min(1).max(80)).max(1_024).optional()
    .describe('Exact manifestAssetId subset to generate now. Omit or pass an empty array to generate every asset in the adopted manifest.'),
}).strict()

const createImageInputSchema = z.object({
  request: z.discriminatedUnion('kind', [
    createImageNewRequestSchema,
    createAssetImageRequestSchema,
    createImageManifestAssetsRequestSchema,
    retryMediaGenerationRequestSchema,
  ]),
}).strict()

const createAudioNewRequestSchema = z.object({
  ...commonNewMediaGenerationShape,
  videoReferences: audioVideoReferencesSchema,
  durationSeconds: z.number().int().min(1).max(600)
    .describe('Requested audio duration in seconds.'),
  vocalMode: z.enum(['instrumental', 'vocal', CAPABILITY_AUTO]).optional()
    .describe('Whether the configured music generation capability should produce instrumental or vocal audio. Use auto to let the system decide.'),
  genre: z.string().trim().optional()
    .describe('Musical genre. An empty string means unspecified.'),
  mood: z.string().trim().optional()
    .describe('Musical mood. An empty string means unspecified.'),
  bpm: z.union([z.number().int().min(20).max(300), z.literal(CAPABILITY_AUTO)]).optional()
    .describe('Tempo in beats per minute. Use auto to let the system decide.'),
  outputFormat: z.enum(['mp3', 'wav', CAPABILITY_AUTO]).optional()
    .describe('Requested audio file format. Use auto to let the system decide.'),
}).strict()

const createAudioMusicDirectionRequestSchema = z.object({
  kind: z.literal('music_direction'),
  resourceId: z.string().trim().min(1).max(32)
    .describe('Exact ready project.music_direction Resource with at least one score cue. The server reads the cue\'s generation instruction directly; do not copy, summarize, or rewrite it.'),
  cueKey: z.string().trim().min(1).max(160)
    .describe('Exact key of the one score cue to generate. Call this operation once per cue in the direction; each cue becomes one independent bgm_audio Resource.'),
  videoReference: creativeResourceInputRefSchema
    .describe('Exact ready final video Resource this score was designed for. The server scores only the cue\'s time window of this video and derives the cue duration from the direction.'),
}).strict()

const createAudioInputSchema = z.object({
  request: z.discriminatedUnion('kind', [
    createAudioNewRequestSchema,
    createAudioMusicDirectionRequestSchema,
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
  resolution: z.string().trim().min(1).optional()
    .describe('Optional resolution supported by the configured video generation capability, such as 720p or 1080p. Use auto to let the system decide.'),
  generateAudio: z.union([z.boolean(), z.literal(CAPABILITY_AUTO)]).optional()
    .describe('Whether the configured video generation capability should generate synchronized native audio. Use auto to let the system decide.'),
} as const

const createVideoNewRequestSchema = z.object({
  ...createVideoNewRequestBaseShape,
  imageReferences: videoImageReferenceSchema,
  audioReferences: z.array(creativeResourceInputRefSchema).max(3).optional()
    .describe('Ready audio Resources sent to the configured video model. An empty array means none. When non-empty, imageReferences must also be non-empty and cannot use first_frame or last_frame roles.'),
}).strict()

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
type CreateImageManifestAssetsRequest = z.infer<typeof createImageManifestAssetsRequestSchema>
type CreateAudioNewRequest = z.infer<typeof createAudioNewRequestSchema>
type CreateAudioMusicDirectionRequest = z.infer<typeof createAudioMusicDirectionRequestSchema>
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
  // Manifest asset batches mix character/location/prop image schemas inside
  // one plan; absent means the plan-level schemaId applies.
  schemaId: z.string().min(1).optional(),
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
    ...('videoReferences' in input ? input.videoReferences ?? [] : []),
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
  targetScope: CreativeResourceScopeRef,
  references: readonly CreativeResourceInputRef[],
  requiredMediaType: CreativeResourceMediaType | null,
  field: 'contextReferences' | 'imageReferences' | 'audioReferences' | 'videoReferences',
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await validateCreativeResourceInputReferencesInTransaction(tx, targetScope, references)
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
      : 'videoReferences'
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
  const suppliedScreenplayTitle = (
    input.content.kind === 'current_user_text'
    || input.content.kind === 'current_user_media_transcription'
  )
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
  const suppliedTextScope = (
    input.content.kind === 'current_user_text'
    || input.content.kind === 'current_user_media_transcription'
  )
    ? input.content.scope
    : null
  const episodeId = suppliedTextScope !== null
    ? suppliedTextScope === 'project'
      ? null
      : ctx.context.episodeId?.trim() || null
    : resolveEpisodeId(input, ctx)
  if (
    input.content.kind === 'current_user_text'
    && suppliedTextScope === 'current_episode'
    && !episodeId
  ) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'CURRENT_USER_TEXT_EPISODE_SCOPE_UNAVAILABLE',
      field: 'content.scope',
      allowedValues: ['project'],
      agentRetryableAfterCorrection: true,
    })
  }
  if (
    input.content.kind === 'current_user_media_transcription'
    && suppliedTextScope === 'current_episode'
    && !episodeId
  ) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'CURRENT_USER_MEDIA_TRANSCRIPTION_EPISODE_SCOPE_UNAVAILABLE',
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
  const mediaSourceResourceId = input.content.kind === 'current_user_media_transcription'
    ? input.content.sourceResourceId
    : null
  if (
    mediaSourceResourceId
    && !ctx.context.userTurnMediaResourceIds?.includes(mediaSourceResourceId)
  ) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'CURRENT_USER_MEDIA_SOURCE_NOT_ATTACHED',
      field: 'content.sourceResourceId',
      agentRetryableAfterCorrection: true,
    })
  }
  if (mediaSourceResourceId) {
    const [source] = await readProjectCreativeResourceLinkViews({
      projectId: ctx.projectId,
      userId: ctx.userId,
      refs: [{ resourceId: mediaSourceResourceId }],
      client: tx,
    })
    if (source?.mediaType !== 'image') {
      throw new ApiError('INVALID_PARAMS', {
        code: 'CURRENT_USER_MEDIA_SOURCE_NOT_IMAGE',
        field: 'content.sourceResourceId',
        allowedValues: ['image'],
        agentRetryableAfterCorrection: true,
      })
    }
  }
  if (
    mediaSourceResourceId
    && input.contextReferences?.some((reference) => reference.resourceId === mediaSourceResourceId)
  ) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'CREATIVE_RESOURCE_INPUT_REFERENCE_DUPLICATE',
      field: 'contextReferences',
      resourceId: mediaSourceResourceId,
      agentRetryableAfterCorrection: true,
    })
  }
  const contextReferences = normalizeInputReferences(input.contextReferences, {
    defaultRole: 'context',
    positionOffset: mediaSourceResourceId ? 1 : 0,
  })
  const references: CreativeResourceInputRef[] = mediaSourceResourceId
    ? [{
        resourceId: mediaSourceResourceId,
        role: 'source',
        position: 0,
      }, ...contextReferences]
    : contextReferences
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
          : input.content.kind === 'current_user_media_transcription'
            ? {
                source: 'current_user_media_transcription',
                sourceResourceId: input.content.sourceResourceId,
              }
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
  readonly config: MediaPlanConfig
  readonly schemaId: string
  readonly modelKey: string
  readonly publicInput: NewMediaGenerationRequest
  readonly projectConfig: ProjectGenerationModelConfig
}): Promise<Record<string, string | number | boolean>> {
  const modelType: UnifiedModelType = input.config.mediaType === 'audio' ? 'music' : input.config.mediaType
  const projectConfig = input.projectConfig
  const capabilities = requireMediaGenerationCapabilities(modelType, input.modelKey)
  const optionFields = getCapabilityOptionFields(modelType, capabilities)
  const optionFieldNames = new Set(Object.keys(optionFields))
  const explicitSelections: Record<string, CapabilityValue> = {}

  if (input.config.mediaType === 'image') {
    const publicInput = input.publicInput as CreateImageGenerationRequest
    if (publicInput.kind === 'new') {
      for (const field of ['resolution', 'quality'] as const) {
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
  // The aspect ratio has exactly one server-side answer (asset format policy or
  // the project ratio), so the model never submits it: it is absent from every
  // model-facing schema and resolved here as the single owner.
  if (input.config.mediaType === 'image' || input.config.mediaType === 'video') {
    const assetImageKind = input.config.mediaType === 'image'
      ? resolveAssetImageKindForSchemaId(input.schemaId)
      : null
    frozen.aspectRatio = assetImageKind
      ? getAssetImageFormatPolicy(assetImageKind).aspectRatio
      : requireProjectVideoRatio(projectConfig.videoRatio).value
  } else {
    const publicInput = input.publicInput as CreateAudioNewRequest
    frozen.durationSeconds = publicInput.durationSeconds
    frozen.vocalMode = publicInput.vocalMode ?? String(frozen.vocalMode ?? 'instrumental')
    frozen.outputFormat = publicInput.outputFormat ?? String(frozen.outputFormat ?? 'mp3')
  }
  return frozen
}

const AUTO_CAPABILITY_SELECTION_FIELDS = [
  'resolution',
  'quality',
  'vocalMode',
  'outputFormat',
  'bpm',
  'generateAudio',
] as const

const EMPTY_STRING_ABSENCE_FIELDS = ['genre', 'mood'] as const

/**
 * The tool dialect encodes "the system decides" as the required enum member
 * "auto" and "unspecified" as an empty string, never as null or a missing key.
 * This is the single point that folds both sentinels back to absence before
 * any hashing, capability resolution, or task payload construction reads them.
 */
function resolveNewMediaGenerationSentinels<T extends NewMediaGenerationRequest>(input: T): T {
  const record: Record<string, unknown> = { ...input }
  let changed = false
  for (const field of AUTO_CAPABILITY_SELECTION_FIELDS) {
    if (record[field] === CAPABILITY_AUTO) {
      delete record[field]
      changed = true
    }
  }
  for (const field of EMPTY_STRING_ABSENCE_FIELDS) {
    if (record[field] === '') {
      delete record[field]
      changed = true
    }
  }
  return changed ? record as T : input
}

async function planNewMediaGeneration(
  ctx: ProjectAgentOperationContext,
  rawInput: NewMediaGenerationRequest,
  config: MediaPlanConfig,
  extras?: { readonly scoreCue: { readonly key: string; readonly startMs: number; readonly endMs: number } },
): Promise<OperationPlan> {
  const input = resolveNewMediaGenerationSentinels(rawInput)
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
    ? compileAssetImagePrompt({
        stableDescription: input.prompt,
        creativeDirection: null,
        kind: assetImageKind,
        locale: resolveOperationLocale(ctx.context),
      })
    : input.prompt
  const effectiveInput = prompt === input.prompt ? input : { ...input, prompt }
  const normalizedReferences = normalizeMediaInputReferences(effectiveInput)
  const references = normalizedReferences.inputs
  const targetScope = resolveProjectCreativeResourceScope({
    userId: ctx.userId,
    projectId: ctx.projectId,
    episodeId,
  })
  await assertInputReferences(
    targetScope,
    references,
    null,
    'contextReferences',
  )
  const providerReferences = await classifyProviderInputReferences(
    normalizedReferences.providerInputs,
    config.mediaType,
  )
  const [modelKey, projectConfig] = await Promise.all([
    resolveGenerationModel({
      ctx,
      purpose: config.modelPurpose,
    }),
    getProjectModelConfig(ctx.projectId, ctx.userId),
  ])
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
        field: 'videoReferences',
        modelKey,
        requestedValue: providerReferences.videoInputs.length,
        allowedValues: [maxReferenceVideos ?? 0],
        agentRetryableAfterCorrection: true,
      })
    }
  }
  const generationOptions = await resolveFrozenGenerationOptions({
    config,
    schemaId,
    modelKey,
    publicInput: effectiveInput,
    projectConfig,
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
        ...(extras?.scoreCue ? { scoreCue: extras.scoreCue } : {}),
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
  const callerEpisodeId = ctx.context.episodeId?.trim() || null
  const candidates = await loadCreativeResourceRetryCandidates({
    userId: ctx.userId,
    projectId: ctx.projectId,
    callerEpisodeId,
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
  const episodeIds = new Set(candidates.map((candidate) => candidate.episodeId))
  if (episodeIds.size !== 1) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'CREATIVE_RESOURCE_RETRY_SCOPE_MIXED',
      field: 'request.resourceIds',
      requestedValue: input.resourceIds,
      agentRetryableAfterCorrection: true,
    })
  }
  const episodeId = candidates[0]?.episodeId ?? null
  const schemaId = requireSchemaForMedia(candidates[0]?.schemaId ?? config.schemaId, config.mediaType)
  for (const candidate of candidates) {
    const targetScope = resolveProjectCreativeResourceScope({
      userId: ctx.userId,
      projectId: ctx.projectId,
      episodeId: candidate.episodeId,
    })
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
    await assertInputReferences(targetScope, references, null, 'contextReferences')
    await assertInputReferences(
      targetScope,
      imageInputs,
      'image',
      'imageReferences',
    )
    await assertInputReferences(targetScope, audioInputs, 'audio', 'audioReferences')
    await assertInputReferences(targetScope, videoInputs, 'video', 'videoReferences')
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
      episodeId: candidate.episodeId,
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
  const [modelKey, projectConfig] = await Promise.all([
    resolveGenerationModel({ ctx, purpose: VIDEO_CONFIG.modelPurpose }),
    getProjectModelConfig(ctx.projectId, ctx.userId),
  ])
  const capabilities = requireMediaGenerationCapabilities('video', modelKey).video
  if (!capabilities) throw new Error(`CREATIVE_RESOURCE_VIDEO_CAPABILITY_REQUIRED:${modelKey}`)
  const maxReferenceImages = requirePositiveCapabilityLimit({
    field: 'maxReferenceImages',
    value: capabilities.maxReferenceImages,
    modelKey,
  })
  const maxReferenceAudios = capabilities.maxReferenceAudios ?? 0
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

async function planManifestAssetImageGeneration(
  ctx: ProjectAgentOperationContext,
  input: CreateImageManifestAssetsRequest,
): Promise<OperationPlan> {
  const adoptedBinding = await prisma.creativeResourceBinding.findFirst({
    where: {
      userId: ctx.userId,
      projectId: ctx.projectId,
      scopeKind: 'project',
      scopeId: ctx.projectId,
      role: CREATIVE_RESOURCE_CANONICAL_BINDINGS.adoptedAssetManifest.role,
      slotKey: CREATIVE_RESOURCE_CANONICAL_BINDINGS.adoptedAssetManifest.slotKey,
    },
    select: { resourceId: true },
  })
  if (!adoptedBinding || adoptedBinding.resourceId !== input.resourceId) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'ASSET_MANIFEST_NOT_ADOPTED',
      field: 'request.resourceId',
      agentRetryableAfterCorrection: true,
    })
  }
  const manifestResource = await prisma.creativeResource.findFirst({
    where: {
      id: input.resourceId,
      userId: ctx.userId,
      projectId: ctx.projectId,
      episodeId: null,
      status: 'ready',
      materializedAt: { not: null },
      mediaType: 'text',
      schemaId: CREATIVE_RESOURCE_SCHEMA.ASSET_MANIFEST,
      sourceType: 'CreativeWorkResult',
    },
    select: {
      id: true,
      contentJson: true,
      outputLineage: {
        where: { role: 'creative_direction' },
        select: {
          inputResource: {
            select: {
              id: true,
              userId: true,
              projectId: true,
              episodeId: true,
              status: true,
              materializedAt: true,
              mediaType: true,
              schemaId: true,
              contentJson: true,
            },
          },
        },
      },
    },
  })
  if (!manifestResource || manifestResource.contentJson === null) {
    throw new ApiError('NOT_FOUND', {
      code: 'ASSET_MANIFEST_RESOURCE_NOT_FOUND',
      field: 'request.resourceId',
    })
  }
  const manifest = validateAssetManifest({
    manifest: assetManifestSchema.parse(manifestResource.contentJson),
  })
  if (manifestResource.outputLineage.length > 1) {
    throw new Error(`ASSET_MANIFEST_CREATIVE_DIRECTION_LINEAGE_AMBIGUOUS:${manifestResource.id}`)
  }
  const creativeDirectionResource = manifestResource.outputLineage[0]?.inputResource ?? null
  if (
    creativeDirectionResource
    && (
      creativeDirectionResource.userId !== ctx.userId
      || creativeDirectionResource.projectId !== ctx.projectId
      || creativeDirectionResource.episodeId !== null
      || creativeDirectionResource.status !== 'ready'
      || creativeDirectionResource.materializedAt === null
      || creativeDirectionResource.mediaType !== 'text'
      || creativeDirectionResource.schemaId !== CREATIVE_RESOURCE_SCHEMA.CREATIVE_DIRECTION
      || creativeDirectionResource.contentJson === null
    )
  ) {
    throw new Error(`ASSET_MANIFEST_CREATIVE_DIRECTION_LINEAGE_INVALID:${manifestResource.id}`)
  }
  const creativeDirection = creativeDirectionResource
    ? creativeDirectionSchema.parse(creativeDirectionResource.contentJson)
    : null
  if (manifest.assets.length === 0) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'ASSET_MANIFEST_ASSETS_EMPTY',
      field: 'request.resourceId',
      agentRetryableAfterCorrection: false,
    })
  }
  const assetByManifestId = new Map(manifest.assets.map((asset) => [asset.manifestAssetId, asset]))
  // The tool dialect encodes "every asset" as an empty array; treat it exactly
  // like the absent API form instead of planning an empty batch.
  const requestedIds = input.manifestAssetIds?.length
    ? input.manifestAssetIds
    : manifest.assets.map((asset) => asset.manifestAssetId)
  const seenIds = new Set<string>()
  const selected = requestedIds.map((manifestAssetId) => {
    if (seenIds.has(manifestAssetId)) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'MANIFEST_ASSET_ID_DUPLICATE',
        field: 'request.manifestAssetIds',
        requestedValue: manifestAssetId,
        agentRetryableAfterCorrection: true,
      })
    }
    seenIds.add(manifestAssetId)
    const asset = assetByManifestId.get(manifestAssetId)
    if (!asset) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'MANIFEST_ASSET_ID_UNKNOWN',
        field: 'request.manifestAssetIds',
        requestedValue: manifestAssetId,
        allowedValues: manifest.assets.map((candidate) => candidate.manifestAssetId),
        agentRetryableAfterCorrection: true,
      })
    }
    return asset
  })
  const characterManifestIds = selected
    .filter((asset) => asset.kind === 'character')
    .map((asset) => asset.manifestAssetId)
  const locationManifestIds = selected
    .filter((asset) => asset.kind !== 'character')
    .map((asset) => asset.manifestAssetId)
  const [characters, locations] = await Promise.all([
    characterManifestIds.length > 0
      ? prisma.projectCharacter.findMany({
          where: {
            projectId: ctx.projectId,
            project: { userId: ctx.userId },
            manifestAssetId: { in: characterManifestIds },
          },
          select: {
            id: true,
            manifestAssetId: true,
            appearances: {
              where: { appearanceIndex: PRIMARY_APPEARANCE_INDEX },
              select: { id: true },
              take: 1,
            },
          },
        })
      : Promise.resolve([]),
    locationManifestIds.length > 0
      ? prisma.projectLocation.findMany({
          where: {
            projectId: ctx.projectId,
            project: { userId: ctx.userId },
            manifestAssetId: { in: locationManifestIds },
          },
          select: {
            id: true,
            assetKind: true,
            manifestAssetId: true,
            images: { where: { imageIndex: 0 }, select: { id: true }, take: 1 },
          },
        })
      : Promise.resolve([]),
  ])
  const identityByManifestId = new Map<string, {
    readonly assetKind: 'character' | 'location' | 'prop'
    readonly assetId: string
    readonly variantId: string
  }>()
  for (const character of characters) {
    const variantId = character.appearances[0]?.id
    if (!character.manifestAssetId || !variantId) continue
    identityByManifestId.set(character.manifestAssetId, {
      assetKind: 'character',
      assetId: character.id,
      variantId,
    })
  }
  for (const location of locations) {
    const variantId = location.images[0]?.id
    if (!location.manifestAssetId || !variantId) continue
    identityByManifestId.set(location.manifestAssetId, {
      assetKind: location.assetKind === 'prop' ? 'prop' : 'location',
      assetId: location.id,
      variantId,
    })
  }
  const executable = selected.map((asset) => {
    const identity = identityByManifestId.get(asset.manifestAssetId)
    return { asset, identity: identity && identity.assetKind === asset.kind ? identity : null }
  })
  const missingIds = executable
    .filter((entry) => entry.identity === null)
    .map((entry) => entry.asset.manifestAssetId)
  if (missingIds.length > 0) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'ASSET_MANIFEST_ASSET_IDENTITY_MISSING',
      field: 'request.resourceId',
      requestedValue: missingIds,
      agentRetryableAfterCorrection: true,
    })
  }
  const entries = executable.flatMap((entry) => (
    entry.identity ? [{ asset: entry.asset, identity: entry.identity }] : []
  ))
  const bindingRows = await prisma.creativeResourceBinding.findMany({
    where: {
      userId: ctx.userId,
      projectId: ctx.projectId,
      scopeKind: 'project',
      scopeId: ctx.projectId,
      role: CREATIVE_RESOURCE_ASSET_IMAGE_BINDING_ROLE,
      slotKey: { in: entries.map((entry) => entry.identity.variantId) },
    },
    select: { slotKey: true, version: true },
  })
  const bindingVersionBySlot = new Map(bindingRows.map((row) => [row.slotKey, row.version]))
  const [modelKey, projectConfig] = await Promise.all([
    resolveGenerationModel({ ctx, purpose: IMAGE_CONFIG.modelPurpose }),
    getProjectModelConfig(ctx.projectId, ctx.userId),
  ])
  const locale = resolveOperationLocale(ctx.context)
  const planFingerprint = stableArgsHash({
    manifestResourceId: manifestResource.id,
    manifestAssetIds: entries.map((entry) => entry.asset.manifestAssetId),
    modelKey,
  })
  const requestId = [
    'asset-manifest-images',
    ctx.userId,
    ctx.projectId,
    'project',
    ctx.context.runId?.trim() || 'no-run',
    ctx.toolCallId?.trim() || planFingerprint,
    planFingerprint,
  ].join(':')
  const resources = entries.map((entry, candidateIndex) => ({
    resourceId: buildCreativeResourceId({
      operationId: IMAGE_CONFIG.operationId,
      requestId,
      candidateIndex,
    }),
    name: entry.asset.canonicalName.slice(0, 191),
    candidateIndex,
    schemaId: getAssetImageFormatPolicy(entry.asset.kind).schemaId,
  }))
  const firstResource = resources[0]
  if (!firstResource) throw new Error('ASSET_MANIFEST_IMAGE_PLAN_EMPTY')
  const tasks = await Promise.all(entries.map(async (entry, candidateIndex) => {
    const resource = resources[candidateIndex]
    if (!resource) throw new Error(`ASSET_MANIFEST_IMAGE_RESOURCE_PLAN_MISSING:${String(candidateIndex)}`)
    const schemaId = getAssetImageFormatPolicy(entry.asset.kind).schemaId
    const prompt = compileAssetImagePrompt({
      stableDescription: entry.asset.stableDescription,
      creativeDirection,
      kind: entry.asset.kind,
      locale,
    })
    const assetBinding = {
      assetKind: entry.asset.kind,
      assetId: entry.identity.assetId,
      variantId: entry.identity.variantId,
      expectedVersion: bindingVersionBySlot.get(entry.identity.variantId) ?? null,
    }
    const publicInput: CreateAssetImageRequest = {
      kind: 'asset',
      prompt,
      assetBinding,
    }
    const generationOptions = await resolveFrozenGenerationOptions({
      config: IMAGE_CONFIG,
      schemaId,
      modelKey,
      publicInput,
      projectConfig,
    })
    const inputs: CreativeResourceInputRef[] = [
      {
        resourceId: manifestResource.id,
        role: 'asset_manifest',
        position: 0,
      },
      ...(creativeDirectionResource
        ? [{
            resourceId: creativeDirectionResource.id,
            role: 'creative_direction' as const,
            position: 1,
          }]
        : []),
    ]
    const inputHash = hashTaskInput({
      operationId: IMAGE_CONFIG.operationId,
      manifestResourceId: manifestResource.id,
      manifestAssetId: entry.asset.manifestAssetId,
      prompt,
      modelKey,
      schemaId,
      inputs,
      generationOptions,
      assetBinding,
    })
    const payload = {
      lifecycleProjection: buildCreativeResourceLifecycleProjection([{
        resourceId: resource.resourceId,
        mediaType: 'image',
        schemaId,
        name: resource.name,
      }]),
      resource: {
        resourceId: resource.resourceId,
        mediaType: 'image' as const,
        schemaId,
        prompt,
        modelKey,
        inputHash,
        inputs,
        imageInputPositions: [],
        audioInputPositions: [],
        videoInputPositions: [],
        generationOptions,
        executionSegmentId: null,
        toolCallId: ctx.toolCallId?.trim() || null,
        binding: { kind: 'project_asset_image' as const, ...assetBinding },
      },
      imageModel: modelKey,
      prompt,
      count: 1 as const,
      generationOptions,
    }
    return createPlannedTask({
      id: `${IMAGE_CONFIG.operationId}:${resource.resourceId}`,
      taskType: IMAGE_CONFIG.taskType,
      targetType: 'CreativeResource',
      targetId: resource.resourceId,
      payload,
      locale,
      episodeId: null,
      dedupeKey: `${IMAGE_CONFIG.operationId}:manifest:${resource.resourceId}:${inputHash}`,
      billingInfo: requirePlannedTaskBillingInfo({
        taskType: IMAGE_CONFIG.taskType,
        payload,
        allowedApiTypes: ['image'],
      }),
    })
  }))
  return {
    kind: 'task_submission',
    operationId: IMAGE_CONFIG.operationId,
    projectId: ctx.projectId,
    userId: ctx.userId,
    tasks,
    reservedIdentityIds: resources.map((resource) => resource.resourceId),
    metadata: {
      mediaType: 'image',
      schemaId: firstResource.schemaId,
      episodeId: null,
      requestId,
      candidateSetId: null,
      retry: false,
      resources,
    },
  }
}

async function planMusicDirectionAudioGeneration(
  ctx: ProjectAgentOperationContext,
  input: CreateAudioMusicDirectionRequest,
): Promise<OperationPlan> {
  const directionResource = await prisma.creativeResource.findFirst({
    where: {
      id: input.resourceId,
      userId: ctx.userId,
      projectId: ctx.projectId,
      status: 'ready',
      materializedAt: { not: null },
      mediaType: 'text',
      schemaId: CREATIVE_RESOURCE_SCHEMA.MUSIC_DIRECTION,
      sourceType: 'CreativeWorkResult',
    },
    select: { id: true, episodeId: true, contentJson: true },
  })
  if (!directionResource || directionResource.contentJson === null) {
    throw new ApiError('NOT_FOUND', {
      code: 'MUSIC_DIRECTION_RESOURCE_NOT_FOUND',
      field: 'request.resourceId',
    })
  }
  const contextEpisodeId = ctx.context.episodeId?.trim() || null
  if (
    contextEpisodeId
    && directionResource.episodeId
    && contextEpisodeId !== directionResource.episodeId
  ) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MUSIC_DIRECTION_EPISODE_MISMATCH',
      field: 'request.resourceId',
      agentRetryableAfterCorrection: true,
    })
  }
  const direction = creativeWorkOutputSchemas.music_direction.parse(directionResource.contentJson)
  if (direction.cues.length === 0) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MUSIC_DIRECTION_SCORE_ABSENT',
      field: 'request.resourceId',
      agentRetryableAfterCorrection: false,
    })
  }
  const cue = direction.cues.find((candidate) => candidate.key === input.cueKey)
  if (!cue) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MUSIC_DIRECTION_CUE_NOT_FOUND',
      field: 'request.cueKey',
      allowedValues: direction.cues.map((candidate) => candidate.key),
      agentRetryableAfterCorrection: true,
    })
  }
  const videoResource = await prisma.creativeResource.findFirst({
    where: {
      id: input.videoReference.resourceId,
      userId: ctx.userId,
      projectId: ctx.projectId,
      status: 'ready',
      materializedAt: { not: null },
      mediaType: 'video',
    },
    select: {
      id: true,
      episodeId: true,
      media: { select: { durationMs: true } },
    },
  })
  if (!videoResource) {
    throw new ApiError('NOT_FOUND', {
      code: 'MUSIC_DIRECTION_VIDEO_NOT_FOUND',
      field: 'request.videoReference',
    })
  }
  if (
    contextEpisodeId
    && videoResource.episodeId
    && contextEpisodeId !== videoResource.episodeId
  ) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MUSIC_DIRECTION_VIDEO_EPISODE_MISMATCH',
      field: 'request.videoReference',
      agentRetryableAfterCorrection: true,
    })
  }
  const durationMs = videoResource.media?.durationMs ?? null
  if (durationMs === null || durationMs <= 0) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MUSIC_DIRECTION_VIDEO_DURATION_UNKNOWN',
      field: 'request.videoReference',
      agentRetryableAfterCorrection: false,
    })
  }
  const cueStartMs = Math.round(cue.startSeconds * 1000)
  const cueEndMs = Math.round(cue.endSeconds * 1000)
  if (cueEndMs > durationMs) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MUSIC_DIRECTION_CUE_OUTSIDE_VIDEO',
      field: 'request.cueKey',
      requestedValue: cue.endSeconds,
      allowedValues: [Math.floor(durationMs / 1000)],
      agentRetryableAfterCorrection: false,
    })
  }
  const durationSeconds = Math.ceil((cueEndMs - cueStartMs) / 1000)
  const modelKey = await resolveGenerationModel({
    ctx,
    purpose: AUDIO_CONFIG.modelPurpose,
  })
  const capabilities = requireMediaGenerationCapabilities('music', modelKey)
  const optionFields = getCapabilityOptionFields('music', capabilities)
  const durationValues = optionFields.durationSeconds
  const durationRange = capabilities.music?.durationSecondsRange
  const durationAllowed = durationValues && durationValues.length > 0
    ? durationValues.some((value) => value === durationSeconds)
    : durationRange
      ? durationSeconds >= Math.ceil(durationRange.min)
        && durationSeconds <= Math.floor(durationRange.max)
      : false
  if (!durationAllowed) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MUSIC_DIRECTION_VIDEO_DURATION_UNSUPPORTED',
      field: 'request.videoReference',
      modelKey,
      requestedValue: durationSeconds,
      allowedValues: durationValues && durationValues.length > 0
        ? [...durationValues]
        : durationRange
          ? [Math.ceil(durationRange.min), Math.floor(durationRange.max)]
          : [],
      agentRetryableAfterCorrection: false,
    })
  }
  const promptMaxChars = capabilities.music?.promptMaxChars
  if (promptMaxChars !== undefined && cue.generationPrompt.length > promptMaxChars) {
    throw new ApiError('MUSIC_PROMPT_TOO_LONG', {
      field: 'request.cueKey',
      modelKey,
      requestedValue: cue.generationPrompt.length,
      allowedValues: [promptMaxChars],
      agentRetryableAfterCorrection: false,
    })
  }
  const videoConditioned = (capabilities.music?.maxReferenceVideos ?? 0) >= 1
  const request: CreateAudioNewRequest = {
    kind: 'new',
    prompt: cue.generationPrompt,
    durationSeconds,
    contextReferences: [
      { resourceId: directionResource.id, role: 'music_direction' },
      ...(videoConditioned ? [] : [{ resourceId: videoResource.id, role: 'score_target' }]),
    ],
    ...(videoConditioned
      ? { videoReferences: [{ resourceId: videoResource.id, role: 'score_target' }] }
      : {}),
    ...(videoResource.episodeId ? { episodeId: videoResource.episodeId } : {}),
  }
  return await planNewMediaGeneration(ctx, request, AUDIO_CONFIG, {
    scoreCue: { key: cue.key, startMs: cueStartMs, endMs: cueEndMs },
  })
}

async function planMediaGeneration(
  ctx: ProjectAgentOperationContext,
  input: MediaGenerationInput,
  config: MediaPlanConfig,
): Promise<OperationPlan> {
  if (config.operationId === 'create_video' && input.request.kind === 'prompt_set') {
    return await planVideoPromptSetGeneration(ctx, input.request)
  }
  if (config.operationId === 'create_image' && input.request.kind === 'manifest_assets') {
    return await planManifestAssetImageGeneration(ctx, input.request)
  }
  if (config.operationId === 'create_audio' && input.request.kind === 'music_direction') {
    return await planMusicDirectionAudioGeneration(ctx, input.request)
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
    // Manifest asset batches mix per-kind image schemas inside one plan;
    // reserve per exact schema through the same single persistence entry.
    const candidatesBySchemaId = new Map<string, Array<{
      resourceId: string
      name: string
      candidateIndex: number
    }>>()
    for (const resource of metadata.resources) {
      const schemaId = requireSchemaForMedia(resource.schemaId ?? metadata.schemaId, config.mediaType)
      const group = candidatesBySchemaId.get(schemaId) ?? []
      group.push({
        resourceId: resource.resourceId,
        name: resource.name,
        candidateIndex: resource.candidateIndex,
      })
      candidatesBySchemaId.set(schemaId, group)
    }
    for (const [schemaId, candidates] of candidatesBySchemaId) {
      await reserveCreativeResourcesInTransaction(authorization.transaction, {
        scope,
        mediaType: config.mediaType,
        schemaId,
        operationId: config.operationId,
        requestId: metadata.requestId,
        candidateSetId: metadata.candidateSetId,
        candidates,
      })
    }
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

// v2 broadens the canonical initial-generation root from request.kind=new to
// every non-retry request branch, including prompt_set and manifest_assets.
const MEDIA_GENERATION_PLAN_CONTRACT_REVISION = 'creative-resource-generation/v2'

export function createCreativeResourceGenerationOperations(): ProjectAgentOperationRegistryDraft {
  return {
    create_text: defineOperation({
      id: 'create_text',
      summary: 'Persist one or more generic text Resources authored in this Agent turn; persist an exact contiguous excerpt of the current visible user turn with content.kind=current_user_text; or faithfully transcribe an image attached to this exact user turn with content.kind=current_user_media_transcription and its sourceResourceId. Classify a complete project screenplay as content.classification.kind=screenplay so it becomes the same project.screenplay Resource contract without a Creative Subagent; use generic_text otherwise. Creative authoring and resource still belong to Creative Work; contextReferences record exact creative lineage and are never treated as media input.',
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
      summary: 'Generate image Resources. Use request.kind=new for independent images. Use request.kind=manifest_assets with only the adopted project.asset_manifest resourceId to generate Project asset reference images; the server compiles every selected asset from its stable design, frozen Creative Direction, fixed format, ratio, and defaults. Use request.kind=asset with the exact assetBinding only for one asset image that has no manifest entry. To retry, use request.kind=retry with only exact failed Resource IDs.',
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
      planContractRevision: MEDIA_GENERATION_PLAN_CONTRACT_REVISION,
      inputSchema: createImageInputSchema,
      outputSchema: mediaTaskOutputSchema,
      plan: async (ctx, input) => await planMediaGeneration(ctx, input, IMAGE_CONFIG),
      commit: async (ctx, _input, plan) => await commitMediaGeneration(ctx, plan, IMAGE_CONFIG),
    }),
    create_audio: defineOperation({
      id: 'create_audio',
      summary: 'Generate one project.bgm_audio music Resource per call; the server owns the schema identity and audio has no candidate fan-out. To execute a completed music direction, use request.kind=music_direction with only the direction resourceId, one exact cueKey, and the exact final video Resource. The server reads that cue instruction unchanged, derives duration from its time window, freezes the window, and lets a video-capable music model watch only that portion — never copy, merge, or rewrite cue instructions. Submit one call per selected cue; an empty cue list intentionally means no music. For music without a direction, provide the complete prompt and lineage inside request.kind=new; when the configured music model supports video-conditioned soundtracks, pass one ready video Resource in videoReferences and set durationSeconds to that video duration. To retry, provide only exact failed Resource IDs in request.kind=retry; the server restores every frozen generation input.',
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
      planContractRevision: MEDIA_GENERATION_PLAN_CONTRACT_REVISION,
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
      planContractRevision: MEDIA_GENERATION_PLAN_CONTRACT_REVISION,
      inputSchema: createVideoInputSchema,
      outputSchema: mediaTaskOutputSchema,
      plan: async (ctx, input) => await planMediaGeneration(ctx, input, VIDEO_CONFIG),
      commit: async (ctx, _input, plan) => await commitMediaGeneration(ctx, plan, VIDEO_CONFIG),
    }),
  }
}
