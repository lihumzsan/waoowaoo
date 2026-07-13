import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import { attachMediaFieldsToGlobalCharacter } from '@/lib/media/attach'
import { resolveMediaRefFromLegacyValue } from '@/lib/media/service'
import { PRIMARY_APPEARANCE_INDEX } from '@/lib/constants'
import { encodeImageUrls } from '@/lib/contracts/image-urls-contract'
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

function assertNoLegacyArtStyle(body: Record<string, unknown>) {
  if (!Object.prototype.hasOwnProperty.call(body, 'artStyle')) return
  throw new ApiError('INVALID_PARAMS', {
    code: 'LEGACY_ART_STYLE_REMOVED',
    field: 'artStyle',
    message: 'artStyle is no longer supported; use the AI-generated Style Bible workflow.',
  })
}

const ASSET_HUB_CHARACTER_GENERATION_FIELDS = [
  'referenceImageUrl',
  'referenceImageUrls',
  'generateFromReference',
  'customDescription',
  'count',
  'meta',
] as const

function assertAssetHubCharacterRecordOnlyInput(body: Record<string, unknown>): void {
  const unsupportedField = ASSET_HUB_CHARACTER_GENERATION_FIELDS.find((field) =>
    Object.prototype.hasOwnProperty.call(body, field),
  )
  if (!unsupportedField) return
  throw new ApiError('INVALID_PARAMS', {
    code: 'ASSET_HUB_CHARACTER_REFERENCE_GENERATION_SEPARATE_OPERATION_REQUIRED',
    field: unsupportedField,
    message: 'asset_hub_create_character only creates records; submit asset_hub_reference_to_character explicitly.',
  })
}

export function createAssetHubCharacterLibraryOperations(): ProjectAgentOperationRegistryDraft {
  return {
    asset_hub_list_characters: defineOperation({
      id: 'asset_hub_list_characters',
      summary: 'List global characters for the current user (optionally filtered by folderId).',
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

        const characters = await prisma.globalCharacter.findMany({
          where,
          include: { appearances: true },
          orderBy: { createdAt: 'desc' },
        })

        const signedCharacters = await Promise.all(
          characters.map((character) => attachMediaFieldsToGlobalCharacter(character)),
        )

        return { characters: signedCharacters }
      },
    }),

    asset_hub_create_character: defineOperation({
      id: 'asset_hub_create_character',
      summary: 'Create a global character and its primary appearance.',
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
        assertAssetHubCharacterRecordOnlyInput(body)

        const name = normalizeString(body.name)
        if (!name) throw new ApiError('INVALID_PARAMS')

        const folderId = normalizeString(body.folderId) || null
        const initialImageUrl = normalizeString(body.initialImageUrl) || null
        const descriptionText = normalizeString(body.description) || `${name} 的角色设定`
        const imageMedia = await resolveMediaRefFromLegacyValue(initialImageUrl, transaction)
        const characterWithAppearances = await (async () => {
          if (folderId) {
            const folder = await transaction.globalAssetFolder.findUnique({
              where: { id: folderId },
              select: { id: true, userId: true },
            })
            if (!folder || folder.userId !== ctx.userId) throw new ApiError('INVALID_PARAMS')
          }
          const character = await transaction.globalCharacter.create({
            data: {
              userId: ctx.userId,
              folderId,
              name,
              aliases: null,
            },
          })
          await transaction.globalCharacterAppearance.create({
            data: {
              characterId: character.id,
              appearanceIndex: PRIMARY_APPEARANCE_INDEX,
              changeReason: '初始形象',
              description: descriptionText,
              descriptions: JSON.stringify([descriptionText]),
              imageUrl: initialImageUrl,
              imageMediaId: imageMedia?.id || null,
              imageUrls: encodeImageUrls(initialImageUrl ? [initialImageUrl] : []),
              previousImageUrls: encodeImageUrls([]),
            },
          })
          return await transaction.globalCharacter.findUnique({
            where: { id: character.id },
            include: { appearances: true },
          })
        })()

        const withMedia = characterWithAppearances
          ? await attachMediaFieldsToGlobalCharacter(characterWithAppearances, transaction)
          : null

        return {
          success: true,
          character: withMedia,
        }
      },
    }),

    asset_hub_get_character: defineOperation({
      id: 'asset_hub_get_character',
      summary: 'Get a single global character by id.',
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
        characterId: z.string().min(1),
      }),
      outputSchema: z.unknown(),
      execute: async (ctx, input) => {
        const character = await prisma.globalCharacter.findUnique({
          where: { id: input.characterId },
          include: { appearances: true },
        })
        if (!character || character.userId !== ctx.userId) {
          throw new ApiError('NOT_FOUND')
        }
        const withMedia = await attachMediaFieldsToGlobalCharacter(character)
        return { character: withMedia }
      },
    }),

    asset_hub_update_character: defineOperation({
      id: 'asset_hub_update_character',
      summary: 'Update a global character (name, folder, profile fields).',
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
      }).passthrough(),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        const body = input as unknown as Record<string, unknown>
        const characterId = normalizeString(body.characterId)
        if (!characterId) throw new ApiError('INVALID_PARAMS')

        await requireOwnedAssetTarget({
          access: { scope: 'global', userId: ctx.userId },
          kind: 'character',
          assetId: characterId,
        }, transaction)

        const updateData: Record<string, unknown> = {}

        if (body.name !== undefined) {
          if (typeof body.name !== 'string') throw new ApiError('INVALID_PARAMS')
          updateData.name = body.name.trim()
        }
        if (body.aliases !== undefined) updateData.aliases = body.aliases
        if (body.profileData !== undefined) updateData.profileData = body.profileData
        if (body.profileConfirmed !== undefined) updateData.profileConfirmed = body.profileConfirmed

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

        const updated = await transaction.globalCharacter.update({
          where: { id: characterId },
          data: updateData,
          include: { appearances: true },
        })

        const withMedia = await attachMediaFieldsToGlobalCharacter(updated, transaction)
        return { success: true, character: withMedia }
      },
    }),

    asset_hub_delete_character: defineOperation({
      id: 'asset_hub_delete_character',
      summary: 'Delete a global character.',
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
      confirmation: {
        required: true,
        summary: '将删除该角色记录（不可恢复）。系统会在获得明确批准后执行同一份已审核请求。',
      },
      inputSchema: z.object({
        characterId: z.string().min(1),
      }),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        await requireOwnedAssetTarget({
          access: { scope: 'global', userId: ctx.userId },
          kind: 'character',
          assetId: input.characterId,
        }, transaction)

        await transaction.globalCharacter.delete({ where: { id: input.characterId } })
        return { success: true }
      },
    }),
  }
}
