import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { type TaskJobData } from '@/lib/task/types'
import { encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import {
  assertTaskActive,
  getProjectModels,
  getUserModels,
  resolveImageSourceFromGeneration,
  toSignedUrlIfCos,
  uploadImageSourceToCos,
} from '../utils'
import {
  normalizeReferenceImagesForGeneration,
  normalizeToBase64ForGeneration,
} from '@/lib/media/outbound-image'
import {
  AnyObj,
  buildImageProviderRuntimeOptions,
  parseImageUrls,
  pickFirstString,
} from './image-task-handler-shared'
import { createScopedLogger } from '@/lib/logging/core'
import {
  buildCharacterDescriptionFields,
  generateModifiedAssetDescription,
  readIndexedDescription,
} from './modify-description-sync'
import { analyzeAndPersistProjectLocationImageSpatialProfile } from '@/lib/location-spatial-profile/service'

const logger = createScopedLogger({ module: 'worker.modify-asset-image' })

interface LocationImageRecord {
  id: string
  locationId: string
  description: string | null
  imageUrl: string | null
  previousDescription: string | null
  location: {
    name: string
  } | null
}

export async function handleModifyAssetImageTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const type = payload.type
  const modifyPrompt = payload.modifyPrompt

  if (!type || !modifyPrompt) {
    throw new Error('modify task missing type/modifyPrompt')
  }

  const projectModels = await getProjectModels(job.data.projectId, job.data.userId)
  const editModel = projectModels.editModel
  if (!editModel) throw new Error('Edit model not configured')

  const modifyInstruction = typeof modifyPrompt === 'string' ? modifyPrompt.trim() : ''

  if (type === 'character') {
    const appearanceId = pickFirstString(payload.appearanceId, payload.targetId, job.data.targetId)
    if (!appearanceId) throw new Error('character appearance id missing')

    const appearance = await prisma.characterAppearance.findUnique({
      where: { id: appearanceId },
    })
    if (!appearance) throw new Error('Character appearance not found')

    const imageIndex = Number(payload.imageIndex ?? appearance.selectedIndex ?? 0)
    const imageUrls = parseImageUrls(appearance.imageUrls, 'characterAppearance.imageUrls')
    const currentKey = imageUrls[imageIndex] || appearance.imageUrl
    const currentUrl = toSignedUrlIfCos(currentKey, 3600)
    if (!currentUrl) throw new Error('No image to modify')

    const extraReferenceInputs: string[] = []
    if (Array.isArray(payload.extraImageUrls)) {
      for (const url of payload.extraImageUrls) {
        if (typeof url === 'string' && url.trim().length > 0) {
          extraReferenceInputs.push(url.trim())
        }
      }
    }
    const requiredReference = await normalizeToBase64ForGeneration(currentUrl)
    const normalizedExtras = await normalizeReferenceImagesForGeneration(extraReferenceInputs, {
      context: { taskType: String(job.data.type), scope: 'image-task-handlers-core.extra' },
    })
    const referenceImages = Array.from(new Set([requiredReference, ...normalizedExtras]))
    const currentDescription = readIndexedDescription({
      descriptions: appearance.descriptions,
      fallbackDescription: appearance.description,
      index: imageIndex,
    })

    const prompt = `请根据以下指令修改图片，保持人物核心特征一致：\n${modifyInstruction}`
    const source = await resolveImageSourceFromGeneration(job, {
      userId: job.data.userId,
      modelId: editModel,
      prompt,
      options: buildImageProviderRuntimeOptions({
        generationOptions: payload.generationOptions,
        context: 'character_modify',
        referenceImages,
      }),
    })

    const cosKey = await uploadImageSourceToCos(
      source,
      'character-modify',
      appearance.id,
      { taskId: job.data.taskId, artifact: `character-modify:${appearance.id}:${imageIndex}` },
    )

    while (imageUrls.length <= imageIndex) imageUrls.push('')
    imageUrls[imageIndex] = cosKey

    const selectedIndex = appearance.selectedIndex
    const shouldUpdateMain = selectedIndex === imageIndex || (selectedIndex === null && imageIndex === 0) || imageUrls.length === 1

    let descriptionFields: { description: string; descriptions: string } | null = null
    if (currentDescription && modifyInstruction) {
      try {
        const userModels = await getUserModels(job.data.userId)
        const analysisModel = userModels.analysisModel
        if (analysisModel) {
          const nextDescription = await generateModifiedAssetDescription({
            userId: job.data.userId,
            model: analysisModel,
            locale: job.data.locale,
            type: 'character',
            currentDescription,
            modifyInstruction,
            referenceImages: normalizedExtras,
            projectId: job.data.projectId,
          })
          descriptionFields = buildCharacterDescriptionFields({
            descriptions: appearance.descriptions,
            fallbackDescription: appearance.description,
            index: imageIndex,
            nextDescription: nextDescription.prompt,
          })
        }
      } catch (err) {
        logger.warn({ message: '项目角色描述同步失败，不影响改图结果', details: { error: String(err) } })
      }
    }

    await assertTaskActive(job, 'persist_character_modify')
    await prisma.characterAppearance.update({
      where: { id: appearance.id },
      data: {
        previousImageUrl: appearance.imageUrl || null,
        previousImageUrls: appearance.imageUrls,
        previousDescription: appearance.description || null,
        previousDescriptions: appearance.descriptions || null,
        imageUrls: encodeImageUrls(imageUrls),
        imageUrl: shouldUpdateMain ? cosKey : appearance.imageUrl,
        ...(descriptionFields || {}),
      },
    })

    return { type, appearanceId: appearance.id, imageIndex, imageUrl: cosKey }
  }

  if (type === 'location' || type === 'prop') {
    const locationImageId = pickFirstString(payload.locationImageId, payload.targetId, job.data.targetId)
    let locationImage: LocationImageRecord | null = locationImageId
      ? await prisma.locationImage.findUnique({
        where: { id: locationImageId },
        include: { location: true },
      }) as unknown as LocationImageRecord | null
      : null

    const payloadLocationId = typeof payload.locationId === 'string' ? payload.locationId : null
    if (!locationImage && payloadLocationId) {
      locationImage = await prisma.locationImage.findFirst({
        where: { locationId: payloadLocationId, imageIndex: Number(payload.imageIndex ?? 0) },
        include: { location: true },
      }) as unknown as LocationImageRecord | null
    }

    if (!locationImage || !locationImage.imageUrl) {
      throw new Error('Location image not found')
    }

    const currentUrl = toSignedUrlIfCos(locationImage.imageUrl, 3600)
    if (!currentUrl) throw new Error('No location image url')

    const extraReferenceInputs: string[] = []
    if (Array.isArray(payload.extraImageUrls)) {
      for (const url of payload.extraImageUrls) {
        if (typeof url === 'string' && url.trim().length > 0) {
          extraReferenceInputs.push(url.trim())
        }
      }
    }
    const requiredReference = await normalizeToBase64ForGeneration(currentUrl)
    const normalizedExtras = await normalizeReferenceImagesForGeneration(extraReferenceInputs, {
      context: { taskType: String(job.data.type), scope: 'image-task-handlers-core.extra' },
    })
    const referenceImages = Array.from(new Set([requiredReference, ...normalizedExtras]))

    const isProp = type === 'prop'
    const spatialProfileModel = projectModels.analysisModel
    if (!isProp && !spatialProfileModel) throw new Error('LOCATION_SPATIAL_PROFILE_MODEL_REQUIRED')
    const prompt = isProp
      ? `请根据以下指令修改道具图片，保持道具主体、结构和关键材质一致：\n${modifyInstruction}`
      : `请根据以下指令修改场景图片，保持整体风格一致：\n${modifyInstruction}`
    const source = await resolveImageSourceFromGeneration(job, {
      userId: job.data.userId,
      modelId: editModel,
      prompt,
      options: buildImageProviderRuntimeOptions({
        generationOptions: payload.generationOptions,
        context: isProp ? 'prop_modify' : 'location_modify',
        referenceImages,
      }),
    })

    const cosKey = await uploadImageSourceToCos(
      source,
      isProp ? 'prop-modify' : 'location-modify',
      locationImage.id,
      { taskId: job.data.taskId, artifact: `${isProp ? 'prop' : 'location'}-modify:${locationImage.id}` },
    )

    let extractedDescription: {
      prompt: string
    } | null = null
    if (locationImage.description && modifyInstruction) {
      try {
        const userModels = await getUserModels(job.data.userId)
        const analysisModel = userModels.analysisModel
        if (analysisModel) {
          extractedDescription = await generateModifiedAssetDescription({
            userId: job.data.userId,
            model: analysisModel,
            locale: job.data.locale,
            type: isProp ? 'prop' : 'location',
            currentDescription: locationImage.description,
            modifyInstruction,
            referenceImages: normalizedExtras,
            locationName: locationImage.location?.name || '场景',
            propName: isProp ? (locationImage.location?.name || '道具') : undefined,
            projectId: job.data.projectId,
          })
        }
      } catch (err) {
        logger.warn({ message: isProp ? '项目道具描述同步失败，不影响改图结果' : '项目场景描述同步失败，不影响改图结果', details: { error: String(err) } })
      }
    }

    await assertTaskActive(job, isProp ? 'persist_prop_modify' : 'persist_location_modify')
    await prisma.locationImage.update({
      where: { id: locationImage.id },
      data: {
        previousImageUrl: locationImage.imageUrl,
        previousDescription: locationImage.description || null,
        imageUrl: cosKey,
        ...(!isProp
          ? {
            spatialProfileStatus: 'stale',
            spatialProfileError: null,
          }
          : {}),
        ...(extractedDescription ? {
          description: extractedDescription.prompt,
        } : {}),
      },
    })
    if (!isProp) {
      const profileModel = spatialProfileModel
      if (!profileModel) throw new Error('LOCATION_SPATIAL_PROFILE_MODEL_REQUIRED')
      await assertTaskActive(job, 'analyze_location_spatial_profile')
      await analyzeAndPersistProjectLocationImageSpatialProfile({
        imageId: locationImage.id,
        userId: job.data.userId,
        projectId: job.data.projectId,
        model: profileModel,
        locale: job.data.locale === 'en' ? 'en' : 'zh',
      })
    }

    return { type, locationImageId: locationImage.id, imageUrl: cosKey }
  }

  throw new Error(`Unsupported modify type: ${String(type)}`)
}
