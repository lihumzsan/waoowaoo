import type { Prisma } from '@prisma/client'
import { getTaskDefinition } from '@/lib/task/definition'
import { TASK_TYPE, type TaskType } from '@/lib/task/types'
import type {
  CreativeResourceBindingView,
} from './contracts'
import { CREATIVE_RESOURCE_CHARACTER_VOICE_BINDING_ROLE } from './contracts'
import { bindCreativeResourceRevisionInTransaction } from './binding-service'
import { planCreativeWorkResourceMaterialization } from './creative-work-materialization'
import {
  parseCreativeResourceGenerationTaskPayload,
  toCreativeResourceJsonValue,
} from './generation-contract'
import { parseCreativeResourceVideoMergeTaskPayload } from './video-merge-contract'
import { buildCreativeResourceScopeRef, resolveProjectCreativeResourceScope } from './identity'
import {
  appendCreativeResourceRevisionInTransaction,
  reserveDomainCreativeResourceInTransaction,
  settleCreativeResourceFailureInTransaction,
} from './persistence'

type TerminalTask = {
  readonly id: string
  readonly userId: string
  readonly projectId: string
  readonly episodeId: string | null
  readonly type: TaskType
  readonly targetType: string
  readonly targetId: string
  readonly payload: unknown
  readonly operationId: string | null
  readonly operationExecutionId: string | null
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readRequiredString(record: Record<string, unknown>, key: string, code: string): string {
  const value = readString(record, key)
  if (!value) throw new Error(code)
  return value
}

async function materializeDomainOutputs(
  tx: Prisma.TransactionClient,
  task: TerminalTask,
  result: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (task.type !== TASK_TYPE.CREATIVE_WORK) {
    throw new Error(`CREATIVE_RESOURCE_DOMAIN_TASK_UNSUPPORTED:${task.type}`)
  }
  const scope = task.projectId === 'global-asset-hub'
    ? buildCreativeResourceScopeRef({ kind: 'user', id: task.userId, userId: task.userId })
    : resolveProjectCreativeResourceScope({
        userId: task.userId,
        projectId: task.projectId,
        episodeId: task.episodeId,
      })
  const plan = planCreativeWorkResourceMaterialization({
      taskId: task.id,
      payload: task.payload,
      result,
    })
  if (plan.outputs.length === 0) return null
  const resources = []
  for (const output of plan.outputs) {
      const reserved = await reserveDomainCreativeResourceInTransaction(tx, {
        scope,
        mediaType: output.mediaType,
        schemaId: output.schemaId,
        sourceType: output.sourceType,
        sourceId: output.sourceId,
        name: output.name,
        candidateSetId: output.candidateSetId,
        candidateIndex: output.candidateIndex,
      })
      const revision = await appendCreativeResourceRevisionInTransaction(tx, {
        resourceId: reserved.resourceId,
        userId: task.userId,
        mediaType: output.mediaType,
        schemaId: output.schemaId,
        content: output.content,
        inputs: plan.inputs,
        provenance: {
          operationId: task.operationId,
          inputHash: plan.inputFingerprint,
          taskId: task.id,
          operationExecutionId: task.operationExecutionId,
          executionSegmentId: null,
          toolCallId: plan.toolCallId,
          prompt: plan.prompt,
          modelKey: plan.modelKey,
          generationOptions: output.generationOptions,
        },
      })
      resources.push({
        resourceId: revision.resourceId,
        revisionId: revision.revisionId,
        fingerprint: revision.fingerprint,
        schemaId: output.schemaId,
        mediaType: output.mediaType,
        name: output.name,
        candidateKey: output.candidateKey,
      })
  }
  return { resources }
}

export async function materializeCreativeResourceTaskTerminalInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    readonly kind: 'completed' | 'failed' | 'canceled'
    readonly task: TerminalTask
    readonly result: Record<string, unknown> | null
    readonly errorCode: string | null
    readonly errorMessage: string | null
  },
): Promise<Record<string, unknown> | null> {
  const definition = getTaskDefinition(input.task.type)
  if (definition.terminalOutputMaterializer === 'none') return null
  if (definition.terminalOutputMaterializer === 'domain_creative_resource') {
    if (input.kind !== 'completed') return null
    if (!input.result) throw new Error(`CREATIVE_RESOURCE_TASK_RESULT_REQUIRED:${input.task.id}`)
    return await materializeDomainOutputs(tx, input.task, input.result)
  }
  if (definition.terminalOutputMaterializer !== 'creative_resource') {
    const exhaustive: never = definition.terminalOutputMaterializer
    throw new Error(`TASK_TERMINAL_OUTPUT_MATERIALIZER_UNSUPPORTED:${String(exhaustive)}`)
  }
  if (input.task.targetType !== 'CreativeResource') {
    throw new Error(`CREATIVE_RESOURCE_TASK_TARGET_INVALID:${input.task.targetType}`)
  }
  const payload = input.task.type === TASK_TYPE.CREATIVE_RESOURCE_VIDEO_MERGE
    ? parseCreativeResourceVideoMergeTaskPayload(input.task.payload ?? {})
    : parseCreativeResourceGenerationTaskPayload(input.task.payload ?? {})
  if (payload.resource.resourceId !== input.task.targetId) {
    throw new Error(`CREATIVE_RESOURCE_TASK_TARGET_MISMATCH:${input.task.id}`)
  }
  if (input.kind !== 'completed') {
    await settleCreativeResourceFailureInTransaction(tx, {
      resourceId: payload.resource.resourceId,
      userId: input.task.userId,
      status: input.kind === 'canceled' ? 'canceled' : 'failed',
      errorCode: input.errorCode ?? (input.kind === 'canceled' ? 'TASK_CANCELLED' : 'TASK_FAILED'),
      errorMessage: input.errorMessage ?? input.kind,
    })
    return {
      resourceId: payload.resource.resourceId,
      resourceStatus: input.kind === 'canceled' ? 'canceled' : 'failed',
    }
  }
  if (!input.result) throw new Error(`CREATIVE_RESOURCE_TASK_RESULT_REQUIRED:${input.task.id}`)
  const mediaId = readRequiredString(input.result, 'mediaId', 'CREATIVE_RESOURCE_TASK_MEDIA_ID_REQUIRED')
  const actualModelKey = input.task.type === TASK_TYPE.CREATIVE_RESOURCE_VIDEO_MERGE
    ? null
    : readRequiredString(input.result, 'modelKey', 'CREATIVE_RESOURCE_TASK_MODEL_KEY_REQUIRED')
  const revision = await appendCreativeResourceRevisionInTransaction(tx, {
    resourceId: payload.resource.resourceId,
    userId: input.task.userId,
    mediaType: payload.resource.mediaType,
    schemaId: payload.resource.schemaId,
    content: { kind: 'media', mediaId },
    inputs: payload.resource.inputs,
    provenance: {
      operationId: input.task.operationId,
      inputHash: payload.resource.inputHash,
      taskId: input.task.id,
      operationExecutionId: input.task.operationExecutionId,
      executionSegmentId: payload.resource.executionSegmentId,
      toolCallId: payload.resource.toolCallId,
      prompt: payload.resource.prompt,
      modelKey: actualModelKey,
      generationOptions: toCreativeResourceJsonValue(payload.resource.generationOptions),
    },
  })
  let bindingResult: {
    status: 'bound' | 'conflict' | 'target_missing'
    binding: CreativeResourceBindingView | null
  } | null = null
  const requestedBinding = 'binding' in payload.resource ? payload.resource.binding : undefined
  if (requestedBinding?.kind === 'character_voice') {
    const character = await tx.projectCharacter.findFirst({
      where: {
        id: requestedBinding.characterId,
        projectId: input.task.projectId,
        project: { userId: input.task.userId },
      },
      select: { id: true },
    })
    if (!character) {
      bindingResult = { status: 'target_missing', binding: null }
    } else {
      try {
        const binding = await bindCreativeResourceRevisionInTransaction(tx, {
          scope: resolveProjectCreativeResourceScope({
            userId: input.task.userId,
            projectId: input.task.projectId,
            episodeId: null,
          }),
          role: CREATIVE_RESOURCE_CHARACTER_VOICE_BINDING_ROLE,
          slotKey: requestedBinding.characterId,
          resourceId: revision.resourceId,
          revisionId: revision.revisionId,
          source: 'generate_voice',
          expectedVersion: requestedBinding.expectedVersion,
        })
        bindingResult = { status: 'bound', binding }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('CREATIVE_RESOURCE_BINDING_VERSION_CONFLICT:')) {
          bindingResult = { status: 'conflict', binding: null }
        } else {
          throw error
        }
      }
    }
  }
  return {
    resourceId: revision.resourceId,
    revisionId: revision.revisionId,
    fingerprint: revision.fingerprint,
    resourceStatus: 'ready',
    ...(bindingResult ? { bindingResult } : {}),
  }
}
