import { decodeImageUrlsFromDb } from '@/lib/contracts/image-urls-contract'
import {
  resolveMediaRef,
  resolveMediaRefFromLegacyValue,
  type MediaClient,
} from './service'
import type { MediaRef } from './types'

async function resolveAppearanceImageArray(
  raw: unknown,
  fieldName: string,
  client?: MediaClient,
): Promise<{ urls: string[]; medias: MediaRef[] }> {
  const values = decodeImageUrlsFromDb(raw as string | null | undefined, fieldName)
  const refs = await Promise.all(values.map((value) => resolveMediaRefFromLegacyValue(value, client)))
  return {
    urls: values.map((value, index) => refs[index]?.url || value),
    medias: refs.filter((ref): ref is MediaRef => !!ref),
  }
}

async function attachMediaFieldsToAppearance<T extends Record<string, unknown>>(
  appearance: T,
  client?: MediaClient,
) {
  const imageMedia = await resolveMediaRef(appearance.imageMediaId, appearance.imageUrl, client)
  const previousImageMedia = await resolveMediaRef(appearance.previousImageMediaId, appearance.previousImageUrl, client)
  const imageResult = await resolveAppearanceImageArray(appearance.imageUrls, 'appearance.imageUrls', client)
  const previousImageResult = await resolveAppearanceImageArray(appearance.previousImageUrls, 'appearance.previousImageUrls', client)

  return {
    ...appearance,
    imageMedia,
    media: imageMedia,
    previousImageMedia,
    imageMedias: imageResult.medias,
    previousImageMedias: previousImageResult.medias,
    imageUrl: imageMedia?.url || appearance.imageUrl || null,
    previousImageUrl: previousImageMedia?.url || appearance.previousImageUrl || null,
    imageUrls: imageResult.urls,
    previousImageUrls: previousImageResult.urls,
  }
}

export async function attachMediaFieldsToGlobalCharacter<T extends Record<string, unknown>>(
  character: T,
  client?: MediaClient,
) {
  const appearances = await Promise.all(
    ((character.appearances as Array<Record<string, unknown>>) || [])
      .map((appearance) => attachMediaFieldsToAppearance(appearance, client)),
  )

  return {
    ...character,
    appearances,
  }
}

export async function attachMediaFieldsToGlobalLocation<T extends Record<string, unknown>>(
  location: T,
  client?: MediaClient,
) {
  const images = await Promise.all(
    ((location.images as Array<Record<string, unknown>>) || []).map(async (img) => {
    const imageMedia = await resolveMediaRef(img.imageMediaId, img.imageUrl, client)
    const previousImageMedia = await resolveMediaRef(img.previousImageMediaId, img.previousImageUrl, client)
    return {
      ...img,
      media: imageMedia,
      imageMedia,
      previousImageMedia,
      imageUrl: imageMedia?.url || img.imageUrl || null,
      previousImageUrl: previousImageMedia?.url || img.previousImageUrl || null,
    }
    }),
  )

  return {
    ...location,
    images,
  }
}

export function firstMediaUrl(list: MediaRef[]): string[] {
  return list.map((m) => m.url)
}
