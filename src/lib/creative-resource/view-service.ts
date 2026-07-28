import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type {
  CreativeResourceBindingView,
  CreativeResourceCardView,
  CreativeResourceContent,
  CreativeResourceDataView,
  CreativeResourceInputRef,
  CreativeResourceJsonObject,
  CreativeResourceJsonValue,
  CreativeResourceMaterializationView,
  CreativeResourceMediaType,
  CreativeResourcePendingGeneration,
  CreativeResourceScopeRef,
  CreativeResourceStatus,
  CreativeResourceView,
  CreativeResourceWorkingBindingView,
  CreativeResourceWorkingSetView,
} from './contracts'
import {
  CREATIVE_RESOURCE_CANONICAL_BINDINGS,
  isCreativeResourceMediaType,
  isCreativeResourceScopeKind,
  isCreativeResourceStatus,
} from './contracts'
import {
  parseCreativeResourceGenerationTaskPayload,
  toCreativeResourceJsonValue,
} from './generation-contract'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'
import { parseCreativeResourceVideoMergeTaskPayload } from './video-merge-contract'
import { CREATIVE_RESOURCE_SCHEMA, getCreativeResourceSchema } from './schema-registry'
import { projectCreativeResourceSummary } from './summary-projection'

type CreativeResourceReadClient = Pick<
  Prisma.TransactionClient,
  'creativeResource' | 'creativeResourceBinding' | 'task'
> | typeof prisma

const resourceInclude = {
  media: {
    select: {
      id: true,
      publicId: true,
      mimeType: true,
      width: true,
      height: true,
      durationMs: true,
    },
  },
  outputLineage: {
    orderBy: [{ position: 'asc' as const }, { role: 'asc' as const }],
    include: {
      inputResource: {
        select: { id: true },
      },
    },
  },
  bindings: {
    orderBy: [{ role: 'asc' as const }, { slotKey: 'asc' as const }],
  },
} satisfies Prisma.CreativeResourceInclude

type ResourceRow = Prisma.CreativeResourceGetPayload<{ include: typeof resourceInclude }>

function jsonValue(value: Prisma.JsonValue | null): CreativeResourceJsonValue | null {
  return value as CreativeResourceJsonValue | null
}

function jsonObject(value: Prisma.JsonValue | null): CreativeResourceJsonObject {
  if (value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('CREATIVE_RESOURCE_DATA_ROOT_INVALID')
  }
  return value as CreativeResourceJsonObject
}

function requireMediaType(value: string): CreativeResourceMediaType {
  if (!isCreativeResourceMediaType(value)) {
    throw new Error(`CREATIVE_RESOURCE_MEDIA_TYPE_INVALID:${value}`)
  }
  return value
}

function requireStatus(value: string): CreativeResourceStatus {
  if (!isCreativeResourceStatus(value)) {
    throw new Error(`CREATIVE_RESOURCE_STATUS_INVALID:${value}`)
  }
  return value
}

function scopeFromRow(
  row: Pick<ResourceRow, 'scopeKind' | 'scopeId' | 'userId' | 'projectId' | 'episodeId'>,
): CreativeResourceScopeRef {
  if (!isCreativeResourceScopeKind(row.scopeKind)) {
    throw new Error(`CREATIVE_RESOURCE_SCOPE_KIND_INVALID:${row.scopeKind}`)
  }
  return {
    kind: row.scopeKind,
    id: row.scopeId,
    userId: row.userId,
    projectId: row.projectId,
    episodeId: row.episodeId,
  }
}

function resourceContent(row: ResourceRow): CreativeResourceContent {
  if (row.media) {
    return {
      kind: 'media',
      mediaId: row.media.id,
      url: `/m/${encodeURIComponent(row.media.publicId)}`,
      mimeType: row.media.mimeType,
      width: row.media.width,
      height: row.media.height,
      durationMs: row.media.durationMs,
    }
  }
  if (row.contentText !== null) return { kind: 'text', text: row.contentText }
  if (row.contentJson !== null) {
    return { kind: 'structured', data: jsonValue(row.contentJson) ?? null }
  }
  throw new Error(`CREATIVE_RESOURCE_CONTENT_MISSING:${row.id}`)
}

function materializationView(row: ResourceRow): CreativeResourceMaterializationView | null {
  if (!row.materializedAt) return null
  const inputs: CreativeResourceInputRef[] = row.outputLineage.map((lineage) => ({
    resourceId: lineage.inputResource.id,
    role: lineage.role,
    position: lineage.position,
  }))
  return {
    content: resourceContent(row),
    provenance: {
      operationId: row.operationId,
      inputHash: row.inputHash,
      taskId: row.taskId,
      operationExecutionId: row.operationExecutionId,
      executionSegmentId: row.executionSegmentId,
      toolCallId: row.toolCallId,
      prompt: row.prompt,
      modelKey: row.modelKey,
      generationOptions: jsonValue(row.generationOptions),
    },
    inputs,
    materializedAt: row.materializedAt.toISOString(),
  }
}

function bindingView(
  row: ResourceRow['bindings'][number],
  scope: CreativeResourceScopeRef,
): CreativeResourceBindingView {
  return {
    bindingId: row.id,
    scope,
    role: row.role,
    slotKey: row.slotKey,
    resourceId: row.resourceId,
    version: row.version,
    source: row.source,
  }
}

export function projectCreativeResourceView(
  row: ResourceRow,
  pendingGeneration: CreativeResourcePendingGeneration | null = null,
): CreativeResourceView {
  const scope = scopeFromRow(row)
  return {
    resourceId: row.id,
    origin: row.sourceType && row.sourceId
      ? { sourceType: row.sourceType, sourceId: row.sourceId }
      : null,
    scope,
    mediaType: requireMediaType(row.mediaType),
    schemaId: row.schemaId,
    name: row.name,
    status: requireStatus(row.status),
    candidateSetId: row.candidateSetId,
    candidateIndex: row.candidateIndex,
    creativeDataVersion: row.creativeDataVersion,
    creativeDataKeys: Object.keys(jsonObject(row.creativeData)).sort(),
    materialization: materializationView(row),
    pendingGeneration,
    bindings: row.bindings.map((binding) => bindingView(binding, scope)),
    error: row.errorCode || row.errorMessage
      ? { code: row.errorCode, message: row.errorMessage ?? row.errorCode ?? '' }
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function projectCreativeResourceCardView(
  row: ResourceRow,
  pendingGeneration: CreativeResourcePendingGeneration | null = null,
): CreativeResourceCardView {
  const resource = projectCreativeResourceView(row, pendingGeneration)
  const schema = getCreativeResourceSchema(resource.schemaId)
  return {
    resource,
    candidates: null,
    presentation: {
      rendererKey: schema?.schemaId ?? 'generic.resource',
      fallbackMediaType: resource.mediaType,
      summary: projectCreativeResourceSummary(resource),
    },
  }
}

async function loadPendingGenerations(
  client: CreativeResourceReadClient,
  resourceIds: readonly string[],
): Promise<ReadonlyMap<string, CreativeResourcePendingGeneration>> {
  if (resourceIds.length === 0) return new Map()
  const tasks = await client.task.findMany({
    where: {
      targetType: 'CreativeResource',
      targetId: { in: [...resourceIds] },
      status: { in: [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] },
      type: {
        in: [
          TASK_TYPE.CREATIVE_RESOURCE_IMAGE,
          TASK_TYPE.CREATIVE_RESOURCE_AUDIO,
          TASK_TYPE.CREATIVE_RESOURCE_VOICE,
          TASK_TYPE.CREATIVE_RESOURCE_VIDEO,
          TASK_TYPE.CREATIVE_RESOURCE_VIDEO_MERGE,
        ],
      },
    },
    select: { id: true, type: true, targetId: true, operationId: true, payload: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })
  const pendingByResourceId = new Map<string, CreativeResourcePendingGeneration>()
  for (const task of tasks) {
    if (pendingByResourceId.has(task.targetId)) {
      throw new Error(`CREATIVE_RESOURCE_ACTIVE_TASK_OWNER_AMBIGUOUS:${task.targetId}`)
    }
    const payload = task.type === TASK_TYPE.CREATIVE_RESOURCE_VIDEO_MERGE
      ? parseCreativeResourceVideoMergeTaskPayload(task.payload)
      : parseCreativeResourceGenerationTaskPayload(task.payload)
    pendingByResourceId.set(task.targetId, {
      taskId: task.id,
      operationId: task.operationId,
      prompt: payload.resource.prompt,
      modelKey: payload.resource.modelKey,
      generationOptions: toCreativeResourceJsonValue(payload.resource.generationOptions),
      inputs: payload.resource.inputs,
    })
  }
  return pendingByResourceId
}

export async function listProjectCreativeResourceCards(input: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId?: string | null
  readonly mediaType?: CreativeResourceMediaType | null
  readonly schemaId?: string | null
  readonly status?: CreativeResourceStatus | null
  readonly limit?: number
  readonly includeParentScopes?: boolean
  readonly client?: CreativeResourceReadClient
}): Promise<CreativeResourceCardView[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 100, 200))
  const client = input.client ?? prisma
  const scopeFilters: Prisma.CreativeResourceWhereInput[] = [{
    projectId: input.projectId,
    ...(input.episodeId === undefined ? {} : { episodeId: input.episodeId }),
  }]
  if (input.includeParentScopes) {
    if (input.episodeId) scopeFilters.push({ projectId: input.projectId, episodeId: null })
    scopeFilters.push({
      scopeKind: 'user',
      scopeId: input.userId,
      projectId: null,
      episodeId: null,
    })
  }
  const rows = await client.creativeResource.findMany({
    where: {
      userId: input.userId,
      OR: scopeFilters,
      ...(input.mediaType ? { mediaType: input.mediaType } : {}),
      ...(input.schemaId?.trim() ? { schemaId: input.schemaId.trim() } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
    include: resourceInclude,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit,
  })
  const pending = await loadPendingGenerations(client, rows.map((row) => row.id))
  const views = rows.map((row) => projectCreativeResourceCardView(row, pending.get(row.id) ?? null))
  const byCandidateSet = new Map<string, CreativeResourceCardView[]>()
  for (const view of views) {
    const candidateSetId = view.resource.candidateSetId
    if (!candidateSetId) continue
    const group = byCandidateSet.get(candidateSetId) ?? []
    group.push(view)
    byCandidateSet.set(candidateSetId, group)
  }
  return views.map((view) => {
    const candidateSetId = view.resource.candidateSetId
    if (!candidateSetId) return view
    const candidateViews = byCandidateSet.get(candidateSetId) ?? [view]
    const resources = candidateViews.map((candidate) => candidate.resource)
    return {
      ...view,
      candidates: {
        candidateSetId,
        resources,
        summaries: candidateViews.map((candidate) => ({
          resourceId: candidate.resource.resourceId,
          summary: candidate.presentation.summary,
        })),
        selectedResourceId: resources
          .flatMap((resource) => resource.bindings.map((binding) => binding.resourceId))[0] ?? null,
      },
    }
  })
}

export async function getProjectCreativeResourceCard(input: {
  readonly projectId: string
  readonly userId: string
  readonly resourceId: string
  readonly client?: CreativeResourceReadClient
}): Promise<CreativeResourceCardView | null> {
  const client = input.client ?? prisma
  const row = await client.creativeResource.findFirst({
    where: {
      id: input.resourceId,
      userId: input.userId,
      OR: [
        { projectId: input.projectId },
        { scopeKind: 'user', scopeId: input.userId, projectId: null, episodeId: null },
      ],
    },
    include: resourceInclude,
  })
  if (!row) return null
  const pending = await loadPendingGenerations(client, [row.id])
  return projectCreativeResourceCardView(row, pending.get(row.id) ?? null)
}

export async function getProjectCreativeResourceDataView(input: {
  readonly projectId: string
  readonly userId: string
  readonly resourceId: string
  readonly client?: CreativeResourceReadClient
}): Promise<CreativeResourceDataView | null> {
  const client = input.client ?? prisma
  const row = await client.creativeResource.findFirst({
    where: {
      id: input.resourceId,
      userId: input.userId,
      OR: [
        { projectId: input.projectId },
        { scopeKind: 'user', scopeId: input.userId, projectId: null, episodeId: null },
      ],
    },
    select: { id: true, creativeData: true, creativeDataVersion: true },
  })
  if (!row) return null
  return {
    resourceId: row.id,
    creativeData: jsonObject(row.creativeData),
    creativeDataVersion: row.creativeDataVersion,
  }
}

function bindingScopeFromRow(row: {
  readonly scopeKind: string
  readonly scopeId: string
  readonly userId: string
  readonly projectId: string | null
  readonly episodeId: string | null
}): CreativeResourceScopeRef {
  if (!isCreativeResourceScopeKind(row.scopeKind)) {
    throw new Error(`CREATIVE_RESOURCE_BINDING_SCOPE_KIND_INVALID:${row.scopeKind}`)
  }
  return {
    kind: row.scopeKind,
    id: row.scopeId,
    userId: row.userId,
    projectId: row.projectId,
    episodeId: row.episodeId,
  }
}

function workingBindingView(row: {
  readonly id: string
  readonly userId: string
  readonly projectId: string | null
  readonly episodeId: string | null
  readonly scopeKind: string
  readonly scopeId: string
  readonly role: string
  readonly slotKey: string
  readonly source: string
  readonly version: number
  readonly resourceId: string
  readonly resource: {
    readonly name: string
    readonly mediaType: string
    readonly schemaId: string
  }
}): CreativeResourceWorkingBindingView {
  return {
    bindingId: row.id,
    scope: bindingScopeFromRow(row),
    role: row.role,
    slotKey: row.slotKey,
    version: row.version,
    source: row.source,
    resourceId: row.resourceId,
    schemaId: row.resource.schemaId,
    mediaType: requireMediaType(row.resource.mediaType),
    name: row.resource.name,
  }
}

function canonicalBinding(
  bindings: readonly CreativeResourceWorkingBindingView[],
  target: { readonly role: string; readonly slotKey: string },
  expectedSchemaId: string,
): CreativeResourceWorkingBindingView | null {
  const binding = bindings.find((candidate) => (
    candidate.role === target.role && candidate.slotKey === target.slotKey
  )) ?? null
  if (binding && binding.schemaId !== expectedSchemaId) {
    throw new Error(
      `CREATIVE_RESOURCE_CANONICAL_BINDING_SCHEMA_INVALID:${target.role}:${binding.schemaId}`,
    )
  }
  return binding
}

export async function readProjectCreativeResourceWorkingSet(input: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string | null
  readonly client?: CreativeResourceReadClient
}): Promise<CreativeResourceWorkingSetView> {
  const client = input.client ?? prisma
  const scopeWhere: Prisma.CreativeResourceBindingWhereInput[] = input.episodeId
    ? [
        { scopeKind: 'episode', scopeId: input.episodeId },
        { scopeKind: 'project', scopeId: input.projectId },
      ]
    : [{ scopeKind: 'project', scopeId: input.projectId }]
  const resourceScopeWhere: Prisma.CreativeResourceWhereInput[] = input.episodeId
    ? [{ episodeId: input.episodeId }, { episodeId: null }]
    : [{ episodeId: null }]
  const [rows, resourceCounts] = await Promise.all([
    client.creativeResourceBinding.findMany({
      where: {
        userId: input.userId,
        projectId: input.projectId,
        OR: scopeWhere,
      },
      select: {
        id: true,
        userId: true,
        projectId: true,
        episodeId: true,
        scopeKind: true,
        scopeId: true,
        role: true,
        slotKey: true,
        source: true,
        version: true,
        resourceId: true,
        resource: { select: { name: true, mediaType: true, schemaId: true } },
      },
      orderBy: [{ scopeKind: 'asc' }, { role: 'asc' }, { slotKey: 'asc' }],
    }),
    client.creativeResource.groupBy({
      by: ['schemaId'],
      where: {
        userId: input.userId,
        projectId: input.projectId,
        OR: resourceScopeWhere,
      },
      _count: { _all: true },
      orderBy: { schemaId: 'asc' },
    }),
  ])
  const bindings = rows
    .map(workingBindingView)
    .sort((left, right) => {
      const leftPriority = left.scope.kind === 'episode' ? 0 : 1
      const rightPriority = right.scope.kind === 'episode' ? 0 : 1
      return leftPriority - rightPriority
        || left.role.localeCompare(right.role)
        || left.slotKey.localeCompare(right.slotKey)
    })
  const bySchema = resourceCounts.map((entry) => ({
    schemaId: entry.schemaId,
    count: entry._count._all,
  }))
  return {
    adoptedCreativeDirection: canonicalBinding(
      bindings,
      CREATIVE_RESOURCE_CANONICAL_BINDINGS.adoptedCreativeDirection,
      CREATIVE_RESOURCE_SCHEMA.CREATIVE_DIRECTION,
    ),
    adoptedAssetManifest: canonicalBinding(
      bindings,
      CREATIVE_RESOURCE_CANONICAL_BINDINGS.adoptedAssetManifest,
      CREATIVE_RESOURCE_SCHEMA.ASSET_MANIFEST,
    ),
    bindings,
    availableResources: {
      total: bySchema.reduce((sum, entry) => sum + entry.count, 0),
      bySchema,
    },
  }
}
