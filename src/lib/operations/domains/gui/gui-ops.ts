import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { resolveMediaRefFromLegacyValue } from '@/lib/media/service'
import { encodeImageUrls, decodeImageUrlsFromDb } from '@/lib/contracts/image-urls-contract'
import { removeLocationPromptSuffix } from '@/lib/constants'
import { normalizeImageGenerationCount } from '@/lib/image-generation/count'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'
import { readProjectEpisodeDetail } from '@/lib/projects/read-episode-detail'
import { createProjectEpisodeInTransaction } from '@/lib/projects/episode-service'
import { createOrReuseProjectAssetInTransaction } from '@/lib/assets/services/project-asset-writer'

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
  workspaceResourceImpact: 'none',
  billable: false,
  destructive: false,
  overwrite: false,
  bulk: false,
  externalSideEffects: false,
  longRunning: false,
} as const

const EFFECTS_WRITE_OVERWRITE = {
  ...EFFECTS_WRITE,
  overwrite: true,
} as const

const EFFECTS_WRITE_DESTRUCTIVE = {
  ...EFFECTS_WRITE,
  destructive: true,
} as const

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function createGuiOperations(): ProjectAgentOperationRegistryDraft {
  return {
    create_character: defineOperation({
      id: 'create_character',
      summary: 'Create a project character and its primary appearance.',
      intent: 'act',
      effects: { ...EFFECTS_WRITE, workspaceResourceImpact: 'project_assets' },
      inputSchema: z.object({
        name: z.string().min(1),
        description: z.string().optional(),
      }).passthrough(),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        const name = normalizeString(input.name)
        const description = normalizeString(input.description)

        if (!name) {
          throw new ApiError('INVALID_PARAMS')
        }
        const descText = description || `${name} 的角色设定`
        const written = await createOrReuseProjectAssetInTransaction({
          tx: transaction,
          projectId: ctx.projectId,
          kind: 'character',
          name,
          stableDescription: descText,
        })

        const characterWithAppearances = await transaction.projectCharacter.findUnique({
          where: { id: written.assetId },
          include: { appearances: true },
        })

        return { success: true, character: characterWithAppearances }
      },
    }),
    update_character: defineOperation({
      id: 'update_character',
      summary: 'Update a character name/introduction.',
      intent: 'act',
      effects: { ...EFFECTS_WRITE_OVERWRITE, workspaceResourceImpact: 'project_assets' },
      inputSchema: z.object({
        characterId: z.string().min(1),
        name: z.string().optional(),
        introduction: z.string().optional().nullable(),
      }),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        const updateData: { name?: string; introduction?: string } = {}
        if (input.name) updateData.name = input.name.trim()
        if (input.introduction !== undefined && input.introduction !== null) updateData.introduction = input.introduction.trim()
        if (Object.keys(updateData).length === 0) throw new ApiError('INVALID_PARAMS')

        const character = await transaction.projectCharacter.findFirst({
          where: { id: input.characterId, projectId: ctx.projectId },
          select: { id: true },
        })
        if (!character) throw new ApiError('NOT_FOUND')

        const updated = await transaction.projectCharacter.update({
          where: { id: input.characterId },
          data: updateData,
	        })
	        return { success: true, character: updated }
	      },
	    }),
	    create_character_appearance: defineOperation({
	      id: 'create_character_appearance',
	      summary: 'Add a new character appearance record.',
	      intent: 'act',
	      effects: { ...EFFECTS_WRITE, workspaceResourceImpact: 'project_assets' },
	      inputSchema: z.object({
	        characterId: z.string().min(1),
	        changeReason: z.string().min(1),
	        description: z.string().min(1),
      }),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        const character = await transaction.projectCharacter.findUnique({
          where: { id: input.characterId },
          include: {
            appearances: { orderBy: { appearanceIndex: 'asc' } },
          },
        })
        if (!character || character.projectId !== ctx.projectId) throw new ApiError('NOT_FOUND')

        const maxIndex = character.appearances.reduce((max, app) => Math.max(max, app.appearanceIndex), 0)
        const newIndex = maxIndex + 1
        const trimmed = input.description.trim()

        const appearance = await transaction.characterAppearance.create({
          data: {
            characterId: input.characterId,
            appearanceIndex: newIndex,
            changeReason: input.changeReason.trim(),
            description: trimmed,
            descriptions: JSON.stringify([trimmed]),
            imageUrls: encodeImageUrls([]),
            previousImageUrls: encodeImageUrls([]),
          },
        })

	        return { success: true, appearance }
	      },
	    }),
	    update_character_appearance: defineOperation({
	      id: 'update_character_appearance',
	      summary: 'Update a character appearance description list.',
	      intent: 'act',
	      effects: { ...EFFECTS_WRITE_OVERWRITE, workspaceResourceImpact: 'project_assets' },
	      inputSchema: z.object({
	        characterId: z.string().min(1),
	        appearanceId: z.string().min(1),
	        description: z.string().min(1),
	        descriptionIndex: z.number().int().min(0).optional(),
      }),
      outputSchema: z.object({ success: z.boolean() }),
      executeInTransaction: async (ctx, input, transaction) => {
        const appearance = await transaction.characterAppearance.findUnique({
          where: { id: input.appearanceId },
          include: { character: true },
        })
        if (!appearance) throw new ApiError('NOT_FOUND')
        if (appearance.characterId !== input.characterId) throw new ApiError('INVALID_PARAMS')
        if (appearance.character.projectId !== ctx.projectId) throw new ApiError('INVALID_PARAMS')

        const trimmedDesc = input.description.trim()

        let descriptions: string[] = []
        try {
          descriptions = appearance.descriptions ? JSON.parse(appearance.descriptions) : []
        } catch {
          descriptions = []
        }
        const idx = typeof input.descriptionIndex === 'number' ? input.descriptionIndex : 0
        if (idx >= 0 && idx < descriptions.length) {
          descriptions[idx] = trimmedDesc
        } else {
          descriptions.push(trimmedDesc)
        }

        await transaction.characterAppearance.update({
          where: { id: input.appearanceId },
          data: {
            description: trimmedDesc,
            descriptions: JSON.stringify(descriptions),
          },
	        })
	        return { success: true }
	      },
	    }),
	    delete_character_appearance: defineOperation({
	      id: 'delete_character_appearance',
	      summary: 'Delete a character appearance relation and then reindex appearanceIndex.',
	      intent: 'act',
	      effects: {
	        writes: true,
	        workspaceResourceImpact: 'project_assets',
	        billable: false,
	        destructive: true,
	        overwrite: true,
	        bulk: true,
	        externalSideEffects: false,
	        longRunning: false,
	      },
	      confirmation: {
	        required: true,
	        summary: '将删除该角色形象关系并重排索引；共享媒体对象由独立生命周期管理。系统会在获得明确批准后执行同一份已审核请求。',
	      },
			      inputSchema: z.object({
			        characterId: z.string().min(1),
			        appearanceId: z.string().min(1),
		      }),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        const appearance = await transaction.characterAppearance.findUnique({
          where: { id: input.appearanceId },
          include: { character: true },
        })
        if (!appearance) throw new ApiError('NOT_FOUND')
        if (appearance.characterId !== input.characterId) throw new ApiError('INVALID_PARAMS')
        if (appearance.character.projectId !== ctx.projectId) throw new ApiError('INVALID_PARAMS')

        const appearanceCount = await transaction.characterAppearance.count({
          where: { characterId: input.characterId },
        })
        if (appearanceCount <= 1) {
          throw new ApiError('INVALID_PARAMS')
        }

        const deletedImageCount = decodeImageUrlsFromDb(
          appearance.imageUrls,
          'characterAppearance.imageUrls',
        ).filter(Boolean).length

        await transaction.characterAppearance.delete({
          where: { id: input.appearanceId },
        })

        const remaining = await transaction.characterAppearance.findMany({
          where: { characterId: input.characterId },
          orderBy: { appearanceIndex: 'asc' },
        })
        for (let i = 0; i < remaining.length; i++) {
          if (remaining[i].appearanceIndex !== i) {
            await transaction.characterAppearance.update({
              where: { id: remaining[i].id },
              data: { appearanceIndex: i },
            })
          }
        }

	        return { success: true, deletedImages: deletedImageCount }
	      },
	    }),
	    confirm_character_appearance_selection: defineOperation({
	      id: 'confirm_character_appearance_selection',
	      summary: 'Confirm a chosen character appearance image and remove other candidate relations.',
	      intent: 'act',
	      effects: {
	        writes: true,
	        workspaceResourceImpact: 'project_assets',
	        billable: false,
	        destructive: true,
	        overwrite: true,
	        bulk: true,
	        externalSideEffects: false,
	        longRunning: false,
	      },
	      confirmation: {
	        required: true,
	        summary: '将确认角色形象选择并移除其他候选关系；共享媒体对象由独立生命周期管理。系统会在获得明确批准后执行同一份已审核请求。',
	      },
	      inputSchema: z.object({
		        characterId: z.string().min(1),
		        appearanceId: z.string().min(1),
		        selectedIndex: z.number().int().min(0).optional(),
	      }),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        const appearance = await transaction.characterAppearance.findUnique({
          where: { id: input.appearanceId },
          include: { character: true },
        })
        if (!appearance) throw new ApiError('NOT_FOUND')
        if (appearance.characterId !== input.characterId) throw new ApiError('INVALID_PARAMS')
        if (appearance.character.projectId !== ctx.projectId) throw new ApiError('INVALID_PARAMS')

	        const imageUrls = decodeImageUrlsFromDb(appearance.imageUrls, 'characterAppearance.imageUrls')
	        const selectedIndex = input.selectedIndex ?? appearance.selectedIndex
	        if (selectedIndex === null || selectedIndex === undefined) {
	          throw new ApiError('INVALID_PARAMS')
	        }
	        const selectedImageUrl = imageUrls[selectedIndex]
	        if (!selectedImageUrl) throw new ApiError('NOT_FOUND')
	        if (imageUrls.length <= 1) {
	          await transaction.characterAppearance.update({
	            where: { id: appearance.id },
	            data: { imageUrl: selectedImageUrl, selectedIndex: 0 },
	          })
	          return { success: true, message: '已确认选择', deletedCount: 0 }
	        }

        let deletedCount = 0
        for (let i = 0; i < imageUrls.length; i++) {
          if (i === selectedIndex || !imageUrls[i]) continue
          deletedCount += 1
        }

        let descriptions: string[] = []
        if (appearance.descriptions) {
          try { descriptions = JSON.parse(appearance.descriptions) } catch { descriptions = [] }
        }
        const selectedDescription = descriptions[selectedIndex] || appearance.description || ''

        await transaction.characterAppearance.update({
          where: { id: appearance.id },
          data: {
            imageUrl: selectedImageUrl,
            imageUrls: encodeImageUrls([selectedImageUrl]),
            selectedIndex: 0,
            description: selectedDescription,
            descriptions: JSON.stringify([selectedDescription]),
          },
        })

	        return { success: true, message: '已确认选择，其他候选图片已删除', deletedCount }
	      },
	    }),
	    create_location: defineOperation({
	      id: 'create_location',
	      summary: 'Create a project location and its initial locationImage records.',
	      intent: 'act',
	      effects: { ...EFFECTS_WRITE, workspaceResourceImpact: 'project_assets' },
      inputSchema: z.object({
        name: z.string().min(1),
        description: z.string().min(1),
        summary: z.string().optional(),
        count: z.number().int().positive().max(6).optional(),
      }).passthrough(),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        const name = normalizeString(input.name)
        const description = normalizeString(input.description)
        const summary = normalizeString(input.summary)
        const count = Object.prototype.hasOwnProperty.call(input, 'count')
          ? normalizeImageGenerationCount('location', (input as Record<string, unknown>).count)
          : 1

        if (!name || !description) {
          throw new ApiError('INVALID_PARAMS')
        }

        const written = await createOrReuseProjectAssetInTransaction({
          tx: transaction,
          projectId: ctx.projectId,
          kind: 'location',
          name,
          summary,
          stableDescription: removeLocationPromptSuffix(description),
          imageSlotCount: count,
        })

        const locationWithImages = await transaction.projectLocation.findUnique({
          where: { id: written.assetId },
          include: { images: true },
        })

	        return { success: true, location: locationWithImages }
	      },
	    }),
	    patch_location: defineOperation({
	      id: 'patch_location',
	      summary: 'Update a location name/summary or update locationImage description.',
	      intent: 'act',
	      effects: { ...EFFECTS_WRITE_OVERWRITE, workspaceResourceImpact: 'project_assets' },
	      inputSchema: z.object({
	        locationId: z.string().min(1),
	        name: z.string().optional(),
        summary: z.string().optional().nullable(),
        imageIndex: z.number().int().min(0).max(50).optional(),
        description: z.string().optional(),
      }).passthrough(),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        const location = await transaction.projectLocation.findFirst({
          where: { id: input.locationId, projectId: ctx.projectId },
          select: { id: true },
        })
        if (!location) throw new ApiError('NOT_FOUND')

        if (input.name !== undefined || (input as Record<string, unknown>).summary !== undefined) {
          const updateData: { name?: string; summary?: string | null } = {}
          if (input.name !== undefined) updateData.name = input.name.trim()
          if ((input as Record<string, unknown>).summary !== undefined) {
            updateData.summary = (input as Record<string, unknown>).summary
              ? String((input as Record<string, unknown>).summary).trim()
              : null
          }
          const updated = await transaction.projectLocation.update({
            where: { id: input.locationId },
            data: updateData,
          })
          return { success: true, location: updated }
        }

        if (input.imageIndex !== undefined && input.description) {
          const cleanDescription = removeLocationPromptSuffix(input.description.trim())
          const image = await transaction.locationImage.update({
            where: {
              locationId_imageIndex: { locationId: input.locationId, imageIndex: input.imageIndex },
            },
            data: {
              description: cleanDescription,
            },
          })
          return { success: true, image }
        }

	        throw new ApiError('INVALID_PARAMS')
	      },
	    }),
	    confirm_location_selection: defineOperation({
	      id: 'confirm_location_selection',
	      summary: 'Confirm the selected location image and remove other candidate relations.',
	      intent: 'act',
	      effects: {
	        ...EFFECTS_WRITE_DESTRUCTIVE,
        workspaceResourceImpact: 'project_assets',
	        overwrite: true,
	        bulk: true,
	        externalSideEffects: false,
	      },
	      confirmation: {
	        required: true,
	        summary: '将确认场景选择并移除其他候选关系；共享媒体对象由独立生命周期管理。系统会在获得明确批准后执行同一份已审核请求。',
	      },
	      inputSchema: z.object({
		        locationId: z.string().min(1),
		        selectedIndex: z.number().int().min(0).optional(),
	      }),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        const location = await transaction.projectLocation.findFirst({
          where: { id: input.locationId, projectId: ctx.projectId },
          include: { images: { orderBy: { imageIndex: 'asc' } } },
        })
        if (!location) throw new ApiError('NOT_FOUND')

        const images = location.images || []
        if (images.length <= 1) {
          return { success: true, message: '已确认选择', deletedCount: 0 }
        }

	        const selectedImage = input.selectedIndex !== undefined
	          ? images.find((img) => img.imageIndex === input.selectedIndex)
	          : location.selectedImageId
	            ? images.find((img) => img.id === location.selectedImageId)
	            : images.find((img) => img.isSelected)
	        if (!selectedImage) throw new ApiError('INVALID_PARAMS')
	        if (!selectedImage.imageUrl) throw new ApiError('INVALID_PARAMS')

        const imagesToDelete = images.filter((img) => img.id !== selectedImage.id)
        let deletedCount = 0
        for (const img of imagesToDelete) {
          if (!img.imageUrl) continue
          deletedCount += 1
        }

        await transaction.locationImage.deleteMany({
            where: {
              locationId: input.locationId,
              id: { not: selectedImage.id },
            },
          })
	        await transaction.locationImage.update({
	            where: { id: selectedImage.id },
	            data: { imageIndex: 0, isSelected: true },
	          })
        await transaction.projectLocation.update({
            where: { id: input.locationId },
            data: { selectedImageId: selectedImage.id },
        })

	        return { success: true, message: '已确认选择，其他候选图片已删除', deletedCount }
	      },
	    }),
    create_episode: defineOperation({
      id: 'create_episode',
      summary: 'Create a new episode in a project and update lastEpisodeId.',
      intent: 'act',
      effects: { ...EFFECTS_WRITE_OVERWRITE, workspaceResourceImpact: 'project_data' },
      inputSchema: z.object({
        name: z.string().min(1),
        description: z.string().optional().nullable(),
        novelText: z.string().optional(),
      }),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        const created = await createProjectEpisodeInTransaction({
          transaction,
          projectId: ctx.projectId,
          userId: ctx.userId,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          ...(typeof input.novelText === 'string' ? { novelText: input.novelText } : {}),
        })
        return { episode: created.episode }
      },
    }),
    list_episodes: defineOperation({
      id: 'list_episodes',
      summary: 'List episodes for a project ordered by episodeNumber.',
      intent: 'query',
      effects: EFFECTS_QUERY,
      inputSchema: z.object({}).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx) => {
        const episodes = await prisma.projectEpisode.findMany({
          where: { projectId: ctx.projectId },
          orderBy: { episodeNumber: 'asc' },
        })

        return { episodes }
      },
    }),
    get_episode_detail: defineOperation({
      id: 'get_episode_detail',
      summary: 'Get full episode data with edit plans and video segments.',
      intent: 'query',
      effects: EFFECTS_QUERY,
      inputSchema: z.object({
        episodeId: z.string().min(1),
      }),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        return {
          episode: await readProjectEpisodeDetail({
            projectId: ctx.projectId,
            episodeId: input.episodeId,
          }),
        }
      },
    }),
    update_episode: defineOperation({
      id: 'update_episode',
      summary: 'Update an episode fields including audio media ref.',
      intent: 'act',
      effects: { ...EFFECTS_WRITE_OVERWRITE, workspaceResourceImpact: 'episode' },
      inputSchema: z.object({
        episodeId: z.string().min(1),
        name: z.string().optional(),
        description: z.string().optional().nullable(),
        novelText: z.unknown().optional(),
        audioUrl: z.unknown().optional(),
        srtContent: z.unknown().optional(),
      }).passthrough(),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        const episode = await transaction.projectEpisode.findFirst({
          where: { id: input.episodeId, projectId: ctx.projectId },
          select: { id: true },
        })
        if (!episode) throw new ApiError('NOT_FOUND')

        const updateData: Prisma.ProjectEpisodeUncheckedUpdateInput = {}
        if (Object.prototype.hasOwnProperty.call(input, 'name') && input.name !== undefined) updateData.name = input.name.trim()
        if (Object.prototype.hasOwnProperty.call(input, 'description') && (input as Record<string, unknown>).description !== undefined) {
          updateData.description = (input as Record<string, unknown>).description ? String((input as Record<string, unknown>).description).trim() : null
        }
        if (Object.prototype.hasOwnProperty.call(input, 'novelText')) updateData.novelText = (input as Record<string, unknown>).novelText as string
        if (Object.prototype.hasOwnProperty.call(input, 'audioUrl')) {
          updateData.audioUrl = (input as Record<string, unknown>).audioUrl as string | null
          const media = await resolveMediaRefFromLegacyValue((input as Record<string, unknown>).audioUrl, transaction)
          updateData.audioMediaId = media?.id || null
        }
        if (Object.prototype.hasOwnProperty.call(input, 'srtContent')) updateData.srtContent = (input as Record<string, unknown>).srtContent as string

        const updated = await transaction.projectEpisode.update({
          where: { id: input.episodeId },
          data: updateData,
        })
        return { episode: updated }
      },
    }),
    delete_episode: defineOperation({
      id: 'delete_episode',
      summary: 'Delete an episode and update lastEpisodeId if needed.',
      intent: 'act',
      effects: {
        ...EFFECTS_WRITE_DESTRUCTIVE,
        workspaceResourceImpact: 'project_data',
        overwrite: true,
        bulk: true,
      },
      confirmation: {
        required: true,
        summary: '将删除剧集及其关联数据。系统会在获得明确批准后执行同一份已审核请求。',
      },
      inputSchema: z.object({
        episodeId: z.string().min(1),
      }),
      outputSchema: z.object({ success: z.boolean() }),
      executeInTransaction: async (ctx, input, transaction) => {
        const episode = await transaction.projectEpisode.findFirst({
          where: { id: input.episodeId, projectId: ctx.projectId },
          select: { id: true },
        })
        if (!episode) throw new ApiError('NOT_FOUND')

        await transaction.projectEpisode.delete({ where: { id: input.episodeId } })

        const project = await transaction.project.findUnique({
          where: { id: ctx.projectId },
          select: { lastEpisodeId: true },
        })
        if (project?.lastEpisodeId === input.episodeId) {
          const anotherEpisode = await transaction.projectEpisode.findFirst({
            where: { projectId: ctx.projectId },
            orderBy: { episodeNumber: 'asc' },
          })
          await transaction.project.update({
            where: { id: ctx.projectId },
            data: { lastEpisodeId: anotherEpisode?.id || null },
          })
        }

        return { success: true }
      },
    }),
  }
}
