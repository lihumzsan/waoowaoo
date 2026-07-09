import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { logError } from '@/lib/logging/core'
import { resolveTaskLocale } from '@/lib/task/resolve-locale'
import { resolveMediaRefFromLegacyValue, resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { attachMediaFieldsToProject } from '@/lib/media/attach'
import {
  readProjectEditScripts,
  readProjectEditShotExecutionPlans,
} from '@/lib/edit-script/service'
import { createDefaultEditChapter } from '@/lib/edit-chapter'
import { encodeImageUrls, decodeImageUrlsFromDb } from '@/lib/contracts/image-urls-contract'
import { deleteObject } from '@/lib/storage'
import { PRIMARY_APPEARANCE_INDEX, removeLocationPromptSuffix } from '@/lib/constants'
import { normalizeImageGenerationCount } from '@/lib/image-generation/count'
import { revertAssetRender } from '@/lib/assets/services/asset-actions'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'
import { normalizeFinalVideoSummary } from './final-video-summary'

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
  ...EFFECTS_WRITE,
  overwrite: true,
} as const

const EFFECTS_WRITE_DESTRUCTIVE = {
  ...EFFECTS_WRITE,
  destructive: true,
} as const

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function assertNoLegacyArtStyle(input: Record<string, unknown>) {
  if (!Object.prototype.hasOwnProperty.call(input, 'artStyle')) return
  throw new ApiError('INVALID_PARAMS', {
    code: 'LEGACY_ART_STYLE_REMOVED',
    field: 'artStyle',
    message: 'artStyle is no longer supported; use the AI-generated Style Bible workflow.',
  })
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function duplicateAssetError(assetType: 'character' | 'location', name: string): ApiError {
  return new ApiError('CONFLICT', {
    code: assetType === 'character'
      ? 'PROJECT_CHARACTER_NAME_CONFLICT'
      : 'PROJECT_LOCATION_NAME_CONFLICT',
    field: 'name',
    message: `${assetType === 'character' ? 'Character' : 'Location'} already exists in this project: ${name}`,
  })
}

async function assertProjectCharacterNameAvailable(input: {
  readonly projectId: string
  readonly name: string
}): Promise<void> {
  const existing = await prisma.projectCharacter.findFirst({
    where: {
      projectId: input.projectId,
      name: input.name,
    },
    select: { id: true },
  })
  if (existing) throw duplicateAssetError('character', input.name)
}

async function assertProjectLocationNameAvailable(input: {
  readonly projectId: string
  readonly name: string
  readonly assetKind: string
}): Promise<void> {
  const existing = await prisma.projectLocation.findFirst({
    where: {
      projectId: input.projectId,
      assetKind: input.assetKind,
      name: input.name,
    },
    select: { id: true },
  })
  if (existing) throw duplicateAssetError('location', input.name)
}

export function createGuiOperations(): ProjectAgentOperationRegistryDraft {
  return {
    create_character: defineOperation({
      id: 'create_character',
      summary: 'Create a project character and its primary appearance; optionally trigger reference-to-character background generation.',
      intent: 'act',
      effects: {
        ...EFFECTS_WRITE,
        externalSideEffects: true,
        longRunning: true,
      },
      inputSchema: z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        referenceImageUrl: z.string().optional(),
        referenceImageUrls: z.array(z.string()).optional(),
        generateFromReference: z.boolean().optional(),
        customDescription: z.string().optional(),
        count: z.number().int().positive().max(6).optional(),
        meta: z.record(z.string(), z.unknown()).optional(),
      }).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const body = input as unknown as Record<string, unknown>
        assertNoLegacyArtStyle(body)
        const taskLocale = resolveTaskLocale(ctx.request, body)
        const bodyMeta = toObject(body.meta)
        const acceptLanguage = ctx.request.headers.get('accept-language') || ''
        const name = normalizeString(input.name)
        const description = normalizeString(input.description)
        const referenceImageUrl = normalizeString(input.referenceImageUrl)
        const generateFromReference = input.generateFromReference === true
        const customDescription = normalizeString(input.customDescription)
        const count = generateFromReference
          ? normalizeImageGenerationCount('reference-to-character', input.count)
          : normalizeImageGenerationCount('character', input.count)

        const referenceImageUrls = Array.isArray(input.referenceImageUrls)
          ? input.referenceImageUrls.map((item: unknown) => normalizeString(item)).filter(Boolean)
          : []

        if (!name) {
          throw new ApiError('INVALID_PARAMS')
        }
        await assertProjectCharacterNameAvailable({
          projectId: ctx.projectId,
          name,
        })

        let allReferenceImages: string[] = []
        if (referenceImageUrls.length > 0) {
          allReferenceImages = referenceImageUrls.slice(0, 5)
        } else if (referenceImageUrl) {
          allReferenceImages = [referenceImageUrl]
        }

        const character = await prisma.projectCharacter.create({
          data: {
            projectId: ctx.projectId,
            name,
            aliases: null,
          },
        }).catch((error: unknown) => {
          if (isPrismaUniqueConstraintError(error)) throw duplicateAssetError('character', name)
          throw error
        })

        const descText = description || `${name} 的角色设定`
        const appearance = await prisma.characterAppearance.create({
          data: {
            characterId: character.id,
            appearanceIndex: PRIMARY_APPEARANCE_INDEX,
            changeReason: '初始形象',
            description: descText,
            descriptions: JSON.stringify([descText]),
            imageUrls: encodeImageUrls([]),
            previousImageUrls: encodeImageUrls([]),
          },
        })

        if (generateFromReference && allReferenceImages.length > 0) {
          const { getBaseUrl } = await import('@/lib/env')
          const baseUrl = getBaseUrl()
          fetch(`${baseUrl}/api/projects/${ctx.projectId}/reference-to-character`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Cookie: ctx.request.headers.get('cookie') || '',
              ...(acceptLanguage ? { 'Accept-Language': acceptLanguage } : {}),
            },
            body: JSON.stringify({
              referenceImageUrls: allReferenceImages,
              characterName: name,
              characterId: character.id,
              appearanceId: appearance.id,
              count,
              isBackgroundJob: true,
              customDescription: customDescription || undefined,
              locale: taskLocale || undefined,
              meta: {
                ...bodyMeta,
                locale: taskLocale || bodyMeta.locale || undefined,
              },
	            }),
	          }).catch(() => undefined)
	        }

        const characterWithAppearances = await prisma.projectCharacter.findUnique({
          where: { id: character.id },
          include: { appearances: true },
        })

	        return { success: true, character: characterWithAppearances }
	      },
	    }),
	    update_character: defineOperation({
	      id: 'update_character',
	      summary: 'Update a character name/introduction.',
	      intent: 'act',
	      effects: EFFECTS_WRITE_OVERWRITE,
	      inputSchema: z.object({
	        characterId: z.string().min(1),
	        name: z.string().optional(),
	        introduction: z.string().optional().nullable(),
      }),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const updateData: { name?: string; introduction?: string } = {}
        if (input.name) updateData.name = input.name.trim()
        if (input.introduction !== undefined && input.introduction !== null) updateData.introduction = input.introduction.trim()
        if (Object.keys(updateData).length === 0) throw new ApiError('INVALID_PARAMS')

        const character = await prisma.projectCharacter.findFirst({
          where: { id: input.characterId, projectId: ctx.projectId },
          select: { id: true },
        })
        if (!character) throw new ApiError('NOT_FOUND')

        const updated = await prisma.projectCharacter.update({
          where: { id: input.characterId },
          data: updateData,
	        })
	        return { success: true, character: updated }
	      },
	    }),
	    delete_character: defineOperation({
	      id: 'delete_character',
      summary: 'Delete a project character and cascade appearances.',
	      intent: 'act',
	      effects: {
	        ...EFFECTS_WRITE_DESTRUCTIVE,
	      },
	      confirmation: {
	        required: true,
	        summary: '将删除角色及其形象数据。确认继续后请重新调用并传入 confirmed=true。',
	      },
	      inputSchema: z.object({
	        confirmed: z.boolean().optional(),
	        characterId: z.string().min(1),
	      }),
      outputSchema: z.object({ success: z.boolean() }),
      execute: async (ctx, input) => {
        const character = await prisma.projectCharacter.findFirst({
          where: {
            id: input.characterId,
            projectId: ctx.projectId,
          },
          select: { id: true },
        })
        if (!character) throw new ApiError('NOT_FOUND')

	        await prisma.projectCharacter.delete({
	          where: { id: input.characterId },
	        })
	        return { success: true }
	      },
	    }),
	    create_character_appearance: defineOperation({
	      id: 'create_character_appearance',
	      summary: 'Add a new character appearance record.',
	      intent: 'act',
	      effects: EFFECTS_WRITE,
	      inputSchema: z.object({
	        characterId: z.string().min(1),
	        changeReason: z.string().min(1),
	        description: z.string().min(1),
      }),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const character = await prisma.projectCharacter.findUnique({
          where: { id: input.characterId },
          include: {
            appearances: { orderBy: { appearanceIndex: 'asc' } },
          },
        })
        if (!character || character.projectId !== ctx.projectId) throw new ApiError('NOT_FOUND')

        const maxIndex = character.appearances.reduce((max, app) => Math.max(max, app.appearanceIndex), 0)
        const newIndex = maxIndex + 1
        const trimmed = input.description.trim()

        const appearance = await prisma.characterAppearance.create({
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
	      effects: EFFECTS_WRITE_OVERWRITE,
	      inputSchema: z.object({
	        characterId: z.string().min(1),
	        appearanceId: z.string().min(1),
	        description: z.string().min(1),
	        descriptionIndex: z.number().int().min(0).optional(),
      }),
      outputSchema: z.object({ success: z.boolean() }),
      execute: async (ctx, input) => {
        const appearance = await prisma.characterAppearance.findUnique({
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

        await prisma.characterAppearance.update({
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
	      summary: 'Delete a character appearance and cleanup stored images; then reindex appearanceIndex.',
	      intent: 'act',
	      effects: {
	        writes: true,
	        billable: false,
	        destructive: true,
	        overwrite: true,
	        bulk: true,
	        externalSideEffects: true,
	        longRunning: false,
	      },
	      confirmation: {
	        required: true,
	        summary: '将删除该角色形象及其图片。确认继续后请重新调用并传入 confirmed=true。',
	      },
			      inputSchema: z.object({
			        confirmed: z.boolean().optional(),
			        characterId: z.string().min(1),
			        appearanceId: z.string().min(1),
		      }),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const appearance = await prisma.characterAppearance.findUnique({
          where: { id: input.appearanceId },
          include: { character: true },
        })
        if (!appearance) throw new ApiError('NOT_FOUND')
        if (appearance.characterId !== input.characterId) throw new ApiError('INVALID_PARAMS')
        if (appearance.character.projectId !== ctx.projectId) throw new ApiError('INVALID_PARAMS')

        const appearanceCount = await prisma.characterAppearance.count({
          where: { characterId: input.characterId },
        })
        if (appearanceCount <= 1) {
          throw new ApiError('INVALID_PARAMS')
        }

        const deletedKeys = new Set<string>()
        if (appearance.imageUrl) {
          const key = await resolveStorageKeyFromMediaValue(appearance.imageUrl)
          if (key) deletedKeys.add(key)
        }
        try {
          const urls = decodeImageUrlsFromDb(appearance.imageUrls, 'characterAppearance.imageUrls')
          for (const url of urls) {
            if (!url) continue
            const key = await resolveStorageKeyFromMediaValue(url)
            if (key) deletedKeys.add(key)
          }
        } catch {}

        for (const key of deletedKeys) {
          try {
            await deleteObject(key)
          } catch {}
        }

        await prisma.characterAppearance.delete({
          where: { id: input.appearanceId },
        })

        const remaining = await prisma.characterAppearance.findMany({
          where: { characterId: input.characterId },
          orderBy: { appearanceIndex: 'asc' },
        })
        for (let i = 0; i < remaining.length; i++) {
          if (remaining[i].appearanceIndex !== i) {
            await prisma.characterAppearance.update({
              where: { id: remaining[i].id },
              data: { appearanceIndex: i },
            })
          }
        }

	        return { success: true, deletedImages: deletedKeys.size }
	      },
	    }),
	    confirm_character_appearance_selection: defineOperation({
	      id: 'confirm_character_appearance_selection',
	      summary: 'Confirm a chosen character appearance image selection and delete other candidates.',
	      intent: 'act',
	      effects: {
	        writes: true,
	        billable: false,
	        destructive: true,
	        overwrite: true,
	        bulk: true,
	        externalSideEffects: true,
	        longRunning: false,
	      },
	      confirmation: {
	        required: true,
	        summary: '将确认角色形象选择并删除未选中的候选图片。确认继续后请重新调用并传入 confirmed=true。',
	      },
	      inputSchema: z.object({
		        confirmed: z.boolean().optional(),
		        characterId: z.string().min(1),
		        appearanceId: z.string().min(1),
		        selectedIndex: z.number().int().min(0).optional(),
	      }),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const appearance = await prisma.characterAppearance.findUnique({
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
	          await prisma.characterAppearance.update({
	            where: { id: appearance.id },
	            data: { imageUrl: selectedImageUrl, selectedIndex: 0 },
	          })
	          return { success: true, message: '已确认选择', deletedCount: 0 }
	        }

        let deletedCount = 0
        for (let i = 0; i < imageUrls.length; i++) {
          if (i === selectedIndex || !imageUrls[i]) continue
          const key = await resolveStorageKeyFromMediaValue(imageUrls[i]!)
          if (key) {
            try {
              await deleteObject(key)
              deletedCount++
            } catch {}
          }
        }

        let descriptions: string[] = []
        if (appearance.descriptions) {
          try { descriptions = JSON.parse(appearance.descriptions) } catch { descriptions = [] }
        }
        const selectedDescription = descriptions[selectedIndex] || appearance.description || ''

        await prisma.characterAppearance.update({
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
	      effects: EFFECTS_WRITE,
      inputSchema: z.object({
        name: z.string().min(1),
        description: z.string().min(1),
        summary: z.string().optional(),
        count: z.number().int().positive().max(6).optional(),
      }).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        assertNoLegacyArtStyle(input as unknown as Record<string, unknown>)
        const name = normalizeString(input.name)
        const description = normalizeString(input.description)
        const summary = normalizeString(input.summary)
        const count = Object.prototype.hasOwnProperty.call(input, 'count')
          ? normalizeImageGenerationCount('location', (input as Record<string, unknown>).count)
          : 1

        if (!name || !description) {
          throw new ApiError('INVALID_PARAMS')
        }

        const cleanDescription = removeLocationPromptSuffix(description.trim())
        const assetKind = 'location'
        await assertProjectLocationNameAvailable({
          projectId: ctx.projectId,
          name: name.trim(),
          assetKind,
        })
        const location = await prisma.projectLocation.create({
          data: {
            projectId: ctx.projectId,
            name: name.trim(),
            assetKind,
            summary: summary || null,
          },
        }).catch((error: unknown) => {
          if (isPrismaUniqueConstraintError(error)) throw duplicateAssetError('location', name.trim())
          throw error
        })

        await prisma.locationImage.createMany({
          data: Array.from({ length: count }, (_value, imageIndex) => ({
            locationId: location.id,
            imageIndex,
            description: cleanDescription,
          })),
        })

        const locationWithImages = await prisma.projectLocation.findUnique({
          where: { id: location.id },
          include: { images: true },
        })

	        return { success: true, location: locationWithImages }
	      },
	    }),
	    patch_location: defineOperation({
	      id: 'patch_location',
	      summary: 'Update a location name/summary or update locationImage description.',
	      intent: 'act',
	      effects: EFFECTS_WRITE_OVERWRITE,
	      inputSchema: z.object({
	        locationId: z.string().min(1),
	        name: z.string().optional(),
        summary: z.string().optional().nullable(),
        imageIndex: z.number().int().min(0).max(50).optional(),
        description: z.string().optional(),
      }).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const location = await prisma.projectLocation.findFirst({
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
          const updated = await prisma.projectLocation.update({
            where: { id: input.locationId },
            data: updateData,
          })
          return { success: true, location: updated }
        }

        if (input.imageIndex !== undefined && input.description) {
          const cleanDescription = removeLocationPromptSuffix(input.description.trim())
          const image = await prisma.locationImage.update({
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
	    delete_location: defineOperation({
	      id: 'delete_location',
	      summary: 'Delete a project location (cascades images).',
	      intent: 'act',
	      effects: EFFECTS_WRITE_DESTRUCTIVE,
	      confirmation: {
	        required: true,
	        summary: '将删除场景及其图片记录。确认继续后请重新调用并传入 confirmed=true。',
	      },
			      inputSchema: z.object({
			        confirmed: z.boolean().optional(),
			        locationId: z.string().min(1),
		      }),
      outputSchema: z.object({ success: z.boolean() }),
      execute: async (ctx, input) => {
        const location = await prisma.projectLocation.findFirst({
          where: { id: input.locationId, projectId: ctx.projectId },
          select: { id: true },
        })
        if (!location) throw new ApiError('NOT_FOUND')
	        await prisma.projectLocation.delete({
	          where: { id: input.locationId },
	        })
	        return { success: true }
	      },
	    }),
	    confirm_location_selection: defineOperation({
	      id: 'confirm_location_selection',
	      summary: 'Confirm selected location image and delete other candidates.',
	      intent: 'act',
	      effects: {
	        ...EFFECTS_WRITE_DESTRUCTIVE,
	        overwrite: true,
	        bulk: true,
	        externalSideEffects: true,
	      },
	      confirmation: {
	        required: true,
	        summary: '将确认场景选择并删除未选中的候选图片。确认继续后请重新调用并传入 confirmed=true。',
	      },
	      inputSchema: z.object({
		        confirmed: z.boolean().optional(),
		        locationId: z.string().min(1),
		        selectedIndex: z.number().int().min(0).optional(),
	      }),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const location = await prisma.projectLocation.findFirst({
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
          const key = await resolveStorageKeyFromMediaValue(img.imageUrl)
          if (key) {
            try {
              await deleteObject(key)
              deletedCount++
            } catch {}
          }
        }

        await prisma.$transaction(async (tx) => {
          await tx.locationImage.deleteMany({
            where: {
              locationId: input.locationId,
              id: { not: selectedImage.id },
            },
          })
	          await tx.locationImage.update({
	            where: { id: selectedImage.id },
	            data: { imageIndex: 0, isSelected: true },
	          })
          await tx.projectLocation.update({
            where: { id: input.locationId },
            data: { selectedImageId: selectedImage.id },
          })
        })

	        return { success: true, message: '已确认选择，其他候选图片已删除', deletedCount }
	      },
	    }),
	    clear_storyboard_error: defineOperation({
	      id: 'clear_storyboard_error',
	      summary: 'Clear storyboard lastError field.',
	      intent: 'act',
	      effects: EFFECTS_WRITE_OVERWRITE,
	      inputSchema: z.object({
	        storyboardId: z.string().min(1),
	      }),
      outputSchema: z.object({ success: z.boolean() }),
      execute: async (ctx, input) => {
        const storyboard = await prisma.projectStoryboard.findFirst({
          where: { id: input.storyboardId, episode: { projectId: ctx.projectId } },
          select: { id: true },
        })
        if (!storyboard) throw new ApiError('NOT_FOUND')
        await prisma.projectStoryboard.update({
          where: { id: input.storyboardId },
          data: { lastError: null },
	        })
	        return { success: true }
	      },
	    }),
    list_storyboards: defineOperation({
      id: 'list_storyboards',
      summary: 'List storyboards and panels for an episode.',
      intent: 'query',
      effects: EFFECTS_QUERY,
      inputSchema: z.object({
        episodeId: z.string().min(1),
      }),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const episode = await prisma.projectEpisode.findFirst({
          where: { id: input.episodeId, projectId: ctx.projectId },
          select: { id: true },
        })
        if (!episode) throw new ApiError('NOT_FOUND')

        const storyboards = await prisma.projectStoryboard.findMany({
          where: { episodeId: input.episodeId },
          include: {
            panels: { orderBy: { panelIndex: 'asc' } },
          },
          orderBy: { createdAt: 'asc' },
        })

        const withMedia = await attachMediaFieldsToProject({ storyboards })
        const processedStoryboards = withMedia.storyboards || storyboards
        return { storyboards: processedStoryboards }
      },
    }),
    revert_asset_render: defineOperation({
      id: 'revert_asset_render',
      summary: 'Revert an asset render (undo regenerate) for character/location assets.',
      intent: 'act',
      effects: {
        ...EFFECTS_WRITE_DESTRUCTIVE,
        overwrite: true,
      },
      confirmation: {
        required: true,
        summary: '将撤回一次资产渲染选择/变更。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: z.object({
        confirmed: z.boolean().optional(),
        type: z.enum(['character', 'location']),
        id: z.string().min(1),
      }).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => revertAssetRender({
        kind: input.type,
        assetId: input.id,
        body: input as unknown as Record<string, unknown>,
        access: {
          scope: 'project',
          userId: ctx.userId,
          projectId: ctx.projectId,
        },
      }),
    }),
    create_episode: defineOperation({
      id: 'create_episode',
      summary: 'Create a new episode in a project and update lastEpisodeId.',
      intent: 'act',
      effects: EFFECTS_WRITE_OVERWRITE,
      inputSchema: z.object({
        name: z.string().min(1),
        description: z.string().optional().nullable(),
        novelText: z.string().optional(),
      }),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const project = await prisma.project.findUnique({
          where: { id: ctx.projectId },
          select: { id: true },
        })
        if (!project) throw new ApiError('NOT_FOUND')

        const lastEpisode = await prisma.projectEpisode.findFirst({
          where: { projectId: ctx.projectId },
          orderBy: { episodeNumber: 'desc' },
        })
        const nextEpisodeNumber = (lastEpisode?.episodeNumber || 0) + 1

        const createData: Prisma.ProjectEpisodeUncheckedCreateInput = {
          projectId: ctx.projectId,
          episodeNumber: nextEpisodeNumber,
          name: input.name.trim(),
          description: input.description?.trim() || null,
        }
        if (typeof input.novelText === 'string') {
          createData.novelText = input.novelText
        }

        const episode = await prisma.$transaction(async (tx) => {
          const createdEpisode = await tx.projectEpisode.create({ data: createData })
          await createDefaultEditChapter(createdEpisode.id, tx)
          await tx.project.update({
            where: { id: ctx.projectId },
            data: { lastEpisodeId: createdEpisode.id },
          })
          return createdEpisode
        })
        return { episode }
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
      summary: 'Get full episode data with storyboards and update project.lastEpisodeId.',
      intent: 'act',
      effects: EFFECTS_WRITE_OVERWRITE,
      inputSchema: z.object({
        episodeId: z.string().min(1),
      }),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const episode = await prisma.projectEpisode.findFirst({
          where: { id: input.episodeId, projectId: ctx.projectId },
          include: {
            storyboards: {
              include: {
                panels: { orderBy: { panelIndex: 'asc' } },
              },
              orderBy: { createdAt: 'asc' },
            },
            videoGroups: {
              orderBy: { createdAt: 'asc' },
            },
            finalOutput: {
              select: {
                id: true,
                episodeId: true,
                renderStatus: true,
                renderTaskId: true,
                outputUrl: true,
                updatedAt: true,
              },
            },
            musicScore: {
              select: {
                id: true,
                status: true,
                version: true,
                taskId: true,
                timelineSignature: true,
                musicModel: true,
                cuesJson: true,
                mixJson: true,
                diagnosticsJson: true,
                updatedAt: true,
              },
            },
            soundscape: {
              select: {
                id: true,
                status: true,
                version: true,
                taskId: true,
                timelineSignature: true,
                soundEffectModel: true,
                planJson: true,
                sourcesJson: true,
                mixJson: true,
                diagnosticsJson: true,
                updatedAt: true,
              },
            },
          },
        })
        if (!episode) throw new ApiError('NOT_FOUND')

        prisma.project.update({
          where: { id: ctx.projectId },
          data: { lastEpisodeId: input.episodeId },
        }).catch((error: unknown) => logError('update lastEpisodeId failed', error))

        const [episodeWithSignedUrls, editScripts, editShotExecutionPlans] = await Promise.all([
          attachMediaFieldsToProject(episode),
          readProjectEditScripts({
            projectId: ctx.projectId,
            episodeId: input.episodeId,
          }),
          readProjectEditShotExecutionPlans({
            projectId: ctx.projectId,
            episodeId: input.episodeId,
          }),
        ])
        return {
          episode: {
            ...episodeWithSignedUrls,
            editScript: editScripts.length === 1 ? editScripts[0] : null,
            editScripts,
            editShotExecutionPlans,
            finalVideo: normalizeFinalVideoSummary(episode.finalOutput, episode.musicScore, episode.soundscape),
          },
        }
      },
    }),
    update_episode: defineOperation({
      id: 'update_episode',
      summary: 'Update an episode fields including audio media ref.',
      intent: 'act',
      effects: EFFECTS_WRITE_OVERWRITE,
      inputSchema: z.object({
        episodeId: z.string().min(1),
        name: z.string().optional(),
        description: z.string().optional().nullable(),
        novelText: z.unknown().optional(),
        audioUrl: z.unknown().optional(),
        srtContent: z.unknown().optional(),
      }).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const episode = await prisma.projectEpisode.findFirst({
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
          const media = await resolveMediaRefFromLegacyValue((input as Record<string, unknown>).audioUrl)
          updateData.audioMediaId = media?.id || null
        }
        if (Object.prototype.hasOwnProperty.call(input, 'srtContent')) updateData.srtContent = (input as Record<string, unknown>).srtContent as string

        const updated = await prisma.projectEpisode.update({
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
        overwrite: true,
        bulk: true,
      },
      confirmation: {
        required: true,
        summary: '将删除剧集及其关联数据。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: z.object({
        confirmed: z.boolean().optional(),
        episodeId: z.string().min(1),
      }),
      outputSchema: z.object({ success: z.boolean() }),
      execute: async (ctx, input) => {
        const episode = await prisma.projectEpisode.findFirst({
          where: { id: input.episodeId, projectId: ctx.projectId },
          select: { id: true },
        })
        if (!episode) throw new ApiError('NOT_FOUND')

        await prisma.projectEpisode.delete({ where: { id: input.episodeId } })

        const project = await prisma.project.findUnique({
          where: { id: ctx.projectId },
          select: { lastEpisodeId: true },
        })
        if (project?.lastEpisodeId === input.episodeId) {
          const anotherEpisode = await prisma.projectEpisode.findFirst({
            where: { projectId: ctx.projectId },
            orderBy: { episodeNumber: 'asc' },
          })
          await prisma.project.update({
            where: { id: ctx.projectId },
            data: { lastEpisodeId: anotherEpisode?.id || null },
          })
        }

        return { success: true }
      },
    }),
  }
}
