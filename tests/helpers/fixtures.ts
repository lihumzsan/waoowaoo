import { randomUUID } from 'node:crypto'
import { FAL_PLATFORM_DEFAULT_IMAGE_MODEL_KEY } from '@/lib/ai-providers/fal/models'
import {
  OPENROUTER_PLATFORM_DEFAULT_ANALYSIS_MODEL_KEY,
  OPENROUTER_PLATFORM_DEFAULT_VIDEO_MODEL_KEY,
} from '@/lib/ai-providers/openrouter/models'
import { prisma } from './prisma'

function suffix() {
  return randomUUID().slice(0, 8)
}

export async function createFixtureUser() {
  const id = suffix()
  return await prisma.user.create({
    data: {
      name: `user_${id}`,
      email: `user_${id}@example.com`,
    },
  })
}

export async function createFixtureProject(userId: string) {
  const id = suffix()
  return await prisma.project.create({
    data: {
      userId,
      name: `project_${id}`,
      analysisModel: OPENROUTER_PLATFORM_DEFAULT_ANALYSIS_MODEL_KEY,
      characterModel: FAL_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
      locationModel: FAL_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
      storyboardModel: FAL_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
      editModel: FAL_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
      videoModel: OPENROUTER_PLATFORM_DEFAULT_VIDEO_MODEL_KEY,
      videoRatio: '9:16',
      imageResolution: '2K',
    },
  })
}

export async function createFixtureNovelProject(projectId: string) {
  return await prisma.project.update({
    where: { id: projectId },
    data: {
      analysisModel: OPENROUTER_PLATFORM_DEFAULT_ANALYSIS_MODEL_KEY,
      characterModel: FAL_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
      locationModel: FAL_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
      storyboardModel: FAL_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
      editModel: FAL_PLATFORM_DEFAULT_IMAGE_MODEL_KEY,
      videoModel: OPENROUTER_PLATFORM_DEFAULT_VIDEO_MODEL_KEY,
      videoRatio: '9:16',
      imageResolution: '2K',
    }
  })
}

export async function createFixtureGlobalCharacter(userId: string, folderId: string | null = null) {
  const id = suffix()
  return await prisma.globalCharacter.create({
    data: {
      userId,
      name: `character_${id}`,
      ...(folderId ? { folderId } : {}),
    },
  })
}

export async function createFixtureGlobalCharacterAppearance(characterId: string, appearanceIndex = 0) {
  return await prisma.globalCharacterAppearance.create({
    data: {
      characterId,
      appearanceIndex,
      changeReason: 'default',
      imageUrls: JSON.stringify(['images/test-0.jpg']),
      selectedIndex: 0,
    },
  })
}

export async function createFixtureGlobalLocation(userId: string, folderId: string | null = null) {
  const id = suffix()
  return await prisma.globalLocation.create({
    data: {
      userId,
      name: `location_${id}`,
      ...(folderId ? { folderId } : {}),
    },
  })
}

export async function createFixtureGlobalLocationImage(locationId: string, imageIndex = 0) {
  return await prisma.globalLocationImage.create({
    data: {
      locationId,
      imageIndex,
      imageUrl: `images/location-${suffix()}.jpg`,
      isSelected: imageIndex === 0,
    },
  })
}

export async function createFixtureEpisode(projectId: string, episodeNumber = 1) {
  return await prisma.projectEpisode.create({
    data: {
      projectId,
      episodeNumber,
      name: `Episode ${episodeNumber}`,
      novelText: 'test novel text',
    },
  })
}
