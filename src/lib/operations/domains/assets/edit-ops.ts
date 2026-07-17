import { z } from 'zod'
import { removeLocationPromptSuffix } from '@/lib/constants'
import { selectAssetRender } from '@/lib/assets/services/asset-actions'
import { decodeImageUrlsFromDb, encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'

const EFFECTS_OVERWRITE = {
  writes: true,
  workspaceResourceImpact: 'project_assets',
  billable: false,
  destructive: false,
  overwrite: false,
  bulk: false,
  externalSideEffects: false,
  longRunning: false,
} as const

const EFFECTS_DESTRUCTIVE_BULK = {
  writes: true,
  workspaceResourceImpact: 'project_assets',
  billable: false,
  destructive: true,
  overwrite: false,
  bulk: true,
  externalSideEffects: false,
  longRunning: false,
} as const

export function createEditOperations(): ProjectAgentOperationRegistryDraft {
  return {
    select_asset_render: defineOperation({
      id: 'select_asset_render',
      summary: 'Select an asset render (character/location) as the canonical chosen image.',
      intent: 'act',
      effects: EFFECTS_OVERWRITE,
      inputSchema: z.object({
        selection: z.discriminatedUnion('kind', [
          z.object({
            kind: z.literal('character'),
            assetId: z.string().trim().min(1).describe('Exact project character ID.'),
            appearanceId: z.string().trim().min(1).describe('Exact character appearance ID.'),
            imageIndex: z.number().int().min(0).nullable()
              .describe('Candidate image index to select, or null to clear the selection.'),
          }).strict(),
          z.object({
            kind: z.literal('location'),
            assetId: z.string().trim().min(1).describe('Exact project location ID.'),
            imageIndex: z.number().int().min(0).nullable()
              .describe('Candidate image index to select, or null to clear the selection.'),
          }).strict(),
        ]),
      }).strict(),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) =>
        selectAssetRender({
          kind: input.selection.kind,
          assetId: input.selection.assetId,
          body: {
            ...(input.selection.kind === 'character'
              ? { appearanceId: input.selection.appearanceId }
              : {}),
            imageIndex: input.selection.imageIndex ?? undefined,
          },
          access: {
            scope: 'project',
            userId: ctx.userId,
            projectId: ctx.projectId,
          },
        }, transaction),
    }),
    update_character_appearance_description: defineOperation({
      id: 'update_character_appearance_description',
      summary: 'Update a project character appearance description (supports indexed description variants).',
      intent: 'act',
      effects: EFFECTS_OVERWRITE,
      inputSchema: z.object({
        characterId: z.string().min(1),
        appearanceId: z.string().min(1),
        newDescription: z.string().min(1),
        descriptionIndex: z.number().int().min(0).optional().nullable(),
      }),
      outputSchema: z.object({ success: z.boolean() }),
      executeInTransaction: async (ctx, input, transaction) => {
        const appearance = await transaction.characterAppearance.findFirst({
          where: {
            id: input.appearanceId,
            characterId: input.characterId,
            character: { projectId: ctx.projectId },
          },
          select: {
            id: true,
            description: true,
            descriptions: true,
          },
        })
        if (!appearance) throw new Error('NOT_FOUND')

        const trimmedDescription = input.newDescription.trim()

        let descriptions: string[] = []
        if (appearance.descriptions) {
          try {
            const parsed = JSON.parse(appearance.descriptions)
            descriptions = Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []
          } catch {
            descriptions = []
          }
        }
        if (descriptions.length === 0) {
          descriptions = [appearance.description || '']
        }

        const index = input.descriptionIndex === undefined || input.descriptionIndex === null ? 0 : input.descriptionIndex
        while (descriptions.length <= index) descriptions.push('')
        descriptions[index] = trimmedDescription
        if (!descriptions[0]) descriptions[0] = trimmedDescription

        await transaction.characterAppearance.update({
          where: { id: appearance.id },
          data: {
            descriptions: JSON.stringify(descriptions),
            description: descriptions[0] || trimmedDescription,
          },
        })

        return { success: true }
      },
    }),
    update_location_image_description: defineOperation({
      id: 'update_location_image_description',
      summary: 'Update a project location image description (stored on locationImage record).',
      intent: 'act',
      effects: EFFECTS_OVERWRITE,
      inputSchema: z.object({
        locationId: z.string().min(1),
        imageIndex: z.number().int().min(0).max(50).optional(),
        newDescription: z.string().min(1),
      }),
      outputSchema: z.object({ success: z.boolean() }),
      executeInTransaction: async (ctx, input, transaction) => {
        const cleanDescription = removeLocationPromptSuffix(input.newDescription.trim())
        const imageIndex = input.imageIndex ?? 0

        const location = await transaction.projectLocation.findFirst({
          where: { id: input.locationId, projectId: ctx.projectId },
          select: { id: true },
        })
        if (!location) throw new Error('NOT_FOUND')

        const locationImage = await transaction.locationImage.findFirst({
          where: { locationId: input.locationId, imageIndex },
          select: { id: true },
        })
        if (!locationImage) throw new Error('NOT_FOUND')

        await transaction.locationImage.update({
          where: { id: locationImage.id },
          data: { description: cleanDescription },
        })
        return { success: true }
      },
    }),
    cleanup_unselected_images: defineOperation({
      id: 'cleanup_unselected_images',
      summary: 'Remove unselected character/location image relations and normalize selected indices.',
      intent: 'act',
      channels: { tool: false, api: true },
      effects: EFFECTS_DESTRUCTIVE_BULK,
      confirmation: {
        required: true,
        summary: '将移除未选中的图片关系并规范索引；共享媒体对象由独立生命周期管理。系统会在获得明确批准后执行同一份已审核请求。',
      },
      inputSchema: z.object({
      }),
      outputSchema: z.object({
        success: z.boolean(),
        deletedCount: z.number().int().nonnegative(),
      }),
      executeInTransaction: async (ctx, _input, transaction) => {
        let deletedCount = 0

        const appearances = await transaction.characterAppearance.findMany({
          where: { character: { projectId: ctx.projectId } },
          include: { character: true },
        })

        for (const appearance of appearances) {
          if (appearance.selectedIndex === null) continue
          const imageUrls = decodeImageUrlsFromDb(appearance.imageUrls, 'characterAppearance.imageUrls')
          if (imageUrls.length <= 1) continue

          for (let i = 0; i < imageUrls.length; i++) {
            if (i !== appearance.selectedIndex && imageUrls[i]) {
              deletedCount += 1
            }
          }

          const selectedUrl = imageUrls[appearance.selectedIndex]
          if (!selectedUrl) throw new Error(`CHARACTER_APPEARANCE_SELECTED_IMAGE_MISSING:${appearance.id}`)
          await transaction.characterAppearance.update({
            where: { id: appearance.id },
            data: {
              imageUrls: encodeImageUrls([selectedUrl]),
              selectedIndex: 0,
            },
          })
        }

        const locations = await transaction.projectLocation.findMany({
          where: { projectId: ctx.projectId },
          include: { images: true },
        })

        for (const location of locations) {
          const selectedImage = location.selectedImageId
            ? location.images.find((img) => img.id === location.selectedImageId)
            : location.images.find((img) => img.isSelected)
          if (!selectedImage) continue

          for (const img of location.images) {
            if (img.id !== selectedImage.id && img.imageUrl) {
              deletedCount += 1
              await transaction.locationImage.delete({ where: { id: img.id } })
            }
          }

          await transaction.locationImage.update({
            where: { id: selectedImage.id },
            data: { imageIndex: 0 },
          })
          await transaction.projectLocation.update({
            where: { id: location.id },
            data: { selectedImageId: selectedImage.id },
          })
        }

        return { success: true, deletedCount }
      },
    }),
  }
}
