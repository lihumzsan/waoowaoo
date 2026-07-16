import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import type {
  CreativeResourceGenerationProvenance,
  CreativeResourceInputRef,
  CreativeResourceJsonValue,
  CreativeResourceMediaType,
  CreativeResourceRevisionContent,
  CreativeResourceRevisionRef,
  CreativeResourceScopeRef,
} from './contracts'
import {
  buildCreativeResourceOriginKey,
  buildDomainCreativeResourceOriginKey,
  fingerprintCreativeResourceRevision,
} from './identity'
import { requireCreativeResourceSchema } from './schema-registry'

export type CreativeResourcePersistenceClient = Prisma.TransactionClient

export interface ReservedCreativeResource {
  readonly resourceId: string
  readonly originKey: string
  readonly candidateSetId: string | null
  readonly candidateIndex: number | null
  readonly status: 'pending' | 'ready' | 'failed' | 'canceled'
}

export interface ReservedDomainCreativeResource extends ReservedCreativeResource {
  readonly sourceType: string
  readonly sourceId: string
}

export interface ReserveCreativeResourceCandidate {
  readonly resourceId?: string
  readonly name: string
  readonly candidateIndex: number
}

export interface AppendCreativeResourceRevisionInput {
  readonly resourceId: string
  readonly userId: string
  readonly mediaType: CreativeResourceMediaType
  readonly schemaId: string
  readonly content: CreativeResourceRevisionContent
  readonly inputs: readonly CreativeResourceInputRef[]
  readonly provenance: CreativeResourceGenerationProvenance
}

type LockedResourceRow = {
  id: string
  userId: string
  mediaType: string
  schemaId: string
  status: string
}

function requireNonEmpty(value: string, code: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(code)
  return normalized
}

function toJson(value: CreativeResourceJsonValue): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue
}

function nullableJson(value: CreativeResourceJsonValue | null): Prisma.InputJsonValue | Prisma.NullTypes.JsonNull {
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

export async function reserveCreativeResourcesInTransaction(
  tx: CreativeResourcePersistenceClient,
  input: {
    readonly scope: CreativeResourceScopeRef
    readonly mediaType: CreativeResourceMediaType
    readonly schemaId: string
    readonly operationId: string
    readonly requestId: string
    readonly candidateSetId?: string | null
    readonly candidates: readonly ReserveCreativeResourceCandidate[]
  },
): Promise<readonly ReservedCreativeResource[]> {
  await assertScopeOwnership(tx, input.scope)
  const schema = requireCreativeResourceSchema(requireNonEmpty(input.schemaId, 'CREATIVE_RESOURCE_SCHEMA_ID_REQUIRED'))
  if (schema.mediaType !== input.mediaType) {
    throw new Error(`CREATIVE_RESOURCE_SCHEMA_MEDIA_MISMATCH:${schema.schemaId}:${input.mediaType}`)
  }
  if (input.candidates.length === 0) throw new Error('CREATIVE_RESOURCE_CANDIDATES_REQUIRED')
  const candidateIndexes = new Set<number>()
  const candidateSetId = input.candidateSetId?.trim() || null
  const rows = input.candidates.map((candidate) => {
    if (!Number.isSafeInteger(candidate.candidateIndex) || candidate.candidateIndex < 0) {
      throw new Error('CREATIVE_RESOURCE_CANDIDATE_INDEX_INVALID')
    }
    if (candidateIndexes.has(candidate.candidateIndex)) {
      throw new Error(`CREATIVE_RESOURCE_CANDIDATE_INDEX_DUPLICATE:${String(candidate.candidateIndex)}`)
    }
    candidateIndexes.add(candidate.candidateIndex)
    return {
      id: candidate.resourceId?.trim() || randomUUID(),
      userId: input.scope.userId,
      projectId: input.scope.projectId,
      episodeId: input.scope.episodeId,
      scopeKind: input.scope.kind,
      scopeId: input.scope.id,
      mediaType: input.mediaType,
      schemaId: schema.schemaId,
      name: requireNonEmpty(candidate.name, 'CREATIVE_RESOURCE_NAME_REQUIRED'),
      originKey: buildCreativeResourceOriginKey({
        operationId: input.operationId,
        requestId: input.requestId,
        candidateIndex: candidate.candidateIndex,
      }),
      candidateSetId,
      candidateIndex: candidate.candidateIndex,
    }
  })
  await tx.creativeResource.createMany({ data: rows, skipDuplicates: true })
  const stored = await tx.creativeResource.findMany({
    where: { originKey: { in: rows.map((row) => row.originKey) } },
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
      originKey: true,
      candidateSetId: true,
      candidateIndex: true,
      status: true,
    },
  })
  const storedByOrigin = new Map(stored.map((row) => [row.originKey, row]))
  return rows.map((expected) => {
    const row = storedByOrigin.get(expected.originKey)
    if (!row) throw new Error(`CREATIVE_RESOURCE_RESERVATION_MISSING:${expected.originKey}`)
    if (
      row.userId !== expected.userId
      || row.id !== expected.id
      || row.projectId !== expected.projectId
      || row.episodeId !== expected.episodeId
      || row.scopeKind !== expected.scopeKind
      || row.scopeId !== expected.scopeId
      || row.mediaType !== expected.mediaType
      || row.schemaId !== expected.schemaId
      || row.name !== expected.name
      || row.candidateSetId !== expected.candidateSetId
      || row.candidateIndex !== expected.candidateIndex
    ) {
      throw new Error(`CREATIVE_RESOURCE_ORIGIN_COLLISION:${expected.originKey}`)
    }
    if (row.status !== 'pending' && row.status !== 'ready' && row.status !== 'failed' && row.status !== 'canceled') {
      throw new Error(`CREATIVE_RESOURCE_STATUS_INVALID:${row.status}`)
    }
    return {
      resourceId: row.id,
      originKey: row.originKey,
      candidateSetId: row.candidateSetId,
      candidateIndex: row.candidateIndex,
      status: row.status,
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
    readonly candidateSetId?: string | null
    readonly candidateIndex?: number | null
  },
): Promise<ReservedDomainCreativeResource> {
  await assertScopeOwnership(tx, input.scope)
  const schema = requireCreativeResourceSchema(requireNonEmpty(input.schemaId, 'CREATIVE_RESOURCE_SCHEMA_ID_REQUIRED'))
  if (schema.mediaType !== input.mediaType) {
    throw new Error(`CREATIVE_RESOURCE_SCHEMA_MEDIA_MISMATCH:${schema.schemaId}:${input.mediaType}`)
  }
  const sourceType = requireNonEmpty(input.sourceType, 'CREATIVE_RESOURCE_SOURCE_TYPE_REQUIRED')
  const sourceId = requireNonEmpty(input.sourceId, 'CREATIVE_RESOURCE_SOURCE_ID_REQUIRED')
  const originKey = buildDomainCreativeResourceOriginKey({ sourceType, sourceId })
  const candidateIndex = input.candidateIndex ?? null
  if (candidateIndex !== null && (!Number.isSafeInteger(candidateIndex) || candidateIndex < 0)) {
    throw new Error('CREATIVE_RESOURCE_CANDIDATE_INDEX_INVALID')
  }
  const expected = {
    id: randomUUID(),
    userId: input.scope.userId,
    projectId: input.scope.projectId,
    episodeId: input.scope.episodeId,
    scopeKind: input.scope.kind,
    scopeId: input.scope.id,
    mediaType: input.mediaType,
    schemaId: schema.schemaId,
    name: requireNonEmpty(input.name, 'CREATIVE_RESOURCE_NAME_REQUIRED'),
    originKey,
    sourceType,
    sourceId,
    candidateSetId: input.candidateSetId?.trim() || null,
    candidateIndex,
  }
  await tx.creativeResource.createMany({ data: [expected], skipDuplicates: true })
  const stored = await tx.creativeResource.findUnique({
    where: { sourceType_sourceId: { sourceType, sourceId } },
    select: {
      id: true,
      userId: true,
      projectId: true,
      episodeId: true,
      scopeKind: true,
      scopeId: true,
      mediaType: true,
      schemaId: true,
      originKey: true,
      sourceType: true,
      sourceId: true,
      candidateSetId: true,
      candidateIndex: true,
      status: true,
    },
  })
  if (!stored) throw new Error(`CREATIVE_RESOURCE_DOMAIN_RESERVATION_MISSING:${sourceType}:${sourceId}`)
  if (
    stored.userId !== expected.userId
    || stored.projectId !== expected.projectId
    || stored.episodeId !== expected.episodeId
    || stored.scopeKind !== expected.scopeKind
    || stored.scopeId !== expected.scopeId
    || stored.mediaType !== expected.mediaType
    || stored.schemaId !== expected.schemaId
    || stored.originKey !== expected.originKey
    || stored.sourceType !== expected.sourceType
    || stored.sourceId !== expected.sourceId
    || stored.candidateSetId !== expected.candidateSetId
    || stored.candidateIndex !== expected.candidateIndex
  ) {
    throw new Error(`CREATIVE_RESOURCE_DOMAIN_COLLISION:${sourceType}:${sourceId}`)
  }
  if (stored.status !== 'pending' && stored.status !== 'ready' && stored.status !== 'failed' && stored.status !== 'canceled') {
    throw new Error(`CREATIVE_RESOURCE_STATUS_INVALID:${stored.status}`)
  }
  return {
    resourceId: stored.id,
    originKey: stored.originKey,
    sourceType,
    sourceId,
    candidateSetId: stored.candidateSetId,
    candidateIndex: stored.candidateIndex,
    status: stored.status,
  }
}

async function lockResource(
  tx: CreativeResourcePersistenceClient,
  resourceId: string,
): Promise<LockedResourceRow> {
  const rows = await tx.$queryRaw<LockedResourceRow[]>(Prisma.sql`
    SELECT id, userId, mediaType, schemaId, status
    FROM creative_resources
    WHERE id = ${resourceId}
    FOR UPDATE
  `)
  const row = rows[0]
  if (!row) throw new Error(`CREATIVE_RESOURCE_NOT_FOUND:${resourceId}`)
  return row
}

export async function validateCreativeResourceInputReferencesInTransaction(
  tx: CreativeResourcePersistenceClient,
  userId: string,
  inputs: readonly CreativeResourceInputRef[],
): Promise<readonly CreativeResourceInputRef[]> {
  const identityKeys = new Set<string>()
  for (const reference of inputs) {
    requireNonEmpty(reference.resourceId, 'CREATIVE_RESOURCE_INPUT_RESOURCE_ID_REQUIRED')
    requireNonEmpty(reference.revisionId, 'CREATIVE_RESOURCE_INPUT_REVISION_ID_REQUIRED')
    requireNonEmpty(reference.fingerprint, 'CREATIVE_RESOURCE_INPUT_FINGERPRINT_REQUIRED')
    requireNonEmpty(reference.role, 'CREATIVE_RESOURCE_INPUT_ROLE_REQUIRED')
    if (!Number.isSafeInteger(reference.position) || reference.position < 0) {
      throw new Error('CREATIVE_RESOURCE_INPUT_POSITION_INVALID')
    }
    const identity = `${reference.role}:${String(reference.position)}`
    if (identityKeys.has(identity)) throw new Error(`CREATIVE_RESOURCE_INPUT_POSITION_DUPLICATE:${identity}`)
    identityKeys.add(identity)
  }
  if (inputs.length === 0) return []
  const revisions = await tx.creativeResourceRevision.findMany({
    where: { id: { in: inputs.map((reference) => reference.revisionId) } },
    select: {
      id: true,
      resourceId: true,
      fingerprint: true,
      resource: { select: { userId: true, status: true } },
    },
  })
  const byId = new Map(revisions.map((revision) => [revision.id, revision]))
  return inputs.map((reference) => {
    const revision = byId.get(reference.revisionId)
    if (!revision) throw new Error(`CREATIVE_RESOURCE_INPUT_REVISION_NOT_FOUND:${reference.revisionId}`)
    if (revision.resourceId !== reference.resourceId) {
      throw new Error(`CREATIVE_RESOURCE_INPUT_RESOURCE_MISMATCH:${reference.revisionId}`)
    }
    if (revision.resource.userId !== userId) throw new Error('CREATIVE_RESOURCE_INPUT_NOT_OWNED')
    if (revision.resource.status !== 'ready') {
      throw new Error(`CREATIVE_RESOURCE_INPUT_NOT_READY:${reference.resourceId}`)
    }
    if (revision.fingerprint !== reference.fingerprint) {
      throw new Error(`CREATIVE_RESOURCE_INPUT_FINGERPRINT_CHANGED:${reference.revisionId}`)
    }
    return reference
  })
}

function revisionStorage(content: CreativeResourceRevisionContent): {
  readonly contentText: string | null
  readonly contentJson: Prisma.InputJsonValue | Prisma.NullTypes.JsonNull
  readonly mediaId: string | null
  readonly sourceType: string | null
  readonly sourceId: string | null
  readonly sourceRevision: string | null
} {
  if (content.kind === 'text') {
    return {
      contentText: content.text,
      contentJson: Prisma.JsonNull,
      mediaId: null,
      sourceType: null,
      sourceId: null,
      sourceRevision: null,
    }
  }
  if (content.kind === 'structured') {
    return {
      contentText: null,
      contentJson: toJson(content.data),
      mediaId: null,
      sourceType: null,
      sourceId: null,
      sourceRevision: null,
    }
  }
  if (content.kind === 'media') {
    return {
      contentText: null,
      contentJson: Prisma.JsonNull,
      mediaId: requireNonEmpty(content.mediaId, 'CREATIVE_RESOURCE_MEDIA_ID_REQUIRED'),
      sourceType: null,
      sourceId: null,
      sourceRevision: null,
    }
  }
  return {
    contentText: null,
    contentJson: toJson(content.snapshot),
    mediaId: null,
    sourceType: requireNonEmpty(content.sourceType, 'CREATIVE_RESOURCE_SOURCE_TYPE_REQUIRED'),
    sourceId: requireNonEmpty(content.sourceId, 'CREATIVE_RESOURCE_SOURCE_ID_REQUIRED'),
    sourceRevision: requireNonEmpty(content.sourceRevision, 'CREATIVE_RESOURCE_SOURCE_REVISION_REQUIRED'),
  }
}

export async function appendCreativeResourceRevisionInTransaction(
  tx: CreativeResourcePersistenceClient,
  input: AppendCreativeResourceRevisionInput,
): Promise<CreativeResourceRevisionRef> {
  const resourceId = requireNonEmpty(input.resourceId, 'CREATIVE_RESOURCE_ID_REQUIRED')
  const userId = requireNonEmpty(input.userId, 'CREATIVE_RESOURCE_USER_ID_REQUIRED')
  const resource = await lockResource(tx, resourceId)
  if (resource.userId !== userId) throw new Error('CREATIVE_RESOURCE_NOT_OWNED')
  if (resource.mediaType !== input.mediaType || resource.schemaId !== input.schemaId) {
    throw new Error(`CREATIVE_RESOURCE_REVISION_CONTRACT_MISMATCH:${resourceId}`)
  }
  if (resource.status === 'canceled') throw new Error(`CREATIVE_RESOURCE_CANCELED:${resourceId}`)
  const references = await validateCreativeResourceInputReferencesInTransaction(tx, userId, input.inputs)
  const fingerprint = fingerprintCreativeResourceRevision({
    mediaType: input.mediaType,
    schemaId: input.schemaId,
    content: input.content,
    inputs: references,
    prompt: input.provenance.prompt,
    modelKey: input.provenance.modelKey,
    generationOptions: input.provenance.generationOptions,
  })
  const taskId = input.provenance.taskId?.trim() || null
  if (taskId) {
    const existing = await tx.creativeResourceRevision.findUnique({
      where: { taskId_resourceId: { taskId, resourceId } },
      select: { id: true, resourceId: true, fingerprint: true },
    })
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new Error(`CREATIVE_RESOURCE_TASK_REVISION_COLLISION:${taskId}:${resourceId}`)
      }
      return {
        resourceId: existing.resourceId,
        revisionId: existing.id,
        fingerprint: existing.fingerprint,
      }
    }
  }
  const storage = revisionStorage(input.content)
  if (storage.mediaId) {
    const media = await tx.mediaObject.findUnique({ where: { id: storage.mediaId }, select: { id: true } })
    if (!media) throw new Error(`CREATIVE_RESOURCE_MEDIA_NOT_FOUND:${storage.mediaId}`)
  }
  const aggregate = await tx.creativeResourceRevision.aggregate({
    where: { resourceId },
    _max: { revision: true },
  })
  const revision = (aggregate._max.revision ?? 0) + 1
  const created = await tx.creativeResourceRevision.create({
    data: {
      id: randomUUID(),
      resourceId,
      revision,
      fingerprint,
      ...storage,
      prompt: input.provenance.prompt?.trim() || null,
      modelKey: input.provenance.modelKey?.trim() || null,
      generationOptions: nullableJson(input.provenance.generationOptions),
      operationId: input.provenance.operationId?.trim() || null,
      inputHash: input.provenance.inputHash?.trim() || null,
      taskId,
      operationExecutionId: input.provenance.operationExecutionId?.trim() || null,
      executionSegmentId: input.provenance.executionSegmentId?.trim() || null,
      toolCallId: input.provenance.toolCallId?.trim() || null,
    },
    select: { id: true, resourceId: true, fingerprint: true },
  })
  if (references.length > 0) {
    await tx.creativeResourceLineage.createMany({
      data: references.map((reference) => ({
        id: randomUUID(),
        outputRevisionId: created.id,
        inputRevisionId: reference.revisionId,
        role: reference.role.trim(),
        position: reference.position,
      })),
    })
  }
  const updated = await tx.creativeResource.updateMany({
    where: { id: resourceId, userId },
    data: {
      headRevisionId: created.id,
      status: 'ready',
      errorCode: null,
      errorMessage: null,
    },
  })
  if (updated.count !== 1) throw new Error(`CREATIVE_RESOURCE_HEAD_UPDATE_FAILED:${resourceId}`)
  return {
    resourceId: created.resourceId,
    revisionId: created.id,
    fingerprint: created.fingerprint,
  }
}

export async function settleCreativeResourceFailureInTransaction(
  tx: CreativeResourcePersistenceClient,
  input: {
    readonly resourceId: string
    readonly userId: string
    readonly status: 'failed' | 'canceled'
    readonly errorCode: string
    readonly errorMessage: string
  },
): Promise<void> {
  const resource = await lockResource(tx, requireNonEmpty(input.resourceId, 'CREATIVE_RESOURCE_ID_REQUIRED'))
  if (resource.userId !== input.userId) throw new Error('CREATIVE_RESOURCE_NOT_OWNED')
  if (resource.status === 'ready') return
  const updated = await tx.creativeResource.updateMany({
    where: { id: resource.id, userId: input.userId, status: { in: ['pending', 'failed', 'canceled'] } },
    data: {
      status: input.status,
      errorCode: requireNonEmpty(input.errorCode, 'CREATIVE_RESOURCE_ERROR_CODE_REQUIRED'),
      errorMessage: requireNonEmpty(input.errorMessage, 'CREATIVE_RESOURCE_ERROR_MESSAGE_REQUIRED').slice(0, 2_000),
    },
  })
  if (updated.count !== 1) throw new Error(`CREATIVE_RESOURCE_FAILURE_SETTLEMENT_FAILED:${resource.id}`)
}
