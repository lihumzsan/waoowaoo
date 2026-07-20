import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import { bindCreativeResourceRevisionInTransaction } from '@/lib/creative-resource/binding-service'
import {
  CREATIVE_RESOURCE_CANONICAL_BINDINGS,
  CREATIVE_RESOURCE_MEDIA_TYPES,
  CREATIVE_RESOURCE_STATUSES,
} from '@/lib/creative-resource/contracts'
import { resolveProjectCreativeResourceScope } from '@/lib/creative-resource/identity'
import {
  getProjectCreativeResourceCard,
  getProjectCreativeResourceRevisionView,
  listProjectCreativeResourceCards,
} from '@/lib/creative-resource/view-service'
import { defineOperation } from '@/lib/operations/define-operation'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import {
  CREATIVE_RESOURCE_SCHEMA,
  CREATIVE_RESOURCE_SCHEMAS,
} from '@/lib/creative-resource/schema-registry'

function isReservedCreativeResourceBinding(input: {
  readonly role: string
  readonly slotKey: string
}): boolean {
  const role = input.role.trim()
  const slotKey = input.slotKey.trim()
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

const adoptResourceInputSchema = z.object({
  episodeId: z.string().trim().min(1).nullable().optional(),
  resourceId: z.string().trim().min(1),
  revisionId: z.string().trim().min(1),
  role: z.string().trim().min(1).max(64),
  slotKey: z.string().trim().min(1).max(128),
  expectedVersion: z.number().int().min(0).nullable().optional(),
}).strict()

const confirmScriptResourceInputSchema = z.object({
  episodeId: z.string().trim().min(1).nullable().optional(),
  resourceId: z.string().trim().min(1)
    .describe('Exact ready project.source_script Resource to confirm; obtain it from list_resources.'),
  revisionId: z.string().trim().min(1)
    .describe('Exact immutable screenplay revision to confirm; this operation never copies or rewrites its content.'),
  expectedVersion: z.number().int().min(0).nullable().optional()
    .describe('Pass null for the first confirmation; pass the current binding version when replacing a previously confirmed screenplay.'),
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

const confirmScriptResourceOutputSchema = adoptResourceOutputSchema.extend({
  schemaId: z.literal(CREATIVE_RESOURCE_SCHEMA.SOURCE_SCRIPT),
  fingerprint: z.string().trim().min(1),
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
      summary: 'Read one persistent creative Resource and one exact immutable revision with full content, generation provenance, lineage, candidates, and bindings. Pass revisionId from a Binding when it may differ from the current head.',
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
        return getResourceOutputSchema.parse({ success: true, resource, revision })
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
            allowedValues: ['confirm_script_resource', 'adopt_style_bible'],
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
    confirm_script_resource: defineOperation({
      id: 'confirm_script_resource',
      summary: 'Confirm one exact ready project.source_script revision as the current project or episode screenplay. This only updates the canonical Binding; it never copies, regenerates, or rewrites screenplay content.',
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
        reason: 'confirms an existing immutable screenplay revision through the canonical Binding writer',
      },
      confirmation: { kind: 'none', required: false },
      inputSchema: confirmScriptResourceInputSchema,
      outputSchema: confirmScriptResourceOutputSchema,
      executeInTransaction: async (ctx, input, tx) => {
        const episodeId = input.episodeId === undefined ? (ctx.context.episodeId ?? null) : input.episodeId
        const revision = await tx.creativeResourceRevision.findFirst({
          where: {
            id: input.revisionId,
            resourceId: input.resourceId,
            resource: {
              userId: ctx.userId,
              status: 'ready',
              mediaType: 'text',
              schemaId: CREATIVE_RESOURCE_SCHEMA.SOURCE_SCRIPT,
            },
          },
          select: { fingerprint: true },
        })
        if (!revision) {
          throw new ApiError('NOT_FOUND', {
            code: 'CONFIRMED_SCREENPLAY_REVISION_NOT_FOUND',
            field: 'revisionId',
          })
        }
        const binding = await bindCreativeResourceRevisionInTransaction(tx, {
          scope: resolveProjectCreativeResourceScope({
            userId: ctx.userId,
            projectId: ctx.projectId,
            episodeId,
          }),
          ...CREATIVE_RESOURCE_CANONICAL_BINDINGS.confirmedScreenplay,
          resourceId: input.resourceId,
          revisionId: input.revisionId,
          source: 'script_confirmation',
          expectedVersion: input.expectedVersion ?? null,
        })
        return confirmScriptResourceOutputSchema.parse({
          success: true,
          binding,
          schemaId: CREATIVE_RESOURCE_SCHEMA.SOURCE_SCRIPT,
          fingerprint: revision.fingerprint,
        })
      },
    }),
  }
}
