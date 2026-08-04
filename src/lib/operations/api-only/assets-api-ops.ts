import { z } from 'zod'
import { createAsset, revertAssetRender, selectAssetRender, updateAsset, updateAssetVariant } from '@/lib/assets/services/asset-actions'
import { readAssets } from '@/lib/assets/services/read-assets'
import type { AssetKind } from '@/lib/assets/contracts'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'

const ASSET_KINDS = ['character', 'location', 'prop'] as const
const ASSET_MUTABLE_KINDS = ['character', 'location', 'prop'] as const
const ASSET_CREATABLE_KINDS = ['location', 'prop'] as const

const scopeSchema = z.literal('global')
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
  workspaceResourceImpact: 'global_assets',
  billable: false,
  destructive: false,
  overwrite: false,
  bulk: false,
  externalSideEffects: false,
  longRunning: false,
} as const

const EFFECTS_WRITE_OVERWRITE = {
  writes: true,
  workspaceResourceImpact: 'global_assets',
  billable: false,
  destructive: false,
  overwrite: true,
  bulk: false,
  externalSideEffects: false,
  longRunning: false,
} as const

function omitBodyKeys(input: unknown, keys: ReadonlyArray<string>): Record<string, unknown> {
  const record = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
  const body: Record<string, unknown> = { ...record }
  for (const key of keys) {
    delete body[key]
  }
  return body
}

export function createAssetsApiOperations(): ProjectAgentOperationRegistryDraft {
  return {
    api_assets_read: defineOperation({
      id: 'api_assets_read',
      summary: 'API-only: Read global Asset Hub assets.',
      intent: 'query',
      effects: EFFECTS_QUERY,
      inputSchema: z.object({
        scope: scopeSchema,
        folderId: z.string().nullable().optional(),
        kind: kindSchema.nullable().optional(),
      }),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const folderId = typeof input.folderId === 'string' && input.folderId.trim() ? input.folderId.trim() : null
        const kind = input.kind ?? null

        const assets = await readAssets({ scope: 'global', folderId, kind }, { userId: ctx.userId })

        return { assets }
      },
    }),

    api_assets_create: defineOperation({
      id: 'api_assets_create',
      summary: 'API-only: Create a global Asset Hub location/prop.',
      intent: 'act',
      effects: EFFECTS_WRITE,
      inputSchema: z.object({
        scope: scopeSchema,
        kind: creatableKindSchema,
      }).passthrough(),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        return await createAsset({
          kind: input.kind,
          body: input as unknown as Record<string, unknown>,
          access: { scope: 'global', userId: ctx.userId },
        }, transaction)
      },
    }),

    api_assets_update: defineOperation({
      id: 'api_assets_update',
      summary: 'API-only: Update a global Asset Hub asset.',
      intent: 'act',
      effects: EFFECTS_WRITE,
      inputSchema: z.object({
        assetId: z.string().min(1),
        scope: scopeSchema,
        kind: kindSchema,
      }).passthrough(),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        const body = omitBodyKeys(input, ['assetId'])
        return await updateAsset({
          kind: input.kind,
          assetId: input.assetId,
          body,
          access: { scope: 'global', userId: ctx.userId },
        }, transaction)
      },
    }),

    api_assets_select_render: defineOperation({
      id: 'api_assets_select_render',
      summary: 'API-only: Select a global Asset Hub render.',
      intent: 'act',
      effects: EFFECTS_WRITE_OVERWRITE,
      inputSchema: z.object({
        assetId: z.string().min(1),
        scope: scopeSchema,
        kind: mutableKindSchema,
      }).passthrough(),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        const body = omitBodyKeys(input, ['assetId'])
        return await selectAssetRender({
          kind: input.kind,
          assetId: input.assetId,
          body,
          access: { scope: 'global', userId: ctx.userId },
        }, transaction)
      },
    }),

    api_assets_revert_render: defineOperation({
      id: 'api_assets_revert_render',
      summary: 'API-only: Revert a global Asset Hub render.',
      intent: 'act',
      effects: EFFECTS_WRITE_OVERWRITE,
      inputSchema: z.object({
        assetId: z.string().min(1),
        scope: scopeSchema,
        kind: mutableKindSchema,
      }).passthrough(),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        const body = omitBodyKeys(input, ['assetId'])
        return await revertAssetRender({
          kind: input.kind,
          assetId: input.assetId,
          body,
          access: { scope: 'global', userId: ctx.userId },
        }, transaction)
      },
    }),

    api_assets_update_variant: defineOperation({
      id: 'api_assets_update_variant',
      summary: 'API-only: Update a global Asset Hub variant.',
      intent: 'act',
      effects: EFFECTS_WRITE,
      inputSchema: z.object({
        assetId: z.string().min(1),
        variantId: z.string().min(1),
        scope: scopeSchema,
        kind: mutableKindSchema,
      }).passthrough(),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        const body = omitBodyKeys(input, ['assetId', 'variantId'])
        return await updateAssetVariant({
          kind: input.kind,
          assetId: input.assetId,
          variantId: input.variantId,
          body,
          access: { scope: 'global', userId: ctx.userId },
        }, transaction)
      },
    }),
  }
}
