import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { storeWorkspaceResourceContent } from './content-store'
import type {
  WorkspaceResourceInputRef,
  WorkspaceResourceJsonValue,
  WorkspaceResourceKind,
  WorkspaceResourceMediaType,
} from './contracts'
import { createWorkspaceResourceId } from './identity'
import {
  contentKindFromPath,
  isWorkspaceSubtreePath,
  parentWorkspacePath,
  replaceWorkspacePathPrefix,
  requireOutputPathForMediaType,
  resourceNameFromPath,
  validateWorkspaceResourceFilePath,
  validateWorkspaceResourceFolderPath,
  validateWorkspaceResourcePathForKind,
  WorkspaceResourcePlacementError,
} from './path'
import {
  WORKSPACE_RESOURCE_FOLDER_SCHEMA_ID,
  WORKSPACE_RESOURCE_SCHEMA,
  requireWorkspaceResourceSchema,
} from './schema-registry'

export type WorkspaceResourceMaterializationContent =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'structured'; readonly data: WorkspaceResourceJsonValue }
  | { readonly kind: 'media'; readonly mediaId: string }

export type WorkspaceResourceTreeBaselineEntry = {
  readonly resourceId: string
  readonly workspacePath: string
  readonly resourceKind: WorkspaceResourceKind
  readonly mediaType: WorkspaceResourceMediaType | null
  readonly contentVersion: number
}

export type WorkspaceResourceTreeEntry = {
  readonly resourceId: string
  readonly workspacePath: string
  readonly resourceKind: WorkspaceResourceKind
  readonly mediaType: WorkspaceResourceMediaType | null
  /** Present only for a new or edited user-owned text file. */
  readonly content: Extract<WorkspaceResourceMaterializationContent, { kind: 'text' | 'structured' }> | null
}

export type WorkspaceResourceTreeChange = {
  readonly kind: 'created' | 'updated' | 'moved' | 'deleted'
  readonly resourceId: string
  readonly beforePath: string | null
  readonly afterPath: string | null
}

export type WorkspaceResourceClient = Pick<
  Prisma.TransactionClient,
  'project' | 'workspaceResource' | 'workspaceResourceVersion' | 'workspaceResourceLineage' | 'mediaObject'
> | typeof prisma

type ResourceProvenance = {
  readonly operationId: string | null
  readonly inputHash: string | null
  readonly taskId: string | null
  readonly operationExecutionId: string | null
  readonly toolCallId: string | null
  readonly prompt: string | null
  readonly modelKey: string | null
  readonly generationOptions: WorkspaceResourceJsonValue | null
}

function jsonValue(value: WorkspaceResourceJsonValue | null): Prisma.InputJsonValue | Prisma.NullTypes.JsonNull {
  return value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue
}

async function requireOwnedProject(
  client: WorkspaceResourceClient,
  projectId: string,
  userId: string,
): Promise<void> {
  const project = await client.project.findFirst({ where: { id: projectId, userId }, select: { id: true } })
  if (!project) throw new Error('WORKSPACE_RESOURCE_PROJECT_NOT_OWNED')
}

async function lockOwnedProject(
  tx: Prisma.TransactionClient,
  projectId: string,
  userId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM projects WHERE id = ${projectId} AND userId = ${userId} FOR UPDATE
  `)
  if (rows.length !== 1) throw new Error('WORKSPACE_RESOURCE_PROJECT_NOT_OWNED')
}

async function requireParentFolder(
  tx: Prisma.TransactionClient,
  input: { readonly projectId: string; readonly userId: string; readonly workspacePath: string },
): Promise<void> {
  const parentPath = parentWorkspacePath(input.workspacePath)
  if (!parentPath) return
  const parent = await tx.workspaceResource.findFirst({
    where: {
      projectId: input.projectId,
      userId: input.userId,
      activePath: parentPath,
      resourceKind: 'folder',
      deletedAt: null,
    },
    select: { id: true },
  })
  if (!parent) {
    throw new WorkspaceResourcePlacementError(
      'WORKSPACE_RESOURCE_PARENT_FOLDER_NOT_FOUND',
      parentPath,
    )
  }
}

async function requirePathAvailable(
  tx: Prisma.TransactionClient,
  projectId: string,
  workspacePath: string,
  excludedIds: readonly string[] = [],
): Promise<void> {
  const occupied = await tx.workspaceResource.findFirst({
    where: {
      projectId,
      activePath: workspacePath,
      ...(excludedIds.length > 0 ? { id: { notIn: [...excludedIds] } } : {}),
    },
    select: { id: true },
  })
  if (occupied) {
    throw new WorkspaceResourcePlacementError('WORKSPACE_RESOURCE_PATH_CONFLICT', workspacePath)
  }
}

function assertExactTreeTargets(entries: readonly WorkspaceResourceTreeEntry[]): void {
  const byPath = new Map<string, WorkspaceResourceTreeEntry>()
  for (const entry of entries) {
    const workspacePath = validateWorkspaceResourcePathForKind(entry.workspacePath, entry.resourceKind)
    if (workspacePath !== entry.workspacePath || byPath.has(workspacePath)) {
      throw new WorkspaceResourcePlacementError('WORKSPACE_RESOURCE_TREE_PATH_CONFLICT', workspacePath)
    }
    if ((entry.resourceKind === 'folder') !== (entry.mediaType === null)) {
      throw new Error(`WORKSPACE_RESOURCE_KIND_MEDIA_MISMATCH:${entry.resourceId}`)
    }
    if (entry.content && (entry.resourceKind !== 'file' || entry.mediaType !== 'text')) {
      throw new Error(`WORKSPACE_RESOURCE_TREE_CONTENT_INVALID:${entry.resourceId}`)
    }
    byPath.set(workspacePath, entry)
  }
  for (const entry of entries) {
    const parentPath = parentWorkspacePath(entry.workspacePath)
    if (!parentPath) continue
    const parent = byPath.get(parentPath)
    if (!parent || parent.resourceKind !== 'folder') {
      throw new WorkspaceResourcePlacementError(
        'WORKSPACE_RESOURCE_PARENT_FOLDER_NOT_FOUND',
        parentPath,
      )
    }
  }
}

/**
 * Atomically reconciles one Runtime checkpoint against the complete active
 * WorkspaceResource tree. This is the only batch writer used by Codex
 * writeback; callers must never reconstruct versions or paths themselves.
 */
export async function reconcileWorkspaceResourceTreeInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    readonly userId: string
    readonly projectId: string
    readonly baseline: readonly WorkspaceResourceTreeBaselineEntry[]
    readonly entries: readonly WorkspaceResourceTreeEntry[]
    readonly sourceTurnId?: string | null
  },
): Promise<readonly WorkspaceResourceTreeChange[]> {
  await lockOwnedProject(tx, input.projectId, input.userId)
  assertExactTreeTargets(input.entries)
  const baselineById = new Map(input.baseline.map((entry) => [entry.resourceId, entry]))
  if (baselineById.size !== input.baseline.length) throw new Error('WORKSPACE_RESOURCE_BASELINE_DUPLICATE')
  const entryById = new Map(input.entries.map((entry) => [entry.resourceId, entry]))
  if (entryById.size !== input.entries.length) throw new Error('WORKSPACE_RESOURCE_TREE_ID_DUPLICATE')

  const current = await tx.workspaceResource.findMany({
    where: { projectId: input.projectId, userId: input.userId, deletedAt: null, activePath: { not: null } },
  })
  const currentById = new Map(current.map((resource) => [resource.id, resource]))
  if (current.length !== input.baseline.length) throw new Error('WORKSPACE_RESOURCE_BASELINE_DIVERGED')
  for (const baseline of input.baseline) {
    const row = currentById.get(baseline.resourceId)
    if (
      !row
      || row.workspacePath !== baseline.workspacePath
      || row.activePath !== baseline.workspacePath
      || row.resourceKind !== baseline.resourceKind
      || row.mediaType !== baseline.mediaType
      // User-owned text content participates in optimistic concurrency. A
      // media pointer is immutable to the Runtime and contains only the stable
      // Resource identity, so its Task terminal writer may materialize a new
      // media version without conflicting with an unchanged Agent workspace.
      || (baseline.mediaType === 'text' && row.currentVersion !== baseline.contentVersion)
    ) {
      throw new Error(`WORKSPACE_RESOURCE_BASELINE_DIVERGED:${baseline.resourceId}`)
    }
  }
  const newIds = input.entries
    .filter((entry) => !baselineById.has(entry.resourceId))
    .map((entry) => entry.resourceId)
  if (newIds.length > 0) {
    const existing = await tx.workspaceResource.findFirst({ where: { id: { in: newIds } }, select: { id: true } })
    if (existing) throw new Error(`WORKSPACE_RESOURCE_TREE_ID_CONFLICT:${existing.id}`)
  }

  const changedOrDeletedIds = input.baseline
    .filter((baseline) => {
      const entry = entryById.get(baseline.resourceId)
      return !entry || entry.workspacePath !== baseline.workspacePath
    })
    .map((entry) => entry.resourceId)
  await requireNoActiveResourceTasks(tx, changedOrDeletedIds)
  for (const resourceId of changedOrDeletedIds) {
    const row = currentById.get(resourceId)
    if (row?.status === 'pending' && !entryById.has(resourceId)) {
      throw new Error('WORKSPACE_RESOURCE_PENDING_DELETE_CONFLICT')
    }
  }

  const changes: WorkspaceResourceTreeChange[] = []
  const now = new Date()
  await tx.workspaceResource.updateMany({
    where: { id: { in: current.map((resource) => resource.id) } },
    data: { activePath: null },
  })

  for (const baseline of input.baseline) {
    if (entryById.has(baseline.resourceId)) continue
    await tx.workspaceResource.update({
      where: { id: baseline.resourceId },
      data: { deletedAt: now },
    })
    changes.push({
      kind: 'deleted',
      resourceId: baseline.resourceId,
      beforePath: baseline.workspacePath,
      afterPath: null,
    })
  }

  for (const entry of input.entries) {
    const baseline = baselineById.get(entry.resourceId)
    if (!baseline) {
      if (entry.resourceKind === 'folder') {
        await tx.workspaceResource.create({
          data: {
            id: entry.resourceId,
            userId: input.userId,
            projectId: input.projectId,
            workspacePath: entry.workspacePath,
            activePath: entry.workspacePath,
            resourceKind: 'folder',
            mediaType: null,
            schemaId: WORKSPACE_RESOURCE_FOLDER_SCHEMA_ID,
            name: resourceNameFromPath(entry.workspacePath, 'folder'),
            status: 'ready',
            currentVersion: 0,
            sourceType: 'agent_folder',
            sourceId: entry.resourceId,
            materializedAt: now,
          },
        })
      } else {
        if (entry.mediaType !== 'text' || !entry.content) {
          throw new Error(`WORKSPACE_RESOURCE_NEW_FILE_CONTENT_REQUIRED:${entry.resourceId}`)
        }
        const serialized = entry.content.kind === 'text'
          ? entry.content.text
          : `${JSON.stringify(entry.content.data, null, 2)}\n`
        const media = await storeWorkspaceResourceContent({
          projectId: input.projectId,
          resourceId: entry.resourceId,
          version: 1,
          workspacePath: entry.workspacePath,
          content: serialized,
        })
        await tx.workspaceResource.create({
          data: {
            id: entry.resourceId,
            userId: input.userId,
            projectId: input.projectId,
            workspacePath: entry.workspacePath,
            activePath: entry.workspacePath,
            resourceKind: 'file',
            mediaType: 'text',
            schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_TEXT,
            name: resourceNameFromPath(entry.workspacePath),
            status: 'ready',
            currentVersion: 1,
            sourceType: 'agent_file',
            sourceId: entry.resourceId,
            materializedAt: now,
            versions: {
              create: {
                id: randomUUID(),
                version: 1,
                contentKind: entry.content.kind,
                mediaId: media.id,
                sha256: media.sha256,
                sizeBytes: media.sizeBytes === null || media.sizeBytes === undefined ? null : BigInt(media.sizeBytes),
                sourceTurnId: input.sourceTurnId?.trim() || null,
              },
            },
          },
        })
      }
      changes.push({ kind: 'created', resourceId: entry.resourceId, beforePath: null, afterPath: entry.workspacePath })
      continue
    }

    const row = currentById.get(entry.resourceId)
    if (!row) throw new Error(`WORKSPACE_RESOURCE_BASELINE_DIVERGED:${entry.resourceId}`)
    if (entry.resourceKind !== baseline.resourceKind || entry.mediaType !== baseline.mediaType) {
      throw new Error(`WORKSPACE_RESOURCE_TREE_KIND_CHANGE_FORBIDDEN:${entry.resourceId}`)
    }
    let nextVersion = row.currentVersion
    if (entry.content) {
      const expectedKind = contentKindFromPath(entry.workspacePath)
      if (expectedKind !== entry.content.kind) throw new Error('WORKSPACE_RESOURCE_CONTENT_PATH_MISMATCH')
      nextVersion += 1
      const serialized = entry.content.kind === 'text'
        ? entry.content.text
        : `${JSON.stringify(entry.content.data, null, 2)}\n`
      const media = await storeWorkspaceResourceContent({
        projectId: input.projectId,
        resourceId: entry.resourceId,
        version: nextVersion,
        workspacePath: entry.workspacePath,
        content: serialized,
      })
      await tx.workspaceResourceVersion.create({
        data: {
          id: randomUUID(),
          resourceId: entry.resourceId,
          version: nextVersion,
          contentKind: entry.content.kind,
          mediaId: media.id,
          sha256: media.sha256,
          sizeBytes: media.sizeBytes === null || media.sizeBytes === undefined ? null : BigInt(media.sizeBytes),
          sourceTurnId: input.sourceTurnId?.trim() || null,
        },
      })
    }
    await tx.workspaceResource.update({
      where: { id: entry.resourceId },
      data: {
        workspacePath: entry.workspacePath,
        activePath: entry.workspacePath,
        name: resourceNameFromPath(entry.workspacePath, entry.resourceKind),
        currentVersion: nextVersion,
        ...(entry.content ? { status: 'ready', materializedAt: now, errorCode: null, errorMessage: null } : {}),
        deletedAt: null,
      },
    })
    if (baseline.workspacePath !== entry.workspacePath) {
      changes.push({
        kind: 'moved',
        resourceId: entry.resourceId,
        beforePath: baseline.workspacePath,
        afterPath: entry.workspacePath,
      })
    }
    if (entry.content) {
      changes.push({
        kind: 'updated',
        resourceId: entry.resourceId,
        beforePath: baseline.workspacePath,
        afterPath: entry.workspacePath,
      })
    }
  }
  return changes
}

export type ReserveWorkspaceResourceInput = {
  readonly resourceId?: string
  readonly userId: string
  readonly projectId: string
  readonly outputPath: string
  readonly mediaType: WorkspaceResourceMediaType
  readonly schemaId: string
  readonly sourceType?: string | null
  readonly sourceId?: string | null
  readonly memberIndex?: number | null
  readonly operationExecutionId?: string | null
  readonly alternativeGroupExecutionId?: string | null
  readonly toolCallId?: string | null
  readonly prompt?: string | null
  readonly modelKey?: string | null
  readonly generationOptions?: WorkspaceResourceJsonValue | null
  readonly operationId?: string | null
  readonly inputHash?: string | null
  readonly taskId?: string | null
}

export async function validateWorkspaceResourcePlacement(
  client: WorkspaceResourceClient,
  input: {
    readonly userId: string
    readonly projectId: string
    readonly outputPath: string
    readonly mediaType: WorkspaceResourceMediaType
    readonly schemaId: string
  },
): Promise<string> {
  await requireOwnedProject(client, input.projectId, input.userId)
  const workspacePath = requireOutputPathForMediaType(input.outputPath, input.mediaType)
  const schema = requireWorkspaceResourceSchema(input.schemaId)
  if (schema.resourceKind !== 'file' || schema.mediaType !== input.mediaType) {
    throw new Error(`WORKSPACE_RESOURCE_SCHEMA_MEDIA_MISMATCH:${input.schemaId}:${input.mediaType}`)
  }
  const parentPath = parentWorkspacePath(workspacePath)
  if (parentPath) {
    const parent = await client.workspaceResource.findFirst({
      where: {
        projectId: input.projectId,
        userId: input.userId,
        activePath: parentPath,
        resourceKind: 'folder',
        deletedAt: null,
      },
      select: { id: true },
    })
    if (!parent) {
      throw new WorkspaceResourcePlacementError(
        'WORKSPACE_RESOURCE_PARENT_FOLDER_NOT_FOUND',
        parentPath,
      )
    }
  }
  const occupied = await client.workspaceResource.findFirst({
    where: { projectId: input.projectId, activePath: workspacePath },
    select: { id: true },
  })
  if (occupied) {
    throw new WorkspaceResourcePlacementError('WORKSPACE_RESOURCE_PATH_CONFLICT', workspacePath)
  }
  return workspacePath
}

export async function reserveWorkspaceResourceInTransaction(
  tx: Prisma.TransactionClient,
  input: ReserveWorkspaceResourceInput,
): Promise<{ readonly resourceId: string; readonly workspacePath: string }> {
  await lockOwnedProject(tx, input.projectId, input.userId)
  const workspacePath = requireOutputPathForMediaType(input.outputPath, input.mediaType)
  const schema = requireWorkspaceResourceSchema(input.schemaId)
  if (schema.resourceKind !== 'file' || schema.mediaType !== input.mediaType) {
    throw new Error(`WORKSPACE_RESOURCE_SCHEMA_MEDIA_MISMATCH:${input.schemaId}:${input.mediaType}`)
  }
  await requireParentFolder(tx, { projectId: input.projectId, userId: input.userId, workspacePath })
  const resourceId = input.resourceId?.trim() || createWorkspaceResourceId()
  const existing = await tx.workspaceResource.findUnique({ where: { id: resourceId } })
  if (existing) {
    if (
      existing.userId !== input.userId
      || existing.projectId !== input.projectId
      || existing.workspacePath !== workspacePath
      || existing.resourceKind !== 'file'
      || existing.mediaType !== input.mediaType
      || existing.schemaId !== input.schemaId
    ) {
      throw new Error(`WORKSPACE_RESOURCE_RESERVATION_CONFLICT:${resourceId}`)
    }
    return { resourceId, workspacePath }
  }
  await requirePathAvailable(tx, input.projectId, workspacePath)
  await tx.workspaceResource.create({
    data: {
      id: resourceId,
      userId: input.userId,
      projectId: input.projectId,
      workspacePath,
      activePath: workspacePath,
      resourceKind: 'file',
      mediaType: input.mediaType,
      schemaId: input.schemaId.trim(),
      name: resourceNameFromPath(workspacePath),
      status: 'pending',
      currentVersion: 0,
      sourceType: input.sourceType?.trim() || null,
      sourceId: input.sourceId?.trim() || null,
      memberIndex: input.memberIndex ?? null,
      prompt: input.prompt?.trim() || null,
      modelKey: input.modelKey?.trim() || null,
      generationOptions: jsonValue(input.generationOptions ?? null),
      operationId: input.operationId?.trim() || null,
      inputHash: input.inputHash?.trim() || null,
      taskId: input.taskId?.trim() || null,
      operationExecutionId: input.operationExecutionId?.trim() || null,
      alternativeGroupExecutionId: input.alternativeGroupExecutionId?.trim() || null,
      toolCallId: input.toolCallId?.trim() || null,
    },
  })
  return { resourceId, workspacePath }
}

export async function createWorkspaceResourceFolderInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    readonly userId: string
    readonly projectId: string
    readonly workspacePath: string
    readonly resourceId?: string
    readonly sourceType?: string | null
    readonly sourceId?: string | null
  },
): Promise<{ readonly resourceId: string; readonly workspacePath: string }> {
  await lockOwnedProject(tx, input.projectId, input.userId)
  const workspacePath = validateWorkspaceResourceFolderPath(input.workspacePath)
  await requireParentFolder(tx, { projectId: input.projectId, userId: input.userId, workspacePath })
  await requirePathAvailable(tx, input.projectId, workspacePath)
  const resourceId = input.resourceId?.trim() || createWorkspaceResourceId()
  await tx.workspaceResource.create({
    data: {
      id: resourceId,
      userId: input.userId,
      projectId: input.projectId,
      workspacePath,
      activePath: workspacePath,
      resourceKind: 'folder',
      mediaType: null,
      schemaId: WORKSPACE_RESOURCE_FOLDER_SCHEMA_ID,
      name: resourceNameFromPath(workspacePath, 'folder'),
      status: 'ready',
      currentVersion: 0,
      sourceType: input.sourceType?.trim() || null,
      sourceId: input.sourceId?.trim() || null,
      materializedAt: new Date(),
    },
  })
  return { resourceId, workspacePath }
}

export async function resolveWorkspaceResourceInputs(
  client: WorkspaceResourceClient,
  input: {
    readonly userId: string
    readonly projectId: string
    readonly references: readonly {
      readonly workspacePath: string
      readonly resourceId?: string
      readonly contentVersion?: number
      readonly role: string
      readonly position: number
    }[]
  },
): Promise<readonly WorkspaceResourceInputRef[]> {
  const paths = input.references.map((reference) => validateWorkspaceResourceFilePath(reference.workspacePath))
  const resources = paths.length === 0 ? [] : await client.workspaceResource.findMany({
    where: {
      projectId: input.projectId,
      userId: input.userId,
      activePath: { in: paths },
      resourceKind: 'file',
      deletedAt: null,
    },
    select: { id: true, workspacePath: true, currentVersion: true, status: true },
  })
  const byPath = new Map(resources.map((resource) => [resource.workspacePath, resource]))
  const seenPositions = new Set<string>()
  const resolved: WorkspaceResourceInputRef[] = []
  for (const [index, reference] of input.references.entries()) {
    const workspacePath = paths[index]
    if (!workspacePath) throw new Error('WORKSPACE_RESOURCE_INPUT_PATH_INVALID')
    const resource = byPath.get(workspacePath)
    if (!resource || (reference.resourceId && reference.resourceId !== resource.id)) {
      throw new Error(`WORKSPACE_RESOURCE_INPUT_NOT_FOUND:${workspacePath}`)
    }
    const contentVersion = reference.contentVersion ?? resource.currentVersion
    if (resource.status !== 'ready' || !Number.isSafeInteger(contentVersion) || contentVersion < 1) {
      throw new Error(`WORKSPACE_RESOURCE_INPUT_NOT_READY:${workspacePath}`)
    }
    const version = await client.workspaceResourceVersion.findUnique({
      where: { resourceId_version: { resourceId: resource.id, version: contentVersion } },
      select: { id: true },
    })
    if (!version) throw new Error(`WORKSPACE_RESOURCE_INPUT_VERSION_NOT_FOUND:${resource.id}:${String(contentVersion)}`)
    const role = reference.role.trim()
    const positionKey = `${role}:${String(reference.position)}`
    if (!role || !Number.isSafeInteger(reference.position) || reference.position < 0 || seenPositions.has(positionKey)) {
      throw new Error('WORKSPACE_RESOURCE_INPUT_REFERENCE_INVALID')
    }
    seenPositions.add(positionKey)
    resolved.push({ resourceId: resource.id, contentVersion, workspacePath, role, position: reference.position })
  }
  return resolved
}

export async function validateWorkspaceResourceInputReferencesInTransaction(
  tx: Prisma.TransactionClient,
  input: { readonly userId: string; readonly projectId: string },
  references: readonly WorkspaceResourceInputRef[],
): Promise<void> {
  const seen = new Set<string>()
  for (const reference of references) {
    const key = `${reference.role}:${String(reference.position)}`
    if (seen.has(key)) throw new Error('WORKSPACE_RESOURCE_INPUT_REFERENCE_DUPLICATE')
    seen.add(key)
    const version = await tx.workspaceResourceVersion.findFirst({
      where: {
        resourceId: reference.resourceId,
        version: reference.contentVersion,
        resource: {
          userId: input.userId,
          projectId: input.projectId,
          resourceKind: 'file',
        },
      },
      select: { id: true },
    })
    if (!version) {
      throw new Error(`WORKSPACE_RESOURCE_INPUT_VERSION_NOT_FOUND:${reference.resourceId}:${String(reference.contentVersion)}`)
    }
  }
}

function contentKind(content: WorkspaceResourceMaterializationContent): 'text' | 'structured' | 'media' {
  return content.kind
}

export async function materializeWorkspaceResourceInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    readonly resourceId: string
    readonly userId: string
    readonly mediaType: WorkspaceResourceMediaType
    readonly schemaId: string
    readonly content: WorkspaceResourceMaterializationContent
    readonly inputs: readonly WorkspaceResourceInputRef[]
    readonly sourceTurnId?: string | null
    readonly provenance: ResourceProvenance
  },
): Promise<{ readonly resourceId: string; readonly contentVersion: number }> {
  const resource = await tx.workspaceResource.findUnique({ where: { id: input.resourceId } })
  if (!resource || resource.userId !== input.userId || resource.deletedAt || resource.resourceKind !== 'file') {
    throw new Error(`WORKSPACE_RESOURCE_NOT_OWNED:${input.resourceId}`)
  }
  if (resource.mediaType !== input.mediaType || resource.schemaId !== input.schemaId) {
    throw new Error(`WORKSPACE_RESOURCE_MATERIALIZATION_CONTRACT_MISMATCH:${resource.id}`)
  }
  if (resource.status === 'ready' && resource.currentVersion > 0) {
    if (resource.taskId === input.provenance.taskId && input.provenance.taskId) {
      return { resourceId: resource.id, contentVersion: resource.currentVersion }
    }
    throw new Error(`WORKSPACE_RESOURCE_ALREADY_MATERIALIZED:${resource.id}`)
  }
  await validateWorkspaceResourceInputReferencesInTransaction(tx, {
    userId: input.userId,
    projectId: resource.projectId,
  }, input.inputs)
  const nextContentVersion = resource.currentVersion + 1
  let mediaId: string
  let sha256: string | null
  let sizeBytes: bigint | null
  if (input.content.kind === 'media') {
    const media = await tx.mediaObject.findUnique({ where: { id: input.content.mediaId } })
    if (!media) throw new Error(`WORKSPACE_RESOURCE_MEDIA_NOT_FOUND:${input.content.mediaId}`)
    mediaId = media.id
    sha256 = media.sha256
    sizeBytes = media.sizeBytes
  } else {
    if (input.mediaType !== 'text') throw new Error('WORKSPACE_RESOURCE_TEXT_MEDIA_TYPE_REQUIRED')
    const expectedKind = contentKindFromPath(resource.workspacePath)
    if (expectedKind === 'pointer' || expectedKind !== input.content.kind) {
      throw new Error(`WORKSPACE_RESOURCE_CONTENT_PATH_MISMATCH:${resource.workspacePath}`)
    }
    const serialized = input.content.kind === 'text'
      ? input.content.text
      : `${JSON.stringify(input.content.data, null, 2)}\n`
    const media = await storeWorkspaceResourceContent({
      projectId: resource.projectId,
      resourceId: resource.id,
      version: nextContentVersion,
      workspacePath: resource.workspacePath,
      content: serialized,
    })
    mediaId = media.id
    sha256 = media.sha256 ?? null
    sizeBytes = media.sizeBytes === null || media.sizeBytes === undefined ? null : BigInt(media.sizeBytes)
  }
  await tx.workspaceResourceVersion.create({
    data: {
      id: randomUUID(),
      resourceId: resource.id,
      version: nextContentVersion,
      contentKind: contentKind(input.content),
      mediaId,
      sha256,
      sizeBytes,
      sourceTurnId: input.sourceTurnId?.trim() || null,
    },
  })
  if (input.inputs.length > 0) {
    await tx.workspaceResourceLineage.createMany({
      data: input.inputs.map((reference) => ({
        id: randomUUID(),
        outputResourceId: resource.id,
        outputVersion: nextContentVersion,
        inputResourceId: reference.resourceId,
        inputVersion: reference.contentVersion,
        role: reference.role,
        position: reference.position,
      })),
    })
  }
  const updated = await tx.workspaceResource.updateMany({
    where: {
      id: resource.id,
      currentVersion: resource.currentVersion,
      status: { in: ['pending', 'failed', 'canceled'] },
      deletedAt: null,
    },
    data: {
      currentVersion: nextContentVersion,
      status: 'ready',
      materializedAt: new Date(),
      prompt: input.provenance.prompt,
      modelKey: input.provenance.modelKey,
      generationOptions: jsonValue(input.provenance.generationOptions),
      operationId: input.provenance.operationId,
      inputHash: input.provenance.inputHash,
      taskId: input.provenance.taskId,
      operationExecutionId: input.provenance.operationExecutionId,
      toolCallId: input.provenance.toolCallId,
      errorCode: null,
      errorMessage: null,
    },
  })
  if (updated.count !== 1) throw new Error(`WORKSPACE_RESOURCE_MATERIALIZATION_CONFLICT:${resource.id}`)
  return { resourceId: resource.id, contentVersion: nextContentVersion }
}

export async function materializeWorkspaceResourceMediaInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    readonly resourceId: string
    readonly userId: string
    readonly mediaId: string
    readonly inputs: readonly WorkspaceResourceInputRef[]
    readonly sourceTurnId?: string | null
    readonly provenance: ResourceProvenance
  },
): Promise<{ readonly resourceId: string; readonly contentVersion: number }> {
  const resource = await tx.workspaceResource.findUnique({ where: { id: input.resourceId } })
  if (!resource?.mediaType) throw new Error(`WORKSPACE_RESOURCE_NOT_OWNED:${input.resourceId}`)
  return await materializeWorkspaceResourceInTransaction(tx, {
    ...input,
    mediaType: resource.mediaType as WorkspaceResourceMediaType,
    schemaId: resource.schemaId,
    content: { kind: 'media', mediaId: input.mediaId },
  })
}

export async function appendWorkspaceResourceUserContent(input: {
  readonly userId: string
  readonly projectId: string
  readonly resourceId: string
  readonly expectedContentVersion: number
  readonly content: Extract<WorkspaceResourceMaterializationContent, { kind: 'text' | 'structured' }>
  readonly sourceTurnId?: string | null
}): Promise<{ readonly resourceId: string; readonly contentVersion: number }> {
  return await prisma.$transaction(async (tx) => await appendWorkspaceResourceUserContentInTransaction(tx, input))
}

export async function appendWorkspaceResourceUserContentInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    readonly userId: string
    readonly projectId: string
    readonly resourceId: string
    readonly expectedContentVersion: number
    readonly content: Extract<WorkspaceResourceMaterializationContent, { kind: 'text' | 'structured' }>
    readonly sourceTurnId?: string | null
  },
): Promise<{ readonly resourceId: string; readonly contentVersion: number }> {
  await lockOwnedProject(tx, input.projectId, input.userId)
    const resource = await tx.workspaceResource.findFirst({
      where: { id: input.resourceId, projectId: input.projectId, userId: input.userId, deletedAt: null },
    })
    if (!resource || resource.resourceKind !== 'file' || resource.mediaType !== 'text') {
      throw new Error('WORKSPACE_RESOURCE_TEXT_NOT_FOUND')
    }
    if (resource.currentVersion !== input.expectedContentVersion) {
      throw new Error(`WORKSPACE_RESOURCE_CONTENT_VERSION_CONFLICT:${String(resource.currentVersion)}`)
    }
    const expectedKind = contentKindFromPath(resource.workspacePath)
    if (expectedKind !== input.content.kind) throw new Error('WORKSPACE_RESOURCE_CONTENT_PATH_MISMATCH')
    const nextVersion = resource.currentVersion + 1
    const serialized = input.content.kind === 'text'
      ? input.content.text
      : `${JSON.stringify(input.content.data, null, 2)}\n`
    const media = await storeWorkspaceResourceContent({
      projectId: resource.projectId,
      resourceId: resource.id,
      version: nextVersion,
      workspacePath: resource.workspacePath,
      content: serialized,
    })
    await tx.workspaceResourceVersion.create({
      data: {
        id: randomUUID(),
        resourceId: resource.id,
        version: nextVersion,
        contentKind: input.content.kind,
        mediaId: media.id,
        sha256: media.sha256,
        sizeBytes: media.sizeBytes === null || media.sizeBytes === undefined ? null : BigInt(media.sizeBytes),
        sourceTurnId: input.sourceTurnId?.trim() || null,
      },
    })
    const updated = await tx.workspaceResource.updateMany({
      where: { id: resource.id, currentVersion: input.expectedContentVersion, deletedAt: null },
      data: { currentVersion: nextVersion, status: 'ready', materializedAt: new Date(), errorCode: null, errorMessage: null },
    })
    if (updated.count !== 1) throw new Error('WORKSPACE_RESOURCE_CONTENT_VERSION_CONFLICT')
  return { resourceId: resource.id, contentVersion: nextVersion }
}

export async function createWorkspaceResourceUserFileInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    readonly userId: string
    readonly projectId: string
    readonly outputPath: string
    readonly schemaId: string
    readonly content: Extract<WorkspaceResourceMaterializationContent, { kind: 'text' | 'structured' }>
    readonly sourceTurnId?: string | null
    readonly sourceType?: string | null
    readonly sourceId?: string | null
  },
): Promise<{ readonly resourceId: string; readonly workspacePath: string; readonly contentVersion: number }> {
  const reserved = await reserveWorkspaceResourceInTransaction(tx, {
    userId: input.userId,
    projectId: input.projectId,
    outputPath: input.outputPath,
    mediaType: 'text',
    schemaId: input.schemaId,
    sourceType: input.sourceType ?? 'agent_file',
    sourceId: input.sourceId ?? null,
  })
  const materialized = await materializeWorkspaceResourceInTransaction(tx, {
    resourceId: reserved.resourceId,
    userId: input.userId,
    mediaType: 'text',
    schemaId: input.schemaId,
    content: input.content,
    inputs: [],
    sourceTurnId: input.sourceTurnId,
    provenance: {
      operationId: null,
      inputHash: null,
      taskId: null,
      operationExecutionId: null,
      toolCallId: null,
      prompt: null,
      modelKey: null,
      generationOptions: null,
    },
  })
  return { ...reserved, contentVersion: materialized.contentVersion }
}

export async function settleWorkspaceResourceFailureInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    readonly resourceId: string
    readonly userId: string
    readonly status: 'failed' | 'canceled'
    readonly errorCode: string | null
    readonly errorMessage: string | null
  },
): Promise<void> {
  const resource = await tx.workspaceResource.findUnique({ where: { id: input.resourceId } })
  if (!resource || resource.userId !== input.userId || resource.resourceKind !== 'file') {
    throw new Error('WORKSPACE_RESOURCE_NOT_OWNED')
  }
  if (resource.status === 'ready') return
  await tx.workspaceResource.update({
    where: { id: resource.id },
    data: {
      status: input.status,
      errorCode: input.status === 'failed' ? input.errorCode : null,
      errorMessage: input.status === 'failed' ? input.errorMessage?.slice(0, 2_000) ?? null : null,
    },
  })
}

async function requireNoActiveResourceTasks(
  tx: Prisma.TransactionClient,
  resourceIds: readonly string[],
): Promise<void> {
  if (resourceIds.length === 0) return
  const activeTask = await tx.task.findFirst({
    where: {
      targetType: 'WorkspaceResource',
      targetId: { in: [...resourceIds] },
      status: { in: ['queued', 'processing'] },
    },
    select: { id: true },
  })
  if (activeTask) throw new Error(`WORKSPACE_RESOURCE_ACTIVE_TASK_CONFLICT:${activeTask.id}`)
}

export async function moveWorkspaceResource(input: {
  readonly userId: string
  readonly projectId: string
  readonly resourceId: string
  readonly destinationPath: string
}): Promise<{ readonly resourceId: string; readonly workspacePath: string; readonly movedCount: number }> {
  return await prisma.$transaction(async (tx) => await moveWorkspaceResourceInTransaction(tx, input))
}

export async function moveWorkspaceResourceInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    readonly userId: string
    readonly projectId: string
    readonly resourceId: string
    readonly destinationPath: string
  },
): Promise<{ readonly resourceId: string; readonly workspacePath: string; readonly movedCount: number }> {
  await lockOwnedProject(tx, input.projectId, input.userId)
    const root = await tx.workspaceResource.findFirst({
      where: { id: input.resourceId, projectId: input.projectId, userId: input.userId, deletedAt: null, activePath: { not: null } },
    })
    if (!root) throw new Error('WORKSPACE_RESOURCE_NOT_FOUND')
    const destinationPath = root.resourceKind === 'folder'
      ? validateWorkspaceResourceFolderPath(input.destinationPath)
      : requireOutputPathForMediaType(input.destinationPath, root.mediaType as WorkspaceResourceMediaType)
    if (root.resourceKind === 'folder' && isWorkspaceSubtreePath(destinationPath, root.workspacePath)) {
      throw new Error('WORKSPACE_RESOURCE_MOVE_INTO_SELF')
    }
    await requireParentFolder(tx, { projectId: input.projectId, userId: input.userId, workspacePath: destinationPath })
    const subtree = await tx.workspaceResource.findMany({
      where: {
        projectId: input.projectId,
        userId: input.userId,
        deletedAt: null,
        OR: [{ workspacePath: root.workspacePath }, { workspacePath: { startsWith: `${root.workspacePath}/` } }],
      },
      orderBy: { workspacePath: 'asc' },
    })
    const ids = subtree.map((resource) => resource.id)
    await requireNoActiveResourceTasks(tx, ids)
    const destinations = subtree.map((resource) => ({
      resource,
      path: replaceWorkspacePathPrefix(resource.workspacePath, root.workspacePath, destinationPath),
    }))
    for (const destination of destinations) {
      await requirePathAvailable(tx, input.projectId, destination.path, ids)
    }
    await tx.workspaceResource.updateMany({ where: { id: { in: ids } }, data: { activePath: null } })
    for (const destination of destinations) {
      const kind = destination.resource.resourceKind === 'folder' ? 'folder' : 'file'
      await tx.workspaceResource.update({
        where: { id: destination.resource.id },
        data: {
          workspacePath: destination.path,
          activePath: destination.path,
          name: resourceNameFromPath(destination.path, kind),
        },
      })
    }
  return { resourceId: root.id, workspacePath: destinationPath, movedCount: subtree.length }
}

export async function softDeleteWorkspacePath(input: {
  readonly userId: string
  readonly projectId: string
  readonly workspacePath: string
}): Promise<number> {
  return await prisma.$transaction(async (tx) => await softDeleteWorkspacePathInTransaction(tx, input))
}

export async function softDeleteWorkspacePathInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    readonly userId: string
    readonly projectId: string
    readonly workspacePath: string
  },
): Promise<number> {
  await lockOwnedProject(tx, input.projectId, input.userId)
    const root = await tx.workspaceResource.findFirst({
      where: { userId: input.userId, projectId: input.projectId, activePath: input.workspacePath, deletedAt: null },
    })
    if (!root) throw new Error('WORKSPACE_RESOURCE_PATH_NOT_FOUND')
    const workspacePath = validateWorkspaceResourcePathForKind(input.workspacePath, root.resourceKind === 'folder' ? 'folder' : 'file')
    const resources = await tx.workspaceResource.findMany({
      where: {
        userId: input.userId,
        projectId: input.projectId,
        deletedAt: null,
        OR: [{ workspacePath }, { workspacePath: { startsWith: `${workspacePath}/` } }],
      },
      select: { id: true, status: true },
    })
    if (root.resourceKind === 'file' && resources.length !== 1) throw new Error('WORKSPACE_RESOURCE_FILE_HAS_DESCENDANTS')
    const ids = resources.map((resource) => resource.id)
    await requireNoActiveResourceTasks(tx, ids)
    if (resources.some((resource) => resource.status === 'pending')) {
      throw new Error('WORKSPACE_RESOURCE_PENDING_DELETE_CONFLICT')
    }
    const deletedAt = new Date()
    const result = await tx.workspaceResource.updateMany({
      where: { id: { in: ids }, deletedAt: null },
      data: { activePath: null, deletedAt },
    })
  if (result.count !== resources.length) throw new Error('WORKSPACE_RESOURCE_DELETE_CONFLICT')
  return result.count
}

export async function restoreWorkspaceResource(input: {
  readonly userId: string
  readonly projectId: string
  readonly resourceId: string
  readonly workspacePath?: string | null
}): Promise<{ readonly resourceId: string; readonly workspacePath: string; readonly restoredCount: number }> {
  return await prisma.$transaction(async (tx) => await restoreWorkspaceResourceInTransaction(tx, input))
}

export async function restoreWorkspaceResourceInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    readonly userId: string
    readonly projectId: string
    readonly resourceId: string
    readonly workspacePath?: string | null
  },
): Promise<{ readonly resourceId: string; readonly workspacePath: string; readonly restoredCount: number }> {
  await lockOwnedProject(tx, input.projectId, input.userId)
    const root = await tx.workspaceResource.findFirst({
      where: { id: input.resourceId, projectId: input.projectId, userId: input.userId },
    })
    if (!root || !root.deletedAt) throw new Error('WORKSPACE_RESOURCE_DELETED_NOT_FOUND')
    const destinationPath = input.workspacePath
      ? (root.resourceKind === 'folder'
          ? validateWorkspaceResourceFolderPath(input.workspacePath)
          : requireOutputPathForMediaType(input.workspacePath, root.mediaType as WorkspaceResourceMediaType))
      : root.workspacePath
    await requireParentFolder(tx, { projectId: input.projectId, userId: input.userId, workspacePath: destinationPath })
    const cohort = await tx.workspaceResource.findMany({
      where: {
        userId: input.userId,
        projectId: input.projectId,
        deletedAt: root.deletedAt,
        OR: [{ workspacePath: root.workspacePath }, { workspacePath: { startsWith: `${root.workspacePath}/` } }],
      },
      orderBy: { workspacePath: 'asc' },
    })
    const ids = cohort.map((resource) => resource.id)
    const destinations = cohort.map((resource) => ({
      resource,
      path: replaceWorkspacePathPrefix(resource.workspacePath, root.workspacePath, destinationPath),
    }))
    for (const destination of destinations) {
      await requirePathAvailable(tx, input.projectId, destination.path, ids)
    }
    for (const destination of destinations) {
      const kind = destination.resource.resourceKind === 'folder' ? 'folder' : 'file'
      await tx.workspaceResource.update({
        where: { id: destination.resource.id },
        data: {
          workspacePath: destination.path,
          activePath: destination.path,
          name: resourceNameFromPath(destination.path, kind),
          deletedAt: null,
        },
      })
    }
  return { resourceId: root.id, workspacePath: destinationPath, restoredCount: cohort.length }
}
