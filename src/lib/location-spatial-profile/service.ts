import { type Prisma } from '@prisma/client'
import { AI_PROMPT_IDS, buildAiPrompt } from '@/lib/ai-prompts'
import { executeAiVisionStep } from '@/lib/ai-exec/engine'
import { safeParseJsonObject } from '@/lib/json-repair'
import { normalizeReferenceImagesForGeneration } from '@/lib/media/outbound-image'
import { prisma } from '@/lib/prisma'
import type { Locale } from '@/i18n/routing'
import {
  deriveAvailableSlotsFromSpatialProfile,
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

function profileToJson(profile: LocationSpatialProfile): Prisma.InputJsonValue {
  return profile as unknown as Prisma.InputJsonObject
}

function profileAvailableSlotsJson(profile: LocationSpatialProfile): string {
  return JSON.stringify(deriveAvailableSlotsFromSpatialProfile(profile))
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

  const completion = await executeAiVisionStep({
    userId: input.userId,
    model: input.model,
    prompt,
    imageUrls: normalizedImages,
    temperature: 0.1,
    projectId: input.projectId ?? undefined,
    action: AI_PROMPT_IDS.LOCATION_SPATIAL_PROFILE,
    meta: {
      stepId: AI_PROMPT_IDS.LOCATION_SPATIAL_PROFILE,
      stepTitle: 'Analyze location spatial profile',
      stepIndex: 1,
      stepTotal: 1,
    },
  })
  if (!completion.text.trim()) throw new Error('LOCATION_SPATIAL_PROFILE_EMPTY')

  const parsed = safeParseJsonObject(completion.text)
  return parseLocationSpatialProfile(parsed)
}

export async function analyzeAndPersistProjectLocationImageSpatialProfile(
  input: AnalyzeProjectLocationImageInput,
): Promise<LocationSpatialProfile> {
  const image = await prisma.locationImage.findUnique({
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

  await prisma.locationImage.update({
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
    await prisma.locationImage.update({
      where: { id: input.imageId },
      data: {
        spatialProfileJson: profileToJson(profile),
        spatialProfileStatus: 'ready',
        spatialProfileError: null,
        spatialProfileAnalyzedAt: new Date(),
        spatialProfileModel: input.model,
        availableSlots: profileAvailableSlotsJson(profile),
      },
    })
    return profile
  } catch (error) {
    await prisma.locationImage.update({
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
): Promise<LocationSpatialProfile> {
  const image = await prisma.globalLocationImage.findUnique({
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

  await prisma.globalLocationImage.update({
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
    await prisma.globalLocationImage.update({
      where: { id: input.imageId },
      data: {
        spatialProfileJson: profileToJson(profile),
        spatialProfileStatus: 'ready',
        spatialProfileError: null,
        spatialProfileAnalyzedAt: new Date(),
        spatialProfileModel: input.model,
        availableSlots: profileAvailableSlotsJson(profile),
      },
    })
    return profile
  } catch (error) {
    await prisma.globalLocationImage.update({
      where: { id: input.imageId },
      data: {
        spatialProfileStatus: 'failed',
        spatialProfileError: errorMessage(error),
      },
    })
    throw error
  }
}
