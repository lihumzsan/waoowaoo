import { z } from 'zod'
import { removeAsset } from '@/lib/assets/services/asset-actions'
import { defineOperation } from '@/lib/operations/define-operation'
import type {
  ProjectAgentOperationRegistryDraft,
  ProjectAgentToolInputSchema,
} from '@/lib/operations/types'

const deleteAssetTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('character'), assetId: z.string().trim().min(1) }).strict(),
  z.object({ kind: z.literal('location'), assetId: z.string().trim().min(1) }).strict(),
  z.object({ kind: z.literal('prop'), assetId: z.string().trim().min(1) }).strict(),
])

const deleteAssetInputSchema = z.object({
  target: deleteAssetTargetSchema,
}).strict()

const deleteAssetToolInputSchema: ProjectAgentToolInputSchema = {
  type: 'object',
  properties: {
    target: {
      oneOf: [
        {
          type: 'object',
          properties: {
            kind: { const: 'character' },
            assetId: { type: 'string', minLength: 1 },
          },
          required: ['kind', 'assetId'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            kind: { const: 'location' },
            assetId: { type: 'string', minLength: 1 },
          },
          required: ['kind', 'assetId'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            kind: { const: 'prop' },
            assetId: { type: 'string', minLength: 1 },
          },
          required: ['kind', 'assetId'],
          additionalProperties: false,
        },
      ],
      description: 'Exact existing global Asset Hub identity to delete.',
    },
  },
  required: ['target'],
  additionalProperties: false,
}

export function createAssetDeleteOperations(): ProjectAgentOperationRegistryDraft {
  return {
    delete_asset: defineOperation({
      id: 'delete_asset',
      summary: 'Delete one exact global Asset Hub character, location, or prop without deleting shared media objects.',
      intent: 'act',
      channels: { tool: true, api: true, mcp: true },
      toolContractRevision: 'delete_asset/v1',
      effects: {
        writes: true,
        workspaceResourceImpact: 'global_assets',
        billable: false,
        destructive: true,
        overwrite: false,
        bulk: false,
        externalSideEffects: false,
        longRunning: false,
      },
      confirmation: {
        kind: 'destructive',
        required: true,
        summary: '将删除指定资产记录及其变体关系；共享媒体对象由独立生命周期管理。系统会在获得明确批准后执行同一份已审核请求。',
      },
      toolInputSchema: deleteAssetToolInputSchema,
      inputSchema: deleteAssetInputSchema,
      outputSchema: z.object({ success: z.literal(true) }),
      executeInTransaction: async (ctx, input, transaction) => {
        await removeAsset({
          kind: input.target.kind,
          assetId: input.target.assetId,
          access: { scope: 'global', userId: ctx.userId },
        }, transaction)
        return { success: true as const }
      },
    }),
  }
}
