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
  refineTaskBatchSubmitOperationOutputSchema,
  taskBatchSubmitOperationOutputSchemaBase,
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
  name: z.string().trim().min(1).max(191)
    .describe('Display name for the new immutable voice Resource.'),
}).strict()

const voiceDesignMemberShape = {
  description: z.string().trim().min(1).max(4_000)
    .describe('Natural-language design of the voice identity, such as age, timbre, accent, pace, energy, and emotional texture.'),
  previewText: z.string().trim().min(1).max(10_000)
    .describe('Short multilingual sample to render with the designed voice. This exact text is billed by character count.'),
  language: z.enum(VOICE_DESIGN_LANGUAGE_OPTIONS)
    .describe('Language of previewText. Use Auto only when language cannot be determined reliably.'),
  resource: voiceResourceCommandSchema,
} as const

const singleVoiceRequestSchema = z.object({
  kind: z.literal('single'),
  ...voiceDesignMemberShape,
  target: voiceTargetSchema,
}).strict()

const characterVoiceMemberSchema = z.object({
  characterId: z.string().trim().min(1)
    .describe('Exact project character ID. The completed voice Resource will be bound to this character.'),
  ...voiceDesignMemberShape,
}).strict()

const charactersVoiceRequestSchema = z.object({
  kind: z.literal('characters'),
  characters: z.array(characterVoiceMemberSchema).min(1),
}).strict()

// generate_voice has no capability binder, so this canonical schema is also
// the model-facing tool schema. Both branches are complete and strict.
const generateVoiceInputSchema = z.object({
  request: z.discriminatedUnion('kind', [
    singleVoiceRequestSchema,
    charactersVoiceRequestSchema,
  ]),
}).strict().superRefine((input, context) => {
  if (input.request.kind !== 'characters') return
  const seen = new Set<string>()
  input.request.characters.forEach((character, index) => {
    if (seen.has(character.characterId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['request', 'characters', index, 'characterId'],
        message: 'VOICE_CHARACTER_DUPLICATE',
      })
    }
    seen.add(character.characterId)
  })
})

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

const generateVoiceOutputSchema = refineTaskBatchSubmitOperationOutputSchema(
  taskBatchSubmitOperationOutputSchemaBase.extend({
    total: z.number().int().positive(),
    taskIds: z.array(z.string().min(1)).min(1),
    results: z.array(z.object({
      refId: z.string().min(1),
      taskId: z.string().min(1),
    }).passthrough()).min(1),
    resources: z.array(z.object({
      resourceId: z.string().min(1),
      candidateIndex: z.number().int().min(0),
      characterId: z.string().min(1).nullable(),
      bindingRequested: z.boolean(),
    }).strict()).min(1),
  }).passthrough(),
)

const voicePlanMetadataSchema = z.object({
  requestId: z.string().min(1),
  resources: z.array(z.object({
    resourceId: z.string().min(1),
    resourceName: z.string().min(1),
    candidateIndex: z.number().int().min(0),
    characterId: z.string().min(1).nullable(),
  }).strict()).min(1),
}).strict()

type GenerateVoiceInput = z.infer<typeof generateVoiceInputSchema>

interface VoiceGenerationMember {
  readonly description: string
  readonly previewText: string
  readonly language: typeof VOICE_DESIGN_LANGUAGE_OPTIONS[number]
  readonly resource: z.infer<typeof voiceResourceCommandSchema>
  readonly target: z.infer<typeof voiceTargetSchema>
  readonly expectedBindingVersion: number | null | undefined
}

async function resolveVoiceGenerationMembers(
  ctx: ProjectAgentOperationContext,
  input: GenerateVoiceInput,
): Promise<VoiceGenerationMember[]> {
  const requested = input.request.kind === 'single'
    ? [{
        description: input.request.description,
        previewText: input.request.previewText,
        language: input.request.language,
        resource: input.request.resource,
        target: input.request.target,
      }]
    : input.request.characters.map((character) => ({
        description: character.description,
        previewText: character.previewText,
        language: character.language,
        resource: character.resource,
        target: {
          kind: 'character' as const,
          characterId: character.characterId,
        },
      }))
  const characterIds = requested.flatMap((member) => (
    member.target.kind === 'character' ? [member.target.characterId] : []
  ))
  if (characterIds.length === 0) {
    return requested.map((member) => ({
      ...member,
      expectedBindingVersion: undefined,
    }))
  }
  const characters = await prisma.projectCharacter.findMany({
    where: {
      id: { in: characterIds },
      projectId: ctx.projectId,
      project: { userId: ctx.userId },
    },
    select: { id: true },
  })
  const foundCharacterIds = new Set(characters.map((character) => character.id))
  const missingCharacterId = characterIds.find((characterId) => !foundCharacterIds.has(characterId))
  if (missingCharacterId) {
    throw new ApiError('NOT_FOUND', {
      code: 'VOICE_CHARACTER_NOT_FOUND',
      field: input.request.kind === 'single'
        ? 'request.target.characterId'
        : 'request.characters.characterId',
      characterId: missingCharacterId,
    })
  }
  const bindings = await prisma.creativeResourceBinding.findMany({
    where: {
      userId: ctx.userId,
      projectId: ctx.projectId,
      scopeKind: 'project',
      scopeId: ctx.projectId,
      role: CREATIVE_RESOURCE_CHARACTER_VOICE_BINDING_ROLE,
      slotKey: { in: characterIds },
    },
    select: { slotKey: true, version: true },
  })
  const bindingVersionByCharacterId = new Map(
    bindings.map((binding) => [binding.slotKey, binding.version]),
  )
  return requested.map((member) => ({
    ...member,
    expectedBindingVersion: member.target.kind === 'character'
      ? bindingVersionByCharacterId.get(member.target.characterId) ?? null
      : undefined,
  }))
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
  const members = await resolveVoiceGenerationMembers(ctx, input)
  const planFingerprint = stableArgsHash({
    operationId: 'generate_voice',
    projectId: ctx.projectId,
    input,
    voiceModel,
    bindingVersions: members.map((member) => member.expectedBindingVersion ?? null),
  })
  const requestId = [
    'generate_voice',
    ctx.userId,
    ctx.projectId,
    ctx.context.runId?.trim() ?? 'no-run',
    ctx.toolCallId?.trim() ?? planFingerprint,
    planFingerprint,
  ].join(':')
  const resources = members.map((member, candidateIndex) => ({
    resourceId: buildCreativeResourceId({
      operationId: 'generate_voice',
      requestId,
      candidateIndex,
    }),
    resourceName: member.resource.name,
    candidateIndex,
    characterId: member.target.kind === 'character' ? member.target.characterId : null,
  }))
  const tasks = members.map((member, candidateIndex) => {
    const resource = resources[candidateIndex]
    if (!resource) throw new Error(`VOICE_RESOURCE_PLAN_MISSING:${String(candidateIndex)}`)
    const inputHash = stableArgsHash({
      operationId: 'generate_voice',
      projectId: ctx.projectId,
      requestKind: input.request.kind,
      member: {
        description: member.description,
        previewText: member.previewText,
        language: member.language,
        resource: member.resource,
        target: member.target,
      },
      voiceModel,
      expectedBindingVersion: member.expectedBindingVersion ?? null,
    })
    const generationOptions = { language: member.language }
    const resourcePayload = {
      resourceId: resource.resourceId,
      mediaType: 'audio' as const,
      schemaId: CREATIVE_RESOURCE_SCHEMA.VOICE_REFERENCE,
      prompt: member.description,
      modelKey: voiceModel,
      inputHash,
      inputs: [],
      imageInputPositions: [],
      audioInputPositions: [],
      videoInputPositions: [],
      generationOptions,
      executionSegmentId: null,
      toolCallId: ctx.toolCallId?.trim() || null,
      ...(member.target.kind === 'character' ? {
        binding: {
          kind: 'character_voice' as const,
          characterId: member.target.characterId,
          expectedVersion: member.expectedBindingVersion ?? null,
        },
      } : {}),
    }
    const payload = {
      lifecycleProjection: buildCreativeResourceLifecycleProjection([{
        resourceId: resource.resourceId,
        mediaType: 'audio',
        schemaId: CREATIVE_RESOURCE_SCHEMA.VOICE_REFERENCE,
        name: resource.resourceName,
      }]),
      resource: resourcePayload,
      voiceModel,
      prompt: member.description,
      previewText: member.previewText,
      language: member.language,
      count: 1 as const,
      generationOptions,
    }
    return createPlannedTask({
      id: `generate_voice:${resource.resourceId}`,
      taskType: TASK_TYPE.CREATIVE_RESOURCE_VOICE,
      targetType: 'CreativeResource',
      targetId: resource.resourceId,
      payload,
      locale: resolveOperationLocale(ctx.context),
      episodeId: null,
      dedupeKey: `generate_voice:${resource.resourceId}:${inputHash}`,
      billingInfo: requirePlannedTaskBillingInfo({
        taskType: TASK_TYPE.CREATIVE_RESOURCE_VOICE,
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
    metadata: {
      requestId,
      resources,
    },
  }
}

async function commitGenerateVoice(ctx: ProjectAgentOperationContext, plan: OperationPlan) {
  const authorization = ctx.executionAuthorization
  if (!authorization) throw new Error('OPERATION_EXECUTION_AUTHORIZATION_REQUIRED')
  const metadata = voicePlanMetadataSchema.parse(plan.metadata)
  if (
    plan.tasks.length !== metadata.resources.length
    || plan.tasks.some((task, index) => task.target.targetId !== metadata.resources[index]?.resourceId)
  ) {
    throw new Error('VOICE_OPERATION_PLAN_CONTRACT_INVALID')
  }
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
    candidates: metadata.resources.map((resource) => ({
      resourceId: resource.resourceId,
      name: resource.resourceName,
      candidateIndex: resource.candidateIndex,
    })),
  })
  const submitted = await submitPlannedOperationTasks({ ctx, operationId: 'generate_voice' })
  await createWorkspaceResourceBroadcastsInTransaction({
    tx: authorization.transaction,
    invocationId: authorization.operationExecutionId,
    affectedResources: [{ kind: 'creativeResources', projectId: ctx.projectId, episodeId: null }],
    userId: ctx.userId,
    operationId: 'generate_voice',
  })
  const results = plan.tasks.map((task) => {
    const result = submitted.get(task.id)
    if (!result) throw new Error(`VOICE_TASK_RESULT_MISSING:${task.id}`)
    return result
  })
  const first = results[0]
  if (!first) throw new Error('VOICE_OPERATION_PLAN_EMPTY')
  return generateVoiceOutputSchema.parse({
    ...first,
    total: results.length,
    taskIds: results.map((result) => result.taskId),
    results: results.map((result, index) => {
      const resource = metadata.resources[index]
      if (!resource) throw new Error(`VOICE_RESOURCE_RESULT_MISSING:${String(index)}`)
      return {
        refId: resource.resourceId,
        taskId: result.taskId,
      }
    }),
    resources: metadata.resources.map((resource) => ({
      resourceId: resource.resourceId,
      candidateIndex: resource.candidateIndex,
      characterId: resource.characterId,
      bindingRequested: resource.characterId !== null,
    })),
  })
}

export function createVoiceOperations(): ProjectAgentOperationRegistryDraft {
  return {
    generate_voice: defineOperation({
      id: 'generate_voice',
      summary: 'Design reusable voices and render short preview audio Resources. Use request.kind=single for one standalone or character voice. Use request.kind=characters to submit every selected character in one priced plan and one approval; each member becomes an independent Resource and Task, so partial failure does not discard successful voices and a follow-up can submit only failed characters. Completed character voices bind automatically without overwriting a newer manual binding.',
      intent: 'act',
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
        outputMediaTypes: ['audio'],
        outputSchemaIds: [CREATIVE_RESOURCE_SCHEMA.VOICE_REFERENCE],
        supportsCandidates: false,
      },
      confirmation: { kind: 'billable_media', required: true },
      planContractRevision: 'voice-generation/v2',
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
