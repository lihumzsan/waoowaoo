import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { logError } from '@/lib/logging/core'
import { resolveModelSelectionOrSingle } from '@/lib/user-api/runtime-config'
import { getProviderKey } from '@/lib/ai-registry/selection'
import { getProjectModelConfig, getUserModelConfig } from '@/lib/config-service'
import { resolveTaskLocale, resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo, isBillableTaskType } from '@/lib/billing'
import { resolveMediaRefFromLegacyValue, resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { attachMediaFieldsToProject } from '@/lib/media/attach'
import { encodeImageUrls, decodeImageUrlsFromDb } from '@/lib/contracts/image-urls-contract'
import { deleteObject } from '@/lib/storage'
import { PRIMARY_APPEARANCE_INDEX, removeLocationPromptSuffix } from '@/lib/constants'
import { normalizeImageGenerationCount } from '@/lib/image-generation/count'
import { revertAssetRender } from '@/lib/assets/services/asset-actions'
import { resolveBuiltinPricing } from '@/lib/ai-registry/pricing-resolution'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'
import { composeModelKey, parseModelKeyStrict } from '@/lib/ai-registry/selection'
import { resolveProjectModelCapabilityGenerationOptions } from '@/lib/config-service'
import { resolveBuiltinCapabilitiesByModelKey as _resolveCaps } from '@/lib/ai-registry/capabilities-catalog'
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

function resolveStoryboardGroupInsertCreatedAt<T extends { createdAt: Date }>(
  existingClips: T[],
  insertIndex?: number,
): Date {
  const insertAt = insertIndex !== undefined ? insertIndex : existingClips.length
  if (existingClips.length === 0) return new Date()
  if (insertAt === 0) return new Date(existingClips[0].createdAt.getTime() - 1000)
  if (insertAt >= existingClips.length) {
    return new Date(existingClips[existingClips.length - 1].createdAt.getTime() + 1000)
  }

  const prevClip = existingClips[insertAt - 1]
  const nextClip = existingClips[insertAt]
  return new Date((prevClip.createdAt.getTime() + nextClip.createdAt.getTime()) / 2)
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
        const location = await prisma.projectLocation.create({
          data: {
            projectId: ctx.projectId,
            name: name.trim(),
            summary: summary || null,
          },
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
	    update_clip: defineOperation({
	      id: 'update_clip',
	      summary: 'Update a clip fields (characters/location/props/content/screenplay).',
	      intent: 'act',
	      effects: EFFECTS_WRITE_OVERWRITE,
	      inputSchema: z.object({
	        clipId: z.string().min(1),
	        characters: z.string().nullable().optional(),
	        location: z.string().nullable().optional(),
        props: z.string().nullable().optional(),
        content: z.string().optional(),
        screenplay: z.string().nullable().optional(),
      }).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const clip = await prisma.projectClip.findFirst({
          where: { id: input.clipId, episode: { projectId: ctx.projectId } },
          select: { id: true },
        })
        if (!clip) throw new ApiError('NOT_FOUND')

        const updateData: Record<string, unknown> = {}
        if (Object.prototype.hasOwnProperty.call(input, 'characters')) updateData.characters = input.characters
        if (Object.prototype.hasOwnProperty.call(input, 'location')) updateData.location = input.location
        if (Object.prototype.hasOwnProperty.call(input, 'props')) updateData.props = input.props
        if (Object.prototype.hasOwnProperty.call(input, 'content')) updateData.content = (input as Record<string, unknown>).content
        if (Object.prototype.hasOwnProperty.call(input, 'screenplay')) updateData.screenplay = input.screenplay

        const updated = await prisma.projectClip.update({
          where: { id: input.clipId },
          data: updateData,
	        })
	        return { success: true, clip: updated }
	      },
	    }),
	    get_video_editor_project: defineOperation({
	      id: 'get_video_editor_project',
	      summary: 'Get video editor project data for an episode.',
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

        const editorProject = await prisma.videoEditorProject.findUnique({
          where: { episodeId: input.episodeId },
        })

        if (!editorProject) {
          return { projectData: null }
        }

        let parsedProjectData: unknown
        try {
          parsedProjectData = JSON.parse(editorProject.projectData)
        } catch {
          throw new Error('VIDEO_EDITOR_PROJECT_DATA_INVALID')
        }

        return {
          id: editorProject.id,
          episodeId: editorProject.episodeId,
          projectData: parsedProjectData,
          renderStatus: editorProject.renderStatus,
          outputUrl: editorProject.outputUrl,
	          updatedAt: editorProject.updatedAt,
	        }
	      },
	    }),
	    save_video_editor_project: defineOperation({
	      id: 'save_video_editor_project',
	      summary: 'Upsert video editor project data for an episode.',
	      intent: 'act',
	      effects: EFFECTS_WRITE_OVERWRITE,
	      inputSchema: z.object({
	        episodeId: z.string().min(1),
	        projectData: z.unknown(),
      }),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const episode = await prisma.projectEpisode.findFirst({
          where: { id: input.episodeId, projectId: ctx.projectId },
          select: { id: true },
        })
        if (!episode) throw new ApiError('NOT_FOUND')

        const editorProject = await prisma.videoEditorProject.upsert({
          where: { episodeId: input.episodeId },
          create: {
            episodeId: input.episodeId,
            projectData: JSON.stringify(input.projectData),
          },
          update: {
            projectData: JSON.stringify(input.projectData),
            updatedAt: new Date(),
          },
	        })
	        return { success: true, id: editorProject.id, updatedAt: editorProject.updatedAt }
	      },
	    }),
	    delete_video_editor_project: defineOperation({
	      id: 'delete_video_editor_project',
	      summary: 'Delete video editor project data for an episode.',
	      intent: 'act',
	      effects: {
	        ...EFFECTS_WRITE_DESTRUCTIVE,
	        overwrite: true,
	      },
	      confirmation: {
	        required: true,
	        summary: '将删除该剧集的编辑器工程数据。确认继续后请重新调用并传入 confirmed=true。',
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

	        await prisma.videoEditorProject.delete({
	          where: { episodeId: input.episodeId },
	        })
	        return { success: true }
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
      summary: 'List storyboards (clip + panels) for an episode.',
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
            clip: true,
            blockingArtifacts: { orderBy: [{ groupIndex: 'asc' }, { createdAt: 'asc' }] },
            panels: { orderBy: { panelIndex: 'asc' } },
          },
          orderBy: { createdAt: 'asc' },
        })

        const withMedia = await attachMediaFieldsToProject({ storyboards })
        const processedStoryboards = withMedia.storyboards || storyboards
        return { storyboards: processedStoryboards }
      },
    }),
    create_storyboard_group: defineOperation({
      id: 'create_storyboard_group',
      summary: 'Create a storyboard group (clip + storyboard + initial panel) for an episode at an insert index.',
      intent: 'act',
      effects: EFFECTS_WRITE,
      inputSchema: z.object({
        episodeId: z.string().min(1),
        insertIndex: z.number().int().min(0).optional(),
      }),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const episode = await prisma.projectEpisode.findFirst({
          where: { id: input.episodeId, projectId: ctx.projectId },
          include: {
            clips: { orderBy: { createdAt: 'asc' } },
          },
        })
        if (!episode) throw new ApiError('NOT_FOUND')

        const newCreatedAt = resolveStoryboardGroupInsertCreatedAt(episode.clips, input.insertIndex)

        const result = await prisma.$transaction(async (tx) => {
          const clip = await tx.projectClip.create({
            data: {
              episodeId: input.episodeId,
              summary: '手动添加的分镜组',
              content: '',
              location: null,
              characters: null,
              createdAt: newCreatedAt,
            },
          })
          const storyboard = await tx.projectStoryboard.create({
            data: {
              episodeId: input.episodeId,
              clipId: clip.id,
              panelCount: 1,
            },
          })
          const panel = await tx.projectPanel.create({
            data: {
              storyboardId: storyboard.id,
              panelIndex: 0,
              panelNumber: 1,
              shotType: '中景',
              cameraMove: '固定',
              description: '新镜头描述',
              characters: '[]',
            },
          })
          return { clip, storyboard, panel }
        })

        return { success: true, ...result }
      },
    }),
    copy_storyboard_group: defineOperation({
      id: 'copy_storyboard_group',
      summary: 'Copy a storyboard group (clip + storyboard + panels) into the same episode.',
      intent: 'act',
      effects: EFFECTS_WRITE,
      inputSchema: z.object({
        sourceStoryboardId: z.string().min(1),
        insertIndex: z.number().int().min(0).optional(),
        includeImages: z.boolean().optional(),
      }),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const source = await prisma.projectStoryboard.findFirst({
          where: {
            id: input.sourceStoryboardId,
            episode: {
              projectId: ctx.projectId,
            },
          },
          include: {
            clip: true,
            episode: {
              include: {
                clips: { orderBy: { createdAt: 'asc' } },
              },
            },
            panels: { orderBy: { panelIndex: 'asc' } },
          },
        })
        if (!source) throw new ApiError('NOT_FOUND')

        const includeImages = input.includeImages !== false
        const newCreatedAt = resolveStoryboardGroupInsertCreatedAt(source.episode.clips, input.insertIndex)

        const result = await prisma.$transaction(async (tx) => {
          const clip = await tx.projectClip.create({
            data: {
              episodeId: source.episodeId,
              start: source.clip.start,
              end: source.clip.end,
              duration: source.clip.duration,
              summary: source.clip.summary,
              location: source.clip.location,
              content: source.clip.content,
              characters: source.clip.characters,
              props: source.clip.props,
              endText: source.clip.endText,
              shotCount: source.clip.shotCount,
              startText: source.clip.startText,
              screenplay: source.clip.screenplay,
              createdAt: newCreatedAt,
            },
          })

          const storyboard = await tx.projectStoryboard.create({
            data: {
              episodeId: source.episodeId,
              clipId: clip.id,
              panelCount: source.panels.length,
              storyboardTextJson: source.storyboardTextJson,
              photographyPlan: source.photographyPlan,
              storyboardImageUrl: includeImages ? source.storyboardImageUrl : null,
            },
          })

          if (source.panels.length > 0) {
            await tx.projectPanel.createMany({
              data: source.panels.map((panel, index) => ({
                storyboardId: storyboard.id,
                panelIndex: index,
                panelNumber: panel.panelNumber ?? index + 1,
                shotType: panel.shotType,
                cameraMove: panel.cameraMove,
                description: panel.description,
                location: panel.location,
                characters: panel.characters,
                props: panel.props,
                srtSegment: panel.srtSegment,
                srtStart: panel.srtStart,
                srtEnd: panel.srtEnd,
                duration: panel.duration,
                imagePrompt: panel.imagePrompt,
                imageUrl: includeImages ? panel.imageUrl : null,
                imageMediaId: includeImages ? panel.imageMediaId : null,
                videoPrompt: panel.videoPrompt,
                firstLastFramePrompt: panel.firstLastFramePrompt,
                sceneType: panel.sceneType,
                linkedToNextPanel: panel.linkedToNextPanel,
                sketchImageUrl: includeImages ? panel.sketchImageUrl : null,
                sketchImageMediaId: includeImages ? panel.sketchImageMediaId : null,
                photographyRules: panel.photographyRules,
                actingNotes: panel.actingNotes,
              })),
            })
          }

          return { clip, storyboard, panelCount: source.panels.length }
        })

        return { success: true, ...result }
      },
    }),
    copy_storyboard_panel: defineOperation({
      id: 'copy_storyboard_panel',
      summary: 'Copy a storyboard panel into the same storyboard after the source panel or a specified panel.',
      intent: 'act',
      effects: EFFECTS_WRITE,
      inputSchema: z.object({
        sourcePanelId: z.string().min(1),
        insertAfterPanelId: z.string().min(1).optional(),
        includeImages: z.boolean().optional(),
      }),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const sourcePanel = await prisma.projectPanel.findFirst({
          where: {
            id: input.sourcePanelId,
            storyboard: {
              episode: {
                projectId: ctx.projectId,
              },
            },
          },
        })
        if (!sourcePanel) throw new ApiError('NOT_FOUND')

        const insertAfter = input.insertAfterPanelId && input.insertAfterPanelId !== sourcePanel.id
          ? await prisma.projectPanel.findFirst({
            where: {
              id: input.insertAfterPanelId,
              storyboardId: sourcePanel.storyboardId,
            },
          })
          : sourcePanel
        if (!insertAfter) throw new ApiError('NOT_FOUND')

        const includeImages = input.includeImages !== false
        const createdPanel = await prisma.$transaction(async (tx) => {
          const affectedPanels = await tx.projectPanel.findMany({
            where: { storyboardId: sourcePanel.storyboardId, panelIndex: { gt: insertAfter.panelIndex } },
            select: { id: true, panelIndex: true },
            orderBy: { panelIndex: 'asc' },
          })

          for (const panel of affectedPanels) {
            await tx.projectPanel.update({
              where: { id: panel.id },
              data: { panelIndex: -(panel.panelIndex + 1) },
            })
          }

          for (const panel of affectedPanels) {
            await tx.projectPanel.update({
              where: { id: panel.id },
              data: {
                panelIndex: panel.panelIndex + 1,
                panelNumber: panel.panelIndex + 2,
              },
            })
          }

          const panel = await tx.projectPanel.create({
            data: {
              storyboardId: sourcePanel.storyboardId,
              panelIndex: insertAfter.panelIndex + 1,
              panelNumber: insertAfter.panelIndex + 2,
              shotType: sourcePanel.shotType,
              cameraMove: sourcePanel.cameraMove,
              description: sourcePanel.description,
              location: sourcePanel.location,
              characters: sourcePanel.characters,
              props: sourcePanel.props,
              srtSegment: sourcePanel.srtSegment,
              srtStart: sourcePanel.srtStart,
              srtEnd: sourcePanel.srtEnd,
              duration: sourcePanel.duration,
              imagePrompt: sourcePanel.imagePrompt,
              imageUrl: includeImages ? sourcePanel.imageUrl : null,
              imageMediaId: includeImages ? sourcePanel.imageMediaId : null,
              imageHistory: includeImages ? sourcePanel.imageHistory : null,
              videoPrompt: sourcePanel.videoPrompt,
              firstLastFramePrompt: sourcePanel.firstLastFramePrompt,
              sceneType: sourcePanel.sceneType,
              linkedToNextPanel: false,
              sketchImageUrl: includeImages ? sourcePanel.sketchImageUrl : null,
              sketchImageMediaId: includeImages ? sourcePanel.sketchImageMediaId : null,
              photographyRules: sourcePanel.photographyRules,
              actingNotes: sourcePanel.actingNotes,
              previousImageUrl: includeImages ? sourcePanel.previousImageUrl : null,
              previousImageMediaId: includeImages ? sourcePanel.previousImageMediaId : null,
            },
          })

          const panelCount = await tx.projectPanel.count({
            where: { storyboardId: sourcePanel.storyboardId },
          })
          await tx.projectStoryboard.update({
            where: { id: sourcePanel.storyboardId },
            data: { panelCount },
          })

          return panel
        })

        return { success: true, panel: createdPanel }
      },
    }),
    move_storyboard_group: defineOperation({
      id: 'move_storyboard_group',
      summary: 'Move storyboard group up/down by swapping clip createdAt ordering.',
      intent: 'act',
      effects: EFFECTS_WRITE_OVERWRITE,
      inputSchema: z.object({
        episodeId: z.string().min(1),
        clipId: z.string().min(1),
        direction: z.enum(['up', 'down']),
      }),
      outputSchema: z.object({ success: z.boolean() }),
      execute: async (ctx, input) => {
        const episode = await prisma.projectEpisode.findFirst({
          where: { id: input.episodeId, projectId: ctx.projectId },
          include: { clips: { orderBy: { createdAt: 'asc' } } },
        })
        if (!episode) throw new ApiError('NOT_FOUND')

        const clips = episode.clips
        const currentIndex = clips.findIndex((c) => c.id === input.clipId)
        if (currentIndex === -1) throw new ApiError('NOT_FOUND')

        const targetIndex = input.direction === 'up' ? currentIndex - 1 : currentIndex + 1
        if (targetIndex < 0 || targetIndex >= clips.length) throw new ApiError('INVALID_PARAMS')

        const currentClip = clips[currentIndex]
        const targetClip = clips[targetIndex]

        const tempTime = currentClip.createdAt.getTime()
        const targetTime = targetClip.createdAt.getTime()

        await prisma.$transaction(async (tx) => {
          await tx.projectClip.update({
            where: { id: currentClip.id },
            data: { createdAt: new Date(0) },
          })
          await tx.projectClip.update({
            where: { id: targetClip.id },
            data: { createdAt: new Date(tempTime) },
          })
          await tx.projectClip.update({
            where: { id: currentClip.id },
            data: { createdAt: new Date(targetTime) },
          })
        })

        return { success: true }
      },
    }),
    delete_storyboard_group: defineOperation({
      id: 'delete_storyboard_group',
      summary: 'Delete a storyboard group (panels + storyboard + clip).',
      intent: 'act',
      effects: {
        ...EFFECTS_WRITE_DESTRUCTIVE,
        overwrite: true,
        bulk: true,
      },
      confirmation: {
        required: true,
        summary: '将删除整个分镜组（Clip/Storyboard/Panels）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: z.object({
        confirmed: z.boolean().optional(),
        storyboardId: z.string().min(1),
      }),
      outputSchema: z.object({ success: z.boolean() }),
      execute: async (ctx, input) => {
        const storyboard = await prisma.projectStoryboard.findFirst({
          where: { id: input.storyboardId, episode: { projectId: ctx.projectId } },
          include: { panels: true, clip: true },
        })
        if (!storyboard) throw new ApiError('NOT_FOUND')

        await prisma.$transaction(async (tx) => {
          await tx.projectPanel.deleteMany({
            where: { storyboardId: input.storyboardId },
          })
          await tx.projectStoryboard.delete({
            where: { id: input.storyboardId },
          })
          if (storyboard.clipId) {
            await tx.projectClip.delete({
              where: { id: storyboard.clipId },
            })
          }
        })

        return { success: true }
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

        const episode = await prisma.projectEpisode.create({ data: createData })
        await prisma.project.update({
          where: { id: ctx.projectId },
          data: { lastEpisodeId: episode.id },
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
      summary: 'Get full episode data with storyboards/clips/shots and update project.lastEpisodeId.',
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
            clips: { orderBy: { createdAt: 'asc' } },
            storyboards: {
              include: {
                clip: true,
                blockingArtifacts: { orderBy: [{ groupIndex: 'asc' }, { createdAt: 'asc' }] },
                panels: { orderBy: { panelIndex: 'asc' } },
              },
              orderBy: { createdAt: 'asc' },
            },
            shots: { orderBy: { shotId: 'asc' } },
            videoGroups: {
              orderBy: { createdAt: 'asc' },
            },
            editScript: {
              include: {
                requirements: {
                  orderBy: [
                    { kind: 'asc' },
                    { name: 'asc' },
                  ],
                },
              },
            },
            editorProject: {
              select: {
                id: true,
                episodeId: true,
                projectData: true,
                renderStatus: true,
                renderTaskId: true,
                outputUrl: true,
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

        const episodeWithSignedUrls = await attachMediaFieldsToProject(episode)
        return {
          episode: {
            ...episodeWithSignedUrls,
            finalVideo: normalizeFinalVideoSummary(episodeWithSignedUrls.editorProject),
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
    batch_create_episodes: defineOperation({
      id: 'batch_create_episodes',
      summary: 'Batch create episodes, optionally clearing existing ones; also updates importStatus/lastEpisodeId.',
      intent: 'act',
      effects: {
        ...EFFECTS_WRITE_DESTRUCTIVE,
        overwrite: true,
        bulk: true,
      },
      confirmation: {
        required: true,
        summary: '将批量导入剧集（可选清空现有剧集）。确认继续后请重新调用并传入 confirmed=true。',
      },
      inputSchema: z.object({
        confirmed: z.boolean().optional(),
        episodes: z.array(z.object({
          name: z.string().min(1),
          description: z.string().optional(),
          novelText: z.string(),
        })).optional(),
        clearExisting: z.boolean().optional(),
        importStatus: z.string().optional(),
      }).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const episodes = Array.isArray((input as Record<string, unknown>).episodes) ? (input as Record<string, unknown>).episodes as Array<Record<string, unknown>> : []
        const clearExisting = (input as Record<string, unknown>).clearExisting === true
        const importStatus = normalizeString((input as Record<string, unknown>).importStatus)

        const project = await prisma.project.findUnique({
          where: { id: ctx.projectId },
          select: { id: true },
        })
        if (!project) throw new ApiError('NOT_FOUND')

        if (clearExisting) {
          await prisma.projectEpisode.deleteMany({ where: { projectId: ctx.projectId } })
        }

        if (episodes.length === 0) {
          if (importStatus) {
            await prisma.project.update({
              where: { id: ctx.projectId },
              data: { importStatus },
            })
          }
          return { success: true, episodes: [], message: '已清空剧集' }
        }

        const lastEpisode = await prisma.projectEpisode.findFirst({
          where: { projectId: ctx.projectId },
          orderBy: { episodeNumber: 'desc' },
        })
        const startNumber = clearExisting ? 1 : (lastEpisode?.episodeNumber || 0) + 1

        const createdEpisodes = await prisma.$transaction(
          episodes.map((ep: Record<string, unknown>, idx: number) =>
            prisma.projectEpisode.create({
              data: {
                projectId: ctx.projectId,
                episodeNumber: startNumber + idx,
                name: normalizeString(ep.name) || `Episode ${startNumber + idx}`,
                description: normalizeString(ep.description) || null,
                novelText: normalizeString(ep.novelText),
              },
            }),
          ),
        )

        const updateData: { lastEpisodeId: string; importStatus?: string } = { lastEpisodeId: createdEpisodes[0].id }
        if (importStatus) updateData.importStatus = importStatus
        await prisma.project.update({
          where: { id: ctx.projectId },
          data: updateData,
        })

        return {
          success: true,
          episodes: createdEpisodes.map((ep: { id: string; episodeNumber: number; name: string }) => ({
            id: ep.id,
            episodeNumber: ep.episodeNumber,
            name: ep.name,
          })),
        }
      },
    }),
  }
}
