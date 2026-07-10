import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { planAssetGenerateTask } from '@/lib/assets/services/asset-actions'
import type { ProjectAgentOperationContext } from '@/lib/operations/types'
import type { OperationPlan } from '@/lib/operations/planning'
import { assertNoLegacyArtStyle, normalizeString, resolveLocaleFromContext } from './shared'

export async function planCharacterImageGenerationOperation(
  ctx: ProjectAgentOperationContext,
  input: z.infer<ReturnType<typeof buildGenerateCharacterImageInputSchema>>,
): Promise<OperationPlan> {
  assertNoLegacyArtStyle(input as unknown as Record<string, unknown>)
  const locale = resolveLocaleFromContext(ctx.context.locale)

  let characterId = normalizeString(input.characterId)
  const characterName = normalizeString(input.characterName)
  if (!characterId) {
    const exact = await prisma.projectCharacter.findFirst({
      where: {
        projectId: ctx.projectId,
        name: characterName,
      },
      select: { id: true },
    })
    if (exact) {
      characterId = exact.id
    } else {
      const fuzzy = await prisma.projectCharacter.findFirst({
        where: {
          projectId: ctx.projectId,
          name: {
            contains: characterName,
          },
        },
        select: { id: true },
      })
      if (fuzzy) {
        characterId = fuzzy.id
      }
    }
  }
  if (!characterId) {
    throw new Error('PROJECT_AGENT_CHARACTER_NOT_FOUND')
  }

  let appearanceId = normalizeString(input.appearanceId)
  if (!appearanceId) {
    const appearance = await prisma.characterAppearance.findFirst({
      where: { characterId },
      orderBy: { appearanceIndex: 'asc' },
      select: { id: true },
    })
    appearanceId = appearance?.id || ''
  }

  const body: Record<string, unknown> = {
    meta: {
      locale,
    },
    ...(appearanceId ? { appearanceId } : {}),
    ...(typeof input.appearanceIndex === 'number' ? { appearanceIndex: input.appearanceIndex } : {}),
    ...(typeof input.count === 'number' ? { count: input.count } : {}),
    ...(typeof input.imageIndex === 'number' ? { imageIndex: input.imageIndex } : {}),
  }

  const planned = await planAssetGenerateTask({
    request: ctx.request,
    kind: 'character',
    assetId: characterId,
    body,
    access: {
      scope: 'project',
      userId: ctx.userId,
      projectId: ctx.projectId,
    },
  })

  return {
    kind: 'task_submission',
    operationId: 'generate_character_image',
    projectId: ctx.projectId,
    userId: ctx.userId,
    tasks: [planned.task],
    metadata: {
      assetId: characterId,
      assetKind: 'character',
      appearanceId: appearanceId || null,
      mutationTargetType: 'ProjectCharacter',
      mutationTargetId: characterId,
    },
  }
}

export async function planLocationImageGenerationOperation(
  ctx: ProjectAgentOperationContext,
  input: z.infer<ReturnType<typeof buildGenerateLocationImageInputSchema>>,
): Promise<OperationPlan> {
  assertNoLegacyArtStyle(input as unknown as Record<string, unknown>)
  const locale = resolveLocaleFromContext(ctx.context.locale)

  let locationId = normalizeString(input.locationId)
  const locationName = normalizeString(input.locationName)
  if (!locationId) {
    const exact = await prisma.projectLocation.findFirst({
      where: {
        projectId: ctx.projectId,
        name: locationName,
      },
      select: { id: true },
    })
    if (exact) {
      locationId = exact.id
    } else {
      const fuzzy = await prisma.projectLocation.findFirst({
        where: {
          projectId: ctx.projectId,
          name: {
            contains: locationName,
          },
        },
        select: { id: true },
      })
      if (fuzzy) {
        locationId = fuzzy.id
      }
    }
  }
  if (!locationId) {
    throw new Error('PROJECT_AGENT_LOCATION_NOT_FOUND')
  }

  const body: Record<string, unknown> = {
    meta: {
      locale,
    },
    ...(typeof input.count === 'number' ? { count: input.count } : {}),
    ...(typeof input.imageIndex === 'number' ? { imageIndex: input.imageIndex } : {}),
  }

  const planned = await planAssetGenerateTask({
    request: ctx.request,
    kind: 'location',
    assetId: locationId,
    body,
    access: {
      scope: 'project',
      userId: ctx.userId,
      projectId: ctx.projectId,
    },
  })

  return {
    kind: 'task_submission',
    operationId: 'generate_location_image',
    projectId: ctx.projectId,
    userId: ctx.userId,
    tasks: [planned.task],
    metadata: {
      assetId: locationId,
      assetKind: 'location',
      appearanceId: null,
      mutationTargetType: 'ProjectLocation',
      mutationTargetId: locationId,
    },
  }
}

export function buildGenerateCharacterImageInputSchema() {
  return z.object({
    characterId: z.string().min(1).optional(),
    characterName: z.string().min(1).optional(),
    appearanceId: z.string().min(1).optional(),
    appearanceIndex: z.number().int().min(0).max(20).optional(),
    count: z.number().int().positive().max(6).optional(),
    imageIndex: z.number().int().min(0).max(20).optional(),
  }).refine((value) => Boolean(value.characterId || value.characterName), {
    message: 'characterId or characterName is required',
    path: ['characterId'],
  })
}

export function buildGenerateLocationImageInputSchema() {
  return z.object({
    locationId: z.string().min(1).optional(),
    locationName: z.string().min(1).optional(),
    count: z.number().int().positive().max(6).optional(),
    imageIndex: z.number().int().min(0).max(50).optional(),
  }).refine((value) => Boolean(value.locationId || value.locationName), {
    message: 'locationId or locationName is required',
    path: ['locationId'],
  })
}
