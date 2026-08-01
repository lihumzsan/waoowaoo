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
import {
  buildCreativeResourceRetryTaskPayload,
  loadCreativeResourceRetryTargets,
} from '@/lib/creative-resource/generation-retry'
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

const voiceTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('standalone') }).strict(),
  z.object({
    kind: z.literal('character'),
    characterId: z.string().trim().min(1)
      .describe('Exact project character ID. The completed voice resource will be bound to this character.'),
  }).strict(),
])

const VOICE_DESCRIPTION_MAX_LENGTH = 4_000
const VOICE_PREVIEW_TEXT_MAX_LENGTH = 10_000

const voiceResourceCommandSchema = z.object({
  name: z.string().trim().min(1).max(191)
    .describe('Display name for the new immutable voice Resource.'),
}).strict()

const voiceDesignMemberShape = {
  description: z.string().trim().min(1).max(VOICE_DESCRIPTION_MAX_LENGTH)
    .describe('Natural-language design of the voice identity, such as age, timbre, accent, pace, energy, and emotional texture.'),
  previewText: z.string().trim().min(1).max(VOICE_PREVIEW_TEXT_MAX_LENGTH)
    .describe('Short multilingual sample to render with the designed voice. This exact text is billed by character count.'),
  language: z.enum(VOICE_DESIGN_LANGUAGE_OPTIONS)
    .describe('Language of previewText. Use Auto only when language cannot be determined reliably.'),
  resource: voiceResourceCommandSchema,
} as const

const singleVoiceRequestSchema = z.object({
  kind: z.literal('single'),
  ...voiceDesignMemberShape,
  count: z.number().int().min(1).max(6).default(1)
    .describe('Number of independent voice alternatives. Must be 1 when target.kind=character; use standalone to create a browsable alternative group.'),
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

const retryVoiceRequestSchema = z.object({
  kind: z.literal('retry'),
  resourceIds: z.array(z.string().trim().min(1)).min(1).max(6)
    .describe('Exact failed voice Resource IDs whose original frozen generation inputs must be retried.'),
}).strict()

// generate_voice has no capability binder, so this canonical schema is also
// the model-facing tool schema. Both branches are complete and strict.
const generateVoiceInputSchema = z.object({
  request: z.discriminatedUnion('kind', [
    singleVoiceRequestSchema,
    charactersVoiceRequestSchema,
    retryVoiceRequestSchema,
  ]),
}).strict().superRefine((input, context) => {
  if (
    input.request.kind === 'single'
    && input.request.target.kind === 'character'
    && input.request.count !== 1
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['request', 'count'],
      message: 'VOICE_CHARACTER_ALTERNATIVES_REQUIRE_STANDALONE_TARGET',
    })
  }
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

const bindVoiceOutputSchema = z.object({
  success: z.literal(true),
  characterId: z.string().min(1),
  currentVoiceResourceId: z.string().min(1).nullable(),
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
      memberIndex: z.number().int().min(0),
      characterId: z.string().min(1).nullable(),
      currentVoiceRequested: z.boolean(),
    }).strict()).min(1),
  }).passthrough(),
)

const voicePlanResourceMetadataSchema = z.object({
    resourceId: z.string().min(1),
    resourceName: z.string().min(1),
    memberIndex: z.number().int().min(0),
    characterId: z.string().min(1).nullable(),
}).strict()

const voicePlanMetadataSchema = z.discriminatedUnion('retry', [
  z.object({
    requestId: z.string().min(1),
    alternatives: z.boolean(),
    retry: z.literal(false),
    resources: z.array(voicePlanResourceMetadataSchema).min(1),
  }).strict(),
  z.object({
    requestId: z.string().min(1),
    alternatives: z.literal(false),
    retry: z.literal(true),
    resources: z.array(voicePlanResourceMetadataSchema.extend({
      sourceTaskId: z.string().min(1),
    }).strict()).min(1),
  }).strict(),
])

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
  const request = input.request
  if (request.kind === 'retry') {
    throw new Error('VOICE_RETRY_REQUEST_REQUIRES_RETRY_PLANNER')
  }
  const requested = request.kind === 'single'
    ? Array.from({ length: request.count }, (_, memberIndex) => ({
        description: request.description,
        previewText: request.previewText,
        language: request.language,
        resource: {
          name: request.count === 1
            ? request.resource.name
            : `${request.resource.name} ${String(memberIndex + 1)}`,
        },
        target: request.target,
      }))
    : request.characters.map((character) => ({
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
  if (input.request.kind === 'retry') {
    const targets = await loadCreativeResourceRetryTargets({
      userId: ctx.userId,
      projectId: ctx.projectId,
      callerEpisodeId: ctx.context.episodeId?.trim() || null,
      operationId: 'generate_voice',
      taskType: TASK_TYPE.CREATIVE_RESOURCE_VOICE,
      mediaType: 'audio',
      resourceIds: input.request.resourceIds,
    })
    const invalidTarget = targets.find((target) => (
      target.schemaId !== CREATIVE_RESOURCE_SCHEMA.VOICE_REFERENCE
      || target.payload.resource.schemaId !== CREATIVE_RESOURCE_SCHEMA.VOICE_REFERENCE
      || target.payload.voiceModel === undefined
      || target.payload.previewText === undefined
      || target.payload.language === undefined
    ))
    if (invalidTarget) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'CREATIVE_RESOURCE_RETRY_FROZEN_INPUT_INVALID',
        field: 'request.resourceIds',
        resourceId: invalidTarget.resourceId,
        agentRetryableAfterCorrection: false,
      })
    }
    const requestId = `generation-retry:generate_voice:${stableArgsHash({
      userId: ctx.userId,
      projectId: ctx.projectId,
      turnId: ctx.context.turnId?.trim() || null,
      intentId: ctx.toolCallId?.trim() || ctx.requestId?.trim() || null,
      resources: targets.map((target) => ({
        resourceId: target.resourceId,
        sourceTaskId: target.sourceTaskId,
      })),
    })}`
    const tasks = targets.map((target) => {
      const payload = buildCreativeResourceRetryTaskPayload({
        frozenPayload: target.payload,
        toolCallId: ctx.toolCallId?.trim() || null,
      })
      return createPlannedTask({
        id: `generate_voice:retry:${target.resourceId}`,
        taskType: TASK_TYPE.CREATIVE_RESOURCE_VOICE,
        targetType: 'CreativeResource',
        targetId: target.resourceId,
        payload,
        locale: resolveOperationLocale(ctx.context),
        episodeId: target.episodeId,
        dedupeKey: `generate_voice:retry:${stableArgsHash({
          requestId,
          resourceId: target.resourceId,
          sourceTaskId: target.sourceTaskId,
        })}`,
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
      reservedIdentityIds: [],
      metadata: {
        requestId,
        alternatives: false,
        retry: true,
        resources: targets.map((target) => ({
          resourceId: target.resourceId,
          resourceName: target.name,
          memberIndex: target.memberIndex,
          characterId: target.payload.resource.binding?.kind === 'character_voice'
            ? target.payload.resource.binding.characterId
            : null,
          sourceTaskId: target.sourceTaskId,
        })),
      },
    }
  }
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
    ctx.context.turnId?.trim() ?? 'no-turn',
    ctx.toolCallId?.trim() ?? ctx.requestId?.trim() ?? planFingerprint,
    planFingerprint,
  ].join(':')
  const resources = members.map((member, memberIndex) => ({
    resourceId: buildCreativeResourceId({
      operationId: 'generate_voice',
      requestId,
      memberIndex,
    }),
    resourceName: member.resource.name,
    memberIndex,
    characterId: member.target.kind === 'character' ? member.target.characterId : null,
  }))
  const tasks = members.map((member, memberIndex) => {
    const resource = resources[memberIndex]
    if (!resource) throw new Error(`VOICE_RESOURCE_PLAN_MISSING:${String(memberIndex)}`)
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
      alternatives: input.request.kind === 'single'
        && input.request.target.kind === 'standalone'
        && input.request.count > 1,
      retry: false,
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
  if (!metadata.retry) {
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
      alternativeGroupExecutionId: metadata.alternatives
        ? authorization.operationExecutionId
        : null,
      members: metadata.resources.map((resource) => ({
        resourceId: resource.resourceId,
        name: resource.resourceName,
        memberIndex: resource.memberIndex,
      })),
    })
  } else {
    const resourceIds = metadata.resources.map((resource) => resource.resourceId)
    const retryable = await authorization.transaction.creativeResource.count({
      where: {
        id: { in: resourceIds },
        userId: ctx.userId,
        projectId: ctx.projectId,
        status: 'failed',
        mediaType: 'audio',
        schemaId: CREATIVE_RESOURCE_SCHEMA.VOICE_REFERENCE,
      },
    })
    if (retryable !== resourceIds.length) {
      throw new Error('CREATIVE_RESOURCE_RETRY_TARGET_CHANGED:generate_voice')
    }
    await authorization.transaction.creativeResource.updateMany({
      where: { id: { in: resourceIds }, status: 'failed' },
      data: { status: 'pending', errorCode: null, errorMessage: null },
    })
  }
  const submitted = await submitPlannedOperationTasks({ ctx, operationId: 'generate_voice' })
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
      memberIndex: resource.memberIndex,
      characterId: resource.characterId,
      currentVoiceRequested: resource.characterId !== null,
    })),
  })
}

export function createVoiceOperations(): ProjectAgentOperationRegistryDraft {
  return {
    generate_voice: defineOperation({
      id: 'generate_voice',
      summary: 'Design reusable voices and render short preview audio Resources. Use request.kind=single with a standalone target and count 1-6 for independent alternatives; count defaults to 1 and every result is a separate Resource and Task. A character target requires count=1 because generation may update that character current voice. Use request.kind=characters for distinct character targets; those members are a domain batch, not alternatives. Use request.kind=retry with only exact failed voice Resource IDs; the server restores each original frozen generation input and submits a new Task for the same Resource.',
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
        alternativeGeneration: {
          kind: 'request_count',
          mediaKind: 'voice',
          requestKind: 'single',
          minCount: 1,
          maxCount: 6,
          inputLimits: {
            promptMaxLength: VOICE_DESCRIPTION_MAX_LENGTH,
            previewTextMaxLength: VOICE_PREVIEW_TEXT_MAX_LENGTH,
          },
        },
      },
      confirmation: { kind: 'billable_media', required: true },
      planContractRevision: 'voice-generation/v4',
      inputSchema: generateVoiceInputSchema,
      outputSchema: generateVoiceOutputSchema,
      plan: planGenerateVoice,
      commit: async (ctx, _input, plan) => await commitGenerateVoice(ctx, plan),
    }),
    bind_voice: defineOperation({
      id: 'bind_voice',
      summary: 'Select, replace, or clear the exact immutable audio Resource currently used as one project character\'s voice. Accepts a designed project.voice_reference Resource or a user-uploaded project.upload_audio Resource. Use selection.kind=none to clear it. This never generates audio and never creates another voice Resource.',
      intent: 'act',
      toolContractRevision: 'bind_voice/v2',
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
        reason: 'updates only the character current-voice selection and never creates a Resource',
      },
      confirmation: { kind: 'none', required: false },
      inputSchema: bindVoiceInputSchema,
      outputSchema: bindVoiceOutputSchema,
      executeInTransaction: async (ctx, input, tx) => {
        const current = await bindCharacterVoiceInTransaction(tx, {
          userId: ctx.userId,
          projectId: ctx.projectId,
          characterId: input.characterId,
          selection: input.selection as CharacterVoiceSelection,
        })
        return bindVoiceOutputSchema.parse({
          success: true,
          characterId: input.characterId,
          currentVoiceResourceId: current?.resourceId ?? null,
        })
      },
    }),
  }
}
