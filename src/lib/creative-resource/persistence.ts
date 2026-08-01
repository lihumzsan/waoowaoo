import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import type {
  CreativeResourceContent,
  CreativeResourceGenerationProvenance,
  CreativeResourceInputRef,
  CreativeResourceJsonValue,
  CreativeResourceMaterializedRef,
  CreativeResourceMediaType,
  CreativeResourceScopeRef,
} from './contracts'
import { isCreativeResourceScopeKind } from './contracts'
import {
  buildCreativeResourceId,
  buildDomainCreativeResourceId,
} from './identity'
import { requireCreativeResourceSchema } from './schema-registry'

export type CreativeResourcePersistenceClient = Prisma.TransactionClient

export interface ReservedCreativeResource {
  readonly resourceId: string
  readonly memberIndex: number | null
  readonly alternativeGroupExecutionId: string | null
  readonly status: 'pending' | 'ready' | 'failed' | 'canceled'
}

export interface ReservedDomainCreativeResource extends ReservedCreativeResource {
  readonly sourceType: string
  readonly sourceId: string
}

export interface ReserveCreativeResourceMember {
  readonly resourceId?: string
  readonly name: string
  readonly memberIndex: number
}

export interface MaterializeCreativeResourceInput {
  readonly resourceId: string
  readonly userId: string
  readonly mediaType: CreativeResourceMediaType
  readonly schemaId: string
  readonly content: CreativeResourceContent
  readonly inputs: readonly CreativeResourceInputRef[]
  readonly provenance: CreativeResourceGenerationProvenance
}

type LockedResourceRow = {
  id: string
  userId: string
  projectId: string | null
  episodeId: string | null
  scopeKind: string
  scopeId: string
  mediaType: string
  schemaId: string
  status: string
  taskId: string | null
  materializedAt: Date | null
}

function requireNonEmpty(value: string | null | undefined, code: string): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) throw new Error(code)
  return normalized
}

function toJson(value: CreativeResourceJsonValue): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue
}

function nullableJson(
  value: CreativeResourceJsonValue | null,
): Prisma.InputJsonValue | Prisma.NullTypes.JsonNull {
  return value === null ? Prisma.JsonNull : toJson(value)
}

async function assertScopeOwnership(
  tx: CreativeResourcePersistenceClient,
  scope: CreativeResourceScopeRef,
): Promise<void> {
  if (scope.kind === 'user') return
  if (!scope.projectId) throw new Error('CREATIVE_RESOURCE_PROJECT_SCOPE_REQUIRED')
  if (scope.kind === 'project') {
    const project = await tx.project.findFirst({
      where: { id: scope.projectId, userId: scope.userId },
      select: { id: true },
    })
    if (!project) throw new Error('CREATIVE_RESOURCE_PROJECT_NOT_OWNED')
    return
  }
  if (!scope.episodeId) throw new Error('CREATIVE_RESOURCE_EPISODE_SCOPE_REQUIRED')
  const episode = await tx.projectEpisode.findFirst({
    where: {
      id: scope.episodeId,
      projectId: scope.projectId,
      project: { userId: scope.userId },
    },
    select: { id: true },
  })
  if (!episode) throw new Error('CREATIVE_RESOURCE_EPISODE_NOT_OWNED')
}

function assertMemberIndex(index: number, seen?: Set<number>): void {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error('CREATIVE_RESOURCE_MEMBER_INDEX_INVALID')
  }
  if (seen?.has(index)) {
    throw new Error(`CREATIVE_RESOURCE_MEMBER_INDEX_DUPLICATE:${String(index)}`)
  }
  seen?.add(index)
}

export async function reserveCreativeResourcesInTransaction(
  tx: CreativeResourcePersistenceClient,
  input: {
    readonly scope: CreativeResourceScopeRef
    readonly mediaType: CreativeResourceMediaType
    readonly schemaId: string
    readonly operationId: string
    readonly requestId: string
    readonly alternativeGroupExecutionId?: string | null
    readonly members: readonly ReserveCreativeResourceMember[]
  },
): Promise<readonly ReservedCreativeResource[]> {
  await assertScopeOwnership(tx, input.scope)
  const schema = requireCreativeResourceSchema(
    requireNonEmpty(input.schemaId, 'CREATIVE_RESOURCE_SCHEMA_ID_REQUIRED'),
  )
  if (schema.mediaType !== input.mediaType) {
    throw new Error(`CREATIVE_RESOURCE_SCHEMA_MEDIA_MISMATCH:${schema.schemaId}:${input.mediaType}`)
  }
  if (input.members.length === 0) throw new Error('CREATIVE_RESOURCE_MEMBERS_REQUIRED')

  const memberIndexes = new Set<number>()
  const alternativeGroupExecutionId = input.alternativeGroupExecutionId?.trim() || null
  if (alternativeGroupExecutionId) {
    if (input.members.length < 2 || input.members.length > 6) {
      throw new Error('CREATIVE_RESOURCE_ALTERNATIVE_MEMBER_COUNT_INVALID')
    }
    const execution = await tx.operationExecution.findUnique({
      where: { id: alternativeGroupExecutionId },
      select: {
        userId: true,
        projectId: true,
        episodeId: true,
        operationId: true,
        status: true,
      },
    })
    if (
      !execution
      || execution.userId !== input.scope.userId
      || execution.projectId !== input.scope.projectId
      || (
        input.scope.episodeId !== null
        && execution.episodeId !== input.scope.episodeId
      )
      || execution.operationId !== input.operationId
      || execution.status !== 'committing'
    ) {
      throw new Error(`CREATIVE_RESOURCE_ALTERNATIVE_GROUP_OWNER_INVALID:${alternativeGroupExecutionId}`)
    }
  }
  const rows = input.members.map((member) => {
    assertMemberIndex(member.memberIndex, memberIndexes)
    const resourceId = buildCreativeResourceId({
      operationId: input.operationId,
      requestId: input.requestId,
      memberIndex: member.memberIndex,
    })
    const requestedId = member.resourceId?.trim() || resourceId
    if (requestedId !== resourceId) {
      throw new Error(`CREATIVE_RESOURCE_ID_MISMATCH:${requestedId}:${resourceId}`)
    }
    return {
      id: resourceId,
      userId: input.scope.userId,
      projectId: input.scope.projectId,
      episodeId: input.scope.episodeId,
      scopeKind: input.scope.kind,
      scopeId: input.scope.id,
      mediaType: input.mediaType,
      schemaId: schema.schemaId,
      name: requireNonEmpty(member.name, 'CREATIVE_RESOURCE_NAME_REQUIRED'),
      memberIndex: member.memberIndex,
      alternativeGroupExecutionId,
    }
  })
  if (
    alternativeGroupExecutionId
    && rows.some((row, index) => row.memberIndex !== index)
  ) {
    throw new Error('CREATIVE_RESOURCE_ALTERNATIVE_MEMBER_INDEX_NON_CONTIGUOUS')
  }

  await tx.creativeResource.createMany({ data: rows, skipDuplicates: true })
  const stored = await tx.creativeResource.findMany({
    where: { id: { in: rows.map((row) => row.id) } },
    select: {
      id: true,
      userId: true,
      projectId: true,
      episodeId: true,
      scopeKind: true,
      scopeId: true,
      mediaType: true,
      schemaId: true,
      name: true,
      memberIndex: true,
      alternativeGroupExecutionId: true,
      status: true,
    },
  })
  const storedById = new Map(stored.map((row) => [row.id, row]))
  return rows.map((expected) => {
    const row = storedById.get(expected.id)
    if (!row) throw new Error(`CREATIVE_RESOURCE_RESERVATION_MISSING:${expected.id}`)
    if (
      row.userId !== expected.userId
      || row.projectId !== expected.projectId
      || row.episodeId !== expected.episodeId
      || row.scopeKind !== expected.scopeKind
      || row.scopeId !== expected.scopeId
      || row.mediaType !== expected.mediaType
      || row.schemaId !== expected.schemaId
      || row.name !== expected.name
      || row.memberIndex !== expected.memberIndex
      || row.alternativeGroupExecutionId !== expected.alternativeGroupExecutionId
    ) {
      throw new Error(`CREATIVE_RESOURCE_ID_COLLISION:${expected.id}`)
    }
    if (!['pending', 'ready', 'failed', 'canceled'].includes(row.status)) {
      throw new Error(`CREATIVE_RESOURCE_STATUS_INVALID:${row.status}`)
    }
    return {
      resourceId: row.id,
      memberIndex: row.memberIndex,
      alternativeGroupExecutionId: row.alternativeGroupExecutionId,
      status: row.status as ReservedCreativeResource['status'],
    }
  })
}

export async function reserveDomainCreativeResourceInTransaction(
  tx: CreativeResourcePersistenceClient,
  input: {
    readonly scope: CreativeResourceScopeRef
    readonly mediaType: CreativeResourceMediaType
    readonly schemaId: string
    readonly sourceType: string
    readonly sourceId: string
    readonly name: string
    readonly memberIndex?: number | null
  },
): Promise<ReservedDomainCreativeResource> {
  await assertScopeOwnership(tx, input.scope)
  const schema = requireCreativeResourceSchema(
    requireNonEmpty(input.schemaId, 'CREATIVE_RESOURCE_SCHEMA_ID_REQUIRED'),
  )
  if (schema.mediaType !== input.mediaType) {
    throw new Error(`CREATIVE_RESOURCE_SCHEMA_MEDIA_MISMATCH:${schema.schemaId}:${input.mediaType}`)
  }
  const sourceType = requireNonEmpty(input.sourceType, 'CREATIVE_RESOURCE_SOURCE_TYPE_REQUIRED')
  const sourceId = requireNonEmpty(input.sourceId, 'CREATIVE_RESOURCE_SOURCE_ID_REQUIRED')
  const resourceId = buildDomainCreativeResourceId({ sourceType, sourceId })
  const memberIndex = input.memberIndex ?? null
  if (memberIndex !== null) assertMemberIndex(memberIndex)
  const expected = {
    id: resourceId,
    userId: input.scope.userId,
    projectId: input.scope.projectId,
    episodeId: input.scope.episodeId,
    scopeKind: input.scope.kind,
    scopeId: input.scope.id,
    mediaType: input.mediaType,
    schemaId: schema.schemaId,
    name: requireNonEmpty(input.name, 'CREATIVE_RESOURCE_NAME_REQUIRED'),
    sourceType,
    sourceId,
    memberIndex,
  }
  await tx.creativeResource.createMany({ data: [expected], skipDuplicates: true })
  const stored = await tx.creativeResource.findUnique({
    where: { id: resourceId },
    select: {
      id: true,
      userId: true,
      projectId: true,
      episodeId: true,
      scopeKind: true,
      scopeId: true,
      mediaType: true,
      schemaId: true,
      sourceType: true,
      sourceId: true,
      memberIndex: true,
      status: true,
    },
  })
  if (!stored) throw new Error(`CREATIVE_RESOURCE_DOMAIN_RESERVATION_MISSING:${resourceId}`)
  if (
    stored.userId !== expected.userId
    || stored.projectId !== expected.projectId
    || stored.episodeId !== expected.episodeId
    || stored.scopeKind !== expected.scopeKind
    || stored.scopeId !== expected.scopeId
    || stored.mediaType !== expected.mediaType
    || stored.schemaId !== expected.schemaId
    || stored.sourceType !== expected.sourceType
    || stored.sourceId !== expected.sourceId
    || stored.memberIndex !== expected.memberIndex
  ) {
    throw new Error(`CREATIVE_RESOURCE_DOMAIN_COLLISION:${sourceType}:${sourceId}`)
  }
  if (!['pending', 'ready', 'failed', 'canceled'].includes(stored.status)) {
    throw new Error(`CREATIVE_RESOURCE_STATUS_INVALID:${stored.status}`)
  }
  return {
    resourceId: stored.id,
    sourceType,
    sourceId,
    memberIndex: stored.memberIndex,
    alternativeGroupExecutionId: null,
    status: stored.status as ReservedCreativeResource['status'],
  }
}

async function lockResource(
  tx: CreativeResourcePersistenceClient,
  resourceId: string,
): Promise<LockedResourceRow> {
  const rows = await tx.$queryRaw<LockedResourceRow[]>(Prisma.sql`
    SELECT id, userId, projectId, episodeId, scopeKind, scopeId,
           mediaType, schemaId, status, taskId, materializedAt
    FROM creative_resources
    WHERE id = ${resourceId}
    FOR UPDATE
  `)
  const row = rows[0]
  if (!row) throw new Error(`CREATIVE_RESOURCE_NOT_FOUND:${resourceId}`)
  return row
}

function scopeFromStoredResource(resource: {
  readonly userId: string
  readonly projectId: string | null
  readonly episodeId: string | null
  readonly scopeKind: string
  readonly scopeId: string
}): CreativeResourceScopeRef {
  if (!isCreativeResourceScopeKind(resource.scopeKind)) {
    throw new Error(`CREATIVE_RESOURCE_SCOPE_KIND_INVALID:${resource.scopeKind}`)
  }
  return {
    kind: resource.scopeKind,
    id: resource.scopeId,
    userId: resource.userId,
    projectId: resource.projectId,
    episodeId: resource.episodeId,
  }
}

function isInputScopeAllowed(
  targetScope: CreativeResourceScopeRef,
  resource: {
    readonly userId: string
    readonly projectId: string | null
    readonly episodeId: string | null
    readonly scopeKind: string
    readonly scopeId: string
  },
): boolean {
  if (resource.userId !== targetScope.userId) return false
  if (resource.scopeKind === 'user') {
    return resource.scopeId === targetScope.userId
      && resource.projectId === null
      && resource.episodeId === null
  }
  if (resource.scopeKind === 'project') {
    return targetScope.projectId !== null
      && resource.scopeId === targetScope.projectId
      && resource.projectId === targetScope.projectId
      && resource.episodeId === null
  }
  if (resource.scopeKind === 'episode') {
    return targetScope.projectId !== null
      && targetScope.episodeId !== null
      && resource.scopeId === targetScope.episodeId
      && resource.projectId === targetScope.projectId
      && resource.episodeId === targetScope.episodeId
  }
  return false
}

export async function validateCreativeResourceInputReferencesInTransaction(
  tx: CreativeResourcePersistenceClient,
  targetScope: CreativeResourceScopeRef,
  inputs: readonly CreativeResourceInputRef[],
): Promise<readonly CreativeResourceInputRef[]> {
  const positions = new Set<string>()
  for (const reference of inputs) {
    requireNonEmpty(reference.resourceId, 'CREATIVE_RESOURCE_INPUT_ID_REQUIRED')
    requireNonEmpty(reference.role, 'CREATIVE_RESOURCE_INPUT_ROLE_REQUIRED')
    if (!Number.isSafeInteger(reference.position) || reference.position < 0) {
      throw new Error('CREATIVE_RESOURCE_INPUT_POSITION_INVALID')
    }
    const identity = `${reference.role}:${String(reference.position)}`
    if (positions.has(identity)) throw new Error(`CREATIVE_RESOURCE_INPUT_POSITION_DUPLICATE:${identity}`)
    positions.add(identity)
  }
  if (inputs.length === 0) return []
  const resources = await tx.creativeResource.findMany({
    where: { id: { in: inputs.map((reference) => reference.resourceId) } },
    select: {
      id: true,
      userId: true,
      projectId: true,
      episodeId: true,
      scopeKind: true,
      scopeId: true,
      status: true,
    },
  })
  const byId = new Map(resources.map((resource) => [resource.id, resource]))
  return inputs.map((reference) => {
    const resource = byId.get(reference.resourceId)
    if (!resource) throw new Error(`CREATIVE_RESOURCE_INPUT_NOT_FOUND:${reference.resourceId}`)
    if (!isInputScopeAllowed(targetScope, resource)) {
      throw new Error(`CREATIVE_RESOURCE_INPUT_SCOPE_INVALID:${reference.resourceId}`)
    }
    if (resource.status !== 'ready') {
      throw new Error(`CREATIVE_RESOURCE_INPUT_NOT_READY:${reference.resourceId}`)
    }
    return reference
  })
}

function contentStorage(content: CreativeResourceContent): {
  readonly contentText: string | null
  readonly contentJson: Prisma.InputJsonValue | Prisma.NullTypes.JsonNull
  readonly mediaId: string | null
} {
  if (content.kind === 'text') {
    return { contentText: content.text, contentJson: Prisma.JsonNull, mediaId: null }
  }
  if (content.kind === 'structured') {
    return { contentText: null, contentJson: toJson(content.data), mediaId: null }
  }
  return {
    contentText: null,
    contentJson: Prisma.JsonNull,
    mediaId: requireNonEmpty(content.mediaId, 'CREATIVE_RESOURCE_MEDIA_ID_REQUIRED'),
  }
}

export async function materializeCreativeResourceInTransaction(
  tx: CreativeResourcePersistenceClient,
  input: MaterializeCreativeResourceInput,
): Promise<CreativeResourceMaterializedRef> {
  const resourceId = requireNonEmpty(input.resourceId, 'CREATIVE_RESOURCE_ID_REQUIRED')
  const userId = requireNonEmpty(input.userId, 'CREATIVE_RESOURCE_USER_ID_REQUIRED')
  const resource = await lockResource(tx, resourceId)
  if (resource.userId !== userId) throw new Error('CREATIVE_RESOURCE_NOT_OWNED')
  if (resource.mediaType !== input.mediaType || resource.schemaId !== input.schemaId) {
    throw new Error(`CREATIVE_RESOURCE_CONTRACT_MISMATCH:${resourceId}`)
  }
  const taskId = input.provenance.taskId?.trim() || null
  if (resource.materializedAt) {
    if (resource.status === 'ready' && resource.taskId === taskId) return { resourceId }
    throw new Error(`CREATIVE_RESOURCE_ALREADY_MATERIALIZED:${resourceId}`)
  }
  if (resource.status === 'canceled') throw new Error(`CREATIVE_RESOURCE_CANCELED:${resourceId}`)

  const references = await validateCreativeResourceInputReferencesInTransaction(
    tx,
    scopeFromStoredResource(resource),
    input.inputs,
  )
  const storage = contentStorage(input.content)
  if (storage.mediaId) {
    const media = await tx.mediaObject.findUnique({
      where: { id: storage.mediaId },
      select: { id: true },
    })
    if (!media) throw new Error(`CREATIVE_RESOURCE_MEDIA_NOT_FOUND:${storage.mediaId}`)
  }

  const updated = await tx.creativeResource.updateMany({
    where: {
      id: resourceId,
      userId,
      materializedAt: null,
      status: { in: ['pending', 'failed'] },
    },
    data: {
      ...storage,
      prompt: input.provenance.prompt?.trim() || null,
      modelKey: input.provenance.modelKey?.trim() || null,
      generationOptions: nullableJson(input.provenance.generationOptions),
      operationId: input.provenance.operationId?.trim() || null,
      inputHash: input.provenance.inputHash?.trim() || null,
      taskId,
      operationExecutionId: input.provenance.operationExecutionId?.trim() || null,
      toolCallId: input.provenance.toolCallId?.trim() || null,
      materializedAt: new Date(),
      status: 'ready',
      errorCode: null,
      errorMessage: null,
    },
  })
  if (updated.count !== 1) throw new Error(`CREATIVE_RESOURCE_MATERIALIZATION_FAILED:${resourceId}`)
  if (references.length > 0) {
    await tx.creativeResourceLineage.createMany({
      data: references.map((reference) => ({
        id: randomUUID(),
        outputResourceId: resourceId,
        inputResourceId: reference.resourceId,
        role: reference.role.trim(),
        position: reference.position,
      })),
    })
  }
  return { resourceId }
}

export async function settleCreativeResourceFailureInTransaction(
  tx: CreativeResourcePersistenceClient,
  input: {
    readonly resourceId: string
    readonly userId: string
    readonly status: 'failed' | 'canceled'
    readonly errorCode: string | null
    readonly errorMessage: string | null
  },
): Promise<void> {
  const resource = await lockResource(
    tx,
    requireNonEmpty(input.resourceId, 'CREATIVE_RESOURCE_ID_REQUIRED'),
  )
  if (resource.userId !== input.userId) throw new Error('CREATIVE_RESOURCE_NOT_OWNED')
  if (resource.status === 'ready') return
  const errorCode = input.status === 'failed'
    ? requireNonEmpty(input.errorCode, 'CREATIVE_RESOURCE_ERROR_CODE_REQUIRED')
    : null
  const errorMessage = input.status === 'failed'
    ? requireNonEmpty(
        input.errorMessage,
        'CREATIVE_RESOURCE_ERROR_MESSAGE_REQUIRED',
      ).slice(0, 2_000)
    : null
  const updated = await tx.creativeResource.updateMany({
    where: {
      id: resource.id,
      userId: input.userId,
      materializedAt: null,
      status: { in: ['pending', 'failed', 'canceled'] },
    },
    data: {
      status: input.status,
      errorCode,
      errorMessage,
    },
  })
  if (updated.count !== 1) {
    throw new Error(`CREATIVE_RESOURCE_FAILURE_SETTLEMENT_FAILED:${resource.id}`)
  }
}
