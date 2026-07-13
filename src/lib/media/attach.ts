import { decodeImageUrlsFromDb } from '@/lib/contracts/image-urls-contract'
import {
  resolveMediaRef,
  resolveMediaRefFromLegacyValue,
  type MediaClient,
} from './service'
import type { MediaRef } from './types'

function parseStringArray(value: unknown): string[] {
  if (!value) return []
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

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

async function attachMediaFieldsToPanel<T extends Record<string, unknown>>(panel: T) {
  const imageMedia = await resolveMediaRef(panel.imageMediaId, panel.imageUrl)
  const videoMedia = await resolveMediaRef(panel.videoMediaId, panel.videoUrl)

  const candidateRaw = parseStringArray(panel.candidateImages)
  const candidateMediaUrls: string[] = []
  for (const candidate of candidateRaw) {
    if (candidate.startsWith('PENDING:')) {
      candidateMediaUrls.push(candidate)
      continue
    }
    const media = await resolveMediaRefFromLegacyValue(candidate)
    candidateMediaUrls.push(media?.url || candidate)
  }

  return {
    ...panel,
    media: imageMedia,
    imageMedia,
    videoMedia,
    imageUrl: imageMedia?.url || panel.imageUrl || null,
    videoUrl: videoMedia?.url || panel.videoUrl || null,
    candidateImages: candidateRaw.length > 0 ? JSON.stringify(candidateMediaUrls) : panel.candidateImages,
  }
}

async function attachMediaFieldsToStoryboard<T extends Record<string, unknown>>(storyboard: T) {
  const storyboardImageMedia = await resolveMediaRefFromLegacyValue(storyboard.storyboardImageUrl)
  const panels = await Promise.all(
    ((storyboard.panels as Array<Record<string, unknown>>) || []).map(attachMediaFieldsToPanel),
  )

  return {
    ...storyboard,
    media: storyboardImageMedia,
    storyboardImageMedia,
    storyboardImageUrl: storyboardImageMedia?.url || storyboard.storyboardImageUrl || null,
    panels,
  }
}

async function attachMediaFieldsToProjectCharacter<T extends Record<string, unknown>>(character: T) {
  const appearances = await Promise.all(
    ((character.appearances as Array<Record<string, unknown>>) || [])
      .map((appearance) => attachMediaFieldsToAppearance(appearance)),
  )
  return {
    ...character,
    appearances,
  }
}

async function attachMediaFieldsToProjectLocation<T extends Record<string, unknown>>(location: T) {
  const images = await Promise.all(
    ((location.images as Array<Record<string, unknown>>) || []).map(async (img) => {
    const imageMedia = await resolveMediaRef(img.imageMediaId, img.imageUrl)
    const previousImageMedia = await resolveMediaRef(img.previousImageMediaId, img.previousImageUrl)
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

async function attachMediaFieldsToProjectProp<T extends Record<string, unknown>>(prop: T) {
  return await attachMediaFieldsToProjectLocation(prop)
}

async function attachMediaFieldsToShot<T extends Record<string, unknown>>(shot: T) {
  const imageMedia = await resolveMediaRef(shot.imageMediaId, shot.imageUrl)
  const videoMedia = await resolveMediaRefFromLegacyValue(shot.videoUrl)
  return {
    ...shot,
    media: imageMedia,
    imageMedia,
    videoMedia,
    imageUrl: imageMedia?.url || shot.imageUrl || null,
    videoUrl: videoMedia?.url || shot.videoUrl || null,
  }
}

async function attachMediaFieldsToVideoGroup<T extends Record<string, unknown>>(group: T) {
  const referenceImageMedia = await resolveMediaRef(group.referenceImageMediaId, group.referenceImageUrl)
  const videoMedia = await resolveMediaRef(group.videoMediaId, group.videoUrl)
  return {
    ...group,
    referenceImageMedia,
    videoMedia,
    referenceImageUrl: referenceImageMedia?.url || group.referenceImageUrl || null,
    videoUrl: videoMedia?.url || group.videoUrl || null,
  }
}

export async function attachMediaFieldsToProject<T extends Record<string, unknown>>(projectLike: T) {
  const audioMedia = await resolveMediaRef(projectLike.audioMediaId, projectLike.audioUrl)
  const characters = await Promise.all(
    ((projectLike.characters as Array<Record<string, unknown>>) || []).map(attachMediaFieldsToProjectCharacter),
  )
  const locations = await Promise.all(
    ((projectLike.locations as Array<Record<string, unknown>>) || []).map(attachMediaFieldsToProjectLocation),
  )
  const props = await Promise.all(
    ((projectLike.props as Array<Record<string, unknown>>) || []).map(attachMediaFieldsToProjectProp),
  )
  const shots = await Promise.all(
    ((projectLike.shots as Array<Record<string, unknown>>) || []).map(attachMediaFieldsToShot),
  )
  const storyboards = await Promise.all(
    ((projectLike.storyboards as Array<Record<string, unknown>>) || []).map(attachMediaFieldsToStoryboard),
  )
  const videoGroups = await Promise.all(
    ((projectLike.videoGroups as Array<Record<string, unknown>>) || []).map(attachMediaFieldsToVideoGroup),
  )

  return {
    ...projectLike,
    media: audioMedia,
    audioMedia,
    audioUrl: audioMedia?.url || projectLike.audioUrl || null,
    characters,
    locations,
    props,
    shots,
    storyboards,
    videoGroups,
  }
}

export function firstMediaUrl(list: MediaRef[]): string[] {
  return list.map((m) => m.url)
}
