import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

type LocationSlotClient = Pick<Prisma.TransactionClient, 'locationImage' | 'globalLocationImage'>

export async function ensureProjectLocationImageSlots(
  input: {
    locationId: string
    count: number
    fallbackDescription: string
  },
  client: LocationSlotClient = prisma,
) {
  const existing = await client.locationImage.findMany({
    where: { locationId: input.locationId },
    select: { imageIndex: true },
    orderBy: { imageIndex: 'asc' },
  })
  const existingIndexes = new Set(existing.map((item) => item.imageIndex))
  const toCreate: Array<{
    locationId: string
    imageIndex: number
    description: string
  }> = []

  for (let imageIndex = 0; imageIndex < input.count; imageIndex += 1) {
    if (existingIndexes.has(imageIndex)) continue
    toCreate.push({
      locationId: input.locationId,
      imageIndex,
      description: input.fallbackDescription,
    })
  }

  if (toCreate.length > 0) {
    await client.locationImage.createMany({ data: toCreate })
  }
}

export async function ensureGlobalLocationImageSlots(
  input: {
    locationId: string
    count: number
    fallbackDescription: string
  },
  client: LocationSlotClient = prisma,
) {
  const existing = await client.globalLocationImage.findMany({
    where: { locationId: input.locationId },
    select: { imageIndex: true },
    orderBy: { imageIndex: 'asc' },
  })
  const existingIndexes = new Set(existing.map((item) => item.imageIndex))
  const toCreate: Array<{
    locationId: string
    imageIndex: number
    description: string
  }> = []

  for (let imageIndex = 0; imageIndex < input.count; imageIndex += 1) {
    if (existingIndexes.has(imageIndex)) continue
    toCreate.push({
      locationId: input.locationId,
      imageIndex,
      description: input.fallbackDescription,
    })
  }

  if (toCreate.length > 0) {
    await client.globalLocationImage.createMany({ data: toCreate })
  }
}
