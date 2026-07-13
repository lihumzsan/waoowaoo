import type { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'

export async function confirmProjectLocationBackedSelection(
  assetId: string,
  selectedIndex: number | null | undefined,
  client: Prisma.TransactionClient,
): Promise<{ success: true }> {
  const location = await client.projectLocation.findUnique({
    where: { id: assetId },
    include: { images: { orderBy: { imageIndex: 'asc' } } },
  })
  if (!location) {
    throw new ApiError('NOT_FOUND')
  }

  const selectedImage = selectedIndex !== null && selectedIndex !== undefined
    ? location.images.find((image) => image.imageIndex === selectedIndex)
    : location.selectedImageId
      ? location.images.find((image) => image.id === location.selectedImageId)
      : location.images.find((image) => image.isSelected)

  if (location.images.length <= 1) {
    const onlyImage = location.images[0] ?? null
    if (
      onlyImage &&
      selectedIndex !== null &&
      selectedIndex !== undefined &&
      onlyImage.imageIndex !== selectedIndex
    ) {
      throw new ApiError('INVALID_PARAMS')
    }
    if (onlyImage) {
      await client.locationImage.update({
          where: { id: onlyImage.id },
          data: {
            imageIndex: 0,
            isSelected: true,
          },
        })
      await client.projectLocation.update({
          where: { id: assetId },
          data: { selectedImageId: onlyImage.id },
      })
    }
    return { success: true }
  }

  if (!selectedImage || !selectedImage.imageUrl) {
    throw new ApiError('INVALID_PARAMS')
  }

  await client.locationImage.deleteMany({
      where: {
        locationId: assetId,
        id: { not: selectedImage.id },
      },
    })
  await client.locationImage.update({
      where: { id: selectedImage.id },
      data: {
        imageIndex: 0,
        isSelected: true,
      },
    })
  await client.projectLocation.update({
      where: { id: assetId },
      data: { selectedImageId: selectedImage.id },
  })

  return { success: true }
}
