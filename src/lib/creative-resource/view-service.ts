import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type {
  CreativeResourceCardView,
  CreativeResourceCardMemberView,
  CreativeResourceContent,
  CreativeResourceDataView,
  CreativeResourceInputRef,
  CreativeResourceInputSummaryView,
  CreativeResourceJsonObject,
  CreativeResourceJsonValue,
  CreativeResourceMaterializationView,
  CreativeResourceMediaType,
  CreativeResourcePendingGeneration,
  CreativeResourceScopeRef,
  CreativeResourceStatus,
  CreativeResourceView,
  CreativeResourceCurrentSelectionView,
  CreativeResourceWorkingSetView,
} from './contracts'
import {
  CREATIVE_RESOURCE_BINDING_ROLES,
  CREATIVE_RESOURCE_CANONICAL_BINDINGS,
  isCreativeResourceBindingRole,
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
import { buildCreativeResourceAlternativeGroupId } from './identity'
import { loadCreativeResourceCanvasOperationViews } from './canvas-action-view'

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

function protectedMediaUrl(publicId: string): string {
  return `/m/${encodeURIComponent(publicId)}`
}

function resourceContent(row: ResourceRow): CreativeResourceContent {
  if (row.media) {
    return {
      kind: 'media',
      mediaId: row.media.id,
      url: protectedMediaUrl(row.media.publicId),
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
      toolCallId: row.toolCallId,
      prompt: row.prompt,
      modelKey: row.modelKey,
      generationOptions: jsonValue(row.generationOptions),
    },
    inputs,
    materializedAt: row.materializedAt.toISOString(),
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
    alternativeGroupId: row.alternativeGroupExecutionId
      ? buildCreativeResourceAlternativeGroupId({
          operationExecutionId: row.alternativeGroupExecutionId,
        })
      : null,
    memberIndex: row.memberIndex,
    creativeDataVersion: row.creativeDataVersion,
    creativeDataKeys: Object.keys(jsonObject(row.creativeData)).sort(),
    materialization: materializationView(row),
    pendingGeneration,
    error: row.errorCode || row.errorMessage
      ? { code: row.errorCode, message: row.errorMessage ?? row.errorCode ?? '' }
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function cardViewFromResource(
  resource: CreativeResourceView,
  inputSummaries: readonly CreativeResourceInputSummaryView[],
): CreativeResourceCardMemberView {
  const schema = getCreativeResourceSchema(resource.schemaId)
  const content = resource.materialization?.content
  return {
    resource,
    inputSummaries,
    download: content?.kind === 'media' && content.url
      ? { href: content.url, fileName: resource.name }
      : null,
    presentation: {
      rendererKey: schema?.schemaId ?? 'generic.resource',
      fallbackMediaType: resource.mediaType,
      summary: projectCreativeResourceSummary(resource),
    },
  }
}

function cardInputRefs(view: CreativeResourceView): readonly CreativeResourceInputRef[] {
  return view.materialization?.inputs ?? view.pendingGeneration?.inputs ?? []
}

/**
 * Resolves generation input references into display summaries (name, media
 * type, protected preview URL). Input Resources are owner-scoped rows loaded
 * by exact Resource ID; a materialized Lineage input can never be missing
 * (RESTRICT), so a missing row fails loudly instead of degrading to raw IDs.
 */
async function loadInputSummaries(
  client: CreativeResourceReadClient,
  views: readonly CreativeResourceView[],
  userId: string,
): Promise<ReadonlyMap<string, readonly CreativeResourceInputSummaryView[]>> {
  const inputIds = new Set<string>()
  for (const view of views) {
    for (const input of cardInputRefs(view)) inputIds.add(input.resourceId)
  }
  if (inputIds.size === 0) return new Map()
  const rows = await client.creativeResource.findMany({
    where: { id: { in: [...inputIds] }, userId },
    select: {
      id: true,
      name: true,
      mediaType: true,
      media: {
        select: {
          publicId: true,
          mimeType: true,
          width: true,
          height: true,
          durationMs: true,
        },
      },
    },
  })
  const rowById = new Map(rows.map((row) => [row.id, row]))
  const summariesByViewId = new Map<string, readonly CreativeResourceInputSummaryView[]>()
  for (const view of views) {
    const inputs = cardInputRefs(view)
    if (inputs.length === 0) continue
    summariesByViewId.set(view.resourceId, inputs.map((input) => {
      const row = rowById.get(input.resourceId)
      if (!row) {
        throw new Error(`CREATIVE_RESOURCE_INPUT_SUMMARY_MISSING:${input.resourceId}`)
      }
      return {
        resourceId: input.resourceId,
        role: input.role,
        position: input.position,
        name: row.name,
        mediaType: requireMediaType(row.mediaType),
        media: row.media
          ? {
              url: protectedMediaUrl(row.media.publicId),
              mimeType: row.media.mimeType,
              width: row.media.width,
              height: row.media.height,
              durationMs: row.media.durationMs,
            }
          : null,
      }
    }))
  }
  return summariesByViewId
}

const EMPTY_INPUT_SUMMARIES: readonly CreativeResourceInputSummaryView[] = []

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

function assertAlternativeGroupRows(
  executionId: string,
  rows: readonly ResourceRow[],
): void {
  if (rows.length < 2 || rows.length > 6) {
    throw new Error(`CREATIVE_RESOURCE_ALTERNATIVE_GROUP_SIZE_INVALID:${executionId}`)
  }
  const first = rows[0]
  if (!first) throw new Error(`CREATIVE_RESOURCE_ALTERNATIVE_GROUP_EMPTY:${executionId}`)
  for (const [index, row] of rows.entries()) {
    if (
      row.alternativeGroupExecutionId !== executionId
      || row.memberIndex !== index
      || row.userId !== first.userId
      || row.projectId !== first.projectId
      || row.episodeId !== first.episodeId
      || row.scopeKind !== first.scopeKind
      || row.scopeId !== first.scopeId
      || row.mediaType !== first.mediaType
      || row.schemaId !== first.schemaId
    ) {
      throw new Error(`CREATIVE_RESOURCE_ALTERNATIVE_GROUP_DIVERGED:${executionId}`)
    }
  }
}

async function projectCreativeResourceCards(
  client: CreativeResourceReadClient,
  primaryRows: readonly ResourceRow[],
  userId: string,
): Promise<CreativeResourceCardView[]> {
  if (primaryRows.length === 0) return []
  const groupExecutionIds = Array.from(new Set(primaryRows.flatMap((row) => (
    row.alternativeGroupExecutionId ? [row.alternativeGroupExecutionId] : []
  ))))
  const allGroupRows = groupExecutionIds.length === 0
    ? []
    : await client.creativeResource.findMany({
        where: {
          userId,
          alternativeGroupExecutionId: { in: groupExecutionIds },
        },
        include: resourceInclude,
        orderBy: [
          { alternativeGroupExecutionId: 'asc' },
          { memberIndex: { sort: 'asc', nulls: 'last' } },
          { id: 'asc' },
        ],
      })
  const allRowsByGroup = new Map<string, ResourceRow[]>()
  for (const row of allGroupRows) {
    const executionId = row.alternativeGroupExecutionId
    if (!executionId) {
      throw new Error(`CREATIVE_RESOURCE_ALTERNATIVE_GROUP_OWNER_MISSING:${row.id}`)
    }
    const members = allRowsByGroup.get(executionId) ?? []
    members.push(row)
    allRowsByGroup.set(executionId, members)
  }
  for (const executionId of groupExecutionIds) {
    assertAlternativeGroupRows(executionId, allRowsByGroup.get(executionId) ?? [])
  }

  const combinedRowsById = new Map<string, ResourceRow>()
  for (const row of [...primaryRows, ...allGroupRows]) combinedRowsById.set(row.id, row)
  const combinedRows = [...combinedRowsById.values()]
  const pending = await loadPendingGenerations(client, combinedRows.map((row) => row.id))
  const resources = combinedRows.map((row) => (
    projectCreativeResourceView(row, pending.get(row.id) ?? null)
  ))
  const inputSummaries = await loadInputSummaries(client, resources, userId)
  const membersByResourceId = new Map(resources.map((resource) => [
    resource.resourceId,
    cardViewFromResource(
      resource,
      inputSummaries.get(resource.resourceId) ?? EMPTY_INPUT_SUMMARIES,
    ),
  ]))
  const canvasOperationsByResourceId = await loadCreativeResourceCanvasOperationViews(
    client,
    combinedRows.map((row) => ({
      id: row.id,
      status: requireStatus(row.status),
      operationId: row.operationId,
    })),
    userId,
  )
  const visibleMembersByGroup = new Map<string, CreativeResourceCardMemberView[]>()
  for (const row of allGroupRows) {
    const executionId = row.alternativeGroupExecutionId
    const member = membersByResourceId.get(row.id)
    if (!executionId || !member) {
      throw new Error(`CREATIVE_RESOURCE_ALTERNATIVE_GROUP_VIEW_MISSING:${row.id}`)
    }
    const members = visibleMembersByGroup.get(executionId) ?? []
    members.push(member)
    visibleMembersByGroup.set(executionId, members)
  }

  return primaryRows.map((row) => {
    const member = membersByResourceId.get(row.id)
    if (!member) throw new Error(`CREATIVE_RESOURCE_CARD_VIEW_MISSING:${row.id}`)
    const executionId = row.alternativeGroupExecutionId
    const groupMembers = executionId ? visibleMembersByGroup.get(executionId) ?? [] : []
    return {
      ...member,
      canvasOperations: canvasOperationsByResourceId.get(row.id) ?? [],
      alternativeGroup: executionId && groupMembers.length > 1
        ? {
            groupId: buildCreativeResourceAlternativeGroupId({
              operationExecutionId: executionId,
            }),
            total: groupMembers.length,
            members: groupMembers,
          }
        : null,
    }
  })
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
    orderBy: [
      { createdAt: 'asc' },
      { memberIndex: { sort: 'asc', nulls: 'last' } },
      { id: 'asc' },
    ],
    take: limit,
  })
  return await projectCreativeResourceCards(client, rows, input.userId)
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
  const [card] = await projectCreativeResourceCards(client, [row], input.userId)
  if (!card) throw new Error(`CREATIVE_RESOURCE_CARD_VIEW_MISSING:${row.id}`)
  return card
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

function currentSelectionView(row: {
  readonly role: string
  readonly slotKey: string
  readonly resourceId: string
  readonly resource: {
    readonly name: string
    readonly mediaType: string
    readonly schemaId: string
  }
}): CreativeResourceCurrentSelectionView {
  if (!isCreativeResourceBindingRole(row.role)) {
    throw new Error(`CREATIVE_RESOURCE_CURRENT_SELECTION_KIND_INVALID:${row.role}`)
  }
  return {
    kind: row.role,
    targetId: row.slotKey,
    resourceId: row.resourceId,
    schemaId: row.resource.schemaId,
    mediaType: requireMediaType(row.resource.mediaType),
    name: row.resource.name,
  }
}

function canonicalSelection(
  selections: readonly CreativeResourceCurrentSelectionView[],
  target: { readonly role: string; readonly slotKey: string },
  expectedSchemaId: string,
): CreativeResourceCurrentSelectionView | null {
  const selection = selections.find((candidate) => (
    candidate.kind === target.role && candidate.targetId === target.slotKey
  )) ?? null
  if (selection && selection.schemaId !== expectedSchemaId) {
    throw new Error(
      `CREATIVE_RESOURCE_CURRENT_SELECTION_SCHEMA_INVALID:${target.role}:${selection.schemaId}`,
    )
  }
  return selection
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
        role: { in: [...CREATIVE_RESOURCE_BINDING_ROLES] },
        OR: scopeWhere,
      },
      select: {
        role: true,
        slotKey: true,
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
  const currentSelections = rows
    .map(currentSelectionView)
    .sort((left, right) => {
      return left.kind.localeCompare(right.kind)
        || left.targetId.localeCompare(right.targetId)
    })
  const bySchema = resourceCounts.map((entry) => ({
    schemaId: entry.schemaId,
    count: entry._count._all,
  }))
  return {
    adoptedCreativeDirection: canonicalSelection(
      currentSelections,
      CREATIVE_RESOURCE_CANONICAL_BINDINGS.adoptedCreativeDirection,
      CREATIVE_RESOURCE_SCHEMA.CREATIVE_DIRECTION,
    ),
    adoptedAssetManifest: canonicalSelection(
      currentSelections,
      CREATIVE_RESOURCE_CANONICAL_BINDINGS.adoptedAssetManifest,
      CREATIVE_RESOURCE_SCHEMA.ASSET_MANIFEST,
    ),
    currentSelections,
    availableResources: {
      total: bySchema.reduce((sum, entry) => sum + entry.count, 0),
      bySchema,
    },
  }
}
