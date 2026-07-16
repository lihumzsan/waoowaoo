import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import {
  getCapabilityOptionFields,
  resolveBuiltinCapabilitiesByModelKey,
  resolveGenerationOptionsForModel,
} from '@/lib/ai-registry/capabilities-catalog'
import { parseModelKeyStrict } from '@/lib/ai-registry/selection'
import type { CapabilityValue, UnifiedModelType } from '@/lib/ai-registry/types'
import { supportsTextToVideoModel } from '@/lib/ai-registry/video-model-helpers'
import { getProjectModelConfig } from '@/lib/config-service'
import type {
  CreativeResourceInputRef,
  CreativeResourceMediaType,
} from '@/lib/creative-resource/contracts'
import {
  creativeResourceGenerationOptionsSchema,
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
  requireCreativeResourceSchema,
} from '@/lib/creative-resource/schema-registry'
import { isPlatformProviderCredentialMode } from '@/lib/deployment/config'
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

const commonReferenceSchema = z.array(creativeResourceInputRefSchema).max(8).optional()

const createTextInputSchema = z.object({
  episodeId: z.string().trim().min(1).optional(),
  schemaId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  prompt: z.string().trim().min(1),
  text: z.string().trim().min(1).optional(),
  candidates: z.array(z.object({
    name: z.string().trim().min(1).max(200).optional(),
    text: z.string().trim().min(1),
  }).strict()).min(1).max(6).optional(),
  references: commonReferenceSchema,
}).strict().refine((input) => Boolean(input.text) !== Boolean(input.candidates), {
  message: 'Provide exactly one of text or candidates',
  path: ['text'],
})

const mediaGenerationInputSchema = z.object({
  episodeId: z.string().trim().min(1).optional(),
  schemaId: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  prompt: z.string().trim().min(1),
  modelKey: z.string().trim().min(1).optional(),
  count: z.number().int().min(1).max(6).optional(),
  retryResourceIds: z.array(z.string().trim().min(1)).min(1).max(6).optional(),
  references: commonReferenceSchema,
  generationOptions: creativeResourceGenerationOptionsSchema.optional(),
}).strict().refine((input) => !(input.count && input.retryResourceIds), {
  message: 'count and retryResourceIds are mutually exclusive',
  path: ['retryResourceIds'],
})

const createAudioInputSchema = mediaGenerationInputSchema.extend({
  durationSeconds: z.number().int().min(1).max(600),
  vocalMode: z.enum(['instrumental', 'vocal']).optional(),
  genre: z.string().trim().min(1).optional(),
  mood: z.string().trim().min(1).optional(),
  bpm: z.number().int().min(20).max(300).optional(),
  outputFormat: z.enum(['mp3', 'wav']).optional(),
}).strict()

type CreateTextInput = z.infer<typeof createTextInputSchema>
type MediaGenerationInput = z.infer<typeof mediaGenerationInputSchema>
type CreateAudioInput = z.infer<typeof createAudioInputSchema>

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
        throw new Error(
          `CREATIVE_RESOURCE_INPUT_MEDIA_TYPE_INVALID:${reference.resourceId}:${requiredMediaType}`,
        )
      }
    }
  })
}

function requireSchemaForMedia(schemaId: string, mediaType: CreativeResourceMediaType): string {
  const schema = requireCreativeResourceSchema(schemaId)
  if (schema.mediaType !== mediaType) {
    throw new Error(`CREATIVE_RESOURCE_SCHEMA_MEDIA_MISMATCH:${schema.schemaId}:${mediaType}`)
  }
  return schema.schemaId
}

async function resolveGenerationModel(input: {
  readonly ctx: ProjectAgentOperationContext
  readonly requestedModelKey?: string
  readonly purpose: SystemModelPurpose
}): Promise<string> {
  const configured = await resolveSystemModelKey({
    userId: input.ctx.userId,
    projectId: input.ctx.projectId,
    purpose: input.purpose,
  })
  const requested = input.requestedModelKey?.trim() || ''
  if (isPlatformProviderCredentialMode()) {
    if (requested && requested !== configured) {
      throw new ApiError('FORBIDDEN', {
        code: 'TASK_MODEL_MANAGED_BY_PLATFORM',
        field: 'modelKey',
      })
    }
    return configured
  }
  if (!requested) return configured
  const parsed = parseModelKeyStrict(requested)
  if (!parsed) throw new Error(`CREATIVE_RESOURCE_MODEL_KEY_INVALID:${requested}`)
  return parsed.modelKey
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
  const candidates = input.candidates ?? [{ name: input.name, text: input.text ?? '' }]
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

const GENERATION_OPTION_KEYS = {
  image: new Set(['aspectRatio', 'resolution', 'quality', 'size']),
  audio: new Set<string>(),
  video: new Set(['duration', 'fps', 'resolution', 'aspectRatio', 'generateAudio']),
} as const

function readCapabilitySelections(
  options: z.infer<typeof creativeResourceGenerationOptionsSchema> | undefined,
  allowedFields: ReadonlySet<string> | null,
): Record<string, CapabilityValue> {
  const selections: Record<string, CapabilityValue> = {}
  for (const [field, value] of Object.entries(options ?? {})) {
    if (!GENERATION_OPTION_KEYS.image.has(field)
      && !GENERATION_OPTION_KEYS.video.has(field)
      && !GENERATION_OPTION_KEYS.audio.has(field)) {
      throw new Error(`CREATIVE_RESOURCE_GENERATION_OPTION_UNSUPPORTED:${field}`)
    }
    if (allowedFields && !allowedFields.has(field)) continue
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      selections[field] = value
    }
  }
  return selections
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
): void {
  const issue = issues[0]
  if (!issue) return
  throw new Error(`${issue.code}:${modelKey}:${issue.field}:${issue.message}`)
}

async function resolveFrozenGenerationOptions(input: {
  readonly ctx: ProjectAgentOperationContext
  readonly config: MediaPlanConfig
  readonly modelKey: string
  readonly generationOptions: z.infer<typeof creativeResourceGenerationOptionsSchema> | undefined
  readonly audioInput: CreateAudioInput | null
}): Promise<Record<string, string | number | boolean>> {
  const modelType: UnifiedModelType = input.config.mediaType === 'audio' ? 'music' : input.config.mediaType
  const projectConfig = await getProjectModelConfig(input.ctx.projectId, input.ctx.userId)
  const capabilities = resolveBuiltinCapabilitiesByModelKey(modelType, input.modelKey)
  const optionFields = getCapabilityOptionFields(modelType, capabilities)
  const optionFieldNames = capabilities ? new Set(Object.keys(optionFields)) : null
  const explicitSelections = readCapabilitySelections(input.generationOptions, optionFieldNames)
  if (input.audioInput) {
    if (!optionFieldNames || optionFieldNames.has('durationSeconds')) {
      explicitSelections.durationSeconds = input.audioInput.durationSeconds
    }
    if (input.audioInput.vocalMode && (!optionFieldNames || optionFieldNames.has('vocalMode'))) {
      explicitSelections.vocalMode = input.audioInput.vocalMode
    }
    if (input.audioInput.outputFormat && (!optionFieldNames || optionFieldNames.has('outputFormat'))) {
      explicitSelections.outputFormat = input.audioInput.outputFormat
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
  assertCapabilityResolution(input.modelKey, partial.issues)
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
  assertCapabilityResolution(input.modelKey, resolved.issues)

  const frozen: Record<string, string | number | boolean> = { ...resolved.options }
  const raw = input.generationOptions ?? {}
  const projectAspectRatio = projectConfig.videoRatio?.trim() || '9:16'
  if (input.config.mediaType === 'image') {
    frozen.aspectRatio = typeof raw.aspectRatio === 'string' ? raw.aspectRatio : projectAspectRatio
    if (typeof raw.size === 'string') frozen.size = raw.size
  } else if (input.config.mediaType === 'video') {
    frozen.aspectRatio = typeof raw.aspectRatio === 'string' ? raw.aspectRatio : projectAspectRatio
    if (typeof raw.fps === 'number') frozen.fps = raw.fps
  } else if (input.audioInput) {
    frozen.durationSeconds = input.audioInput.durationSeconds
    frozen.vocalMode = input.audioInput.vocalMode ?? String(frozen.vocalMode ?? 'instrumental')
    frozen.outputFormat = input.audioInput.outputFormat ?? String(frozen.outputFormat ?? 'mp3')
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
    requestedModelKey: input.modelKey,
    purpose: config.modelPurpose,
  })
  if (config.mediaType === 'video') {
    if (references.length === 0 && !supportsTextToVideoModel(modelKey)) {
      throw new Error(`VIDEO_MODEL_TEXT_TO_VIDEO_UNSUPPORTED:${modelKey}`)
    }
    const maxReferences = resolveBuiltinCapabilitiesByModelKey('video', modelKey)?.video?.maxReferenceImages ?? 1
    if (references.length > maxReferences) {
      throw new Error(
        `VIDEO_MODEL_REFERENCE_LIMIT_EXCEEDED:${modelKey}:${String(references.length)}:${String(maxReferences)}`,
      )
    }
  }
  const generationOptions = await resolveFrozenGenerationOptions({
    ctx,
    config,
    modelKey,
    generationOptions: input.generationOptions,
    audioInput: config.mediaType === 'audio' ? input as CreateAudioInput : null,
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
  const retryResourceIds = input.retryResourceIds ?? []
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
    throw new Error('CREATIVE_RESOURCE_RETRY_TARGET_NOT_FOUND')
  }
  const retryById = new Map(retryRows.map((resource) => [resource.id, resource]))
  const resources = retryResourceIds.length > 0
    ? retryResourceIds.map((resourceId, candidateIndex) => {
        const resource = retryById.get(resourceId)
        if (!resource) throw new Error(`CREATIVE_RESOURCE_RETRY_TARGET_NOT_FOUND:${resourceId}`)
        if (
          resource.status !== 'failed'
          || resource.mediaType !== config.mediaType
          || resource.schemaId !== schemaId
          || resource.episodeId !== episodeId
        ) {
          throw new Error(`CREATIVE_RESOURCE_RETRY_TARGET_INVALID:${resourceId}`)
        }
        return {
          resourceId,
          name: resource.name,
          candidateIndex: resource.candidateIndex ?? candidateIndex,
        }
      })
    : Array.from({ length: input.count ?? 1 }, (_, candidateIndex) => ({
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
      agentFlow: { onTaskComplete: 'resume_agent' },
      confirmation: { kind: 'billable_media', required: true },
      inputSchema: mediaGenerationInputSchema,
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
      agentFlow: { onTaskComplete: 'resume_agent' },
      confirmation: { kind: 'billable_media', required: true },
      inputSchema: createAudioInputSchema,
      outputSchema: mediaTaskOutputSchema,
      plan: async (ctx, input) => await planMediaGeneration(ctx, input, AUDIO_CONFIG),
      commit: async (ctx, _input, plan) => await commitMediaGeneration(ctx, plan, AUDIO_CONFIG),
    }),
    create_video: defineOperation({
      id: 'create_video',
      summary: 'Generate independent video resources directly from a prompt, with optional exact image Resource revisions. Zero-reference text-to-video is allowed only when the selected model declares that capability.',
      intent: 'act',
      effects: MEDIA_EFFECTS,
      resourceContract: {
        kind: 'resource',
        acceptsReferences: true,
        outputMediaTypes: ['video'],
        outputSchemaIds: Object.values(CREATIVE_RESOURCE_SCHEMA).filter((schemaId) => requireCreativeResourceSchema(schemaId).mediaType === 'video'),
        supportsCandidates: true,
      },
      agentFlow: { onTaskComplete: 'resume_agent' },
      confirmation: { kind: 'billable_media', required: true },
      inputSchema: mediaGenerationInputSchema,
      outputSchema: mediaTaskOutputSchema,
      plan: async (ctx, input) => await planMediaGeneration(ctx, input, VIDEO_CONFIG),
      commit: async (ctx, _input, plan) => await commitMediaGeneration(ctx, plan, VIDEO_CONFIG),
    }),
  }
}
