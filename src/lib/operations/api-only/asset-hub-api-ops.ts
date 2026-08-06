import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import sharp from 'sharp'
import { ApiError } from '@/lib/api-errors'
import { decodeImageUrlsFromDb, encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { PRIMARY_APPEARANCE_INDEX } from '@/lib/constants'
import { buildCharacterDescriptionFields } from '@/lib/assets/description-fields'
import { deleteObject, generateUniqueKey, getSignedUrl, uploadObject } from '@/lib/storage'
import {
  requireProjectAgentOperationRequest,
  type ProjectAgentOperationRegistryDraft,
} from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'
import {
  requireOwnedAssetTarget,
  requireOwnedAssetVariant,
} from '@/lib/assets/services/asset-scope-ownership'
import { prisma } from '@/lib/prisma'
import {
  assertFileSizeWithinLimit,
  decodeBase64WithLimit,
  MAX_IMAGE_BYTES,
  MAX_MULTIPART_IMAGE_REQUEST_BYTES,
  readFormDataWithLimit,
} from '@/lib/http/body-limits'

type UploadFileLike = {
  name: string
  type: string
  size: number
  arrayBuffer: () => Promise<ArrayBuffer>
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function isFileLike(value: unknown): value is UploadFileLike {
  if (!value || typeof value !== 'object') return false
  const file = value as Partial<UploadFileLike>
  return typeof file.name === 'string' && typeof file.type === 'string' && typeof file.arrayBuffer === 'function'
    && typeof file.size === 'number'
}

function parseAppearanceIndex(value: unknown): number | null {
  const num = toNumberOrNull(value)
  if (num === null) return null
  if (!Number.isInteger(num) || num < 0) throw new ApiError('INVALID_PARAMS')
  return num
}

const uploadImageOutputSchema = z.object({
  success: z.literal(true),
  imageKey: z.string().min(1),
  imageIndex: z.number().int().nonnegative(),
})

const preparedAssetHubUploadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('character'),
    assetId: z.string().min(1),
    appearanceId: z.string().min(1),
    appearanceUpdatedAtMs: z.number().int().nonnegative(),
    imageKey: z.string().min(1),
    imageIndex: z.number().int().nonnegative().nullable(),
  }).strict(),
  z.object({
    kind: z.literal('location'),
    assetId: z.string().min(1),
    imageKey: z.string().min(1),
    imageIndex: z.number().int().nonnegative(),
    existingImageId: z.string().min(1).nullable(),
    existingImageUpdatedAtMs: z.number().int().nonnegative().nullable(),
    labelText: z.string().min(1),
    locationUpdatedAtMs: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    kind: z.literal('prop'),
    assetId: z.string().min(1),
    imageKey: z.string().min(1),
    imageIndex: z.number().int().nonnegative(),
    existingImageId: z.string().min(1).nullable(),
    existingImageUpdatedAtMs: z.number().int().nonnegative().nullable(),
    labelText: z.string().min(1),
    locationUpdatedAtMs: z.number().int().nonnegative(),
  }).strict(),
]).superRefine((prepared, ctx) => {
  if (
    prepared.kind !== 'character'
    && ((prepared.existingImageId === null) !== (prepared.existingImageUpdatedAtMs === null))
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'ASSET_HUB_UPLOAD_PREPARED_IMAGE_VERSION_INVALID',
      path: ['existingImageUpdatedAtMs'],
    })
  }
})

type PreparedAssetHubUpload = z.infer<typeof preparedAssetHubUploadSchema>

async function deletePreparedAssetHubImageOrThrow(
  imageKey: string,
  cause: unknown,
  label: string,
): Promise<never> {
  try {
    await deleteObject(imageKey)
  } catch (cleanupError) {
    throw new AggregateError([cause, cleanupError], `${label}:${imageKey}`)
  }
  throw cause
}

async function prepareAssetHubImageUpload(
  userId: string,
  request: Request,
): Promise<PreparedAssetHubUpload> {
  const formData = await readFormDataWithLimit(
    request,
    MAX_MULTIPART_IMAGE_REQUEST_BYTES,
    'asset hub image upload',
  )

  const file = formData.get('file')
  const type = normalizeString(formData.get('type'))
  const assetId = normalizeString(formData.get('id'))
  const appearanceIndex = parseAppearanceIndex(formData.get('appearanceIndex'))
  const requestedImageIndex = parseAppearanceIndex(formData.get('imageIndex'))
  const labelText = normalizeString(formData.get('labelText'))

  if (!isFileLike(file) || !assetId || ((type === 'location' || type === 'prop') && !labelText)) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (type !== 'character' && type !== 'location' && type !== 'prop') throw new ApiError('INVALID_PARAMS')
  assertFileSizeWithinLimit(file, MAX_IMAGE_BYTES, 'asset hub image')

  await requireOwnedAssetTarget({
    access: { scope: 'global', userId },
    kind: type,
    assetId,
  })

  const appearance = type === 'character' && appearanceIndex !== null
      ? await prisma.globalCharacterAppearance.findFirst({
        where: { characterId: assetId, appearanceIndex, character: { userId } },
        select: { id: true, updatedAt: true },
      })
    : null
  if (type === 'character' && (!appearance || appearanceIndex === null)) {
    throw new ApiError('NOT_FOUND')
  }

  const location = type === 'location' || type === 'prop'
    ? await prisma.globalLocation.findFirst({
        where: { id: assetId, userId, assetKind: type },
        select: {
          name: true,
          updatedAt: true,
          images: {
            orderBy: { imageIndex: 'asc' },
            select: {
              id: true,
              imageIndex: true,
              description: true,
              updatedAt: true,
            },
          },
        },
      })
    : null
  if ((type === 'location' || type === 'prop') && !location) throw new ApiError('NOT_FOUND')

  const buffer = Buffer.from(await file.arrayBuffer())
  const processed = await sharp(buffer)
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer()
  const keyPrefix = type === 'character'
    ? `global-char-${assetId}-${appearanceIndex ?? 'na'}-upload`
    : `global-${type}-${assetId}-upload`
  const imageKey = generateUniqueKey(keyPrefix, 'jpg')
  try {
    await uploadObject(processed, imageKey, 'image/jpeg')
    if (type === 'character') {
      if (!appearance || appearanceIndex === null) throw new ApiError('NOT_FOUND')
      return {
        kind: type,
        assetId,
        appearanceId: appearance.id,
        appearanceUpdatedAtMs: appearance.updatedAt.getTime(),
        imageKey,
        imageIndex: requestedImageIndex,
      }
    }

    if (!location) {
      throw new Error('ASSET_HUB_LOCATION_UPLOAD_PREPARE_INVALID')
    }
    const imageIndex = requestedImageIndex ?? location.images.length
    const existingImage = location.images.find((image) => image.imageIndex === imageIndex) ?? null
    return {
      kind: type,
      assetId,
      imageKey,
      imageIndex,
      existingImageId: existingImage?.id ?? null,
      existingImageUpdatedAtMs: existingImage?.updatedAt.getTime() ?? null,
      labelText,
      locationUpdatedAtMs: location.updatedAt.getTime(),
    }
  } catch (error) {
    return await deletePreparedAssetHubImageOrThrow(
      imageKey,
      error,
      'ASSET_HUB_UPLOAD_PREPARE_COMPENSATION_FAILED',
    )
  }
}

async function commitPreparedAssetHubImageUpload(
  userId: string,
  preparedValue: unknown,
  transaction: Prisma.TransactionClient,
) {
  const prepared = preparedAssetHubUploadSchema.parse(preparedValue)
  if (prepared.kind === 'character') {
    await requireOwnedAssetVariant({
      access: { scope: 'global', userId },
      kind: prepared.kind,
      assetId: prepared.assetId,
      variantId: prepared.appearanceId,
    }, transaction)
    const appearance = await transaction.globalCharacterAppearance.findFirst({
      where: {
        id: prepared.appearanceId,
        updatedAt: new Date(prepared.appearanceUpdatedAtMs),
      },
      select: {
        id: true,
        imageUrl: true,
        imageUrls: true,
        selectedIndex: true,
      },
    })
    if (!appearance) throw new Error('GLOBAL_CHARACTER_APPEARANCE_CHANGED_DURING_UPLOAD')

    const imageUrls = decodeImageUrlsFromDb(appearance.imageUrls, 'globalCharacterAppearance.imageUrls')
    const targetIndex = prepared.imageIndex ?? imageUrls.length
    while (imageUrls.length <= targetIndex) imageUrls.push('')
    imageUrls[targetIndex] = prepared.imageKey

    const shouldUpdateImageUrl =
      appearance.selectedIndex === targetIndex
      || (appearance.selectedIndex === null && targetIndex === 0)
      || imageUrls.filter((url) => !!url).length === 1
    const updated = await transaction.globalCharacterAppearance.updateMany({
      where: {
        id: appearance.id,
        updatedAt: new Date(prepared.appearanceUpdatedAtMs),
      },
      data: {
        ...(appearance.imageUrl || decodeImageUrlsFromDb(appearance.imageUrls, 'globalCharacterAppearance.imageUrls').length > 0
          ? {
              previousImageUrl: appearance.imageUrl,
              previousImageUrls: appearance.imageUrls,
            }
          : {}),
        imageUrls: encodeImageUrls(imageUrls),
        ...(shouldUpdateImageUrl ? { imageUrl: prepared.imageKey } : {}),
        updatedAt: new Date(Math.max(Date.now(), prepared.appearanceUpdatedAtMs + 1)),
      },
    })
    if (updated.count !== 1) throw new Error('GLOBAL_CHARACTER_APPEARANCE_CHANGED_DURING_UPLOAD')
    return { success: true as const, imageKey: prepared.imageKey, imageIndex: targetIndex }
  }

  await requireOwnedAssetTarget({
    access: { scope: 'global', userId },
    kind: prepared.kind,
    assetId: prepared.assetId,
  }, transaction)
  const location = await transaction.globalLocation.findFirst({
    where: {
      id: prepared.assetId,
      userId,
      assetKind: prepared.kind,
      updatedAt: new Date(prepared.locationUpdatedAtMs),
    },
    select: { id: true },
  })
  if (!location) throw new Error('GLOBAL_LOCATION_CHANGED_DURING_UPLOAD')

  if (prepared.existingImageId) {
    const existingImage = await transaction.globalLocationImage.findFirst({
      where: {
        id: prepared.existingImageId,
        locationId: prepared.assetId,
        imageIndex: prepared.imageIndex,
        updatedAt: new Date(prepared.existingImageUpdatedAtMs ?? -1),
      },
      select: { id: true, imageUrl: true },
    })
    if (!existingImage) throw new Error('GLOBAL_LOCATION_IMAGE_CHANGED_DURING_UPLOAD')
    const updated = await transaction.globalLocationImage.updateMany({
      where: {
        id: existingImage.id,
        updatedAt: new Date(prepared.existingImageUpdatedAtMs ?? -1),
      },
      data: {
        ...(existingImage.imageUrl ? { previousImageUrl: existingImage.imageUrl } : {}),
        imageUrl: prepared.imageKey,
        updatedAt: new Date(Math.max(Date.now(), (prepared.existingImageUpdatedAtMs ?? 0) + 1)),
      },
    })
    if (updated.count !== 1) throw new Error('GLOBAL_LOCATION_IMAGE_CHANGED_DURING_UPLOAD')
  } else {
    const conflictingImage = await transaction.globalLocationImage.findFirst({
      where: { locationId: prepared.assetId, imageIndex: prepared.imageIndex },
      select: { id: true },
    })
    if (conflictingImage) throw new Error('GLOBAL_LOCATION_IMAGE_CHANGED_DURING_UPLOAD')
    await transaction.globalLocationImage.create({
      data: {
        locationId: prepared.assetId,
        imageIndex: prepared.imageIndex,
        imageUrl: prepared.imageKey,
        description: prepared.labelText,
        isSelected: prepared.imageIndex === 0,
      },
    })
  }
  return { success: true as const, imageKey: prepared.imageKey, imageIndex: prepared.imageIndex }
}

async function compensatePreparedAssetHubImageUpload(
  userId: string,
  preparedValue: unknown,
): Promise<void> {
  const prepared = preparedAssetHubUploadSchema.parse(preparedValue)
  const committedRelation = prepared.kind === 'character'
    ? await prisma.globalCharacterAppearance.findFirst({
        where: {
          id: prepared.appearanceId,
          characterId: prepared.assetId,
          character: { userId },
          OR: [
            { imageUrl: prepared.imageKey },
            { imageUrls: { contains: prepared.imageKey } },
          ],
        },
        select: { id: true },
      })
    : await prisma.globalLocationImage.findFirst({
        where: {
      locationId: prepared.assetId,
      imageIndex: prepared.imageIndex,
      imageUrl: prepared.imageKey,
          location: { userId, assetKind: prepared.kind },
        },
        select: { id: true },
      })
  if (committedRelation) {
    return
  }
  await deleteObject(prepared.imageKey)
}

export function createAssetHubApiOperations(): ProjectAgentOperationRegistryDraft {
  return {
    api_asset_hub_upload_temp: defineOperation({
      id: 'api_asset_hub_upload_temp',
      summary: 'API-only: Upload a temporary base64 blob and return signed url.',
      intent: 'act',
      effects: {
        writes: true,
        workspaceResourceImpact: 'none',
        billable: false,
        destructive: false,
        overwrite: false,
        bulk: false,
        externalSideEffects: true,
        longRunning: false,
      },
      inputSchema: z.object({}).passthrough(),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const body = input as unknown as Record<string, unknown>
        const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : ''
        const base64 = typeof body.base64 === 'string' ? body.base64 : ''
        const extension = typeof body.extension === 'string' ? body.extension.trim() : ''

        let buffer: Buffer
        let ext: string

        if (imageBase64) {
          const matches = imageBase64.match(/^data:image\/(\w+);base64,(.+)$/)
          if (!matches) throw new ApiError('INVALID_PARAMS')
          ext = matches[1] === 'jpeg' ? 'jpg' : matches[1]
          buffer = decodeBase64WithLimit(matches[2], MAX_IMAGE_BYTES, 'temporary image')
        } else if (base64 && extension) {
          buffer = decodeBase64WithLimit(base64, MAX_IMAGE_BYTES, 'temporary image')
          ext = extension
        } else {
          throw new ApiError('INVALID_PARAMS')
        }

        const key = generateUniqueKey(`temp-${ctx.userId}-${Date.now()}`, ext)
        await uploadObject(buffer, key)
        const signedUrl = getSignedUrl(key, 3600)
        return { success: true, url: signedUrl, key }
      },
    }),

    api_asset_hub_character_appearances_create: defineOperation({
      id: 'api_asset_hub_character_appearances_create',
      summary: 'API-only: Create a global character appearance (legacy /asset-hub/appearances POST).',
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
        characterId: z.string().min(1),
        changeReason: z.string().min(1),
      }).passthrough(),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        const description = normalizeString((input as unknown as Record<string, unknown>).description)

        await requireOwnedAssetTarget({
          access: { scope: 'global', userId: ctx.userId },
          kind: 'character',
          assetId: input.characterId,
        }, transaction)
        const character = await transaction.globalCharacter.findUniqueOrThrow({
          where: { id: input.characterId },
          select: { id: true, appearances: { select: { appearanceIndex: true } } },
        })

        const maxIndex = character.appearances.reduce((max, appearance) => Math.max(max, appearance.appearanceIndex), 0)
        const nextIndex = maxIndex + 1

        const trimmed = description ? description.trim() : ''
        const appearance = await transaction.globalCharacterAppearance.create({
          data: {
            characterId: input.characterId,
            appearanceIndex: nextIndex,
            changeReason: input.changeReason,
            description: trimmed || null,
            descriptions: trimmed ? JSON.stringify([trimmed]) : null,
            imageUrls: encodeImageUrls([]),
            previousImageUrls: encodeImageUrls([]),
          },
        })

        return { success: true, appearance }
      },
    }),

    api_asset_hub_character_appearances_update: defineOperation({
      id: 'api_asset_hub_character_appearances_update',
      summary: 'API-only: Update a global character appearance (legacy /asset-hub/appearances PATCH).',
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
        characterId: z.string().min(1),
        appearanceIndex: z.number().int().min(0),
      }).passthrough(),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        const body = input as unknown as Record<string, unknown>
        await requireOwnedAssetTarget({
          access: { scope: 'global', userId: ctx.userId },
          kind: 'character',
          assetId: input.characterId,
        }, transaction)

        const appearance = await transaction.globalCharacterAppearance.findFirst({
          where: { characterId: input.characterId, appearanceIndex: input.appearanceIndex },
        })
        if (!appearance) throw new ApiError('NOT_FOUND')

        const updateData: Record<string, unknown> = {}
        if (body.description !== undefined) {
          if (typeof body.description !== 'string') throw new ApiError('INVALID_PARAMS')
          const descriptionFields = buildCharacterDescriptionFields({
            descriptions: appearance.descriptions ?? null,
            fallbackDescription: appearance.description ?? null,
            index: 0,
            nextDescription: body.description.trim(),
          })
          updateData.description = descriptionFields.description
          updateData.descriptions = descriptionFields.descriptions
        }
        if (body.changeReason !== undefined) {
          updateData.changeReason = body.changeReason
        }

        await transaction.globalCharacterAppearance.update({
          where: { id: appearance.id },
          data: updateData,
        })

        return { success: true }
      },
    }),

    api_asset_hub_character_appearances_delete: defineOperation({
      id: 'api_asset_hub_character_appearances_delete',
      summary: 'API-only: Delete a global character appearance (legacy /asset-hub/appearances DELETE).',
      intent: 'act',
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
      inputSchema: z.object({
        characterId: z.string().min(1),
        appearanceIndex: z.number().int().min(0),
      }),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        await requireOwnedAssetTarget({
          access: { scope: 'global', userId: ctx.userId },
          kind: 'character',
          assetId: input.characterId,
        }, transaction)

        if (input.appearanceIndex === PRIMARY_APPEARANCE_INDEX) {
          throw new ApiError('INVALID_PARAMS')
        }

        await transaction.globalCharacterAppearance.deleteMany({
          where: { characterId: input.characterId, appearanceIndex: input.appearanceIndex },
        })

        return { success: true }
      },
    }),

    api_asset_hub_upload_image: defineOperation({
      id: 'api_asset_hub_upload_image',
      summary: 'API-only: Upload a custom image into global character appearance or global location image slots.',
      intent: 'act',
      effects: {
        writes: true,
        workspaceResourceImpact: 'global_assets',
        billable: false,
        destructive: false,
        overwrite: true,
        bulk: false,
        externalSideEffects: true,
        longRunning: false,
      },
      inputSchema: z.object({}).passthrough(),
      outputSchema: uploadImageOutputSchema,
      prepareTransaction: async (ctx) => {
        return await prepareAssetHubImageUpload(
          ctx.userId,
          requireProjectAgentOperationRequest(ctx),
        )
      },
      executeInTransaction: async (ctx, _input, transaction, prepared) => {
        return await commitPreparedAssetHubImageUpload(ctx.userId, prepared, transaction)
      },
      compensateTransactionFailure: async (ctx, _input, prepared) => {
        await compensatePreparedAssetHubImageUpload(ctx.userId, prepared)
      },
    }),
  }
}
