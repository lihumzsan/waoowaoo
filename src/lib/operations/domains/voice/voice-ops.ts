import path from 'node:path'
import { z } from 'zod'
import { VOICE_DESIGN_LANGUAGE_OPTIONS } from '@/lib/ai-registry/voice-design-contract'
import { parseWorkspaceResourceGenerationTaskPayload } from '@/lib/workspace-resource/generation-contract'
import { buildWorkspaceResourceId } from '@/lib/workspace-resource/identity'
import { resourceNameFromPath } from '@/lib/workspace-resource/path'
import {
  reserveWorkspaceResourceInTransaction,
  validateWorkspaceResourcePlacement,
} from '@/lib/workspace-resource/persistence'
import { WORKSPACE_RESOURCE_SCHEMA } from '@/lib/workspace-resource/schema-registry'
import { buildWorkspaceResourceLifecycleProjection } from '@/lib/workspace-resource/task-runtime-envelope'
import { resolveSystemModelKey } from '@/lib/model-access/system-model-resolver'
import { defineOperation } from '@/lib/operations/define-operation'
import { resolveOperationLocale } from '@/lib/operations/environment-input'
import {
  createPlannedTask,
  requirePlannedTaskBillingInfo,
  submitPlannedOperationTasks,
  type OperationPlan,
  type PlannedTask,
} from '@/lib/operations/planning'
import { refineTaskBatchSubmitOperationOutputSchema, taskBatchSubmitOperationOutputSchemaBase } from '@/lib/operations/output-schemas'
import type { ProjectAgentOperationContext, ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { prisma } from '@/lib/prisma'
import { stableArgsFingerprint, stableArgsHash } from '@/lib/project-agent/stable-args-hash'
import { TASK_TYPE } from '@/lib/task/types'

const voiceNewSchema = z.object({
  kind: z.literal('new'),
  outputPath: z.string().trim().min(1).max(512),
  description: z.string().trim().min(1).max(4_000),
  previewText: z.string().trim().min(1).max(10_000),
  language: z.enum(VOICE_DESIGN_LANGUAGE_OPTIONS),
  modelKey: z.string().trim().min(1).max(191).optional(),
  count: z.number().int().min(1).max(6).default(1),
}).strict()

const voiceRetrySchema = z.object({
  kind: z.literal('retry'),
  resourceIds: z.array(z.string().trim().min(1).max(32)).min(1).max(6),
}).strict()

const generateVoiceInputSchema = z.object({
  request: z.discriminatedUnion('kind', [voiceNewSchema, voiceRetrySchema]),
}).strict()

const generateVoiceOutputSchema = refineTaskBatchSubmitOperationOutputSchema(
  taskBatchSubmitOperationOutputSchemaBase.extend({
    total: z.number().int().positive(),
    taskIds: z.array(z.string().min(1)).min(1),
    results: z.array(z.object({ refId: z.string().min(1), taskId: z.string().min(1) }).strict()).min(1),
    resources: z.array(z.object({
      resourceId: z.string().min(1),
      workspacePath: z.string().min(1),
      memberIndex: z.number().int().nonnegative(),
    }).strict()).min(1),
  }).passthrough(),
)

const voicePlanMetadataSchema = z.object({
  requestId: z.string().min(1),
  retry: z.boolean(),
  alternatives: z.boolean(),
  resources: z.array(z.object({
    resourceId: z.string().min(1),
    workspacePath: z.string().min(1),
    memberIndex: z.number().int().nonnegative(),
    taskPlanId: z.string().min(1),
  }).strict()).min(1),
}).strict()

function alternativePath(outputPath: string, memberIndex: number): string {
  if (memberIndex === 0) return outputPath
  const extension = path.posix.extname(outputPath)
  return `${outputPath.slice(0, -extension.length)}-${String(memberIndex + 1)}${extension}`
}

async function planNewVoice(
  ctx: ProjectAgentOperationContext,
  request: z.infer<typeof voiceNewSchema>,
): Promise<OperationPlan> {
  const voiceModel = request.modelKey ?? await resolveSystemModelKey({
    userId: ctx.userId,
    projectId: ctx.projectId,
    purpose: 'voice-design',
  })
  const fingerprint = stableArgsHash({ request, voiceModel })
  const requestId = [
    'generate_voice', ctx.userId, ctx.projectId,
    ctx.context.turnId?.trim() || 'no-turn',
    ctx.toolCallId?.trim() || ctx.requestId?.trim() || fingerprint,
    fingerprint,
  ].join(':')
  const resources = Array.from({ length: request.count }, (_, memberIndex) => {
    const resourceId = buildWorkspaceResourceId({ operationId: 'generate_voice', requestId, memberIndex })
    return {
      resourceId,
      workspacePath: alternativePath(request.outputPath, memberIndex),
      memberIndex,
      taskPlanId: `generate_voice:${resourceId}`,
    }
  })
  await Promise.all(resources.map(async (resource) => await validateWorkspaceResourcePlacement(prisma, {
    userId: ctx.userId,
    projectId: ctx.projectId,
    outputPath: resource.workspacePath,
    mediaType: 'audio',
    schemaId: WORKSPACE_RESOURCE_SCHEMA.VOICE_REFERENCE,
  })))
  const tasks = resources.map((resource) => {
    const inputHash = stableArgsFingerprint({
      description: request.description,
      previewText: request.previewText,
      language: request.language,
      voiceModel,
      memberIndex: resource.memberIndex,
    })
    const payload = {
      lifecycleProjection: buildWorkspaceResourceLifecycleProjection([{
        resourceId: resource.resourceId,
        mediaType: 'audio',
        schemaId: WORKSPACE_RESOURCE_SCHEMA.VOICE_REFERENCE,
        name: resourceNameFromPath(resource.workspacePath),
      }]),
      protocol: 'workspace_resource_generation_v1' as const,
      resource: {
        resourceId: resource.resourceId,
        workspacePath: resource.workspacePath,
        mediaType: 'audio' as const,
        schemaId: WORKSPACE_RESOURCE_SCHEMA.VOICE_REFERENCE,
        inputHash,
        prompt: request.description,
        modelKey: voiceModel,
        inputs: [],
        imageInputPositions: [],
        audioInputPositions: [],
        videoInputPositions: [],
        toolCallId: ctx.toolCallId?.trim() || null,
        sourceTurnId: ctx.context.turnId?.trim() || null,
      },
      voiceModel,
      previewText: request.previewText,
      language: request.language,
      count: 1 as const,
      generationOptions: { language: request.language },
    }
    return createPlannedTask({
      id: resource.taskPlanId,
      taskType: TASK_TYPE.WORKSPACE_RESOURCE_VOICE,
      targetType: 'WorkspaceResource',
      targetId: resource.resourceId,
      payload,
      locale: resolveOperationLocale(ctx.context),
      dedupeKey: `generate_voice:${resource.resourceId}:${inputHash}`,
      billingInfo: requirePlannedTaskBillingInfo({
        taskType: TASK_TYPE.WORKSPACE_RESOURCE_VOICE,
        payload,
        allowedApiTypes: ['voice'],
      }),
    })
  })
  return {
    kind: 'task_submission',
    operationId: 'generate_voice',
    projectId: ctx.projectId,
    userId: ctx.userId,
    tasks,
    reservedIdentityIds: resources.map((resource) => resource.resourceId),
    metadata: { requestId, retry: false, alternatives: request.count > 1, resources },
  }
}

async function planRetryVoice(
  ctx: ProjectAgentOperationContext,
  resourceIds: readonly string[],
): Promise<OperationPlan> {
  const rows = await prisma.workspaceResource.findMany({
    where: {
      id: { in: [...resourceIds] },
      userId: ctx.userId,
      projectId: ctx.projectId,
      resourceKind: 'file',
      mediaType: 'audio',
      schemaId: WORKSPACE_RESOURCE_SCHEMA.VOICE_REFERENCE,
      status: { in: ['failed', 'canceled'] },
      deletedAt: null,
    },
    include: { task: { select: { id: true, type: true, payload: true } } },
  })
  const byId = new Map(rows.map((row) => [row.id, row]))
  const resources = resourceIds.map((resourceId, memberIndex) => {
    const row = byId.get(resourceId)
    if (!row?.task || row.task.type !== TASK_TYPE.WORKSPACE_RESOURCE_VOICE) {
      throw new Error(`WORKSPACE_RESOURCE_VOICE_RETRY_TARGET_INVALID:${resourceId}`)
    }
    parseWorkspaceResourceGenerationTaskPayload(row.task.payload)
    return {
      resourceId,
      workspacePath: row.workspacePath,
      memberIndex: row.memberIndex ?? memberIndex,
      taskPlanId: `generate_voice:retry:${resourceId}`,
      sourceTask: row.task,
    }
  })
  const tasks = resources.map((resource): PlannedTask => {
    const payload = parseWorkspaceResourceGenerationTaskPayload(resource.sourceTask.payload)
    return createPlannedTask({
      id: resource.taskPlanId,
      taskType: TASK_TYPE.WORKSPACE_RESOURCE_VOICE,
      targetType: 'WorkspaceResource',
      targetId: resource.resourceId,
      payload,
      locale: resolveOperationLocale(ctx.context),
      dedupeKey: `generate_voice:retry:${resource.resourceId}:${resource.sourceTask.id}`,
      billingInfo: requirePlannedTaskBillingInfo({
        taskType: TASK_TYPE.WORKSPACE_RESOURCE_VOICE,
        payload,
        allowedApiTypes: ['voice'],
      }),
    })
  })
  return {
    kind: 'task_submission',
    operationId: 'generate_voice',
    projectId: ctx.projectId,
    userId: ctx.userId,
    tasks,
    reservedIdentityIds: [],
    metadata: {
      requestId: `generate_voice:retry:${stableArgsHash(resourceIds)}`,
      retry: true,
      alternatives: false,
      resources: resources.map((resource) => ({
        resourceId: resource.resourceId,
        workspacePath: resource.workspacePath,
        memberIndex: resource.memberIndex,
        taskPlanId: resource.taskPlanId,
      })),
    },
  }
}

async function commitVoice(ctx: ProjectAgentOperationContext, plan: OperationPlan) {
  const authorization = ctx.executionAuthorization
  if (!authorization) throw new Error('OPERATION_EXECUTION_AUTHORIZATION_REQUIRED')
  const metadata = voicePlanMetadataSchema.parse(plan.metadata)
  if (!metadata.retry) {
    for (const resource of metadata.resources) {
      const task = plan.tasks.find((candidate) => candidate.id === resource.taskPlanId)
      if (!task) throw new Error(`VOICE_PLAN_TASK_MISSING:${resource.taskPlanId}`)
      const payload = parseWorkspaceResourceGenerationTaskPayload(task.payload)
      await reserveWorkspaceResourceInTransaction(authorization.transaction, {
        resourceId: resource.resourceId,
        userId: ctx.userId,
        projectId: ctx.projectId,
        outputPath: resource.workspacePath,
        mediaType: 'audio',
        schemaId: WORKSPACE_RESOURCE_SCHEMA.VOICE_REFERENCE,
        memberIndex: resource.memberIndex,
        operationExecutionId: authorization.operationExecutionId,
        alternativeGroupExecutionId: metadata.alternatives ? authorization.operationExecutionId : null,
        operationId: 'generate_voice',
        inputHash: payload.resource.inputHash,
        prompt: payload.resource.prompt,
        modelKey: payload.resource.modelKey,
        generationOptions: payload.generationOptions,
        toolCallId: ctx.toolCallId?.trim() || null,
      })
    }
  } else {
    const updated = await authorization.transaction.workspaceResource.updateMany({
      where: {
        id: { in: metadata.resources.map((resource) => resource.resourceId) },
        userId: ctx.userId,
        projectId: ctx.projectId,
        status: { in: ['failed', 'canceled'] },
      },
      data: { status: 'pending', errorCode: null, errorMessage: null, operationId: 'generate_voice' },
    })
    if (updated.count !== metadata.resources.length) throw new Error('WORKSPACE_RESOURCE_RETRY_TARGET_CHANGED:generate_voice')
  }
  const submitted = await submitPlannedOperationTasks({ ctx, operationId: 'generate_voice' })
  const results = plan.tasks.map((task) => {
    const result = submitted.get(task.id)
    if (!result) throw new Error(`VOICE_TASK_RESULT_MISSING:${task.id}`)
    return result
  })
  for (const resource of metadata.resources) {
    const result = submitted.get(resource.taskPlanId)
    if (!result) throw new Error(`VOICE_TASK_RESULT_MISSING:${resource.taskPlanId}`)
    const updated = await authorization.transaction.workspaceResource.updateMany({
      where: { id: resource.resourceId, status: 'pending' },
      data: { taskId: result.taskId },
    })
    if (updated.count !== 1) throw new Error(`VOICE_TASK_BINDING_CONFLICT:${resource.resourceId}`)
  }
  const first = results[0]
  if (!first) throw new Error('VOICE_OPERATION_PLAN_EMPTY')
  return generateVoiceOutputSchema.parse({
    ...first,
    total: results.length,
    taskIds: results.map((result) => result.taskId),
    results: metadata.resources.map((resource, index) => ({
      refId: resource.resourceId,
      taskId: results[index]?.taskId ?? '',
    })),
    resources: metadata.resources.map((resource) => ({
      resourceId: resource.resourceId,
      workspacePath: resource.workspacePath,
      memberIndex: resource.memberIndex,
    })),
  })
}

export function createVoiceOperations(): ProjectAgentOperationRegistryDraft {
  return {
    generate_voice: defineOperation({
      id: 'generate_voice',
      summary: 'Design voice preview audio Resources at explicit workspace paths. Alternatives are independent Tasks; retry reuses the original frozen payload.',
      intent: 'act',
      channels: { tool: true, api: true, mcp: true },
      effects: {
        writes: true,
        workspaceResourceImpact: 'none',
        billable: true,
        destructive: false,
        overwrite: false,
        bulk: true,
        externalSideEffects: true,
        longRunning: true,
      },
      resourceContract: {
        kind: 'resource',
        assistantPresentation: 'created_resources',
        acceptsReferences: false,
        outputResourceKinds: ['file'],
        outputMediaTypes: ['audio'],
        outputSchemaIds: [WORKSPACE_RESOURCE_SCHEMA.VOICE_REFERENCE],
        placement: 'required',
        alternativeGeneration: {
          kind: 'request_count',
          mediaKind: 'voice',
          requestKind: 'single',
          minCount: 1,
          maxCount: 6,
          inputLimits: { promptMaxLength: 4_000, previewTextMaxLength: 10_000 },
        },
      },
      confirmation: { kind: 'billable_media', required: true },
      planContractRevision: 'voice-generation/v5',
      inputSchema: generateVoiceInputSchema,
      outputSchema: generateVoiceOutputSchema,
      plan: async (ctx, input) => input.request.kind === 'retry'
        ? await planRetryVoice(ctx, input.request.resourceIds)
        : await planNewVoice(ctx, input.request),
      commit: async (ctx, _input, plan) => await commitVoice(ctx, plan),
    }),
  }
}
