import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type {
  CreativeResourceBindingView,
  CreativeResourceCardView,
  CreativeResourceInputRef,
  CreativeResourceJsonValue,
  CreativeResourceMediaType,
  CreativeResourceRevisionContent,
  CreativeResourceRevisionView,
  CreativeResourceScopeRef,
  CreativeResourceStatus,
  CreativeResourceView,
} from './contracts'
import { isCreativeResourceMediaType, isCreativeResourceScopeKind, isCreativeResourceStatus } from './contracts'
import { getCreativeResourceSchema } from './schema-registry'

type CreativeResourceReadClient = Pick<Prisma.TransactionClient, 'creativeResource'> | typeof prisma

const resourceInclude = {
  headRevision: {
    include: {
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
          inputRevision: {
            select: { id: true, resourceId: true, fingerprint: true },
          },
        },
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

function requireMediaType(value: string): CreativeResourceMediaType {
  if (!isCreativeResourceMediaType(value)) throw new Error(`CREATIVE_RESOURCE_MEDIA_TYPE_INVALID:${value}`)
  return value
}

function requireStatus(value: string): CreativeResourceStatus {
  if (!isCreativeResourceStatus(value)) throw new Error(`CREATIVE_RESOURCE_STATUS_INVALID:${value}`)
  return value
}

function scopeFromRow(row: Pick<ResourceRow, 'scopeKind' | 'scopeId' | 'userId' | 'projectId' | 'episodeId'>): CreativeResourceScopeRef {
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

function revisionContent(row: NonNullable<ResourceRow['headRevision']>): CreativeResourceRevisionContent {
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
  if (row.sourceType && row.sourceId && row.sourceRevision && row.contentJson !== null) {
    return {
      kind: 'domain_snapshot',
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      sourceRevision: row.sourceRevision,
      snapshot: jsonValue(row.contentJson) ?? null,
    }
  }
  if (row.contentText !== null) return { kind: 'text', text: row.contentText }
  if (row.contentJson !== null) return { kind: 'structured', data: jsonValue(row.contentJson) ?? null }
  throw new Error(`CREATIVE_RESOURCE_REVISION_CONTENT_MISSING:${row.id}`)
}

function revisionView(row: NonNullable<ResourceRow['headRevision']>): CreativeResourceRevisionView {
  const inputs: CreativeResourceInputRef[] = row.outputLineage.map((lineage) => ({
    resourceId: lineage.inputRevision.resourceId,
    revisionId: lineage.inputRevision.id,
    fingerprint: lineage.inputRevision.fingerprint,
    role: lineage.role,
    position: lineage.position,
  }))
  return {
    resourceId: row.resourceId,
    revisionId: row.id,
    fingerprint: row.fingerprint,
    revision: row.revision,
    content: revisionContent(row),
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
    createdAt: row.createdAt.toISOString(),
  }
}

function bindingView(row: ResourceRow['bindings'][number], scope: CreativeResourceScopeRef): CreativeResourceBindingView {
  return {
    bindingId: row.id,
    scope,
    role: row.role,
    slotKey: row.slotKey,
    resourceId: row.resourceId,
    revisionId: row.revisionId,
    version: row.version,
    source: row.source,
  }
}

export function projectCreativeResourceView(row: ResourceRow): CreativeResourceView {
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
    headRevision: row.headRevision ? revisionView(row.headRevision) : null,
    bindings: row.bindings.map((binding) => bindingView(binding, scope)),
    error: row.errorCode || row.errorMessage
      ? { code: row.errorCode, message: row.errorMessage ?? row.errorCode ?? '' }
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function projectCreativeResourceCardView(row: ResourceRow): CreativeResourceCardView {
  const resource = projectCreativeResourceView(row)
  const schema = getCreativeResourceSchema(resource.schemaId)
  return {
    resource,
    candidates: null,
    presentation: {
      rendererKey: schema?.schemaId ?? 'generic.resource',
      fallbackMediaType: resource.mediaType,
    },
  }
}

export async function listProjectCreativeResourceCards(input: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId?: string | null
  readonly mediaType?: CreativeResourceMediaType | null
  readonly schemaId?: string | null
  readonly status?: CreativeResourceStatus | null
  readonly limit?: number
  readonly client?: CreativeResourceReadClient
}): Promise<CreativeResourceCardView[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 100, 200))
  const rows = await (input.client ?? prisma).creativeResource.findMany({
    where: {
      projectId: input.projectId,
      userId: input.userId,
      ...(input.episodeId === undefined ? {} : { episodeId: input.episodeId }),
      ...(input.mediaType ? { mediaType: input.mediaType } : {}),
      ...(input.schemaId?.trim() ? { schemaId: input.schemaId.trim() } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
    include: resourceInclude,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit,
  })
  const views = rows.map(projectCreativeResourceCardView)
  const byCandidateSet = new Map<string, CreativeResourceView[]>()
  for (const view of views) {
    const candidateSetId = view.resource.candidateSetId
    if (!candidateSetId) continue
    const group = byCandidateSet.get(candidateSetId) ?? []
    group.push(view.resource)
    byCandidateSet.set(candidateSetId, group)
  }
  return views.map((view) => {
    const candidateSetId = view.resource.candidateSetId
    if (!candidateSetId) return view
    const resources = byCandidateSet.get(candidateSetId) ?? [view.resource]
    const selectedRevisionId = resources
      .flatMap((resource) => resource.bindings.map((binding) => binding.revisionId))[0] ?? null
    return { ...view, candidates: { candidateSetId, resources, selectedRevisionId } }
  })
}

export async function getProjectCreativeResourceCard(input: {
  readonly projectId: string
  readonly userId: string
  readonly resourceId: string
  readonly client?: CreativeResourceReadClient
}): Promise<CreativeResourceCardView | null> {
  const row = await (input.client ?? prisma).creativeResource.findFirst({
    where: { id: input.resourceId, projectId: input.projectId, userId: input.userId },
    include: resourceInclude,
  })
  return row ? projectCreativeResourceCardView(row) : null
}
