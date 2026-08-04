import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function createAssetHubFolderOperations(): ProjectAgentOperationRegistryDraft {
  return {
    asset_hub_list_folders: defineOperation({
      id: 'asset_hub_list_folders',
      summary: 'List global asset folders for the current user.',
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
      inputSchema: z.object({}),
      outputSchema: z.unknown(),
      execute: async (ctx) => {
        const folders = await prisma.globalAssetFolder.findMany({
          where: { userId: ctx.userId },
          orderBy: { name: 'asc' },
        })
        return { folders }
      },
    }),

    asset_hub_create_folder: defineOperation({
      id: 'asset_hub_create_folder',
      summary: 'Create a global asset folder for the current user.',
      intent: 'act',
      effects: {
        writes: true,
        workspaceResourceImpact: 'global_assets',
        billable: false,
        destructive: false,
        overwrite: false,
        bulk: false,
        externalSideEffects: false,
        longRunning: false,
      },
      inputSchema: z.object({
        name: z.string().min(1),
      }).passthrough(),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        const name = normalizeString(input.name)
        if (!name) {
          throw new ApiError('INVALID_PARAMS')
        }
        const folder = await transaction.globalAssetFolder.create({
          data: {
            userId: ctx.userId,
            name,
          },
        })
        return { success: true, folder }
      },
    }),

    asset_hub_update_folder: defineOperation({
      id: 'asset_hub_update_folder',
      summary: 'Update a global asset folder name.',
      intent: 'act',
      effects: {
        writes: true,
        workspaceResourceImpact: 'global_assets',
        billable: false,
        destructive: false,
        overwrite: true,
        bulk: false,
        externalSideEffects: false,
        longRunning: false,
      },
      inputSchema: z.object({
        folderId: z.string().min(1),
        name: z.string().min(1),
      }).passthrough(),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        const name = normalizeString(input.name)
        if (!name) {
          throw new ApiError('INVALID_PARAMS')
        }

        const folder = await transaction.globalAssetFolder.findUnique({
          where: { id: input.folderId },
          select: { id: true, userId: true },
        })
        if (!folder || folder.userId !== ctx.userId) {
          throw new ApiError('FORBIDDEN')
        }

        const updatedFolder = await transaction.globalAssetFolder.update({
          where: { id: input.folderId },
          data: { name },
        })
        return { success: true, folder: updatedFolder }
      },
    }),

    asset_hub_delete_folder: defineOperation({
      id: 'asset_hub_delete_folder',
      summary: 'Delete a global asset folder and move assets to root.',
      intent: 'act',
      effects: {
        writes: true,
        workspaceResourceImpact: 'global_assets',
        billable: false,
        destructive: true,
        overwrite: false,
        bulk: true,
        externalSideEffects: false,
        longRunning: false,
      },
      confirmation: {
        required: true,
        summary: '将删除该资产文件夹（文件夹内资产会移动到根目录）。系统会在获得明确批准后执行同一份已审核请求。',
      },
      inputSchema: z.object({
        folderId: z.string().min(1),
      }).passthrough(),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        const folder = await transaction.globalAssetFolder.findUnique({
          where: { id: input.folderId },
          select: { id: true, userId: true },
        })

        if (!folder || folder.userId !== ctx.userId) {
          throw new ApiError('FORBIDDEN')
        }

        await transaction.globalCharacter.updateMany({
          where: { folderId: input.folderId },
          data: { folderId: null },
        })

        await transaction.globalLocation.updateMany({
          where: { folderId: input.folderId },
          data: { folderId: null },
        })

        await transaction.globalAssetFolder.delete({
          where: { id: input.folderId },
        })

        return { success: true }
      },
    }),
  }
}
