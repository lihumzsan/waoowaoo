import { z } from 'zod'
import { ApiError } from '@/lib/api-errors'
import { encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import type { ProjectAgentOperationRegistryDraft } from '@/lib/operations/types'
import { defineOperation } from '@/lib/operations/define-operation'
import { requireOwnedAssetTarget } from '@/lib/assets/services/asset-scope-ownership'

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseAppearanceIndex(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed >= 0) return parsed
  }
  throw new ApiError('INVALID_PARAMS')
}

function parseDescriptions(jsonValue: unknown): string[] {
  if (typeof jsonValue !== 'string' || !jsonValue.trim()) return []
  try {
    const parsed = JSON.parse(jsonValue)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function assertNoLegacyArtStyle(body: Record<string, unknown>) {
  if (!Object.prototype.hasOwnProperty.call(body, 'artStyle')) return
  throw new ApiError('INVALID_PARAMS', {
    code: 'LEGACY_ART_STYLE_REMOVED',
    field: 'artStyle',
    message: 'artStyle is no longer supported; use the AI-generated Creative Direction workflow.',
  })
}

const assetHubUpdateCharacterAppearanceInputSchema = z.object({
  characterId: z.string().trim().min(1),
  appearanceIndex: z.union([
    z.number().int().min(0),
    z.string().trim().regex(/^\d+$/),
  ]),
  description: z.string().optional(),
  descriptionIndex: z.number().int().min(0).optional(),
  changeReason: z.string().optional(),
}).strict()

export function createAssetHubCharacterAppearanceOperations(): ProjectAgentOperationRegistryDraft {
  return {
    asset_hub_update_character_appearance: defineOperation({
      id: 'asset_hub_update_character_appearance',
      summary: 'Update a global character appearance description/changeReason.',
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
      inputSchema: assetHubUpdateCharacterAppearanceInputSchema,
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        const characterId = input.characterId
        const appearanceIndex = parseAppearanceIndex(input.appearanceIndex)

        await requireOwnedAssetTarget({
          access: { scope: 'global', userId: ctx.userId },
          kind: 'character',
          assetId: characterId,
        }, transaction)

        const appearance = await transaction.globalCharacterAppearance.findFirst({
          where: { characterId, appearanceIndex },
        })
        if (!appearance) throw new ApiError('NOT_FOUND')

        const updateData: Record<string, unknown> = {}
        if (input.description !== undefined) {
          const trimmedDescription = input.description.trim()
          const descriptions = (() => {
            const existing = parseDescriptions(appearance.descriptions)
            if (existing.length > 0) return existing
            return [typeof appearance.description === 'string' ? appearance.description : '']
          })()

          const index = input.descriptionIndex ?? 0
          if (index >= descriptions.length) {
            throw new ApiError('INVALID_PARAMS', {
              code: 'ASSET_DESCRIPTION_INDEX_OUT_OF_RANGE',
              field: 'descriptionIndex',
              requestedValue: index,
              allowedValues: descriptions.map((_, currentIndex) => currentIndex),
            })
          }
          descriptions[index] = trimmedDescription
          updateData.descriptions = JSON.stringify(descriptions)
          updateData.description = descriptions[0]
        }

        if (input.changeReason !== undefined) updateData.changeReason = input.changeReason

        await transaction.globalCharacterAppearance.update({
          where: { id: appearance.id },
          data: updateData,
        })

        return { success: true }
      },
    }),

    asset_hub_add_character_appearance: defineOperation({
      id: 'asset_hub_add_character_appearance',
      summary: 'Add a new appearance to a global character.',
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
        description: z.string().min(1),
      }).passthrough(),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        const body = input as unknown as Record<string, unknown>
        assertNoLegacyArtStyle(body)
        const characterId = normalizeString(body.characterId)
        const description = normalizeString(body.description)
        if (!characterId || !description) throw new ApiError('INVALID_PARAMS')

        await requireOwnedAssetTarget({
          access: { scope: 'global', userId: ctx.userId },
          kind: 'character',
          assetId: characterId,
        }, transaction)
        const character = await transaction.globalCharacter.findUniqueOrThrow({
          where: { id: characterId },
          include: { appearances: true },
        })

        const maxIndex = character.appearances.reduce((max, appearance) => Math.max(max, appearance.appearanceIndex), 0)
        const newIndex = maxIndex + 1

        const appearance = await transaction.globalCharacterAppearance.create({
          data: {
            characterId,
            appearanceIndex: newIndex,
            changeReason: normalizeString(body.changeReason) || '形象变化',
            description,
            descriptions: JSON.stringify([description]),
            imageUrls: encodeImageUrls([]),
            previousImageUrls: encodeImageUrls([]),
          },
        })

        return { success: true, appearance }
      },
    }),

    asset_hub_delete_character_appearance: defineOperation({
      id: 'asset_hub_delete_character_appearance',
      summary: 'Delete a global character appearance by index.',
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
        summary: '将删除该角色形象记录（不可恢复）。系统会在获得明确批准后执行同一份已审核请求。',
      },
      inputSchema: z.object({
        characterId: z.string().min(1),
        appearanceIndex: z.union([z.number().int().min(0), z.string().min(1)]),
      }),
      outputSchema: z.unknown(),
      executeInTransaction: async (ctx, input, transaction) => {
        const appearanceIndex = parseAppearanceIndex(input.appearanceIndex)

        await requireOwnedAssetTarget({
          access: { scope: 'global', userId: ctx.userId },
          kind: 'character',
          assetId: input.characterId,
        }, transaction)
        const character = await transaction.globalCharacter.findUniqueOrThrow({
          where: { id: input.characterId },
          include: { appearances: true },
        })

        if (character.appearances.length <= 1) throw new ApiError('INVALID_PARAMS')

        const appearance = await transaction.globalCharacterAppearance.findFirst({
          where: { characterId: input.characterId, appearanceIndex },
          select: { id: true },
        })
        if (!appearance) throw new ApiError('NOT_FOUND')

        await transaction.globalCharacterAppearance.delete({ where: { id: appearance.id } })
        return { success: true }
      },
    }),
  }
}
