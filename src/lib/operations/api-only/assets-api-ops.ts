import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import { createAsset, copyAssetFromGlobal, ensureAssetGenerateCommitReady, planAssetGenerateTask, removeAsset, revertAssetRender, selectAssetRender, updateAsset, updateAssetVariant } from '@/lib/assets/services/asset-actions'
import { readAssets } from '@/lib/assets/services/read-assets'
import { uploadProjectAssetRender } from '@/lib/assets/services/project-upload-render'
import type { ProjectUploadRenderInput } from '@/lib/assets/upload-render-form'
import type { AssetKind, AssetScope } from '@/lib/assets/contracts'
import type { ProjectAgentOperationContext, ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import {
  submitPlannedOperationTask,
  type OperationPlan,
} from '@/lib/operations/planning'

const ASSET_SCOPES = ['global', 'project'] as const
const ASSET_KINDS = ['character', 'location', 'prop'] as const
const ASSET_MUTABLE_KINDS = ['character', 'location', 'prop'] as const
const ASSET_CREATABLE_KINDS = ['location', 'prop'] as const

const scopeSchema = z.enum(ASSET_SCOPES satisfies ReadonlyArray<AssetScope>)
const kindSchema = z.enum(ASSET_KINDS satisfies ReadonlyArray<AssetKind>)
const mutableKindSchema = z.enum(ASSET_MUTABLE_KINDS satisfies ReadonlyArray<Extract<AssetKind, 'character' | 'location' | 'prop'>>)
const creatableKindSchema = z.enum(ASSET_CREATABLE_KINDS satisfies ReadonlyArray<Extract<AssetKind, 'location' | 'prop'>>)

const EFFECTS_QUERY = {
  writes: false,
  billable: false,
  destructive: false,
  overwrite: false,
  bulk: false,
  externalSideEffects: false,
  longRunning: false,
} as const

const EFFECTS_WRITE = {
  writes: true,
  billable: false,
  destructive: false,
  overwrite: false,
  bulk: false,
  externalSideEffects: false,
  longRunning: false,
} as const

const EFFECTS_WRITE_OVERWRITE = {
  writes: true,
  billable: false,
  destructive: false,
  overwrite: true,
  bulk: false,
  externalSideEffects: false,
  longRunning: false,
} as const

const EFFECTS_LONG_RUNNING = {
  writes: true,
  billable: true,
  destructive: false,
  overwrite: false,
  bulk: false,
  externalSideEffects: true,
  longRunning: true,
} as const

const EFFECTS_UPLOAD_OVERWRITE = {
  writes: true,
  billable: false,
  destructive: false,
  overwrite: true,
  bulk: false,
  externalSideEffects: true,
  longRunning: true,
} as const

function requireProjectId(scope: AssetScope, projectId: unknown): string {
  if (scope !== 'project') return ''
  if (typeof projectId === 'string' && projectId.trim()) return projectId.trim()
  throw new ApiError('INVALID_PARAMS', { details: 'projectId is required for project scope' })
}

function readOptionalEpisodeId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function omitBodyKeys(input: unknown, keys: ReadonlyArray<string>): Record<string, unknown> {
  const record = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
  const body: Record<string, unknown> = { ...record }
  for (const key of keys) {
    delete body[key]
  }
  return body
}

function isProjectUploadRenderInput(value: unknown): value is ProjectUploadRenderInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<ProjectUploadRenderInput>
  return typeof record.assetId === 'string'
    && record.scope === 'project'
    && (record.kind === 'character' || record.kind === 'location')
    && typeof record.projectId === 'string'
    && !!record.file
}

async function planAssetGenerateOperation(
  ctx: ProjectAgentOperationContext,
  input: z.infer<ReturnType<typeof buildAssetGenerateSchema>>,
): Promise<OperationPlan> {
  const projectId = requireProjectId(input.scope, input.projectId)
  const episodeId = readOptionalEpisodeId(input.episodeId)
  const body = omitBodyKeys(input, ['assetId'])
  const planned = await planAssetGenerateTask({
    request: ctx.request,
    kind: input.kind,
    assetId: input.assetId,
    body,
    episodeId,
    access: input.scope === 'project'
      ? { scope: 'project', userId: ctx.userId, projectId }
      : { scope: 'global', userId: ctx.userId },
  })
  return {
    kind: 'task_submission',
    operationId: 'api_assets_generate',
    projectId: planned.projectId,
    userId: planned.userId,
    tasks: [planned.task],
  }
}

async function commitAssetGenerateOperation(
  ctx: ProjectAgentOperationContext,
  input: z.infer<ReturnType<typeof buildAssetGenerateSchema>>,
  plan: OperationPlan,
) {
  const task = plan.tasks[0]
  if (!task) throw new Error('PROJECT_AGENT_OPERATION_PLAN_EMPTY')
  const projectId = requireProjectId(input.scope, input.projectId)
  const episodeId = readOptionalEpisodeId(input.episodeId)
  const body = omitBodyKeys(input, ['assetId'])
  await ensureAssetGenerateCommitReady({
    request: ctx.request,
    kind: input.kind,
    assetId: input.assetId,
    body,
    episodeId,
    access: input.scope === 'project'
      ? { scope: 'project', userId: ctx.userId, projectId }
      : { scope: 'global', userId: ctx.userId },
  })
  return await submitPlannedOperationTask({
    ctx,
    task,
    operationId: 'api_assets_generate',
  })
}

function buildAssetGenerateSchema() {
  return z.object({
    assetId: z.string().min(1),
    scope: scopeSchema,
    kind: mutableKindSchema,
    projectId: z.string().optional(),
  }).passthrough()
}

export function createAssetsApiOperations(): ProjectAgentOperationRegistryDraft {
  return {
    api_assets_read: defineOperation({
      id: 'api_assets_read',
      summary: 'API-only: Read assets with scope filter.',
      intent: 'query',
      effects: EFFECTS_QUERY,
      inputSchema: z.object({
        scope: scopeSchema,
        projectId: z.string().nullable().optional(),
        folderId: z.string().nullable().optional(),
        kind: kindSchema.nullable().optional(),
      }),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const scope = input.scope
        const projectId = typeof input.projectId === 'string' && input.projectId.trim() ? input.projectId.trim() : null
        const folderId = typeof input.folderId === 'string' && input.folderId.trim() ? input.folderId.trim() : null
        const kind = input.kind ?? null

        const assets = scope === 'global'
          ? await readAssets({ scope, projectId, folderId, kind }, { userId: ctx.userId })
          : await readAssets({ scope, projectId: requireProjectId(scope, projectId), folderId, kind })

        return { assets }
      },
    }),

    api_assets_create: defineOperation({
      id: 'api_assets_create',
      summary: 'API-only: Create a location/prop asset (global or project scope).',
      intent: 'act',
      effects: EFFECTS_WRITE,
      inputSchema: z.object({
        scope: scopeSchema,
        kind: creatableKindSchema,
        projectId: z.string().optional(),
      }).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const scope = input.scope
        const projectId = requireProjectId(scope, input.projectId)
        return await createAsset({
          kind: input.kind,
          body: input as unknown as Record<string, unknown>,
          access: scope === 'project'
            ? { scope: 'project', userId: ctx.userId, projectId }
            : { scope: 'global', userId: ctx.userId },
        })
      },
    }),

    api_assets_update: defineOperation({
      id: 'api_assets_update',
      summary: 'API-only: Update an asset record (global or project scope).',
      intent: 'act',
      effects: EFFECTS_WRITE,
      inputSchema: z.object({
        assetId: z.string().min(1),
        scope: scopeSchema,
        kind: kindSchema,
        projectId: z.string().optional(),
      }).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const projectId = requireProjectId(input.scope, input.projectId)
        const body = omitBodyKeys(input, ['assetId'])
        return await updateAsset({
          kind: input.kind,
          assetId: input.assetId,
          body,
          access: input.scope === 'project'
            ? { scope: 'project', userId: ctx.userId, projectId }
            : { scope: 'global', userId: ctx.userId },
        })
      },
    }),

    api_assets_remove: defineOperation({
      id: 'api_assets_remove',
      summary: 'API-only: Remove a location/prop asset (global or project scope).',
      intent: 'act',
      effects: {
        ...EFFECTS_WRITE,
        destructive: true,
      },
      inputSchema: z.object({
        assetId: z.string().min(1),
        scope: scopeSchema,
        kind: z.enum(['location', 'prop']),
        projectId: z.string().optional(),
      }),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const projectId = requireProjectId(input.scope, input.projectId)
        return await removeAsset({
          kind: input.kind,
          assetId: input.assetId,
          access: input.scope === 'project'
            ? { scope: 'project', userId: ctx.userId, projectId }
            : { scope: 'global', userId: ctx.userId },
        })
      },
    }),

    api_assets_generate: defineOperation({
      id: 'api_assets_generate',
      summary: 'API-only: Submit asset generate task (global or project scope).',
      intent: 'act',
      effects: EFFECTS_LONG_RUNNING,
      confirmation: { kind: 'billable_media', required: true },
      inputSchema: buildAssetGenerateSchema(),
      outputSchema: z.unknown(),
      plan: async (ctx, input) => planAssetGenerateOperation(ctx, input),
      commit: async (ctx, input, plan) => commitAssetGenerateOperation(ctx, input, plan),
    }),

    api_assets_upload_render: defineOperation({
      id: 'api_assets_upload_render',
      summary: 'API-only: Upload a project asset render into character/location image slots.',
      intent: 'act',
      effects: EFFECTS_UPLOAD_OVERWRITE,
      inputSchema: z.custom<ProjectUploadRenderInput>(isProjectUploadRenderInput),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const projectId = requireProjectId(input.scope, input.projectId)
        const imageBuffer = Buffer.from(await input.file.arrayBuffer())
        return await uploadProjectAssetRender({
          userId: ctx.userId,
          projectId,
          kind: input.kind,
          assetId: input.assetId,
          imageBuffer,
          locale: resolveRequiredTaskLocale(ctx.request, {
            scope: input.scope,
            kind: input.kind,
            projectId,
            assetId: input.assetId,
            imageIndex: input.imageIndex,
          }),
          ...(input.appearanceId ? { appearanceId: input.appearanceId } : {}),
          ...(input.imageIndex !== undefined ? { imageIndex: input.imageIndex } : {}),
        })
      },
    }),

    api_assets_select_render: defineOperation({
      id: 'api_assets_select_render',
      summary: 'API-only: Select an asset render (global or project scope).',
      intent: 'act',
      effects: EFFECTS_WRITE_OVERWRITE,
      inputSchema: z.object({
        assetId: z.string().min(1),
        scope: scopeSchema,
        kind: mutableKindSchema,
        projectId: z.string().optional(),
      }).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const projectId = requireProjectId(input.scope, input.projectId)
        const body = omitBodyKeys(input, ['assetId'])
        return await selectAssetRender({
          kind: input.kind,
          assetId: input.assetId,
          body,
          access: input.scope === 'project'
            ? { scope: 'project', userId: ctx.userId, projectId }
            : { scope: 'global', userId: ctx.userId },
        })
      },
    }),

    api_assets_revert_render: defineOperation({
      id: 'api_assets_revert_render',
      summary: 'API-only: Revert an asset render (global or project scope).',
      intent: 'act',
      effects: EFFECTS_WRITE_OVERWRITE,
      inputSchema: z.object({
        assetId: z.string().min(1),
        scope: scopeSchema,
        kind: mutableKindSchema,
        projectId: z.string().optional(),
      }).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const projectId = requireProjectId(input.scope, input.projectId)
        const body = omitBodyKeys(input, ['assetId'])
        return await revertAssetRender({
          kind: input.kind,
          assetId: input.assetId,
          body,
          access: input.scope === 'project'
            ? { scope: 'project', userId: ctx.userId, projectId }
            : { scope: 'global', userId: ctx.userId },
        })
      },
    }),

    api_assets_copy_from_global: defineOperation({
      id: 'api_assets_copy_from_global',
      summary: 'API-only: Copy a global asset into a project target asset.',
      intent: 'act',
      effects: EFFECTS_WRITE_OVERWRITE,
      inputSchema: z.object({
        assetId: z.string().min(1),
        projectId: z.string().min(1),
        globalAssetId: z.string().min(1),
        kind: kindSchema,
      }),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        return await copyAssetFromGlobal({
          kind: input.kind,
          targetId: input.assetId,
          globalAssetId: input.globalAssetId,
          access: {
            userId: ctx.userId,
            projectId: input.projectId,
          },
        })
      },
    }),

    api_assets_update_variant: defineOperation({
      id: 'api_assets_update_variant',
      summary: 'API-only: Update an asset variant record (global or project scope).',
      intent: 'act',
      effects: EFFECTS_WRITE,
      inputSchema: z.object({
        assetId: z.string().min(1),
        variantId: z.string().min(1),
        scope: scopeSchema,
        kind: mutableKindSchema,
        projectId: z.string().optional(),
      }).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const projectId = requireProjectId(input.scope, input.projectId)
        const body = omitBodyKeys(input, ['assetId', 'variantId'])
        return await updateAssetVariant({
          kind: input.kind,
          assetId: input.assetId,
          variantId: input.variantId,
          body,
          access: input.scope === 'project'
            ? { scope: 'project', userId: ctx.userId, projectId }
            : { scope: 'global', userId: ctx.userId },
        })
      },
    }),
  }
}
