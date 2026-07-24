import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { attachMediaFieldsToGlobalLocation } from '@/lib/media/attach'
import { normalizeImageGenerationCount } from '@/lib/image-generation/count'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'
import { requireOwnedAssetTarget } from '@/lib/assets/services/asset-scope-ownership'

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeFolderFilter(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  const text = normalizeString(value)
  if (!text) return undefined
  if (text === 'null') return null
  return text
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

function assertNoLegacyArtStyle(body: Record<string, unknown>) {
  if (!hasOwn(body, 'artStyle')) return
  throw new ApiError('INVALID_PARAMS', {
    code: 'LEGACY_ART_STYLE_REMOVED',
    field: 'artStyle',
    message: 'artStyle is no longer supported; use the AI-generated Creative Direction workflow.',
  })
}

export function createAssetHubLocationLibraryOperations(): ProjectAgentOperationRegistryDraft {
  return {
    asset_hub_list_locations: defineOperation({
      id: 'asset_hub_list_locations',
      summary: 'List global locations for the current user (optionally filtered by folderId).',
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
      inputSchema: z.object({
        folderId: z.string().optional(),
      }).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const folderId = normalizeFolderFilter((input as unknown as Record<string, unknown>).folderId)

        const where: Record<string, unknown> = { userId: ctx.userId }
        if (folderId === null) {
          where.folderId = null
        } else if (typeof folderId === 'string') {
          where.folderId = folderId
        }

        const locations = await prisma.globalLocation.findMany({
          where,
          include: { images: true },
          orderBy: { createdAt: 'desc' },
        })

        const signedLocations = await Promise.all(
          locations.map((location) => attachMediaFieldsToGlobalLocation(location)),
        )

        return { locations: signedLocations }
      },
    }),

    asset_hub_create_location: defineOperation({
      id: 'asset_hub_create_location',
      summary: 'Create a global location and its initial image placeholders.',
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
        const body = input as unknown as Record<string, unknown>
        assertNoLegacyArtStyle(body)
        const name = normalizeString(body.name)
        if (!name) throw new ApiError('INVALID_PARAMS')

        const folderId = normalizeString(body.folderId) || null
        if (folderId) {
          const folder = await transaction.globalAssetFolder.findUnique({
            where: { id: folderId },
            select: { id: true, userId: true },
          })
          if (!folder || folder.userId !== ctx.userId) throw new ApiError('INVALID_PARAMS')
        }

        const summary = normalizeString(body.summary) || null
        const count = hasOwn(body, 'count')
          ? normalizeImageGenerationCount('location', body.count)
          : 1

        const location = await transaction.globalLocation.create({
          data: {
            userId: ctx.userId,
            folderId,
            name,
            summary,
          },
        })

        await transaction.globalLocationImage.createMany({
          data: Array.from({ length: count }, (_value, imageIndex) => ({
            locationId: location.id,
            imageIndex,
            description: summary || name,
          })),
        })

        const withImages = await transaction.globalLocation.findUnique({
          where: { id: location.id },
          include: { images: true },
        })

        const withMedia = withImages
          ? await attachMediaFieldsToGlobalLocation(withImages, transaction)
          : null
        return { success: true, location: withMedia }
      },
    }),

    asset_hub_get_location: defineOperation({
      id: 'asset_hub_get_location',
      summary: 'Get a global location by id.',
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
      inputSchema: z.object({
        locationId: z.string().min(1),
      }),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const location = await prisma.globalLocation.findUnique({
          where: { id: input.locationId },
          include: { images: true },
        })
        if (!location || location.userId !== ctx.userId) throw new ApiError('NOT_FOUND')
        const withMedia = await attachMediaFieldsToGlobalLocation(location)
        return { location: withMedia }
      },
    }),

    asset_hub_update_location: defineOperation({
      id: 'asset_hub_update_location',
      summary: 'Update a global location (name/summary/folderId).',
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
        locationId: z.string().min(1),
      }).passthrough(),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        const body = input as unknown as Record<string, unknown>
        const locationId = normalizeString(body.locationId)
        if (!locationId) throw new ApiError('INVALID_PARAMS')

        await requireOwnedAssetTarget({
          access: { scope: 'global', userId: ctx.userId },
          kind: 'location',
          assetId: locationId,
        }, transaction)

        const updateData: Record<string, unknown> = {}
        if (body.name !== undefined) {
          if (typeof body.name !== 'string') throw new ApiError('INVALID_PARAMS')
          updateData.name = body.name.trim()
        }
        if (body.summary !== undefined) {
          updateData.summary = typeof body.summary === 'string' && body.summary.trim() ? body.summary.trim() : null
        }
        if (body.folderId !== undefined) {
          const folderId = normalizeString(body.folderId) || null
          if (folderId) {
            const folder = await transaction.globalAssetFolder.findUnique({
              where: { id: folderId },
              select: { id: true, userId: true },
            })
            if (!folder || folder.userId !== ctx.userId) throw new ApiError('INVALID_PARAMS')
          }
          updateData.folderId = folderId
        }

        const updated = await transaction.globalLocation.update({
          where: { id: locationId },
          data: updateData,
          include: { images: true },
        })

        const withMedia = await attachMediaFieldsToGlobalLocation(updated, transaction)
        return { success: true, location: withMedia }
      },
    }),

  }
}
