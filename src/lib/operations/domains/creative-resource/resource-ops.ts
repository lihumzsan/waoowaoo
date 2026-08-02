import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import {
  editCreativeResourceDataInTransaction,
  parseCreativeResourceDataValueJson,
  type CreativeResourceDataEdit,
} from '@/lib/creative-resource/creative-data'
import {
  CREATIVE_RESOURCE_MEDIA_TYPES,
  CREATIVE_RESOURCE_STATUSES,
  type CreativeResourceCardView,
  type CreativeResourceMaterializationView,
  type CreativeResourceView,
  type CreativeResourceSummaryView,
} from '@/lib/creative-resource/contracts'
import {
  getProjectCreativeResourceCard,
  getProjectCreativeResourceDataView,
  listProjectCreativeResourceCards,
} from '@/lib/creative-resource/view-service'
import { defineOperation } from '@/lib/operations/define-operation'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import {
  CREATIVE_RESOURCE_SCHEMAS,
} from '@/lib/creative-resource/schema-registry'
import { setCreativeResourceArchivedInTransaction } from '@/lib/creative-resource/archive-service'

const creativeResourceSchemaIds = CREATIVE_RESOURCE_SCHEMAS.map((definition) => definition.schemaId)

const listResourcesInputSchema = z.object({
  episodeId: z.string().trim().min(1).nullable().optional(),
  mediaType: z.enum(CREATIVE_RESOURCE_MEDIA_TYPES).optional(),
  schemaId: z.enum(creativeResourceSchemaIds).optional()
    .describe('Optional exact professional Resource schema to filter by. Omit to include every schema.'),
  status: z.enum(CREATIVE_RESOURCE_STATUSES).optional(),
  limit: z.number().int().min(1).max(200).optional(),
}).strict()

const getResourceInputSchema = z.object({
  resourceId: z.string().trim().min(1),
}).strict()

const creativeResourceEditPathSchema = z.array(
  z.string().trim().min(1).max(128),
).min(1).max(24)
  .describe('Object-key path inside the editable creativeData document. Arrays must be replaced as complete JSON values; path segments do not address array indexes.')

const editResourceInputSchema = z.object({
  resourceId: z.string().trim().min(1)
    .describe('Exact Resource ID to edit. Read it with get_resource first.'),
  expectedVersion: z.number().int().min(0)
    .describe('Exact creativeDataVersion returned by get_resource. Never guess it. A concurrent change causes a conflict and requires a fresh read.'),
  reason: z.string().trim().min(1).max(500)
    .describe('Brief factual reason this edit is necessary. Do not use this tool merely to summarize, restate, speculate, or polish content.'),
  edits: z.array(z.discriminatedUnion('op', [
    z.object({
      op: z.literal('set'),
      path: creativeResourceEditPathSchema,
      valueJson: z.string().min(1).max(262_144)
        .describe('One complete valid JSON value encoded as a string. Use {$resourceRef:{resourceId}} for an exact immutable Resource reference.'),
    }).strict(),
    z.object({
      op: z.literal('remove'),
      path: creativeResourceEditPathSchema,
    }).strict(),
  ])).min(1).max(50)
    .describe('Minimal object-path changes only. Preserve every unrelated field from the Resource you read.'),
}).strict()

const setResourceArchivedInputSchema = z.object({
  resourceId: z.string().trim().min(1),
  archived: z.boolean(),
}).strict()

const setResourceArchivedOutputSchema = z.object({
  success: z.literal(true),
  resourceId: z.string().min(1),
  archivedAt: z.string().datetime().nullable(),
  changed: z.boolean(),
}).strict()

export function projectCreativeResourceMaterializationForAgent(
  materialization: CreativeResourceMaterializationView,
) {
  return {
    ...materialization,
    content: materialization.content.kind === 'media'
      ? {
          kind: materialization.content.kind,
          mimeType: materialization.content.mimeType ?? null,
          width: materialization.content.width ?? null,
          height: materialization.content.height ?? null,
          durationMs: materialization.content.durationMs ?? null,
        }
      : materialization.content,
  }
}

function projectCreativeResourceSummaryForAgent(
  summary: CreativeResourceSummaryView,
) {
  if (summary.kind !== 'media') return summary
  return {
    kind: summary.kind,
    mediaType: summary.mediaType,
    mimeType: summary.mimeType ?? null,
    width: summary.width ?? null,
    height: summary.height ?? null,
    durationMs: summary.durationMs ?? null,
  }
}

export function projectCreativeResourceForAgent(
  resource: CreativeResourceView,
) {
  return {
    ...resource,
    materialization: resource.materialization
      ? projectCreativeResourceMaterializationForAgent(resource.materialization)
      : null,
  }
}

export function projectCreativeResourceCardForAgent(
  card: CreativeResourceCardView,
) {
  return {
    resource: projectCreativeResourceForAgent(card.resource),
    presentation: {
      ...card.presentation,
      summary: projectCreativeResourceSummaryForAgent(card.presentation.summary),
    },
  }
}

const resourceCardSchema = z.object({
  resource: z.object({
    resourceId: z.string().min(1),
    origin: z.object({
      sourceType: z.string().min(1),
      sourceId: z.string().min(1),
    }).strict().nullable(),
    scope: z.object({
      kind: z.enum(['user', 'project', 'episode']),
      id: z.string().min(1),
      userId: z.string().min(1),
      projectId: z.string().nullable(),
      episodeId: z.string().nullable(),
    }).strict(),
    mediaType: z.enum(CREATIVE_RESOURCE_MEDIA_TYPES),
    schemaId: z.string().min(1),
    name: z.string().min(1),
    status: z.enum(CREATIVE_RESOURCE_STATUSES),
    memberIndex: z.number().int().min(0).nullable(),
    alternativeGroupId: z.string().min(1).nullable(),
    archivedAt: z.string().datetime().nullable(),
    creativeDataVersion: z.number().int().min(0),
    creativeDataKeys: z.array(z.string()),
    materialization: z.unknown().nullable(),
    pendingGeneration: z.unknown().nullable(),
    error: z.object({ code: z.string().nullable(), message: z.string() }).strict().nullable(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  }).strict(),
  presentation: z.object({
    rendererKey: z.string().min(1),
    fallbackMediaType: z.enum(CREATIVE_RESOURCE_MEDIA_TYPES),
    summary: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('text'), text: z.string().min(1) }).strict(),
      z.object({
        kind: z.literal('structured'),
        entryCount: z.number().int().nonnegative().nullable(),
      }).strict(),
      z.object({
        kind: z.literal('media'),
        mediaType: z.enum(CREATIVE_RESOURCE_MEDIA_TYPES),
        mimeType: z.string().nullable().optional(),
        width: z.number().nullable().optional(),
        height: z.number().nullable().optional(),
        durationMs: z.number().nullable().optional(),
      }).strict(),
      z.object({ kind: z.literal('empty') }).strict(),
    ]),
  }).strict(),
}).strict()

const listResourcesOutputSchema = z.object({
  success: z.literal(true),
  resources: z.array(resourceCardSchema),
}).strict()

const getResourceOutputSchema = z.object({
  success: z.literal(true),
  resource: resourceCardSchema,
  creativeData: z.record(z.string(), z.unknown()),
  creativeDataVersion: z.number().int().min(0),
}).strict()

const editResourceOutputSchema = z.object({
  success: z.literal(true),
  resourceId: z.string().min(1),
  creativeDataVersion: z.number().int().min(0),
  changedPaths: z.array(z.string()),
  creativeData: z.record(z.string(), z.unknown()),
}).strict()

export function createCreativeResourceOperations(): ProjectAgentOperationRegistryDraft {
  return {
    list_resources: defineOperation({
      id: 'list_resources',
      summary: 'Browse durable creative Resources and reusable outputs. Filter by media/schema/status, then call get_resource for one exact full Resource. This does not decide which Resource is current; get_project_context owns that compact projection.',
      intent: 'query',
      channels: { tool: true, api: true, mcp: true },
      effects: {
        writes: false,
        billable: false,
        destructive: false,
        overwrite: false,
        bulk: false,
        externalSideEffects: false,
        longRunning: false,
      },
      inputSchema: listResourcesInputSchema,
      outputSchema: listResourcesOutputSchema,
      execute: async (ctx, input) => {
        const episodeId = input.episodeId === undefined ? (ctx.context.episodeId ?? null) : input.episodeId
        const resources = await listProjectCreativeResourceCards({
          projectId: ctx.projectId,
          userId: ctx.userId,
          episodeId,
          includeParentScopes: true,
          mediaType: input.mediaType,
          schemaId: input.schemaId,
          status: input.status,
          limit: input.limit,
        })
        return listResourcesOutputSchema.parse({
          success: true,
          resources: resources.map(projectCreativeResourceCardForAgent),
        })
      },
    }),
    get_resource: defineOperation({
      id: 'get_resource',
      summary: 'Read one durable immutable creative Resource with its content, provenance, lineage, and separately editable creativeData document/version. Call this immediately before edit_resource; never guess creativeDataVersion.',
      intent: 'query',
      channels: { tool: true, api: true, mcp: true },
      toolExposure: 'direct',
      effects: {
        writes: false,
        billable: false,
        destructive: false,
        overwrite: false,
        bulk: false,
        externalSideEffects: false,
        longRunning: false,
      },
      inputSchema: getResourceInputSchema,
      outputSchema: getResourceOutputSchema,
      execute: async (ctx, input) => {
        const card = await getProjectCreativeResourceCard({
          projectId: ctx.projectId,
          userId: ctx.userId,
          resourceId: input.resourceId,
        })
        if (!card) {
          throw new ApiError('NOT_FOUND', {
            code: 'CREATIVE_RESOURCE_NOT_FOUND',
            field: 'resourceId',
          })
        }
        const creativeData = await getProjectCreativeResourceDataView({
          projectId: ctx.projectId,
          userId: ctx.userId,
          resourceId: input.resourceId,
        })
        if (!creativeData) {
          throw new ApiError('NOT_FOUND', {
            code: 'CREATIVE_RESOURCE_NOT_FOUND',
            field: 'resourceId',
          })
        }
        return getResourceOutputSchema.parse({
          success: true,
          resource: projectCreativeResourceCardForAgent(card),
          creativeData: creativeData.creativeData,
          creativeDataVersion: creativeData.creativeDataVersion,
        })
      },
    }),
    edit_resource: defineOperation({
      id: 'edit_resource',
      summary: 'Edit only the AI/user-owned creativeData document of one existing Resource without generating media, creating a Task, charging credits, changing any current selection, or rewriting immutable history. Use this sparingly: call it only when the user explicitly asks to save or change Resource creative data, or when saving that data is strictly necessary to complete the user’s stated goal. If the user says not to modify or save Resource data, never call this tool. Do not call it to summarize conversation, restate facts already stored elsewhere, improve wording without a request, infer missing facts, manufacture provenance, or pre-emptively add speculative fields. Always call get_resource first, copy its exact creativeDataVersion into expectedVersion, preserve unrelated fields, and apply the smallest possible paths. Use exact $resourceRef objects for Resource references. This tool cannot modify Resource identity/scope/status, media, current selections, actual generation prompt/model/options, lineage, Task, billing, or timestamps. A successful edit is data storage only and must never be described as generation, selection, rendering, or completion.',
      intent: 'act',
      channels: { tool: true, api: true, mcp: true },
      toolContractRevision: 'edit_resource/v1',
      effects: {
        writes: true,
        workspaceResourceImpact: 'creative_resources',
        billable: false,
        destructive: false,
        overwrite: true,
        bulk: false,
        externalSideEffects: false,
        longRunning: false,
      },
      resourceContract: {
        kind: 'none',
        reason: 'edits only the Resource creativeData document; it neither consumes nor creates a Resource',
      },
      confirmation: { kind: 'none', required: false },
      inputSchema: editResourceInputSchema,
      outputSchema: editResourceOutputSchema,
      executeInTransaction: async (ctx, input, tx) => {
        const edits: CreativeResourceDataEdit[] = input.edits.map((edit) => edit.op === 'set'
          ? {
              op: 'set',
              path: edit.path,
              value: parseCreativeResourceDataValueJson(edit.valueJson),
            }
          : { op: 'remove', path: edit.path })
        const result = await editCreativeResourceDataInTransaction(tx, {
          userId: ctx.userId,
          projectId: ctx.projectId,
          resourceId: input.resourceId,
          expectedVersion: input.expectedVersion,
          edits,
        })
        return editResourceOutputSchema.parse({ success: true, ...result })
      },
    }),
    set_resource_archived: defineOperation({
      id: 'set_resource_archived',
      summary: 'Archive or restore one exact project Resource without changing its immutable content, lifecycle, current bindings, or lineage.',
      intent: 'act',
      channels: { tool: false, api: true },
      effects: {
        writes: true,
        workspaceResourceImpact: 'creative_resources',
        billable: false,
        destructive: false,
        overwrite: true,
        bulk: false,
        externalSideEffects: false,
        longRunning: false,
      },
      resourceContract: {
        kind: 'none',
        reason: 'changes only reversible Resource archive visibility metadata',
      },
      confirmation: { kind: 'none', required: false },
      inputSchema: setResourceArchivedInputSchema,
      outputSchema: setResourceArchivedOutputSchema,
      executeInTransaction: async (ctx, input, tx) => {
        const result = await setCreativeResourceArchivedInTransaction(tx, {
          userId: ctx.userId,
          projectId: ctx.projectId,
          resourceId: input.resourceId,
          archived: input.archived,
        })
        return setResourceArchivedOutputSchema.parse({ success: true, ...result })
      },
    }),
  }
}
