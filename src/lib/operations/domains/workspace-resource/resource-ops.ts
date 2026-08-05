import { z } from 'zod'
import type { WorkspaceResourceView } from '@/lib/workspace-resource/contracts'
import {
  createWorkspaceResourceFolderInTransaction,
  moveWorkspaceResourceInTransaction,
  restoreWorkspaceResourceInTransaction,
  softDeleteWorkspaceResourceInTransaction,
} from '@/lib/workspace-resource/persistence'
import {
  listWorkspaceResourceTreePage,
  readWorkspaceResource,
} from '@/lib/workspace-resource/view-service'
import { WORKSPACE_RESOURCE_FOLDER_SCHEMA_ID } from '@/lib/workspace-resource/schema-registry'
import { defineOperation } from '@/lib/operations/define-operation'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'

const resourceViewSchema = z.custom<WorkspaceResourceView>((value) => (
  Boolean(value)
  && typeof value === 'object'
  && !Array.isArray(value)
  && typeof (value as { resourceId?: unknown }).resourceId === 'string'
  && typeof (value as { workspacePath?: unknown }).workspacePath === 'string'
), { message: 'WORKSPACE_RESOURCE_VIEW_INVALID' })

const listResourcesInputSchema = z.object({
  prefix: z.string().trim().min(1).max(512).nullable().optional(),
  search: z.string().trim().min(1).max(200).nullable().optional(),
  cursor: z.string().trim().min(1).max(1024).nullable().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  deleted: z.boolean().optional(),
}).strict()

const listResourcesOutputSchema = z.object({
  success: z.literal(true),
  resources: z.array(resourceViewSchema),
  nextCursor: z.string().nullable(),
}).strict()

const getResourceInputSchema = z.object({
  resourceId: z.string().trim().min(1).max(32),
}).strict()

const getResourceOutputSchema = z.object({ success: z.literal(true), resource: resourceViewSchema }).strict()

const createFolderInputSchema = z.object({
  outputPath: z.string().trim().min(1).max(512)
    .describe('Complete project-relative folder path. The virtual root is implicit and must not be created.'),
}).strict()

const createFolderOutputSchema = z.object({
  success: z.literal(true),
  resourceId: z.string().min(1),
  workspacePath: z.string().min(1),
}).strict()

const moveResourceInputSchema = z.object({
  resourceId: z.string().trim().min(1).max(32),
  destinationPath: z.string().trim().min(1).max(512),
}).strict()

const moveResourceOutputSchema = z.object({
  success: z.literal(true),
  resourceId: z.string().min(1),
  workspacePath: z.string().min(1),
  movedCount: z.number().int().positive(),
}).strict()

const deleteResourceInputSchema = z.object({
  resourceId: z.string().trim().min(1).max(32),
}).strict()

const deleteResourceOutputSchema = z.object({
  success: z.literal(true),
  deletedCount: z.number().int().positive(),
}).strict()

const restoreResourceInputSchema = z.object({
  resourceId: z.string().trim().min(1).max(32),
  destinationPath: z.string().trim().min(1).max(512).nullable().optional(),
}).strict()

const restoreResourceOutputSchema = z.object({
  success: z.literal(true),
  resourceId: z.string().min(1),
  workspacePath: z.string().min(1),
  restoredCount: z.number().int().positive(),
}).strict()

const readEffects = {
  writes: false,
  billable: false,
  destructive: false,
  overwrite: false,
  bulk: false,
  externalSideEffects: false,
  longRunning: false,
} as const

function writeEffects(input: { readonly destructive: boolean; readonly overwrite: boolean; readonly bulk: boolean }) {
  return {
    writes: true,
    workspaceResourceImpact: 'workspace_resources' as const,
    billable: false,
    destructive: input.destructive,
    overwrite: input.overwrite,
    bulk: input.bulk,
    externalSideEffects: false,
    longRunning: false,
  } as const
}

export function createWorkspaceResourceOperations(): ProjectAgentOperationRegistryDraft {
  return {
    list_resources: defineOperation({
      id: 'list_resources',
      summary: 'List the canonical project file/folder tree or search it. Results include stable hierarchy, exact versions, lineage summaries, alternatives, and server-projected actions.',
      intent: 'query',
      channels: { tool: true, api: true, mcp: true },
      effects: readEffects,
      inputSchema: listResourcesInputSchema,
      outputSchema: listResourcesOutputSchema,
      execute: async (ctx, input) => {
        const page = await listWorkspaceResourceTreePage({
          userId: ctx.userId,
          projectId: ctx.projectId,
          prefix: input.prefix,
          search: input.search,
          cursor: input.cursor,
          limit: input.limit,
          deleted: input.deleted,
        })
        return listResourcesOutputSchema.parse({ success: true, resources: page.items, nextCursor: page.nextCursor })
      },
    }),
    get_resource: defineOperation({
      id: 'get_resource',
      summary: 'Read one canonical project file or folder by stable Resource ID.',
      intent: 'query',
      channels: { tool: true, api: true, mcp: true },
      effects: readEffects,
      inputSchema: getResourceInputSchema,
      outputSchema: getResourceOutputSchema,
      execute: async (ctx, input) => getResourceOutputSchema.parse({
        success: true,
        resource: await readWorkspaceResource({
          userId: ctx.userId,
          projectId: ctx.projectId,
          resourceId: input.resourceId,
        }),
      }),
    }),
    create_folder: defineOperation({
      id: 'create_folder',
      summary: 'Create one durable empty project folder. Parent folders must already exist; the virtual project root is implicit.',
      intent: 'act',
      channels: { tool: false, api: true, mcp: false },
      toolContractRevision: 'create_folder/v1',
      effects: writeEffects({ destructive: false, overwrite: false, bulk: false }),
      resourceContract: {
        kind: 'resource',
        assistantPresentation: 'created_resources',
        acceptsReferences: false,
        outputResourceKinds: ['folder'],
        outputMediaTypes: [],
        outputSchemaIds: [WORKSPACE_RESOURCE_FOLDER_SCHEMA_ID],
        placement: 'required',
      },
      confirmation: { kind: 'none', required: false },
      inputSchema: createFolderInputSchema,
      outputSchema: createFolderOutputSchema,
      executeInTransaction: async (ctx, input, tx) => createFolderOutputSchema.parse({
        success: true,
        ...await createWorkspaceResourceFolderInTransaction(tx, {
          userId: ctx.userId,
          projectId: ctx.projectId,
          workspacePath: input.outputPath,
          sourceType: 'user_folder',
          sourceId: null,
        }),
      }),
    }),
    move_resource: defineOperation({
      id: 'move_resource',
      summary: 'Atomically rename or move a file, or move a complete folder subtree while preserving every Resource ID and content version.',
      intent: 'act',
      channels: { tool: false, api: true, mcp: false },
      toolContractRevision: 'move_resource/v1',
      effects: writeEffects({ destructive: false, overwrite: false, bulk: true }),
      resourceContract: { kind: 'none', reason: 'moves existing Resources without creating a new Resource' },
      confirmation: { kind: 'none', required: false },
      inputSchema: moveResourceInputSchema,
      outputSchema: moveResourceOutputSchema,
      executeInTransaction: async (ctx, input, tx) => moveResourceOutputSchema.parse({
        success: true,
        ...await moveWorkspaceResourceInTransaction(tx, {
          userId: ctx.userId,
          projectId: ctx.projectId,
          resourceId: input.resourceId,
          destinationPath: input.destinationPath,
        }),
      }),
    }),
    delete_resource: defineOperation({
      id: 'delete_resource',
      summary: 'Soft-delete one file or an entire folder subtree. Active or pending production Resources are rejected.',
      intent: 'act',
      channels: { tool: false, api: true, mcp: false },
      toolContractRevision: 'delete_resource/v2',
      effects: writeEffects({ destructive: true, overwrite: false, bulk: true }),
      resourceContract: { kind: 'none', reason: 'soft-deletes existing Resources without creating a new Resource' },
      confirmation: { kind: 'destructive', required: true },
      inputSchema: deleteResourceInputSchema,
      outputSchema: deleteResourceOutputSchema,
      executeInTransaction: async (ctx, input, tx) => deleteResourceOutputSchema.parse({
        success: true,
        deletedCount: await softDeleteWorkspaceResourceInTransaction(tx, {
          userId: ctx.userId,
          projectId: ctx.projectId,
          resourceId: input.resourceId,
        }),
      }),
    }),
    restore_resource: defineOperation({
      id: 'restore_resource',
      summary: 'Restore one soft-deleted file or the exact folder deletion cohort, optionally at a new conflict-free path.',
      intent: 'act',
      channels: { tool: true, api: true, mcp: true },
      toolContractRevision: 'restore_resource/v1',
      effects: writeEffects({ destructive: false, overwrite: false, bulk: true }),
      resourceContract: { kind: 'none', reason: 'restores existing Resources without creating a new Resource' },
      confirmation: { kind: 'none', required: false },
      inputSchema: restoreResourceInputSchema,
      outputSchema: restoreResourceOutputSchema,
      executeInTransaction: async (ctx, input, tx) => restoreResourceOutputSchema.parse({
        success: true,
        ...await restoreWorkspaceResourceInTransaction(tx, {
          userId: ctx.userId,
          projectId: ctx.projectId,
          resourceId: input.resourceId,
          workspacePath: input.destinationPath,
        }),
      }),
    }),
  }
}
