import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import { VOICE_DESIGN_LANGUAGE_OPTIONS } from '@/lib/ai-registry/voice-design-contract'
import {
  CREATIVE_RESOURCE_CHARACTER_VOICE_BINDING_ROLE,
} from '@/lib/creative-resource/contracts'
import {
  buildCreativeResourceId,
  resolveProjectCreativeResourceScope,
} from '@/lib/creative-resource/identity'
import { reserveCreativeResourcesInTransaction } from '@/lib/creative-resource/persistence'
import { CREATIVE_RESOURCE_SCHEMA } from '@/lib/creative-resource/schema-registry'
import { buildCreativeResourceLifecycleProjection } from '@/lib/creative-resource/task-runtime-envelope'
import { resolveSystemModelKey } from '@/lib/model-access/system-model-resolver'
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
import { TASK_TYPE } from '@/lib/task/types'
import {
  bindCharacterVoiceInTransaction,
  type CharacterVoiceSelection,
} from '@/lib/voice/voice-resource-service'
import { createWorkspaceResourceBroadcastsInTransaction } from '@/lib/workspace-resource/resource-change-events'

const voiceTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('standalone') }).strict(),
  z.object({
    kind: z.literal('character'),
    characterId: z.string().trim().min(1)
      .describe('Exact project character ID. The completed voice resource will be bound to this character.'),
  }).strict(),
])

const voiceResourceCommandSchema = z.object({
  kind: z.literal('new'),
  name: z.string().trim().min(1).max(191).optional()
    .describe('Optional display name for the new immutable voice Resource.'),
}).strict()

const generateVoiceInputSchema = z.object({
  description: z.string().trim().min(1).max(4_000)
    .describe('Natural-language design of the voice identity, such as age, timbre, accent, pace, energy, and emotional texture.'),
  previewText: z.string().trim().min(1).max(10_000)
    .describe('Short multilingual sample to render with the designed voice. This exact text is billed by character count.'),
  language: z.enum(VOICE_DESIGN_LANGUAGE_OPTIONS)
    .describe('Language of previewText. Use Auto only when language cannot be determined reliably.'),
  resource: voiceResourceCommandSchema,
  target: voiceTargetSchema,
}).strict()

const bindVoiceInputSchema = z.object({
  characterId: z.string().trim().min(1),
  selection: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('voice'),
      resourceId: z.string().trim().min(1),
    }).strict(),
    z.object({ kind: z.literal('none') }).strict(),
  ]),
}).strict()

const voiceBindingOutputSchema = z.object({
  bindingId: z.string().min(1),
  scope: z.object({
    kind: z.enum(['user', 'project', 'episode']),
    id: z.string().min(1),
    userId: z.string().min(1),
    projectId: z.string().nullable(),
    episodeId: z.string().nullable(),
  }).strict(),
  role: z.literal(CREATIVE_RESOURCE_CHARACTER_VOICE_BINDING_ROLE),
  slotKey: z.string().min(1),
  resourceId: z.string().min(1),
  version: z.number().int().min(0),
  source: z.string().min(1),
}).strict()

const bindVoiceOutputSchema = z.object({
  success: z.literal(true),
  characterId: z.string().min(1),
  binding: voiceBindingOutputSchema.nullable(),
}).strict()

const generateVoiceOutputSchema = refineTaskSubmitOperationOutputSchema(
  taskSubmitOperationOutputSchemaBase.extend({
    resourceId: z.string().min(1),
    bindingRequested: z.boolean(),
  }).passthrough(),
)

const voicePlanMetadataSchema = z.object({
  resourceId: z.string().min(1),
  resourceName: z.string().min(1),
  requestId: z.string().min(1),
}).strict()

type GenerateVoiceInput = z.infer<typeof generateVoiceInputSchema>

async function requireCharacterAndBindingVersion(
  ctx: ProjectAgentOperationContext,
  target: GenerateVoiceInput['target'],
): Promise<number | null | undefined> {
  if (target.kind === 'standalone') return undefined
  const character = await prisma.projectCharacter.findFirst({
    where: {
      id: target.characterId,
      projectId: ctx.projectId,
      project: { userId: ctx.userId },
    },
    select: { id: true },
  })
  if (!character) {
    throw new ApiError('NOT_FOUND', {
      code: 'VOICE_CHARACTER_NOT_FOUND',
      field: 'target.characterId',
    })
  }
  const binding = await prisma.creativeResourceBinding.findFirst({
    where: {
      userId: ctx.userId,
      projectId: ctx.projectId,
      scopeKind: 'project',
      scopeId: ctx.projectId,
      role: CREATIVE_RESOURCE_CHARACTER_VOICE_BINDING_ROLE,
      slotKey: target.characterId,
    },
    select: { version: true },
  })
  return binding?.version ?? null
}

async function planGenerateVoice(
  ctx: ProjectAgentOperationContext,
  input: GenerateVoiceInput,
): Promise<OperationPlan> {
  const voiceModel = await resolveSystemModelKey({
    userId: ctx.userId,
    projectId: ctx.projectId,
    purpose: 'voice-design',
  })
  const expectedBindingVersion = await requireCharacterAndBindingVersion(ctx, input.target)
  const inputHash = stableArgsHash({
    operationId: 'generate_voice',
    projectId: ctx.projectId,
    input,
    voiceModel,
    expectedBindingVersion,
  })
  const requestId = [
    'generate_voice',
    ctx.userId,
    ctx.projectId,
    ctx.context.runId?.trim() ?? 'no-run',
    ctx.toolCallId?.trim() ?? inputHash,
    inputHash,
  ].join(':')
  const resourceId = buildCreativeResourceId({
    operationId: 'generate_voice',
    requestId,
    candidateIndex: 0,
  })
  const resourceName = input.resource.name
    ?? input.description.slice(0, 80)
  const generationOptions = { language: input.language }
  const resourcePayload = {
    resourceId,
    mediaType: 'audio' as const,
    schemaId: CREATIVE_RESOURCE_SCHEMA.VOICE_REFERENCE,
    prompt: input.description,
    modelKey: voiceModel,
    inputHash,
    inputs: [],
    imageInputPositions: [],
    audioInputPositions: [],
    videoInputPositions: [],
    generationOptions,
    executionSegmentId: null,
    toolCallId: ctx.toolCallId?.trim() || null,
    ...(input.target.kind === 'character' ? {
      binding: {
        kind: 'character_voice' as const,
        characterId: input.target.characterId,
        expectedVersion: expectedBindingVersion ?? null,
      },
    } : {}),
  }
  const payload = {
    lifecycleProjection: buildCreativeResourceLifecycleProjection([{
      resourceId,
      mediaType: 'audio',
      schemaId: CREATIVE_RESOURCE_SCHEMA.VOICE_REFERENCE,
      name: resourceName,
    }]),
    resource: resourcePayload,
    voiceModel,
    prompt: input.description,
    previewText: input.previewText,
    language: input.language,
    count: 1 as const,
    generationOptions,
  }
  const task = createPlannedTask({
    id: `generate_voice:${resourceId}:${inputHash}`,
    taskType: TASK_TYPE.CREATIVE_RESOURCE_VOICE,
    targetType: 'CreativeResource',
    targetId: resourceId,
    payload,
    locale: resolveOperationLocale(ctx.context),
    episodeId: null,
    dedupeKey: `generate_voice:${resourceId}:${inputHash}`,
    billingInfo: requirePlannedTaskBillingInfo({
      taskType: TASK_TYPE.CREATIVE_RESOURCE_VOICE,
      payload,
      allowedApiTypes: ['voice'],
    }),
  })
  return {
    kind: 'task_submission',
    operationId: 'generate_voice',
    projectId: ctx.projectId,
    userId: ctx.userId,
    tasks: [task],
    reservedIdentityIds: [resourceId],
    metadata: {
      resourceId,
      resourceName,
      requestId,
    },
  }
}

async function commitGenerateVoice(ctx: ProjectAgentOperationContext, plan: OperationPlan) {
  const authorization = ctx.executionAuthorization
  if (!authorization) throw new Error('OPERATION_EXECUTION_AUTHORIZATION_REQUIRED')
  const metadata = voicePlanMetadataSchema.parse(plan.metadata)
  await reserveCreativeResourcesInTransaction(authorization.transaction, {
    scope: resolveProjectCreativeResourceScope({
      userId: ctx.userId,
      projectId: ctx.projectId,
      episodeId: null,
    }),
    mediaType: 'audio',
    schemaId: CREATIVE_RESOURCE_SCHEMA.VOICE_REFERENCE,
    operationId: 'generate_voice',
    requestId: metadata.requestId,
    candidates: [{
      resourceId: metadata.resourceId,
      name: metadata.resourceName,
      candidateIndex: 0,
    }],
  })
  const submitted = await submitPlannedOperationTasks({ ctx, operationId: 'generate_voice' })
  await createWorkspaceResourceBroadcastsInTransaction({
    tx: authorization.transaction,
    invocationId: authorization.operationExecutionId,
    affectedResources: [{ kind: 'creativeResources', projectId: ctx.projectId, episodeId: null }],
    userId: ctx.userId,
    operationId: 'generate_voice',
  })
  const task = plan.tasks[0]
  if (!task) throw new Error('VOICE_OPERATION_PLAN_EMPTY')
  const result = submitted.get(task.id)
  if (!result) throw new Error(`VOICE_TASK_RESULT_MISSING:${task.id}`)
  return generateVoiceOutputSchema.parse({
    ...result,
    resourceId: metadata.resourceId,
    bindingRequested: Boolean(task.payload.resource && (
      task.payload.resource as Record<string, unknown>
    ).binding),
  })
}

export function createVoiceOperations(): ProjectAgentOperationRegistryDraft {
  return {
    generate_voice: defineOperation({
      id: 'generate_voice',
      summary: 'Design one reusable voice from a natural-language voice description and render one short preview audio as a new immutable Resource. Regeneration creates another Resource; choose standalone for an unbound voice, or character to bind the completed Resource automatically without overwriting a newer manual binding.',
      intent: 'act',
      effects: {
        writes: true,
        workspaceResourceImpact: 'none',
        billable: true,
        destructive: false,
        overwrite: false,
        bulk: false,
        externalSideEffects: true,
        longRunning: true,
      },
      resourceContract: {
        kind: 'resource',
        assistantPresentation: 'created_resources',
        acceptsReferences: false,
        outputMediaTypes: ['audio'],
        outputSchemaIds: [CREATIVE_RESOURCE_SCHEMA.VOICE_REFERENCE],
        supportsCandidates: false,
      },
      confirmation: { kind: 'billable_media', required: true },
      inputSchema: generateVoiceInputSchema,
      outputSchema: generateVoiceOutputSchema,
      plan: planGenerateVoice,
      commit: async (ctx, _input, plan) => await commitGenerateVoice(ctx, plan),
    }),
    bind_voice: defineOperation({
      id: 'bind_voice',
      summary: 'Bind, replace, or unbind the exact immutable audio Resource used as one project character\'s voice. Accepts a designed project.voice_reference Resource or a user-uploaded project.upload_audio Resource. Use selection.kind=none to unbind. This never generates audio and never creates another voice Resource.',
      intent: 'act',
      effects: {
        writes: true,
        workspaceResourceImpact: 'creative_resources',
        billable: false,
        destructive: false,
        overwrite: true,
        bulk: false,
        externalSideEffects: false,
        longRunning: false,
      },
      resourceContract: {
        kind: 'none',
        reason: 'updates only the canonical character voice Binding and never creates a Resource',
      },
      confirmation: { kind: 'none', required: false },
      inputSchema: bindVoiceInputSchema,
      outputSchema: bindVoiceOutputSchema,
      executeInTransaction: async (ctx, input, tx) => {
        const binding = await bindCharacterVoiceInTransaction(tx, {
          userId: ctx.userId,
          projectId: ctx.projectId,
          characterId: input.characterId,
          selection: input.selection as CharacterVoiceSelection,
        })
        return bindVoiceOutputSchema.parse({
          success: true,
          characterId: input.characterId,
          binding,
        })
      },
    }),
  }
}
