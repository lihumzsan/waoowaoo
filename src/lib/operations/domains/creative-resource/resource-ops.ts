import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import { bindCreativeResourceRevisionInTransaction } from '@/lib/creative-resource/binding-service'
import {
  editCreativeResourceDataInTransaction,
  parseCreativeResourceDataValueJson,
  type CreativeResourceDataEdit,
} from '@/lib/creative-resource/creative-data'
import {
  CREATIVE_RESOURCE_CANONICAL_BINDINGS,
  CREATIVE_RESOURCE_ASSET_IMAGE_BINDING_ROLE,
  CREATIVE_RESOURCE_CHARACTER_VOICE_BINDING_ROLE,
  CREATIVE_RESOURCE_MEDIA_TYPES,
  CREATIVE_RESOURCE_STATUSES,
} from '@/lib/creative-resource/contracts'
import { resolveProjectCreativeResourceScope } from '@/lib/creative-resource/identity'
import {
  getProjectCreativeResourceCard,
  getProjectCreativeResourceDataView,
  getProjectCreativeResourceRevisionView,
  listProjectCreativeResourceCards,
} from '@/lib/creative-resource/view-service'
import { defineOperation } from '@/lib/operations/define-operation'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import {
  CREATIVE_RESOURCE_SCHEMAS,
} from '@/lib/creative-resource/schema-registry'

function isReservedCreativeResourceBinding(input: {
  readonly role: string
  readonly slotKey: string
}): boolean {
  const role = input.role.trim()
  const slotKey = input.slotKey.trim()
  if (role === CREATIVE_RESOURCE_CHARACTER_VOICE_BINDING_ROLE) return true
  if (role === CREATIVE_RESOURCE_ASSET_IMAGE_BINDING_ROLE) return true
  return Object.values(CREATIVE_RESOURCE_CANONICAL_BINDINGS).some(
    (binding) => binding.role === role && binding.slotKey === slotKey,
  )
}

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
  revisionId: z.string().trim().min(1).optional()
    .describe('Optional exact immutable revision to read. Omit only when the current head revision is intended.'),
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
        .describe('One complete valid JSON value encoded as a string. Use {$resourceRef:{revisionId}} for an exact immutable Resource reference.'),
    }).strict(),
    z.object({
      op: z.literal('remove'),
      path: creativeResourceEditPathSchema,
    }).strict(),
  ])).min(1).max(50)
    .describe('Minimal object-path changes only. Preserve every unrelated field from the Resource you read.'),
}).strict()

const adoptResourceInputSchema = z.object({
  episodeId: z.string().trim().min(1).nullable().optional(),
  resourceId: z.string().trim().min(1),
  revisionId: z.string().trim().min(1),
  role: z.string().trim().min(1).max(64),
  slotKey: z.string().trim().min(1).max(128),
  expectedVersion: z.number().int().min(0).nullable().optional(),
}).strict()

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
    candidateSetId: z.string().nullable(),
    candidateIndex: z.number().int().min(0).nullable(),
    creativeDataVersion: z.number().int().min(0),
    creativeDataKeys: z.array(z.string()),
    headRevision: z.unknown().nullable(),
    pendingGeneration: z.unknown().nullable(),
    bindings: z.array(z.unknown()),
    error: z.object({ code: z.string().nullable(), message: z.string() }).strict().nullable(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  }).strict(),
  candidates: z.unknown().nullable(),
  presentation: z.object({
    rendererKey: z.string().min(1),
    fallbackMediaType: z.enum(CREATIVE_RESOURCE_MEDIA_TYPES),
  }).strict(),
}).strict()

const listResourcesOutputSchema = z.object({
  success: z.literal(true),
  resources: z.array(resourceCardSchema),
}).strict()

const getResourceOutputSchema = z.object({
  success: z.literal(true),
  resource: resourceCardSchema,
  revision: z.unknown().nullable(),
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

const adoptResourceOutputSchema = z.object({
  success: z.literal(true),
  binding: z.object({
    bindingId: z.string().min(1),
    scope: z.object({
      kind: z.enum(['user', 'project', 'episode']),
      id: z.string().min(1),
      userId: z.string().min(1),
      projectId: z.string().nullable(),
      episodeId: z.string().nullable(),
    }).strict(),
    role: z.string().min(1),
    slotKey: z.string().min(1),
    resourceId: z.string().min(1),
    revisionId: z.string().min(1),
    version: z.number().int().min(0),
    source: z.string().min(1),
  }).strict(),
}).strict()

export function createCreativeResourceOperations(): ProjectAgentOperationRegistryDraft {
  return {
    list_resources: defineOperation({
      id: 'list_resources',
      summary: 'Browse the persistent Resource index: candidates, history, reusable outputs, and unbound assets. Filter by media/schema/status, then call get_resource for one exact full revision. This does not decide which Resource is currently adopted; get_project_context owns that compact working-set projection.',
      intent: 'query',
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
        return listResourcesOutputSchema.parse({ success: true, resources })
      },
    }),
    get_resource: defineOperation({
      id: 'get_resource',
      summary: 'Read one persistent creative Resource, its editable creativeData document/version, and one exact immutable revision with full content, generation provenance, lineage, candidates, and bindings. Pass revisionId from a Binding when it may differ from the current head. Call this immediately before edit_resource; never guess creativeDataVersion.',
      intent: 'query',
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
        const resource = await getProjectCreativeResourceCard({
          projectId: ctx.projectId,
          userId: ctx.userId,
          resourceId: input.resourceId,
        })
        if (!resource) {
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
        const revision = await getProjectCreativeResourceRevisionView({
          projectId: ctx.projectId,
          userId: ctx.userId,
          resourceId: input.resourceId,
          revisionId: input.revisionId,
        })
        if (input.revisionId && !revision) {
          throw new ApiError('NOT_FOUND', {
            code: 'CREATIVE_RESOURCE_REVISION_NOT_FOUND',
            field: 'revisionId',
          })
        }
        return getResourceOutputSchema.parse({
          success: true,
          resource,
          revision,
          creativeData: creativeData.creativeData,
          creativeDataVersion: creativeData.creativeDataVersion,
        })
      },
    }),
    edit_resource: defineOperation({
      id: 'edit_resource',
      summary: 'Edit only the AI/user-owned creativeData document of one existing Resource without generating media, creating a Task, charging credits, changing the current file, or rewriting immutable history. Use this sparingly: call it only when the user explicitly asks to save or change Resource creative data, or when saving that data is strictly necessary to complete the user’s stated goal. If the user says not to modify or save Resource data, never call this tool. Do not call it to summarize conversation, restate facts already stored elsewhere, improve wording without a request, infer missing facts, manufacture provenance, or pre-emptively add speculative fields. Always call get_resource first, copy its exact creativeDataVersion into expectedVersion, preserve unrelated fields, and apply the smallest possible paths. Use exact $resourceRef objects for Resource references. This tool cannot modify Resource identity/scope/status, media, head Revision, actual generation prompt/model/options, lineage, Binding, Task, billing, or timestamps. A successful edit is data storage only and must never be described as generation, adoption, rendering, or completion.',
      intent: 'act',
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
        reason: 'edits only the Resource creativeData document; it neither consumes nor creates a Resource revision',
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
    adopt_resource: defineOperation({
      id: 'adopt_resource',
      summary: 'Adopt an exact immutable Resource revision into a named project or episode role. Generation and adoption remain separate; this does not modify the Resource.',
      intent: 'act',
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
      confirmation: { kind: 'none', required: false },
      inputSchema: adoptResourceInputSchema,
      outputSchema: adoptResourceOutputSchema,
      executeInTransaction: async (ctx, input, tx) => {
        if (isReservedCreativeResourceBinding(input)) {
          throw new ApiError('INVALID_PARAMS', {
            code: 'CREATIVE_RESOURCE_RESERVED_BINDING_OPERATION_REQUIRED',
            field: 'role',
            requestedValue: `${input.role}:${input.slotKey}`,
            allowedValues: ['adopt_style_bible', 'bind_voice'],
            agentRetryableAfterCorrection: true,
          })
        }
        const episodeId = input.episodeId === undefined ? (ctx.context.episodeId ?? null) : input.episodeId
        const binding = await bindCreativeResourceRevisionInTransaction(tx, {
          scope: resolveProjectCreativeResourceScope({
            userId: ctx.userId,
            projectId: ctx.projectId,
            episodeId,
          }),
          role: input.role,
          slotKey: input.slotKey,
          resourceId: input.resourceId,
          revisionId: input.revisionId,
          source: 'agent',
          expectedVersion: input.expectedVersion ?? null,
        })
        return adoptResourceOutputSchema.parse({ success: true, binding })
      },
    }),
  }
}
