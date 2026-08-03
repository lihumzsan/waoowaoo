import path from 'node:path'
import { z } from 'zod'
import { getProjectModelConfig } from '@/lib/config-service'
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
import { defineOperation } from '@/lib/operations/define-operation'
import { resolveOperationLocale } from '@/lib/operations/environment-input'
import {
  PROJECT_VIDEO_RATIO_METADATA_KEY,
  projectVideoRatioSnapshotSchema,
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

const MAX_ALTERNATIVES = 6
const MAX_MANIFEST_ITEMS = OPERATION_EXECUTION_MAX_TASKS
const MEDIA_GENERATION_PLAN_CONTRACT_REVISION = 'workspace-resource-production/v1'

const workspaceResourceJsonValueSchema: z.ZodType<WorkspaceResourceJsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(workspaceResourceJsonValueSchema),
  z.record(z.string(), workspaceResourceJsonValueSchema),
]))

const generationReferenceSchema = workspaceResourceInputRefSchema.extend({
  channel: z.enum(['context', 'image', 'audio', 'video']),
}).strict()

const baseMediaItemShape = {
  outputPath: z.string().trim().min(1).max(512)
    .describe('Complete project-relative output path ending in .resource.'),
  prompt: z.string().trim().min(1).max(100_000),
  schemaId: z.string().trim().min(1).max(96).optional(),
  modelKey: z.string().trim().min(1).max(191).optional(),
  references: z.array(generationReferenceSchema).max(16).optional(),
  generationOptions: workspaceResourceGenerationOptionsSchema.optional(),
} as const

const newMediaRequestSchema = z.object({
  kind: z.literal('new'),
  ...baseMediaItemShape,
  count: z.number().int().min(1).max(MAX_ALTERNATIVES).default(1),
  durationSeconds: z.number().int().min(1).max(600).optional(),
  vocalMode: z.enum(['instrumental', 'vocal']).optional(),
  genre: z.string().trim().min(1).max(200).optional(),
  mood: z.string().trim().min(1).max(200).optional(),
  bpm: z.number().int().min(20).max(300).optional(),
  outputFormat: z.enum(['mp3', 'wav']).optional(),
}).strict()

const retryMediaRequestSchema = z.object({
  kind: z.literal('retry'),
  resourceIds: z.array(z.string().trim().min(1).max(32)).min(1).max(MAX_MANIFEST_ITEMS),
}).strict()

const mediaRequestSchema = z.object({
  request: z.discriminatedUnion('kind', [newMediaRequestSchema, retryMediaRequestSchema]),
}).strict()

const manifestItemSchema = z.object({
  itemId: z.string().trim().min(1).max(191),
  mediaType: z.enum(['image', 'audio', 'video']),
  ...baseMediaItemShape,
  durationSeconds: z.number().int().min(1).max(600).optional(),
  vocalMode: z.enum(['instrumental', 'vocal']).optional(),
  genre: z.string().trim().min(1).max(200).optional(),
  mood: z.string().trim().min(1).max(200).optional(),
  bpm: z.number().int().min(20).max(300).optional(),
  outputFormat: z.enum(['mp3', 'wav']).optional(),
}).strict()

const submitProductionManifestInputSchema = z.object({
  manifestId: z.string().trim().min(1).max(191),
  items: z.array(manifestItemSchema).min(1).max(MAX_MANIFEST_ITEMS),
  maxBudgetCredits: z.number().finite().positive().optional(),
}).strict().superRefine((value, context) => {
  const itemIds = new Set(value.items.map((item) => item.itemId))
  if (itemIds.size !== value.items.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'manifest itemId values must be unique' })
  }
  const paths = new Set(value.items.map((item) => item.outputPath))
  if (paths.size !== value.items.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'manifest outputPath values must be unique' })
  }
})

const rerunFailedItemsInputSchema = z.object({
  resourceIds: z.array(z.string().trim().min(1).max(32)).min(1).max(MAX_MANIFEST_ITEMS),
  maxBudgetCredits: z.number().finite().positive().optional(),
}).strict()

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

type NewMediaRequest = z.infer<typeof newMediaRequestSchema>
type ManifestItem = z.infer<typeof manifestItemSchema>

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

function schemaForMedia(mediaType: PlannedResource['mediaType'], schemaId?: string): string {
  const fallback = mediaType === 'image'
    ? WORKSPACE_RESOURCE_SCHEMA.GENERIC_IMAGE
    : mediaType === 'video'
      ? WORKSPACE_RESOURCE_SCHEMA.GENERIC_VIDEO
      : WORKSPACE_RESOURCE_SCHEMA.BGM_AUDIO
  const resolved = schemaId?.trim() || fallback
  const schema = requireWorkspaceResourceSchema(resolved)
  if (schema.mediaType !== mediaType || !WORKSPACE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA[mediaType].includes(schema.schemaId)) {
    throw new Error(`WORKSPACE_RESOURCE_GENERATION_SCHEMA_INVALID:${resolved}:${mediaType}`)
  }
  return resolved
}

async function modelForMedia(
  ctx: ProjectAgentOperationContext,
  mediaType: PlannedResource['mediaType'],
  requested?: string,
): Promise<string> {
  if (requested?.trim()) return requested.trim()
  const config = await getProjectModelConfig(ctx.projectId, ctx.userId)
  const model = mediaType === 'video'
    ? config.videoModel
    : mediaType === 'audio'
      ? config.musicModel
      : config.editModel ?? config.characterModel ?? config.locationModel
  if (!model) throw new Error(`WORKSPACE_RESOURCE_MODEL_REQUIRED:${mediaType}`)
  return model
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
      throw new Error(`WORKSPACE_RESOURCE_REFERENCE_CHANNEL_MISMATCH:${reference.resourceId}:${reference.channel}`)
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
  const modelKey = await modelForMedia(input.ctx, mediaType, input.item.modelKey)
  const publicReferences = input.item.references ?? []
  const allowedChannels = mediaType === 'image'
    ? new Set(['context', 'image'])
    : mediaType === 'video'
      ? new Set(['context', 'image', 'audio'])
      : new Set(['context', 'video'])
  const invalidChannel = publicReferences.find((reference) => !allowedChannels.has(reference.channel))
  if (invalidChannel) {
    throw new Error(`WORKSPACE_RESOURCE_REFERENCE_CHANNEL_UNSUPPORTED:${mediaType}:${invalidChannel.channel}`)
  }
  const references = await freezeReferences(input.ctx, publicReferences)
  const generationOptions: Record<string, string | number | boolean | null> = {
    ...(input.item.generationOptions ?? {}),
  }
  const config = await getProjectModelConfig(input.ctx.projectId, input.ctx.userId)
  if ((mediaType === 'image' || mediaType === 'video') && !generationOptions.aspectRatio && config.videoRatio) {
    generationOptions.aspectRatio = config.videoRatio
  }
  const resourceId = buildWorkspaceResourceId({
    operationId: input.operationId,
    requestId: `${input.requestId}:${input.item.itemId}`,
    memberIndex: input.memberIndex,
  })
  const inputHash = generationInputFingerprint({
    mediaType,
    schemaId,
    modelKey,
    prompt: input.item.prompt,
    references,
    generationOptions,
    durationSeconds: input.item.durationSeconds ?? null,
  })
  const resourcePayload: WorkspaceResourceGenerationTaskPayload['resource'] = {
    resourceId,
    workspacePath: input.outputPath,
    mediaType,
    schemaId,
    inputHash,
    prompt: input.item.prompt,
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
    ...modelPayload(mediaType, modelKey),
    count: 1,
    generationOptions,
    ...(input.item.durationSeconds ? { durationSeconds: input.item.durationSeconds } : {}),
    ...(input.item.vocalMode ? { vocalMode: input.item.vocalMode } : {}),
    ...(input.item.genre ? { genre: input.item.genre } : {}),
    ...(input.item.mood ? { mood: input.item.mood } : {}),
    ...(input.item.bpm ? { bpm: input.item.bpm } : {}),
    ...(input.item.outputFormat ? { outputFormat: input.item.outputFormat } : {}),
  }
  if ((mediaType === 'audio' || mediaType === 'video') && !payload.durationSeconds) {
    throw new Error(`WORKSPACE_RESOURCE_${mediaType.toUpperCase()}_DURATION_REQUIRED:${input.item.itemId}`)
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
    throw new Error(`WORKSPACE_RESOURCE_MANIFEST_BUDGET_EXCEEDED:${String(frozen)}:${String(maxBudgetCredits)}`)
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
  const item: ManifestItem = {
    itemId: 'primary',
    mediaType,
    outputPath: request.outputPath,
    prompt: request.prompt,
    schemaId: request.schemaId,
    modelKey: request.modelKey,
    references: request.references,
    generationOptions: request.generationOptions,
    durationSeconds: request.durationSeconds,
    vocalMode: request.vocalMode,
    genre: request.genre,
    mood: request.mood,
    bpm: request.bpm,
    outputFormat: request.outputFormat,
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

async function planManifest(
  ctx: ProjectAgentOperationContext,
  input: z.infer<typeof submitProductionManifestInputSchema>,
): Promise<OperationPlan> {
  const operationId = 'submit_production_manifest'
  const requestId = requestIdentity(ctx, operationId, { manifestId: input.manifestId, items: input.items })
  const built = await Promise.all(input.items.map(async (item) => await buildPlannedItem({
    ctx,
    operationId,
    requestId,
    item,
    memberIndex: 0,
    outputPath: item.outputPath,
    alternatives: false,
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
  return resourceIds.map((resourceId) => {
    const resource = byId.get(resourceId)
    if (!resource?.task || !resource.mediaType) throw new Error(`WORKSPACE_RESOURCE_RETRY_TARGET_INVALID:${resourceId}`)
    const taskType = taskTypeForMedia(resource.mediaType as PlannedResource['mediaType'])
    if (resource.task.type !== taskType) throw new Error(`WORKSPACE_RESOURCE_RETRY_TASK_TYPE_INVALID:${resourceId}`)
    const source = parseWorkspaceResourceGenerationRetrySource(resource.task.payload)
    if (source.resource.resourceId !== resource.id) {
      throw new Error(`WORKSPACE_RESOURCE_RETRY_TASK_TARGET_MISMATCH:${resourceId}`)
    }
    const mediaType = resource.mediaType as PlannedResource['mediaType']
    const prompt = resource.prompt?.trim()
    const modelKey = resource.modelKey?.trim()
    if (!prompt || !modelKey) throw new Error(`WORKSPACE_RESOURCE_RETRY_FROZEN_INPUT_MISSING:${resourceId}`)
    const generationOptions = workspaceResourceGenerationOptionsSchema.parse(resource.generationOptions ?? {})
    if ((mediaType === 'audio' || mediaType === 'video') && !source.durationSeconds) {
      throw new Error(`WORKSPACE_RESOURCE_RETRY_DURATION_MISSING:${resourceId}`)
    }
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
      },
    }
  })
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

function mediaOperation(input: {
  readonly operationId: 'create_image' | 'create_audio' | 'create_video'
  readonly mediaType: PlannedResource['mediaType']
  readonly schemaIds: readonly string[]
  readonly mediaKind: 'image' | 'music' | 'video'
}) {
  return defineOperation({
    id: input.operationId,
    summary: `Generate ${input.mediaType} files at explicit workspace paths. Inputs are exact Resource versions; retry accepts only failed Resource IDs.`,
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
        minCount: 1,
        maxCount: 6,
      },
    },
    confirmation: { kind: 'billable_media', required: true },
    planContractRevision: MEDIA_GENERATION_PLAN_CONTRACT_REVISION,
    inputSchema: mediaRequestSchema,
    outputSchema: mediaOutputSchema,
    plan: async (ctx, value) => value.request.kind === 'retry'
      ? await planRetry(ctx, input.operationId, value.request.resourceIds)
      : await planNewMedia(ctx, input.operationId, input.mediaType, value.request),
    commit: async (ctx, _value, plan) => await commitProductionPlan(ctx, input.operationId, plan),
  })
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
    create_image: mediaOperation({
      operationId: 'create_image',
      mediaType: 'image',
      mediaKind: 'image',
      schemaIds: WORKSPACE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA.image,
    }),
    create_audio: mediaOperation({
      operationId: 'create_audio',
      mediaType: 'audio',
      mediaKind: 'music',
      schemaIds: WORKSPACE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA.audio,
    }),
    create_video: mediaOperation({
      operationId: 'create_video',
      mediaType: 'video',
      mediaKind: 'video',
      schemaIds: WORKSPACE_RESOURCE_GENERATION_SCHEMA_IDS_BY_MEDIA.video,
    }),
    submit_production_manifest: defineOperation({
      id: 'submit_production_manifest',
      summary: 'Validate and freeze one explicit image/audio/video production manifest, quote one aggregate budget, then fan out all independent items through Temporal.',
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
