import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import {
  getCapabilityOptionFields,
  resolveBuiltinCapabilitiesByModelKey,
  resolveGenerationOptionsForModel,
} from '@/lib/ai-registry/capabilities-catalog'
import type { CapabilityValue, UnifiedModelType } from '@/lib/ai-registry/types'
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
  buildCreativeResourceCandidateSetId,
  buildCreativeResourceOriginKey,
  resolveProjectCreativeResourceScope,
} from '@/lib/creative-resource/identity'
import {
  appendCreativeResourceRevisionInTransaction,
  reserveCreativeResourcesInTransaction,
  validateCreativeResourceInputReferencesInTransaction,
} from '@/lib/creative-resource/persistence'
import {
  CREATIVE_RESOURCE_SCHEMA,
  CREATIVE_RESOURCE_SCHEMA_IDS_BY_MEDIA,
  requireCreativeResourceSchema,
} from '@/lib/creative-resource/schema-registry'
import { resolveSystemModelKey, type SystemModelPurpose } from '@/lib/model-access/system-model-resolver'
import { defineOperation } from '@/lib/operations/define-operation'
import { resolveOperationLocale } from '@/lib/operations/environment-input'
import {
  createPlannedTask,
  requirePlannedTaskBillingInfo,
  submitPlannedOperationTasks,
  type OperationPlan,
} from '@/lib/operations/planning'
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

const commonReferenceSchema = z.array(creativeResourceInputRefSchema)
  .max(8)
  .optional()
  .describe('Exact immutable Resource revisions to use as ordered creative inputs. Obtain resourceId, revisionId, and fingerprint from list_resources or get_resource; pass null when no reference is needed.')

const commonMediaGenerationShape = {
  episodeId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).max(200).optional()
    .describe('Optional display name for the generated Resource or candidate set.'),
  prompt: z.string().trim().min(1)
    .describe('Complete generation instruction for the configured media model.'),
  request: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('new'),
      count: z.number().int().min(1).max(6).optional()
        .describe('Number of new candidates to generate. Defaults to 1.'),
    }).strict(),
    z.object({
      kind: z.literal('retry'),
      resourceIds: z.array(z.string().trim().min(1)).min(1).max(6)
        .describe('Exact failed Resource IDs to retry without regenerating successful candidates.'),
    }).strict(),
  ]).describe('Choose new generation or an explicit retry of failed Resources.'),
  references: commonReferenceSchema,
} as const

const createTextInputSchema = z.object({
  episodeId: z.string().trim().min(1).optional(),
  schemaId: z.enum(CREATIVE_RESOURCE_SCHEMA_IDS_BY_MEDIA.text).optional()
    .describe('Professional meaning of the text Resource. Pass null to use generic.text.'),
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
  ]).describe('Choose one completed result or a selectable candidate set.'),
  references: commonReferenceSchema,
}).strict()

const createImageInputSchema = z.object({
  ...commonMediaGenerationShape,
  schemaId: z.enum(CREATIVE_RESOURCE_SCHEMA_IDS_BY_MEDIA.image).optional()
    .describe('Professional meaning of the image Resource. Pass null to use generic.image.'),
  aspectRatio: z.string().trim().min(1).optional()
    .describe('Requested output aspect ratio such as 9:16 or 16:9. Pass null to use the project ratio.'),
  resolution: z.string().trim().min(1).optional()
    .describe('Optional resolution supported by the configured image generation capability, such as 1K or 2K.'),
  quality: z.string().trim().min(1).optional()
    .describe('Optional quality tier supported by the configured image generation capability.'),
  size: z.string().trim().min(1).optional()
    .describe('Optional provider-independent image size supported by the configured image generation capability.'),
}).strict()

const createAudioInputSchema = z.object({
  ...commonMediaGenerationShape,
  schemaId: z.enum(CREATIVE_RESOURCE_SCHEMA_IDS_BY_MEDIA.audio).optional()
    .describe('Professional meaning of the audio Resource. Pass null to use generic.audio.'),
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

const createVideoInputSchema = z.object({
  ...commonMediaGenerationShape,
  schemaId: z.enum(CREATIVE_RESOURCE_SCHEMA_IDS_BY_MEDIA.video).optional()
    .describe('Professional meaning of the video Resource. Pass null to use generic.video.'),
  durationSeconds: z.number().int().min(1).max(CREATIVE_VIDEO_SEGMENT_DURATION_CEILING_SECONDS)
    .describe('Exact duration for this one generated video segment. It must match a duration supported by the server-configured video model and cannot exceed the product ceiling of 15 seconds.'),
  aspectRatio: z.string().trim().min(1).optional()
    .describe('Requested output aspect ratio such as 9:16 or 16:9. Pass null to use the project ratio.'),
  resolution: z.string().trim().min(1).optional()
    .describe('Optional resolution supported by the configured video generation capability, such as 720p or 1080p.'),
  fps: z.number().int().min(1).max(240).optional()
    .describe('Optional frame rate supported by the configured video generation capability.'),
  generateAudio: z.boolean().optional()
    .describe('Whether the configured video generation capability should generate synchronized native audio.'),
}).strict()

type CreateTextInput = z.infer<typeof createTextInputSchema>
type CreateImageInput = z.infer<typeof createImageInputSchema>
type CreateAudioInput = z.infer<typeof createAudioInputSchema>
type CreateVideoInput = z.infer<typeof createVideoInputSchema>
type MediaGenerationInput = CreateImageInput | CreateAudioInput | CreateVideoInput

const resourceRefOutputSchema = z.object({
  resourceId: z.string().min(1),
  revisionId: z.string().min(1).optional(),
  fingerprint: z.string().min(1).optional(),
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

const generationPlanMetadataSchema = z.object({
  mediaType: z.enum(['image', 'audio', 'video']),
  schemaId: z.string().min(1),
  episodeId: z.string().nullable(),
  requestId: z.string().min(1),
  candidateSetId: z.string().nullable(),
  retry: z.boolean(),
  resources: z.array(generationPlanResourceSchema).min(1),
}).strict()

function resolveEpisodeId(input: { episodeId?: string }, ctx: ProjectAgentOperationContext): string | null {
  return input.episodeId?.trim() || ctx.context.episodeId?.trim() || null
}

function normalizeInputReferences(
  references: readonly z.infer<typeof creativeResourceInputRefSchema>[] | undefined,
): CreativeResourceInputRef[] {
  return (references ?? []).map((reference, position) => ({
    resourceId: reference.resourceId,
    revisionId: reference.revisionId,
    fingerprint: reference.fingerprint,
    role: reference.role ?? 'reference',
    position,
  }))
}

async function assertInputReferences(
  userId: string,
  references: readonly CreativeResourceInputRef[],
  requiredMediaType: CreativeResourceMediaType | null,
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
          field: 'references',
          resourceId: reference.resourceId,
          allowedValues: [requiredMediaType],
          agentRetryableAfterCorrection: true,
        })
      }
    }
  })
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
      allowedValues: CREATIVE_RESOURCE_SCHEMA_IDS_BY_MEDIA[mediaType],
      agentRetryableAfterCorrection: true,
    })
  }
  if (schema.mediaType !== mediaType) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'CREATIVE_RESOURCE_SCHEMA_MEDIA_MISMATCH',
      field: 'schemaId',
      requestedValue: schema.schemaId,
      allowedValues: CREATIVE_RESOURCE_SCHEMA_IDS_BY_MEDIA[mediaType],
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
  const schemaId = requireSchemaForMedia(input.schemaId ?? CREATIVE_RESOURCE_SCHEMA.GENERIC_TEXT, 'text')
  const episodeId = resolveEpisodeId(input, ctx)
  const scope = resolveProjectCreativeResourceScope({
    userId: ctx.userId,
    projectId: ctx.projectId,
    episodeId,
  })
  const references = normalizeInputReferences(input.references)
  const candidates = input.content.kind === 'candidates'
    ? input.content.candidates
    : [{ name: input.name, text: input.content.text }]
  const candidateSetId = candidates.length > 1 ? randomUUID() : null
  const requestId = ctx.toolCallId?.trim()
    ? `${ctx.context.runId ?? 'run'}:${ctx.toolCallId.trim()}`
    : randomUUID()
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
    const resource = reserved[candidateIndex]
    if (!resource) throw new Error(`CREATIVE_RESOURCE_RESERVATION_MISSING:${String(candidateIndex)}`)
    const revision = await appendCreativeResourceRevisionInTransaction(tx, {
      resourceId: resource.resourceId,
      userId: ctx.userId,
      mediaType: 'text',
      schemaId,
      content: { kind: 'text', text: candidate.text },
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
        generationOptions: null,
      },
    })
    resources.push({ ...revision, candidateIndex })
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
  readonly modelKey: string
  readonly publicInput: MediaGenerationInput
}): Promise<Record<string, string | number | boolean>> {
  const modelType: UnifiedModelType = input.config.mediaType === 'audio' ? 'music' : input.config.mediaType
  const projectConfig = await getProjectModelConfig(input.ctx.projectId, input.ctx.userId)
  const capabilities = resolveBuiltinCapabilitiesByModelKey(modelType, input.modelKey)
  const optionFields = getCapabilityOptionFields(modelType, capabilities)
  const optionFieldNames = capabilities ? new Set(Object.keys(optionFields)) : null
  const explicitSelections: Record<string, CapabilityValue> = {}

  if (input.config.mediaType === 'image') {
    const publicInput = input.publicInput as CreateImageInput
    for (const field of ['resolution', 'quality', 'size'] as const) {
      requireCapabilityField({
        field,
        value: publicInput[field],
        capabilitiesKnown: capabilities !== undefined,
        optionFields,
        modelKey: input.modelKey,
      })
      if (publicInput[field] !== undefined) explicitSelections[field] = publicInput[field]
    }
  } else if (input.config.mediaType === 'video') {
    const publicInput = input.publicInput as CreateVideoInput
    const selections = {
      duration: publicInput.durationSeconds,
      resolution: publicInput.resolution,
      fps: publicInput.fps,
      generateAudio: publicInput.generateAudio,
    } as const
    for (const [field, value] of Object.entries(selections)) {
      requireCapabilityField({
        field,
        value,
        capabilitiesKnown: capabilities !== undefined,
        optionFields,
        modelKey: input.modelKey,
      })
      if (value !== undefined) explicitSelections[field] = value
    }
  } else {
    const publicInput = input.publicInput as CreateAudioInput
    if (!optionFieldNames || optionFieldNames.has('durationSeconds')) {
      explicitSelections.durationSeconds = publicInput.durationSeconds
    }
    if (publicInput.vocalMode && (!optionFieldNames || optionFieldNames.has('vocalMode'))) {
      explicitSelections.vocalMode = publicInput.vocalMode
    }
    if (publicInput.outputFormat && (!optionFieldNames || optionFieldNames.has('outputFormat'))) {
      explicitSelections.outputFormat = publicInput.outputFormat
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
    ? (input.publicInput as CreateImageInput).aspectRatio?.trim()
    : input.config.mediaType === 'video'
      ? (input.publicInput as CreateVideoInput).aspectRatio?.trim()
      : undefined
  const projectAspectRatio = projectConfig.videoRatio?.trim() || null
  const resolvedAspectRatio = requestedAspectRatio || projectAspectRatio
  if ((input.config.mediaType === 'image' || input.config.mediaType === 'video') && !resolvedAspectRatio) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROJECT_VIDEO_RATIO_REQUIRED',
      field: 'aspectRatio',
      agentRetryableAfterCorrection: true,
    })
  }
  if (input.config.mediaType === 'image') {
    const publicInput = input.publicInput as CreateImageInput
    frozen.aspectRatio = resolvedAspectRatio as string
    if (publicInput.size) frozen.size = publicInput.size
  } else if (input.config.mediaType === 'video') {
    const publicInput = input.publicInput as CreateVideoInput
    frozen.aspectRatio = resolvedAspectRatio as string
    if (typeof publicInput.fps === 'number') frozen.fps = publicInput.fps
  } else {
    const publicInput = input.publicInput as CreateAudioInput
    frozen.durationSeconds = publicInput.durationSeconds
    frozen.vocalMode = publicInput.vocalMode ?? String(frozen.vocalMode ?? 'instrumental')
    frozen.outputFormat = publicInput.outputFormat ?? String(frozen.outputFormat ?? 'mp3')
  }
  return frozen
}

async function planMediaGeneration(
  ctx: ProjectAgentOperationContext,
  input: MediaGenerationInput | CreateAudioInput,
  config: MediaPlanConfig,
): Promise<OperationPlan> {
  const episodeId = resolveEpisodeId(input, ctx)
  const schemaId = requireSchemaForMedia(input.schemaId ?? config.schemaId, config.mediaType)
  const references = normalizeInputReferences(input.references)
  await assertInputReferences(
    ctx.userId,
    references,
    config.mediaType === 'image' || config.mediaType === 'video' ? 'image' : null,
  )
  const modelKey = await resolveGenerationModel({
    ctx,
    purpose: config.modelPurpose,
  })
  if (config.mediaType === 'video') {
    if (references.length === 0 && !supportsTextToVideoModel(modelKey)) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'VIDEO_MODEL_TEXT_TO_VIDEO_UNSUPPORTED',
        field: 'references',
        modelKey,
        requiredCapability: 'textToVideo',
        agentRetryableAfterCorrection: true,
      })
    }
    const maxReferences = resolveBuiltinCapabilitiesByModelKey('video', modelKey)?.video?.maxReferenceImages ?? 1
    if (references.length > maxReferences) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'VIDEO_MODEL_REFERENCE_LIMIT_EXCEEDED',
        field: 'references',
        modelKey,
        requestedValue: references.length,
        allowedValues: [maxReferences],
        agentRetryableAfterCorrection: true,
      })
    }
  }
  const generationOptions = await resolveFrozenGenerationOptions({
    ctx,
    config,
    modelKey,
    publicInput: input,
  })
  const inputHash = hashTaskInput({
    operationId: config.operationId,
    prompt: input.prompt,
    modelKey,
    schemaId,
    references,
    generationOptions,
    ...(config.mediaType === 'audio' ? {
      durationSeconds: (input as CreateAudioInput).durationSeconds,
      vocalMode: (input as CreateAudioInput).vocalMode,
      genre: (input as CreateAudioInput).genre,
      mood: (input as CreateAudioInput).mood,
      bpm: (input as CreateAudioInput).bpm,
      outputFormat: (input as CreateAudioInput).outputFormat,
    } : {}),
  })
  const retryResourceIds = input.request.kind === 'retry' ? input.request.resourceIds : []
  const requestId = [
    'generation',
    config.operationId,
    ctx.userId,
    ctx.projectId,
    episodeId ?? 'project',
    ctx.context.runId?.trim() || 'no-run',
    ctx.toolCallId?.trim() || stableArgsHash({ input, modelKey, schemaId, references, generationOptions }),
    inputHash,
  ].join(':')
  const retryRows = retryResourceIds.length > 0
    ? await prisma.creativeResource.findMany({
        where: {
          id: { in: retryResourceIds },
          userId: ctx.userId,
          projectId: ctx.projectId,
        },
        select: {
          id: true,
          name: true,
          mediaType: true,
          schemaId: true,
          status: true,
          candidateSetId: true,
          candidateIndex: true,
          episodeId: true,
        },
      })
    : []
  if (retryResourceIds.length > 0 && retryRows.length !== retryResourceIds.length) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'CREATIVE_RESOURCE_RETRY_TARGET_NOT_FOUND',
      field: 'request.resourceIds',
      requestedValue: retryResourceIds,
      agentRetryableAfterCorrection: true,
    })
  }
  const retryById = new Map(retryRows.map((resource) => [resource.id, resource]))
  const resources = retryResourceIds.length > 0
      ? retryResourceIds.map((resourceId, candidateIndex) => {
        const resource = retryById.get(resourceId)
        if (!resource) {
          throw new ApiError('INVALID_PARAMS', {
            code: 'CREATIVE_RESOURCE_RETRY_TARGET_NOT_FOUND',
            field: 'request.resourceIds',
            requestedValue: resourceId,
            agentRetryableAfterCorrection: true,
          })
        }
        if (
          resource.status !== 'failed'
          || resource.mediaType !== config.mediaType
          || resource.schemaId !== schemaId
          || resource.episodeId !== episodeId
        ) {
          throw new ApiError('INVALID_PARAMS', {
            code: 'CREATIVE_RESOURCE_RETRY_TARGET_INVALID',
            field: 'request.resourceIds',
            requestedValue: resourceId,
            expected: {
              status: 'failed',
              mediaType: config.mediaType,
              schemaId,
              episodeId,
            },
            agentRetryableAfterCorrection: true,
          })
        }
        return {
          resourceId,
          name: resource.name,
          candidateIndex: resource.candidateIndex ?? candidateIndex,
        }
      })
    : Array.from({
        length: input.request.kind === 'new' ? (input.request.count ?? 1) : 1,
      }, (_, candidateIndex) => ({
        resourceId: buildCreativeResourceOriginKey({
          operationId: config.operationId,
          requestId,
          candidateIndex,
        }),
        name: input.name ?? `${config.mediaType[0]?.toUpperCase() ?? ''}${config.mediaType.slice(1)} ${String(candidateIndex + 1)}`,
        candidateIndex,
      }))
  const candidateSetId = retryRows[0]?.candidateSetId
    ?? (resources.length > 1
      ? buildCreativeResourceCandidateSetId({ operationId: config.operationId, requestId })
      : null)
  const tasks = resources.map((resource) => {
    const resourcePayload = {
      resourceId: resource.resourceId,
      mediaType: config.mediaType,
      schemaId,
      prompt: input.prompt,
      modelKey,
      inputHash,
      inputs: references,
      generationOptions,
      // Approval revalidates the frozen plan in a later decision segment. The
      // stable toolCallId identifies the creative invocation across both
      // segments; the commit receives its own operationExecutionId.
      executionSegmentId: null,
      toolCallId: ctx.toolCallId?.trim() || null,
    }
    const payload = {
      resource: resourcePayload,
      [config.modelPayloadKey]: modelKey,
      prompt: input.prompt,
      count: 1 as const,
      generationOptions,
      ...(config.mediaType === 'audio' ? {
        durationSeconds: (input as CreateAudioInput).durationSeconds,
        ...((input as CreateAudioInput).vocalMode ? { vocalMode: (input as CreateAudioInput).vocalMode } : {}),
        ...((input as CreateAudioInput).genre ? { genre: (input as CreateAudioInput).genre } : {}),
        ...((input as CreateAudioInput).mood ? { mood: (input as CreateAudioInput).mood } : {}),
        ...(typeof (input as CreateAudioInput).bpm === 'number' ? { bpm: (input as CreateAudioInput).bpm } : {}),
        ...((input as CreateAudioInput).outputFormat ? { outputFormat: (input as CreateAudioInput).outputFormat } : {}),
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
    reservedIdentityIds: retryResourceIds.length > 0 ? [] : resources.map((resource) => resource.resourceId),
    metadata: {
      mediaType: config.mediaType,
      schemaId,
      episodeId,
      requestId,
      candidateSetId,
      retry: retryResourceIds.length > 0,
      resources,
    },
  }
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
  schemaId: CREATIVE_RESOURCE_SCHEMA.GENERIC_AUDIO,
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
      summary: 'Persist one or more independent text resources authored in this Agent turn. Use schemaId to express script, edit table, plan, or generic text semantics; no Workflow stage is required.',
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
        acceptsReferences: true,
        outputMediaTypes: ['text'],
        outputSchemaIds: Object.values(CREATIVE_RESOURCE_SCHEMA).filter((schemaId) => requireCreativeResourceSchema(schemaId).mediaType === 'text'),
        supportsCandidates: true,
      },
      confirmation: { kind: 'none', required: false },
      inputSchema: createTextInputSchema,
      outputSchema: createTextOutputSchema,
      executeInTransaction: async (ctx, input, tx) => await createTextResources(ctx, input, tx),
    }),
    create_image: defineOperation({
      id: 'create_image',
      summary: 'Generate independent image resources directly from a prompt, with optional exact Resource revisions as references. No script, bible, character, scene, or Workflow stage is required.',
      intent: 'act',
      effects: MEDIA_EFFECTS,
      resourceContract: {
        kind: 'resource',
        acceptsReferences: true,
        outputMediaTypes: ['image'],
        outputSchemaIds: Object.values(CREATIVE_RESOURCE_SCHEMA).filter((schemaId) => requireCreativeResourceSchema(schemaId).mediaType === 'image'),
        supportsCandidates: true,
      },
      confirmation: { kind: 'billable_media', required: true },
      inputSchema: createImageInputSchema,
      outputSchema: mediaTaskOutputSchema,
      plan: async (ctx, input) => await planMediaGeneration(ctx, input, IMAGE_CONFIG),
      commit: async (ctx, _input, plan) => await commitMediaGeneration(ctx, plan, IMAGE_CONFIG),
    }),
    create_audio: defineOperation({
      id: 'create_audio',
      summary: 'Generate an independent audio resource from a prompt, optionally recording exact video or other Resource revisions as creative lineage. No episode BGM plan or Workflow stage is required.',
      intent: 'act',
      effects: MEDIA_EFFECTS,
      resourceContract: {
        kind: 'resource',
        acceptsReferences: true,
        outputMediaTypes: ['audio'],
        outputSchemaIds: Object.values(CREATIVE_RESOURCE_SCHEMA).filter((schemaId) => requireCreativeResourceSchema(schemaId).mediaType === 'audio'),
        supportsCandidates: true,
      },
      confirmation: { kind: 'billable_media', required: true },
      inputSchema: createAudioInputSchema,
      outputSchema: mediaTaskOutputSchema,
      plan: async (ctx, input) => await planMediaGeneration(ctx, input, AUDIO_CONFIG),
      commit: async (ctx, _input, plan) => await commitMediaGeneration(ctx, plan, AUDIO_CONFIG),
    }),
    create_video: defineOperation({
      id: 'create_video',
      summary: 'Generate independent video resources directly from a prompt, with optional exact image Resource revisions. Zero-reference text-to-video is allowed only when the configured video capability supports it.',
      intent: 'act',
      effects: MEDIA_EFFECTS,
      resourceContract: {
        kind: 'resource',
        acceptsReferences: true,
        outputMediaTypes: ['video'],
        outputSchemaIds: Object.values(CREATIVE_RESOURCE_SCHEMA).filter((schemaId) => requireCreativeResourceSchema(schemaId).mediaType === 'video'),
        supportsCandidates: true,
      },
      confirmation: { kind: 'billable_media', required: true },
      inputSchema: createVideoInputSchema,
      outputSchema: mediaTaskOutputSchema,
      plan: async (ctx, input) => await planMediaGeneration(ctx, input, VIDEO_CONFIG),
      commit: async (ctx, _input, plan) => await commitMediaGeneration(ctx, plan, VIDEO_CONFIG),
    }),
  }
}
