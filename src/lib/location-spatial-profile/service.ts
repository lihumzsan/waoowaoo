import { type Prisma } from '@prisma/client'
import { z } from 'zod'
import { AI_PROMPT_IDS, buildAiPrompt } from '@/lib/ai-prompts'
import { executeAiStructuredVisionStep } from '@/lib/ai-exec/structured-step'
import { normalizeReferenceImagesForGeneration } from '@/lib/media/outbound-image'
import { prisma } from '@/lib/prisma'
import type { Locale } from '@/i18n/routing'
import {
  parseLocationSpatialProfile,
  type LocationSpatialProfile,
} from './types'

interface AnalyzeLocationSpatialProfileInput {
  readonly userId: string
  readonly projectId?: string | null
  readonly model: string
  readonly locale: Locale
  readonly locationName: string
  readonly locationDescription: string | null
  readonly imageUrl: string | null
}

interface AnalyzeProjectLocationImageInput {
  readonly imageId: string
  readonly userId: string
  readonly projectId: string
  readonly model: string
  readonly locale: Locale
}

interface AnalyzeGlobalLocationImageInput {
  readonly imageId: string
  readonly userId: string
  readonly model: string
  readonly locale: Locale
}

export function locationSpatialProfileToJson(profile: LocationSpatialProfile): Prisma.InputJsonValue {
  return profile as unknown as Prisma.InputJsonObject
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function analyzeLocationSpatialProfile(
  input: AnalyzeLocationSpatialProfileInput,
): Promise<LocationSpatialProfile> {
  const imageUrl = input.imageUrl?.trim()
  if (!imageUrl) throw new Error('LOCATION_SPATIAL_PROFILE_IMAGE_REQUIRED')
  if (!input.model.trim()) throw new Error('LOCATION_SPATIAL_PROFILE_MODEL_REQUIRED')

  const normalizedImages = await normalizeReferenceImagesForGeneration([imageUrl], {
    context: {
      purpose: 'location_spatial_profile',
      projectId: input.projectId ?? null,
      userId: input.userId,
    },
  })
  if (normalizedImages.length !== 1) throw new Error('LOCATION_SPATIAL_PROFILE_IMAGE_NORMALIZE_FAILED')

  const prompt = buildAiPrompt({
    promptId: AI_PROMPT_IDS.LOCATION_SPATIAL_PROFILE,
    locale: input.locale,
    variables: {
      location_name: input.locationName,
      location_description: input.locationDescription ?? '',
    },
  })

  const completion = await executeAiStructuredVisionStep({
    userId: input.userId,
    model: input.model,
    prompt,
    imageUrls: normalizedImages,
    temperature: 0.1,
    projectId: input.projectId ?? undefined,
    action: AI_PROMPT_IDS.LOCATION_SPATIAL_PROFILE,
    locale: input.locale,
    meta: {
      stepId: AI_PROMPT_IDS.LOCATION_SPATIAL_PROFILE,
      stepTitle: 'Analyze location spatial profile',
      stepIndex: 1,
      stepTotal: 1,
    },
    schema: z.unknown(),
    parse: { kind: 'object' },
    validate: parseLocationSpatialProfile,
  })
  if (!completion.text.trim()) throw new Error('LOCATION_SPATIAL_PROFILE_EMPTY')
  return completion.data
}

export async function analyzeAndPersistProjectLocationImageSpatialProfile(
  input: AnalyzeProjectLocationImageInput,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<LocationSpatialProfile> {
  const image = await client.locationImage.findUnique({
    where: { id: input.imageId },
    include: {
      location: {
        select: {
          id: true,
          name: true,
          projectId: true,
        },
      },
    },
  })
  if (!image || image.location.projectId !== input.projectId) {
    throw new Error(`LOCATION_SPATIAL_PROFILE_IMAGE_NOT_FOUND:${input.imageId}`)
  }

  await client.locationImage.update({
    where: { id: input.imageId },
    data: {
      spatialProfileStatus: 'analyzing',
      spatialProfileError: null,
    },
  })

  try {
    const profile = await analyzeLocationSpatialProfile({
      userId: input.userId,
      projectId: input.projectId,
      model: input.model,
      locale: input.locale,
      locationName: image.location.name,
      locationDescription: image.description,
      imageUrl: image.imageUrl,
    })
    await client.locationImage.update({
      where: { id: input.imageId },
      data: {
        spatialProfileJson: locationSpatialProfileToJson(profile),
        spatialProfileStatus: 'ready',
        spatialProfileError: null,
        spatialProfileAnalyzedAt: new Date(),
        spatialProfileModel: input.model,
      },
    })
    return profile
  } catch (error) {
    await client.locationImage.update({
      where: { id: input.imageId },
      data: {
        spatialProfileStatus: 'failed',
        spatialProfileError: errorMessage(error),
      },
    })
    throw error
  }
}

export async function analyzeAndPersistGlobalLocationImageSpatialProfile(
  input: AnalyzeGlobalLocationImageInput,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<LocationSpatialProfile> {
  const image = await client.globalLocationImage.findUnique({
    where: { id: input.imageId },
    include: {
      location: {
        select: {
          id: true,
          name: true,
          userId: true,
        },
      },
    },
  })
  if (!image || image.location.userId !== input.userId) {
    throw new Error(`GLOBAL_LOCATION_SPATIAL_PROFILE_IMAGE_NOT_FOUND:${input.imageId}`)
  }

  await client.globalLocationImage.update({
    where: { id: input.imageId },
    data: {
      spatialProfileStatus: 'analyzing',
      spatialProfileError: null,
    },
  })

  try {
    const profile = await analyzeLocationSpatialProfile({
      userId: input.userId,
      model: input.model,
      locale: input.locale,
      locationName: image.location.name,
      locationDescription: image.description,
      imageUrl: image.imageUrl,
    })
    await client.globalLocationImage.update({
      where: { id: input.imageId },
      data: {
        spatialProfileJson: locationSpatialProfileToJson(profile),
        spatialProfileStatus: 'ready',
        spatialProfileError: null,
        spatialProfileAnalyzedAt: new Date(),
        spatialProfileModel: input.model,
      },
    })
    return profile
  } catch (error) {
    await client.globalLocationImage.update({
      where: { id: input.imageId },
      data: {
        spatialProfileStatus: 'failed',
        spatialProfileError: errorMessage(error),
      },
    })
    throw error
  }
}
