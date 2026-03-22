import { prisma } from '@/lib/prisma'
import { resolveAnalysisModel as resolveAnalysisModelKey } from './resolve-analysis-model'

export async function resolveAnalysisModel(projectId: string, userId: string): Promise<{
  id: string
  analysisModel: string
}> {
  const novelData = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: { id: true },
  })
  if (!novelData) throw new Error('Novel promotion project not found')

  const analysisModel = await resolveAnalysisModelKey({ userId, projectId })
  return { id: novelData.id, analysisModel }
}

export async function requireProjectLocation(locationId: string, projectInternalId: string) {
  const location = await prisma.novelPromotionLocation.findFirst({
    where: {
      id: locationId,
      novelPromotionProjectId: projectInternalId,
    },
    select: {
      id: true,
      name: true,
    },
  })
  if (!location) throw new Error('Location not found')
  return location
}

export async function persistLocationDescription(params: {
  locationId: string
  imageIndex: number
  modifiedDescription: string
}) {
  const locationImage = await prisma.locationImage.findFirst({
    where: {
      locationId: params.locationId,
      imageIndex: params.imageIndex,
    },
    select: {
      id: true,
    },
  })
  if (!locationImage) throw new Error('Location image not found')

  await prisma.locationImage.update({
    where: { id: locationImage.id },
    data: { description: params.modifiedDescription },
  })

  return await prisma.novelPromotionLocation.findUnique({
    where: { id: params.locationId },
    include: { images: { orderBy: { imageIndex: 'asc' } } },
  })
}
