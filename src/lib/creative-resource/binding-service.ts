import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import type { CreativeResourceBindingView, CreativeResourceScopeRef } from './contracts'
import type { CreativeResourcePersistenceClient } from './persistence'

type LockedBindingRow = {
  id: string
  userId: string
  resourceId: string
  revisionId: string
  source: string
  version: number
}

function requireNonEmpty(value: string, code: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(code)
  return normalized
}

function bindingView(row: LockedBindingRow, scope: CreativeResourceScopeRef, role: string, slotKey: string): CreativeResourceBindingView {
  return {
    bindingId: row.id,
    scope,
    role,
    slotKey,
    resourceId: row.resourceId,
    revisionId: row.revisionId,
    version: row.version,
    source: row.source,
  }
}

async function lockBinding(
  tx: CreativeResourcePersistenceClient,
  input: {
    readonly scope: CreativeResourceScopeRef
    readonly role: string
    readonly slotKey: string
  },
): Promise<LockedBindingRow | null> {
  const rows = await tx.$queryRaw<LockedBindingRow[]>(Prisma.sql`
    SELECT id, userId, resourceId, revisionId, source, version
    FROM creative_resource_bindings
    WHERE scopeKind = ${input.scope.kind}
      AND scopeId = ${input.scope.id}
      AND role = ${input.role}
      AND slotKey = ${input.slotKey}
    FOR UPDATE
  `)
  const existing = rows[0] ?? null
  if (existing && existing.userId !== input.scope.userId) {
    throw new Error('CREATIVE_RESOURCE_BINDING_NOT_OWNED')
  }
  return existing
}

export async function getCreativeResourceBindingInTransaction(
  tx: CreativeResourcePersistenceClient,
  input: {
    readonly scope: CreativeResourceScopeRef
    readonly role: string
    readonly slotKey: string
  },
): Promise<CreativeResourceBindingView | null> {
  const role = requireNonEmpty(input.role, 'CREATIVE_RESOURCE_BINDING_ROLE_REQUIRED')
  const slotKey = requireNonEmpty(input.slotKey, 'CREATIVE_RESOURCE_BINDING_SLOT_REQUIRED')
  const existing = await lockBinding(tx, { scope: input.scope, role, slotKey })
  return existing ? bindingView(existing, input.scope, role, slotKey) : null
}

export async function unbindCreativeResourceInTransaction(
  tx: CreativeResourcePersistenceClient,
  input: {
    readonly scope: CreativeResourceScopeRef
    readonly role: string
    readonly slotKey: string
    readonly expectedVersion: number | null
  },
): Promise<CreativeResourceBindingView | null> {
  const role = requireNonEmpty(input.role, 'CREATIVE_RESOURCE_BINDING_ROLE_REQUIRED')
  const slotKey = requireNonEmpty(input.slotKey, 'CREATIVE_RESOURCE_BINDING_SLOT_REQUIRED')
  const existing = await lockBinding(tx, { scope: input.scope, role, slotKey })
  if (!existing) {
    if (input.expectedVersion !== null) {
      throw new Error(`CREATIVE_RESOURCE_BINDING_VERSION_CONFLICT:missing:${String(input.expectedVersion)}`)
    }
    return null
  }
  if (input.expectedVersion === null || existing.version !== input.expectedVersion) {
    throw new Error(`CREATIVE_RESOURCE_BINDING_VERSION_CONFLICT:${String(existing.version)}:${String(input.expectedVersion)}`)
  }
  const deleted = await tx.creativeResourceBinding.deleteMany({
    where: { id: existing.id, version: input.expectedVersion },
  })
  if (deleted.count !== 1) throw new Error('CREATIVE_RESOURCE_BINDING_CAS_FAILED')
  return bindingView(existing, input.scope, role, slotKey)
}

export async function deleteCreativeResourceBindingSlotInTransaction(
  tx: CreativeResourcePersistenceClient,
  input: {
    readonly scope: CreativeResourceScopeRef
    readonly role: string
    readonly slotKey: string
  },
): Promise<number> {
  const role = requireNonEmpty(input.role, 'CREATIVE_RESOURCE_BINDING_ROLE_REQUIRED')
  const slotKey = requireNonEmpty(input.slotKey, 'CREATIVE_RESOURCE_BINDING_SLOT_REQUIRED')
  const deleted = await tx.creativeResourceBinding.deleteMany({
    where: {
      userId: input.scope.userId,
      scopeKind: input.scope.kind,
      scopeId: input.scope.id,
      role,
      slotKey,
    },
  })
  return deleted.count
}

export async function bindCreativeResourceRevisionInTransaction(
  tx: CreativeResourcePersistenceClient,
  input: {
    readonly scope: CreativeResourceScopeRef
    readonly role: string
    readonly slotKey: string
    readonly resourceId: string
    readonly revisionId: string
    readonly source: string
    readonly expectedVersion: number | null
  },
): Promise<CreativeResourceBindingView> {
  const role = requireNonEmpty(input.role, 'CREATIVE_RESOURCE_BINDING_ROLE_REQUIRED')
  const slotKey = requireNonEmpty(input.slotKey, 'CREATIVE_RESOURCE_BINDING_SLOT_REQUIRED')
  const resourceId = requireNonEmpty(input.resourceId, 'CREATIVE_RESOURCE_ID_REQUIRED')
  const revisionId = requireNonEmpty(input.revisionId, 'CREATIVE_RESOURCE_REVISION_ID_REQUIRED')
  const source = requireNonEmpty(input.source, 'CREATIVE_RESOURCE_BINDING_SOURCE_REQUIRED')
  if (input.scope.kind === 'project') {
    const project = await tx.project.findFirst({
      where: { id: input.scope.id, userId: input.scope.userId },
      select: { id: true },
    })
    if (!project) throw new Error('CREATIVE_RESOURCE_BINDING_SCOPE_NOT_OWNED')
  }
  if (input.scope.kind === 'episode') {
    const episode = await tx.projectEpisode.findFirst({
      where: {
        id: input.scope.id,
        projectId: input.scope.projectId ?? '',
        project: { userId: input.scope.userId },
      },
      select: { id: true },
    })
    if (!episode) throw new Error('CREATIVE_RESOURCE_BINDING_SCOPE_NOT_OWNED')
  }
  const allowedResourceScopes: Prisma.CreativeResourceWhereInput[] = [{
    scopeKind: 'user',
    scopeId: input.scope.userId,
    projectId: null,
    episodeId: null,
  }]
  if (input.scope.projectId) {
    allowedResourceScopes.push({
      scopeKind: 'project',
      scopeId: input.scope.projectId,
      projectId: input.scope.projectId,
      episodeId: null,
    })
  }
  if (input.scope.episodeId) {
    allowedResourceScopes.push({
      scopeKind: 'episode',
      scopeId: input.scope.episodeId,
      projectId: input.scope.projectId,
      episodeId: input.scope.episodeId,
    })
  }
  const revision = await tx.creativeResourceRevision.findFirst({
    where: {
      id: revisionId,
      resourceId,
      resource: {
        userId: input.scope.userId,
        status: 'ready',
        OR: allowedResourceScopes,
      },
    },
    select: { id: true },
  })
  if (!revision) throw new Error('CREATIVE_RESOURCE_BINDING_REVISION_NOT_OWNED')
  const existing = await lockBinding(tx, { scope: input.scope, role, slotKey })
  if (!existing) {
    if (input.expectedVersion !== null) {
      throw new Error(`CREATIVE_RESOURCE_BINDING_VERSION_CONFLICT:missing:${String(input.expectedVersion)}`)
    }
    const created = await tx.creativeResourceBinding.create({
      data: {
        id: randomUUID(),
        userId: input.scope.userId,
        projectId: input.scope.projectId,
        episodeId: input.scope.episodeId,
        scopeKind: input.scope.kind,
        scopeId: input.scope.id,
        role,
        slotKey,
        resourceId,
        revisionId,
        source,
      },
      select: { id: true, userId: true, resourceId: true, revisionId: true, source: true, version: true },
    })
    return bindingView(created, input.scope, role, slotKey)
  }
  if (input.expectedVersion === null || existing.version !== input.expectedVersion) {
    throw new Error(`CREATIVE_RESOURCE_BINDING_VERSION_CONFLICT:${String(existing.version)}:${String(input.expectedVersion)}`)
  }
  const updated = await tx.creativeResourceBinding.updateMany({
    where: { id: existing.id, version: input.expectedVersion },
    data: {
      resourceId,
      revisionId,
      source,
      version: { increment: 1 },
    },
  })
  if (updated.count !== 1) throw new Error('CREATIVE_RESOURCE_BINDING_CAS_FAILED')
  return bindingView({
    ...existing,
    resourceId,
    revisionId,
    source,
    version: existing.version + 1,
  }, input.scope, role, slotKey)
}
