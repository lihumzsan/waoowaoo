import type { Prisma } from '@prisma/client'
import { getTaskDefinition } from '@/lib/task/definition'
import { TASK_TYPE, type TaskType } from '@/lib/task/types'
import type {
  CreativeResourceBindingView,
} from './contracts'
import {
  CREATIVE_RESOURCE_ASSET_IMAGE_BINDING_ROLE,
  CREATIVE_RESOURCE_CHARACTER_VOICE_BINDING_ROLE,
} from './contracts'
import { bindCreativeResourceRevisionInTransaction } from './binding-service'
import { planCreativeWorkResourceMaterialization } from './creative-work-materialization'
import {
  parseCreativeResourceGenerationTaskPayload,
  toCreativeResourceJsonValue,
} from './generation-contract'
import { parseCreativeResourceVideoMergeTaskPayload } from './video-merge-contract'
import { parseCreativeResourceWebReferenceTaskPayload } from './web-reference-contract'
import { buildCreativeResourceScopeRef, resolveProjectCreativeResourceScope } from './identity'
import {
  appendCreativeResourceRevisionInTransaction,
  reserveDomainCreativeResourceInTransaction,
  settleCreativeResourceFailureInTransaction,
} from './persistence'
import { GLOBAL_ASSET_PROJECT_ID } from '@/lib/workspace-resource/resource-impact'
import { resolveAssetImageKindForSchemaId } from '@/lib/asset-generation'

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

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function projectSafeMediaResult(result: Record<string, unknown>): Record<string, number> {
  const projection: Record<string, number> = {}
  for (const key of ['width', 'height', 'durationMs'] as const) {
    const value = result[key]
    if (typeof value === 'number' && Number.isFinite(value)) projection[key] = value
  }
  return projection
}

/**
 * Every `creative_resource` task type declares its own frozen payload shape.
 * The switch is exhaustive against TaskType so a new type cannot be added
 * without deciding how its terminal payload is read.
 */
function parseTerminalResourcePayload(task: TerminalTask) {
  switch (task.type) {
    case TASK_TYPE.CREATIVE_RESOURCE_VIDEO_MERGE:
      return parseCreativeResourceVideoMergeTaskPayload(task.payload ?? {})
    case TASK_TYPE.CREATIVE_RESOURCE_WEB_REFERENCE:
      return parseCreativeResourceWebReferenceTaskPayload(task.payload ?? {})
    case TASK_TYPE.CREATIVE_WORK:
    case TASK_TYPE.CREATIVE_RESOURCE_IMAGE:
    case TASK_TYPE.CREATIVE_RESOURCE_AUDIO:
    case TASK_TYPE.CREATIVE_RESOURCE_VOICE:
    case TASK_TYPE.CREATIVE_RESOURCE_VIDEO:
      return parseCreativeResourceGenerationTaskPayload(task.payload ?? {})
    default: {
      const exhaustive: never = task.type
      throw new Error(`CREATIVE_RESOURCE_TASK_PAYLOAD_UNSUPPORTED:${String(exhaustive)}`)
    }
  }
}

async function materializeDomainOutputs(
  tx: Prisma.TransactionClient,
  task: TerminalTask,
  result: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (task.type !== TASK_TYPE.CREATIVE_WORK) {
    throw new Error(`CREATIVE_RESOURCE_DOMAIN_TASK_UNSUPPORTED:${task.type}`)
  }
  const plan = planCreativeWorkResourceMaterialization({
    taskId: task.id,
    payload: task.payload,
    result,
  })
  if (plan.resourceScope === 'episode' && !task.episodeId) {
    throw new Error(`CREATIVE_WORK_EPISODE_RESOURCE_SCOPE_REQUIRED:${task.id}`)
  }
  const scope = task.projectId === GLOBAL_ASSET_PROJECT_ID
    ? buildCreativeResourceScopeRef({ kind: 'user', id: task.userId, userId: task.userId })
    : resolveProjectCreativeResourceScope({
        userId: task.userId,
        projectId: task.projectId,
        episodeId: plan.resourceScope === 'episode' ? task.episodeId : null,
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
        schemaId: output.schemaId,
        mediaType: output.mediaType,
        name: output.name,
      })
  }
  return {
    resources,
    continuationProjection: {
      ...(readRecord(result.continuationProjection) ?? {}),
      resources,
    },
  }
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
  const payload = parseTerminalResourcePayload(input.task)
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
  const actualModelKey = definition.terminalModelKeyRequirement === 'none'
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
  } else if (requestedBinding?.kind === 'project_asset_image') {
    const schemaAssetKind = resolveAssetImageKindForSchemaId(payload.resource.schemaId)
    if (schemaAssetKind !== requestedBinding.assetKind || payload.resource.mediaType !== 'image') {
      throw new Error(`CREATIVE_RESOURCE_ASSET_IMAGE_BINDING_SCHEMA_INVALID:${payload.resource.schemaId}`)
    }
    const target = requestedBinding.assetKind === 'character'
      ? await tx.characterAppearance.findFirst({
          where: {
            id: requestedBinding.variantId,
            characterId: requestedBinding.assetId,
            character: {
              projectId: input.task.projectId,
              project: { userId: input.task.userId },
            },
          },
          select: { id: true },
        })
      : await tx.locationImage.findFirst({
          where: {
            id: requestedBinding.variantId,
            locationId: requestedBinding.assetId,
            location: {
              projectId: input.task.projectId,
              assetKind: requestedBinding.assetKind,
              project: { userId: input.task.userId },
            },
          },
          select: { id: true },
        })
    if (!target) {
      bindingResult = { status: 'target_missing', binding: null }
    } else {
      try {
        const binding = await bindCreativeResourceRevisionInTransaction(tx, {
          scope: resolveProjectCreativeResourceScope({
            userId: input.task.userId,
            projectId: input.task.projectId,
            episodeId: null,
          }),
          role: CREATIVE_RESOURCE_ASSET_IMAGE_BINDING_ROLE,
          slotKey: requestedBinding.variantId,
          resourceId: revision.resourceId,
          revisionId: revision.revisionId,
          source: 'create_image',
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
  const lifecycleResource = payload.lifecycleProjection.resources.find(
    (resource) => resource.resourceId === revision.resourceId,
  )
  if (
    !lifecycleResource
    || lifecycleResource.mediaType !== payload.resource.mediaType
    || lifecycleResource.schemaId !== payload.resource.schemaId
  ) {
    throw new Error(`CREATIVE_RESOURCE_LIFECYCLE_PROJECTION_MISMATCH:${input.task.id}`)
  }
  const resources = [{
    resourceId: revision.resourceId,
    revisionId: revision.revisionId,
    schemaId: lifecycleResource.schemaId,
    mediaType: lifecycleResource.mediaType,
    name: lifecycleResource.name,
  }]
  return {
    resourceId: revision.resourceId,
    revisionId: revision.revisionId,
    resources,
    resourceStatus: 'ready',
    continuationProjection: {
      resources,
      media: projectSafeMediaResult(input.result),
    },
    ...(bindingResult ? { bindingResult } : {}),
  }
}
