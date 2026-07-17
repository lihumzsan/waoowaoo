import type { Prisma } from '@prisma/client'
import { stableArgsHash } from '@/lib/project-agent/stable-args-hash'
import { getTaskDefinition } from '@/lib/task/definition'
import { TASK_TYPE, type TaskType } from '@/lib/task/types'
import type {
  CreativeResourceInputRef,
  CreativeResourceJsonValue,
  CreativeResourceMediaType,
  CreativeResourceRevisionContent,
} from './contracts'
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
import { CREATIVE_RESOURCE_SCHEMA, type CreativeResourceSchemaId } from './schema-registry'

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

type DomainOutputDescriptor = {
  readonly mediaType: CreativeResourceMediaType
  readonly schemaId: CreativeResourceSchemaId
  readonly sourceType: string
  readonly sourceId: string
  readonly mediaId: string | null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
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

function readStringArray(record: Record<string, unknown>, key: string): readonly string[] {
  const value = record[key]
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => typeof item === 'string' && item.trim() ? [item.trim()] : [])
}

function jsonValue(value: unknown): CreativeResourceJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as CreativeResourceJsonValue
}

function promptFromPayload(payload: Record<string, unknown>): string | null {
  for (const key of ['prompt', 'imagePrompt', 'modifyInstruction', 'userPrompt', 'requirement']) {
    const value = readString(payload, key)
    if (value) return value
  }
  return null
}

function modelFromPayload(payload: Record<string, unknown>): string | null {
  for (const key of ['imageModel', 'videoModel', 'musicModel', 'analysisModel', 'editModel', 'model']) {
    const value = readString(payload, key)
    if (value) return value
  }
  return null
}

function resourceInputsFromPayload(payload: Record<string, unknown>): readonly CreativeResourceInputRef[] {
  const value = payload.resourceInputs
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('CREATIVE_RESOURCE_DOMAIN_INPUTS_INVALID')
  return value.map((item, position) => {
    const record = asRecord(item)
    const explicitPosition = record.position
    return {
      resourceId: readRequiredString(record, 'resourceId', 'CREATIVE_RESOURCE_INPUT_RESOURCE_ID_REQUIRED'),
      revisionId: readRequiredString(record, 'revisionId', 'CREATIVE_RESOURCE_INPUT_REVISION_ID_REQUIRED'),
      fingerprint: readRequiredString(record, 'fingerprint', 'CREATIVE_RESOURCE_INPUT_FINGERPRINT_REQUIRED'),
      role: readString(record, 'role') ?? 'input',
      position: typeof explicitPosition === 'number' && Number.isSafeInteger(explicitPosition) && explicitPosition >= 0
        ? explicitPosition
        : position,
    }
  })
}

function descriptor(input: DomainOutputDescriptor): DomainOutputDescriptor {
  if (!input.sourceType.trim() || !input.sourceId.trim()) {
    throw new Error(`CREATIVE_RESOURCE_DOMAIN_SOURCE_INVALID:${input.sourceType}:${input.sourceId}`)
  }
  return input
}

function imageDescriptor(input: {
  readonly schemaId: CreativeResourceSchemaId
  readonly sourceType: string
  readonly sourceId: string
}): DomainOutputDescriptor {
  return descriptor({ ...input, mediaType: 'image', mediaId: null })
}

function resolveDomainOutputs(task: TerminalTask, result: Record<string, unknown>): readonly DomainOutputDescriptor[] {
  switch (task.type) {
    case TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE:
      return [descriptor({
        mediaType: 'text',
        schemaId: CREATIVE_RESOURCE_SCHEMA.SOURCE_SCRIPT,
        sourceType: 'ProjectEpisodeSourceDocument',
        sourceId: readRequiredString(result, 'sourceDocumentId', 'CREATIVE_RESOURCE_SOURCE_DOCUMENT_ID_REQUIRED'),
        mediaId: null,
      })]
    case TASK_TYPE.EDIT_BIBLE_GENERATE:
      return [descriptor({
        mediaType: 'text',
        schemaId: CREATIVE_RESOURCE_SCHEMA.EDIT_BIBLE,
        sourceType: 'ProjectEditBible',
        sourceId: readRequiredString(result, 'editBibleId', 'CREATIVE_RESOURCE_EDIT_BIBLE_ID_REQUIRED'),
        mediaId: null,
      })]
    case TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE:
      return [imageDescriptor({
        schemaId: CREATIVE_RESOURCE_SCHEMA.STYLE,
        sourceType: 'ProjectEditStylePreview',
        sourceId: readRequiredString(result, 'stylePreviewId', 'CREATIVE_RESOURCE_STYLE_PREVIEW_ID_REQUIRED'),
      })]
    case TASK_TYPE.IMAGE_CHARACTER:
      return [imageDescriptor({
        schemaId: CREATIVE_RESOURCE_SCHEMA.CHARACTER_IMAGE,
        sourceType: 'CharacterAppearance',
        sourceId: readRequiredString(result, 'appearanceId', 'CREATIVE_RESOURCE_CHARACTER_APPEARANCE_ID_REQUIRED'),
      })]
    case TASK_TYPE.IMAGE_LOCATION:
      return readStringArray(result, 'locationIds').map((sourceId) => imageDescriptor({
        schemaId: CREATIVE_RESOURCE_SCHEMA.LOCATION_IMAGE,
        sourceType: 'ProjectLocation',
        sourceId,
      }))
    case TASK_TYPE.MODIFY_ASSET_IMAGE:
    case TASK_TYPE.REGENERATE_GROUP: {
      const appearanceId = readString(result, 'appearanceId')
      if (appearanceId) return [imageDescriptor({
        schemaId: CREATIVE_RESOURCE_SCHEMA.CHARACTER_IMAGE,
        sourceType: 'CharacterAppearance',
        sourceId: appearanceId,
      })]
      const locationImageId = readString(result, 'locationImageId')
      if (locationImageId) return [imageDescriptor({
        schemaId: readString(result, 'type') === 'prop'
          ? CREATIVE_RESOURCE_SCHEMA.PROP_IMAGE
          : CREATIVE_RESOURCE_SCHEMA.LOCATION_IMAGE,
        sourceType: 'LocationImage',
        sourceId: locationImageId,
      })]
      return readStringArray(result, 'locationIds').map((sourceId) => imageDescriptor({
        schemaId: CREATIVE_RESOURCE_SCHEMA.LOCATION_IMAGE,
        sourceType: 'ProjectLocation',
        sourceId,
      }))
    }
    case TASK_TYPE.ASSET_HUB_IMAGE:
    case TASK_TYPE.ASSET_HUB_MODIFY: {
      const appearanceId = readString(result, 'appearanceId')
      if (appearanceId) return [imageDescriptor({
        schemaId: CREATIVE_RESOURCE_SCHEMA.CHARACTER_IMAGE,
        sourceType: 'GlobalCharacterAppearance',
        sourceId: appearanceId,
      })]
      const locationImageId = readString(result, 'locationImageId')
      if (locationImageId) return [imageDescriptor({
        schemaId: readString(result, 'type') === 'prop'
          ? CREATIVE_RESOURCE_SCHEMA.PROP_IMAGE
          : CREATIVE_RESOURCE_SCHEMA.LOCATION_IMAGE,
        sourceType: 'GlobalLocationImage',
        sourceId: locationImageId,
      })]
      const locationId = readString(result, 'locationId')
      return locationId ? [imageDescriptor({
        schemaId: readString(result, 'type') === 'prop'
          ? CREATIVE_RESOURCE_SCHEMA.PROP_IMAGE
          : CREATIVE_RESOURCE_SCHEMA.LOCATION_IMAGE,
        sourceType: 'GlobalLocation',
        sourceId: locationId,
      })] : []
    }
    case TASK_TYPE.EDIT_SCRIPT_GENERATE:
      return [descriptor({
        mediaType: 'text',
        schemaId: CREATIVE_RESOURCE_SCHEMA.EDIT_SCRIPT,
        sourceType: 'ProjectEditScript',
        sourceId: readRequiredString(result, 'editScriptId', 'CREATIVE_RESOURCE_EDIT_SCRIPT_ID_REQUIRED'),
        mediaId: null,
      })]
    case TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE:
      return [descriptor({
        mediaType: 'text',
        schemaId: CREATIVE_RESOURCE_SCHEMA.SHOT_EXECUTION_PLAN,
        sourceType: 'ProjectEditShotExecutionPlan',
        sourceId: readRequiredString(result, 'shotExecutionPlanId', 'CREATIVE_RESOURCE_SHOT_PLAN_ID_REQUIRED'),
        mediaId: null,
      })]
    case TASK_TYPE.VIDEO_SEGMENT:
      return [descriptor({
        mediaType: 'video',
        schemaId: CREATIVE_RESOURCE_SCHEMA.VIDEO_SEGMENT,
        sourceType: 'ProjectVideoSegment',
        sourceId: readRequiredString(result, 'videoSegmentId', 'CREATIVE_RESOURCE_VIDEO_SEGMENT_ID_REQUIRED'),
        mediaId: readRequiredString(result, 'videoMediaId', 'CREATIVE_RESOURCE_VIDEO_MEDIA_ID_REQUIRED'),
      })]
    case TASK_TYPE.CHAPTER_RENDER:
      return [descriptor({
        mediaType: 'video',
        schemaId: CREATIVE_RESOURCE_SCHEMA.CHAPTER_VIDEO,
        sourceType: 'ProjectEditChapter',
        sourceId: readRequiredString(result, 'chapterId', 'CREATIVE_RESOURCE_CHAPTER_ID_REQUIRED'),
        mediaId: readRequiredString(result, 'mediaId', 'CREATIVE_RESOURCE_CHAPTER_MEDIA_ID_REQUIRED'),
      })]
    case TASK_TYPE.BGM_DESIGN_PLAN:
      return [descriptor({
        mediaType: 'text',
        schemaId: CREATIVE_RESOURCE_SCHEMA.BGM_DESIGN,
        sourceType: 'ProjectEditBgmDesign',
        sourceId: readRequiredString(result, 'episodeId', 'CREATIVE_RESOURCE_EPISODE_ID_REQUIRED'),
        mediaId: null,
      })]
    case TASK_TYPE.MUSIC_SCORE_GENERATE:
      return [descriptor({
        mediaType: 'audio',
        schemaId: CREATIVE_RESOURCE_SCHEMA.BGM_AUDIO,
        sourceType: 'ProjectEditMusicScore',
        sourceId: readRequiredString(result, 'episodeId', 'CREATIVE_RESOURCE_EPISODE_ID_REQUIRED'),
        mediaId: readRequiredString(result, 'mediaId', 'CREATIVE_RESOURCE_AUDIO_MEDIA_ID_REQUIRED'),
      })]
    case TASK_TYPE.FINAL_VIDEO_RENDER:
      return [descriptor({
        mediaType: 'video',
        schemaId: CREATIVE_RESOURCE_SCHEMA.RENDERED_VIDEO,
        sourceType: 'ProjectEpisodeFinalOutput',
        sourceId: readRequiredString(result, 'episodeId', 'CREATIVE_RESOURCE_EPISODE_ID_REQUIRED'),
        mediaId: readRequiredString(result, 'videoMediaId', 'CREATIVE_RESOURCE_FINAL_MEDIA_ID_REQUIRED'),
      })]
    case TASK_TYPE.MUSIC_GENERATE:
      return [descriptor({
        mediaType: 'audio',
        schemaId: CREATIVE_RESOURCE_SCHEMA.GENERIC_AUDIO,
        sourceType: 'GeneratedMusicTask',
        sourceId: task.id,
        mediaId: readRequiredString(result, 'mediaId', 'CREATIVE_RESOURCE_AUDIO_MEDIA_ID_REQUIRED'),
      })]
    default:
      throw new Error(`CREATIVE_RESOURCE_DOMAIN_TASK_UNSUPPORTED:${task.type}`)
  }
}

function domainContent(output: DomainOutputDescriptor, result: Record<string, unknown>, taskId: string): CreativeResourceRevisionContent {
  if (output.mediaId) return { kind: 'media', mediaId: output.mediaId }
  return {
    kind: 'domain_snapshot',
    sourceType: output.sourceType,
    sourceId: output.sourceId,
    sourceRevision: taskId,
    snapshot: jsonValue(result),
  }
}

async function materializeDomainOutputs(
  tx: Prisma.TransactionClient,
  task: TerminalTask,
  result: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const payload = asRecord(task.payload)
  const scope = task.projectId === 'global-asset-hub'
    ? buildCreativeResourceScopeRef({ kind: 'user', id: task.userId, userId: task.userId })
    : resolveProjectCreativeResourceScope({
        userId: task.userId,
        projectId: task.projectId,
        episodeId: task.episodeId,
      })
  const outputs = resolveDomainOutputs(task, result)
  if (outputs.length === 0) throw new Error(`CREATIVE_RESOURCE_DOMAIN_OUTPUTS_REQUIRED:${task.type}`)
  const refs = []
  for (const output of outputs) {
    const reserved = await reserveDomainCreativeResourceInTransaction(tx, {
      scope,
      mediaType: output.mediaType,
      schemaId: output.schemaId,
      sourceType: output.sourceType,
      sourceId: output.sourceId,
      name: `${output.schemaId}:${output.sourceId.slice(0, 8)}`,
    })
    const revision = await appendCreativeResourceRevisionInTransaction(tx, {
      resourceId: reserved.resourceId,
      userId: task.userId,
      mediaType: output.mediaType,
      schemaId: output.schemaId,
      content: domainContent(output, result, task.id),
      inputs: resourceInputsFromPayload(payload),
      provenance: {
        operationId: task.operationId,
        inputHash: stableArgsHash(payload),
        taskId: task.id,
        operationExecutionId: task.operationExecutionId,
        executionSegmentId: null,
        toolCallId: null,
        prompt: promptFromPayload(payload),
        modelKey: modelFromPayload(payload),
        generationOptions: jsonValue(payload),
      },
    })
    refs.push({
      resourceId: revision.resourceId,
      revisionId: revision.revisionId,
      fingerprint: revision.fingerprint,
      schemaId: output.schemaId,
      mediaType: output.mediaType,
    })
  }
  return {
    resources: refs,
    ...(refs.length === 1 ? refs[0] : {}),
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
      modelKey: payload.resource.modelKey,
      generationOptions: toCreativeResourceJsonValue(payload.resource.generationOptions),
    },
  })
  return {
    resourceId: revision.resourceId,
    revisionId: revision.revisionId,
    fingerprint: revision.fingerprint,
    resourceStatus: 'ready',
  }
}
