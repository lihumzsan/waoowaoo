import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { getProjectModelConfig } from '@/lib/config-service'
import { decodeImageUrlsFromDb } from '@/lib/contracts/image-urls-contract'
import { normalizeVideoBlockPlanResponse } from '@/lib/video-groups/planner'
import { editCinematographyShotPlanSchema, editDirectorDecoupageSchema, editScriptStyleBibleSchema } from '@/lib/edit-script/types'
import { parseLocationSpatialProfile, type LocationSpatialProfile } from '@/lib/location-spatial-profile/types'
import type { EditAssetRequirement, EditScriptPayload, EditScriptShot } from '@/lib/edit-script/types'
import type {
  StoryboardConsistencyAssetSnapshot,
  StoryboardConsistencyModelConfigSnapshot,
  StoryboardConsistencySourceSnapshot,
  StoryboardConsistencySourceVideoBlock,
} from './types'

interface PersistedRequirement {
  readonly id: string
  readonly kind: string
  readonly name: string
  readonly description: string
  readonly shotIndexes: Prisma.JsonValue
  readonly status: string
  readonly targetId: string | null
  readonly errorMessage: string | null
}

interface PersistedEditScript {
  readonly id: string
  readonly projectId: string
  readonly episodeId: string
  readonly userPrompt: string
  readonly styleBibleJson: Prisma.JsonValue | null
  readonly screenplayText: string | null
  readonly title: string
  readonly logline: string | null
  readonly durationSec: number
  readonly shotCount: number
  readonly status: string
  readonly assetReviewStatus: string
  readonly shotsJson: Prisma.JsonValue
  readonly videoBlocksJson: Prisma.JsonValue | null
  readonly requirements: readonly PersistedRequirement[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readShotNumbers(value: Prisma.JsonValue): number[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'number' && Number.isInteger(item) && item > 0 ? item : null))
    .filter((item): item is number => item !== null)
}

function parseShotsJson(value: Prisma.JsonValue): EditScriptShot[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): EditScriptShot[] => {
    if (!isRecord(item)) return []
    return [{
      shotNumber: Number(item.shotNumber),
      durationSec: Number(item.durationSec),
      dramaticPurpose: String(item.dramaticPurpose ?? ''),
      visibleAction: String(item.visibleAction ?? ''),
      audienceFocus: String(item.audienceFocus ?? ''),
      viewpoint: String(item.viewpoint ?? ''),
      revealPlan: String(item.revealPlan ?? ''),
      performanceBeat: String(item.performanceBeat ?? ''),
      continuityIn: String(item.continuityIn ?? ''),
      continuityOut: String(item.continuityOut ?? ''),
      charactersAndScene: String(item.charactersAndScene ?? ''),
      sound: String(item.sound ?? ''),
    }]
  })
}

function mapRequirements(requirements: readonly PersistedRequirement[]): EditAssetRequirement[] {
  return requirements.map((requirement) => ({
    id: requirement.id,
    kind: requirement.kind === 'location' ? 'location' : 'character',
    name: requirement.name,
    description: requirement.description,
    shotNumbers: readShotNumbers(requirement.shotIndexes),
    status: requirement.status === 'completed' ? 'completed' : requirement.status === 'generating' ? 'generating' : requirement.status === 'failed' ? 'failed' : 'pending',
    targetId: requirement.targetId,
    errorMessage: requirement.errorMessage,
  }))
}

function mapEditScript(script: PersistedEditScript): EditScriptPayload {
  const shots = parseShotsJson(script.shotsJson)
  return {
    id: script.id,
    projectId: script.projectId,
    episodeId: script.episodeId,
    userPrompt: script.userPrompt,
    styleBible: editScriptStyleBibleSchema.parse({ styleBible: script.styleBibleJson }).styleBible,
    screenplayText: script.screenplayText,
    title: script.title,
    logline: script.logline,
    durationSec: script.durationSec,
    shotCount: script.shotCount,
    status: script.status,
    assetReviewStatus: script.assetReviewStatus === 'approved' ? 'approved' : 'pending',
    shots,
    videoBlocks: normalizeVideoBlockPlanResponse({
      response: { items: Array.isArray(script.videoBlocksJson) ? script.videoBlocksJson : [] },
      allShotNumbers: shots.map((shot) => shot.shotNumber),
      shots,
      enforceSingleMinDuration: false,
    }).items,
    requirements: mapRequirements(script.requirements),
  }
}

export function buildEditStoryboardVideoBlockId(editScriptId: string, blockIndex: number): string {
  return `${editScriptId}:videoBlock:${blockIndex + 1}`
}

function requireModelConfig(config: Awaited<ReturnType<typeof getProjectModelConfig>>): StoryboardConsistencyModelConfigSnapshot {
  if (!config.analysisModel || !config.storyboardModel) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_SCRIPT_STORYBOARD_MODELS_NOT_CONFIGURED',
      message: 'Analysis model and storyboard image model are required before generating spatial blocking storyboard panels',
    })
  }
  return {
    analysisModel: config.analysisModel,
    storyboardModel: config.storyboardModel,
  }
}

interface ResolvedAssetImage {
  readonly previewImageUrl: string | null
  readonly spatialProfile: LocationSpatialProfile | null
}

async function resolveAssetImage(requirement: EditAssetRequirement): Promise<ResolvedAssetImage> {
  if (!requirement.targetId) return { previewImageUrl: null, spatialProfile: null }
  if (requirement.kind === 'character') {
    const character = await prisma.projectCharacter.findUnique({
      where: { id: requirement.targetId },
      select: {
        appearances: {
          orderBy: { appearanceIndex: 'asc' },
          take: 1,
          select: {
            imageUrl: true,
            imageUrls: true,
          },
        },
      },
    })
    const appearance = character?.appearances[0]
    if (!appearance) return { previewImageUrl: null, spatialProfile: null }
    const imageUrls = decodeImageUrlsFromDb(appearance.imageUrls, 'editScript.storyboardConsistency.character.imageUrls')
    return {
      previewImageUrl: appearance.imageUrl || imageUrls[0] || null,
      spatialProfile: null,
    }
  }
  const location = await prisma.projectLocation.findUnique({
    where: { id: requirement.targetId },
    select: {
      selectedImageId: true,
      images: {
        orderBy: { imageIndex: 'asc' },
        select: {
          id: true,
          imageUrl: true,
          isSelected: true,
          spatialProfileJson: true,
          spatialProfileStatus: true,
        },
      },
    },
  })
  const image = location?.images.find((item) => item.id === location.selectedImageId)
    ?? location?.images.find((item) => item.isSelected)
    ?? location?.images.find((item) => !!item.imageUrl)
    ?? null
  if (!image?.imageUrl) return { previewImageUrl: null, spatialProfile: null }
  if (image.spatialProfileStatus !== 'ready' || !image.spatialProfileJson) {
    throw new ApiError('CONFLICT', {
      code: 'LOCATION_SPATIAL_PROFILE_REQUIRED',
      message: `Location spatial profile must be ready before storyboard generation: ${requirement.name}`,
    })
  }
  return {
    previewImageUrl: image.imageUrl,
    spatialProfile: parseLocationSpatialProfile(image.spatialProfileJson),
  }
}

export async function buildAssetSnapshots(requirements: readonly EditAssetRequirement[]): Promise<StoryboardConsistencyAssetSnapshot[]> {
  if (requirements.length === 0) {
    throw new ApiError('CONFLICT', {
      code: 'EDIT_SCRIPT_ASSETS_REQUIRED',
      message: 'Completed edit-script assets are required before spatial blocking storyboard generation',
    })
  }
  const snapshots = await Promise.all(requirements.map(async (requirement) => {
    if (!requirement.id || !requirement.targetId) {
      return {
        requirement,
        snapshot: null,
      }
    }
    const resolvedImage = await resolveAssetImage(requirement)
    return {
      requirement,
      snapshot: resolvedImage.previewImageUrl
        ? {
            requirementId: requirement.id,
            kind: requirement.kind,
            name: requirement.name,
            description: requirement.description,
            shotNumbers: requirement.shotNumbers,
            targetId: requirement.targetId,
            previewImageUrl: resolvedImage.previewImageUrl,
            spatialProfile: resolvedImage.spatialProfile,
          }
        : null,
    }
  }))
  const notReady = snapshots
    .filter((item) => item.snapshot === null)
    .map((item) => item.requirement)
  if (notReady.length > 0) {
    throw new ApiError('CONFLICT', {
      code: 'EDIT_SCRIPT_ASSETS_NOT_READY',
      message: `Edit script assets must be completed before spatial blocking storyboard generation: ${notReady.map((item) => item.name).join(', ')}`,
    })
  }
  const staleRequirementIds = snapshots
    .filter((item) => item.snapshot !== null && item.requirement.status !== 'completed')
    .flatMap((item) => (item.requirement.id ? [item.requirement.id] : []))
  if (staleRequirementIds.length > 0) {
    await prisma.projectEditAssetRequirement.updateMany({
      where: { id: { in: staleRequirementIds } },
      data: { status: 'completed', errorMessage: null },
    })
  }
  return snapshots.map((item) => {
    if (!item.snapshot) throw new Error(`EDIT_SCRIPT_STORYBOARD_ASSET_INVALID:${item.requirement.name}`)
    return item.snapshot
  })
}

export async function buildStoryboardConsistencySource(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly editScriptId: string
  readonly userId: string
}): Promise<{
  readonly sourceSnapshot: StoryboardConsistencySourceSnapshot
  readonly modelConfigSnapshot: StoryboardConsistencyModelConfigSnapshot
}> {
  const [project, script, directorDecoupage, cinematographyShotPlan, config] = await Promise.all([
    prisma.project.findFirst({
      where: { id: input.projectId, userId: input.userId },
      select: {
        id: true,
        videoRatio: true,
      },
    }),
    prisma.projectEditScript.findFirst({
      where: {
        id: input.editScriptId,
        projectId: input.projectId,
        episodeId: input.episodeId,
      },
      include: {
        requirements: {
          orderBy: [
            { kind: 'asc' },
            { name: 'asc' },
          ],
        },
      },
    }),
    prisma.projectEditDirectorDecoupage.findFirst({
      where: {
        projectId: input.projectId,
        episodeId: input.episodeId,
      },
    }),
    prisma.projectEditCinematographyShotPlan.findFirst({
      where: {
        projectId: input.projectId,
        episodeId: input.episodeId,
        editScriptId: input.editScriptId,
      },
    }),
    getProjectModelConfig(input.projectId, input.userId),
  ])
  if (!project || !script) throw new ApiError('NOT_FOUND')
  if (!directorDecoupage || directorDecoupage.status !== 'ready') {
    throw new ApiError('CONFLICT', {
      code: 'EDIT_DIRECTOR_DECOUPAGE_REQUIRED',
      message: 'Ready director decoupage is required before storyboard generation',
    })
  }
  if (!cinematographyShotPlan || cinematographyShotPlan.status !== 'ready') {
    throw new ApiError('CONFLICT', {
      code: 'EDIT_CINEMATOGRAPHY_SHOT_PLAN_REQUIRED',
      message: 'Ready cinematography shot plan is required before storyboard generation',
    })
  }
  const editScript = mapEditScript(script)
  if (editScript.status !== 'ready') {
    throw new ApiError('CONFLICT', {
      code: 'EDIT_SCRIPT_NOT_READY',
      message: 'A ready edit script is required before storyboard generation',
    })
  }
  if (!editScript.id) throw new Error('EDIT_SCRIPT_ID_REQUIRED')
  const styleBible = editScript.styleBible
  if (!styleBible) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_SCRIPT_STYLE_BIBLE_REQUIRED',
      message: 'Style Bible is required before storyboard generation',
    })
  }
  const modelConfigSnapshot = requireModelConfig(config)
  const parsedDirectorDecoupage = editDirectorDecoupageSchema.parse(directorDecoupage.decoupageJson)
  const parsedCinematographyShotPlan = editCinematographyShotPlanSchema.parse(cinematographyShotPlan.shotPlanJson)
  const assets = await buildAssetSnapshots(editScript.requirements)
  const videoBlocks: StoryboardConsistencySourceVideoBlock[] = editScript.videoBlocks.map((block, blockIndex) => ({
    ...block,
    blockIndex,
    sourceVideoBlockId: buildEditStoryboardVideoBlockId(editScript.id ?? input.editScriptId, blockIndex),
  }))
  return {
    modelConfigSnapshot,
    sourceSnapshot: {
      schemaVersion: 1,
      projectId: input.projectId,
      episodeId: input.episodeId,
      project: {
        videoRatio: project.videoRatio,
      },
      editScript: {
        id: editScript.id,
        title: editScript.title,
        logline: editScript.logline,
        durationSec: editScript.durationSec,
        shotCount: editScript.shotCount,
        userPrompt: editScript.userPrompt,
        screenplayText: editScript.screenplayText,
      },
      styleBible,
      shots: editScript.shots,
      directorDecoupage: {
        shots: parsedDirectorDecoupage.shots,
        hardBans: parsedDirectorDecoupage.hardBans,
      },
      cinematographyShotPlan: {
        shots: parsedCinematographyShotPlan.shots,
        hardBans: parsedCinematographyShotPlan.hardBans,
      },
      videoBlocks,
      assets,
    },
  }
}
