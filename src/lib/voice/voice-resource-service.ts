import type { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import {
  getCreativeResourceBindingInTransaction,
  replaceCreativeResourceBindingInTransaction,
  unbindCreativeResourceInTransaction,
} from '@/lib/creative-resource/binding-service'
import {
  CREATIVE_RESOURCE_CHARACTER_VOICE_BINDING_ROLE,
  type CreativeResourceBindingView,
} from '@/lib/creative-resource/contracts'
import { resolveProjectCreativeResourceScope } from '@/lib/creative-resource/identity'
import { CREATIVE_RESOURCE_SCHEMA } from '@/lib/creative-resource/schema-registry'
import { TASK_STATUS } from '@/lib/task/types'

export type CharacterVoiceSelection =
  | { readonly kind: 'voice'; readonly resourceId: string }
  | { readonly kind: 'none' }

export async function bindCharacterVoiceInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    readonly userId: string
    readonly projectId: string
    readonly characterId: string
    readonly selection: CharacterVoiceSelection
  },
): Promise<CreativeResourceBindingView | null> {
  const character = await tx.projectCharacter.findFirst({
    where: {
      id: input.characterId,
      projectId: input.projectId,
      project: { userId: input.userId },
    },
    select: { id: true },
  })
  if (!character) {
    throw new ApiError('NOT_FOUND', {
      code: 'VOICE_CHARACTER_NOT_FOUND',
      field: 'characterId',
    })
  }
  const scope = resolveProjectCreativeResourceScope({
    userId: input.userId,
    projectId: input.projectId,
    episodeId: null,
  })
  const current = await getCreativeResourceBindingInTransaction(tx, {
    scope,
    role: CREATIVE_RESOURCE_CHARACTER_VOICE_BINDING_ROLE,
    slotKey: input.characterId,
  })
  if (input.selection.kind === 'none') {
    await unbindCreativeResourceInTransaction(tx, {
      scope,
      role: CREATIVE_RESOURCE_CHARACTER_VOICE_BINDING_ROLE,
      slotKey: input.characterId,
      expectedVersion: current?.version ?? null,
    })
    return null
  }
  const resource = await tx.creativeResource.findFirst({
    where: {
      id: input.selection.resourceId,
      userId: input.userId,
      projectId: input.projectId,
      episodeId: null,
      scopeKind: 'project',
      scopeId: input.projectId,
      status: 'ready',
      materializedAt: { not: null },
      mediaType: 'audio',
      // A character voice is either a designed voice or a user-uploaded
      // audio sample; both bind the same way and feed video generation as
      // reference audio, so this one typed current-selection relation stays
      // the authority for "this character's current voice".
      schemaId: {
        in: [
          CREATIVE_RESOURCE_SCHEMA.VOICE_REFERENCE,
          CREATIVE_RESOURCE_SCHEMA.UPLOAD_AUDIO,
        ],
      },
    },
    select: { id: true },
  })
  if (!resource) {
    throw new ApiError('NOT_FOUND', {
      code: 'VOICE_RESOURCE_NOT_FOUND',
      field: 'selection.resourceId',
    })
  }
  return await replaceCreativeResourceBindingInTransaction(tx, {
    scope,
    role: CREATIVE_RESOURCE_CHARACTER_VOICE_BINDING_ROLE,
    slotKey: input.characterId,
    resourceId: input.selection.resourceId,
    source: 'bind_voice',
  })
}

export async function deleteVoiceResourceInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    readonly userId: string
    readonly projectId: string
    readonly resourceId: string
  },
): Promise<{ success: true }> {
  const resource = await tx.creativeResource.findFirst({
    where: {
      id: input.resourceId,
      userId: input.userId,
      projectId: input.projectId,
      episodeId: null,
      scopeKind: 'project',
      scopeId: input.projectId,
      mediaType: 'audio',
      schemaId: CREATIVE_RESOURCE_SCHEMA.VOICE_REFERENCE,
    },
    select: {
      id: true,
      status: true,
      _count: { select: { bindings: true } },
      inputLineage: {
        select: { id: true },
        take: 1,
      },
    },
  })
  if (!resource) {
    throw new ApiError('NOT_FOUND', {
      code: 'VOICE_RESOURCE_NOT_FOUND',
      field: 'target.assetId',
    })
  }
  if (resource.status === 'pending') {
    throw new ApiError('CONFLICT', { code: 'VOICE_RESOURCE_GENERATION_PENDING' })
  }
  if (resource._count.bindings > 0) {
    throw new ApiError('CONFLICT', { code: 'VOICE_RESOURCE_STILL_BOUND' })
  }
  if (resource.inputLineage.length > 0) {
    throw new ApiError('CONFLICT', { code: 'VOICE_RESOURCE_USED_AS_INPUT' })
  }
  const activeTasks = await tx.task.count({
    where: {
      projectId: input.projectId,
      targetType: 'CreativeResource',
      targetId: input.resourceId,
      status: { in: [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] },
    },
  })
  if (activeTasks > 0) {
    throw new ApiError('CONFLICT', { code: 'VOICE_RESOURCE_GENERATION_PENDING' })
  }
  await tx.creativeResource.delete({ where: { id: resource.id } })
  return { success: true }
}
