import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { getProjectModelConfig } from '@/lib/config-service'
import { decodeImageUrlsFromDb } from '@/lib/contracts/image-urls-contract'
import { editScriptStyleBibleSchema } from '@/lib/edit-script/types'
import { normalizeEditScriptStructure, normalizeEditShotExecutionPlan } from '@/lib/edit-script/normalize'
import { parseLocationSpatialProfile, type LocationSpatialProfile } from '@/lib/location-spatial-profile/types'
import type { EditAssetRequirement, EditScriptPayload } from '@/lib/edit-script/types'
import type {
  StoryboardConsistencyAssetSnapshot,
  StoryboardConsistencyGenerationSegment,
  StoryboardConsistencyModelConfigSnapshot,
  StoryboardConsistencySourceSnapshot,
} from './types'

interface PersistedRequirement {
  readonly id: string
  readonly kind: string
  readonly name: string
  readonly description: string
  readonly requiredForShotNumbers: Prisma.JsonValue
  readonly status: string
  readonly targetId: string | null
  readonly errorMessage: string | null
}

function readShotNumbers(value: Prisma.JsonValue): number[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'number' && Number.isInteger(item) && item > 0 ? item : null))
    .filter((item): item is number => item !== null)
}

function mapRequirements(requirements: readonly PersistedRequirement[]): EditAssetRequirement[] {
  return requirements.map((requirement) => ({
    id: requirement.id,
    kind: requirement.kind === 'location' ? 'location' : 'character',
    name: requirement.name,
    description: requirement.description,
    shotNumbers: readShotNumbers(requirement.requiredForShotNumbers),
    status: requirement.status === 'completed' ? 'completed' : requirement.status === 'generating' ? 'generating' : requirement.status === 'failed' ? 'failed' : 'pending',
    targetId: requirement.targetId,
    errorMessage: requirement.errorMessage,
  }))
}

function parseStyleBible(value: Prisma.JsonValue | null) {
  const parsed = editScriptStyleBibleSchema.safeParse({ styleBible: value })
  if (!parsed.success) throw new Error('EDIT_SCRIPT_STYLE_BIBLE_REQUIRED')
  return parsed.data.styleBible
}

export function buildEditStoryboardGenerationSegmentId(editScriptId: string, segmentIndex: number): string {
  return `${editScriptId}:generationSegment:${segmentIndex + 1}`
}

function requireModelConfig(config: Awaited<ReturnType<typeof getProjectModelConfig>>): StoryboardConsistencyModelConfigSnapshot {
  if (!config.analysisModel || !config.storyboardModel) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_SCRIPT_STORYBOARD_MODELS_NOT_CONFIGURED',
      message: 'Analysis model and storyboard image model are required before generating storyboard panels',
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
    ?? location?.images.find((item) => Boolean(item.imageUrl))
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
      message: 'Completed edit-script assets are required before storyboard generation',
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
      message: `Edit script assets must be completed before storyboard generation: ${notReady.map((item) => item.name).join(', ')}`,
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

function mapEditScriptPayload(input: {
  readonly script: {
    readonly id: string
    readonly projectId: string
    readonly episodeId: string
    readonly editScreenplayId: string
    readonly corePlanJson: Prisma.JsonValue | null
    readonly durationSec: number
    readonly shotCount: number
    readonly status: string
    readonly assetReviewStatus: string
    readonly editScreenplay: {
      readonly userPrompt: string
      readonly styleBibleJson: Prisma.JsonValue | null
      readonly screenplayText: string
    }
    readonly requirements: readonly PersistedRequirement[]
  }
}): EditScriptPayload {
  if (!input.script.corePlanJson) throw new Error(`EDIT_SCRIPT_CORE_PLAN_REQUIRED:${input.script.id}`)
  const core = normalizeEditScriptStructure(input.script.corePlanJson)
  return {
    id: input.script.id,
    projectId: input.script.projectId,
    episodeId: input.script.episodeId,
    screenplayId: input.script.editScreenplayId,
    userPrompt: input.script.editScreenplay.userPrompt,
    styleBible: parseStyleBible(input.script.editScreenplay.styleBibleJson),
    screenplayText: input.script.editScreenplay.screenplayText,
    durationSec: core.durationSec,
    shotCount: core.shotCount,
    status: input.script.status,
    assetReviewStatus: input.script.assetReviewStatus === 'approved' ? 'approved' : 'pending',
    shots: core.shots,
    generationSegments: core.generationSegments,
    requirements: mapRequirements(input.script.requirements),
  }
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
  const [project, script, executionPlan, config] = await Promise.all([
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
        editScreenplay: true,
        requirements: {
          orderBy: [
            { kind: 'asc' },
            { name: 'asc' },
          ],
        },
      },
    }),
    prisma.projectEditShotExecutionPlan.findFirst({
      where: {
        projectId: input.projectId,
        episodeId: input.episodeId,
        editScriptId: input.editScriptId,
      },
    }),
    getProjectModelConfig(input.projectId, input.userId),
  ])
  if (!project || !script) throw new ApiError('NOT_FOUND')
  if (script.status !== 'ready') {
    throw new ApiError('CONFLICT', {
      code: 'EDIT_SCRIPT_NOT_READY',
      message: 'A ready edit core plan is required before storyboard generation',
    })
  }
  if (!executionPlan || executionPlan.status !== 'ready') {
    throw new ApiError('CONFLICT', {
      code: 'EDIT_SHOT_EXECUTION_PLAN_REQUIRED',
      message: 'Ready shot execution plan is required before storyboard generation',
    })
  }
  const editScript = mapEditScriptPayload({ script })
  if (!editScript.id) throw new Error('EDIT_SCRIPT_ID_REQUIRED')
  const styleBible = editScript.styleBible
  if (!styleBible) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_SCRIPT_STYLE_BIBLE_REQUIRED',
      message: 'Style Bible is required before storyboard generation',
    })
  }
  const parsedExecutionPlan = normalizeEditShotExecutionPlan(executionPlan.executionPlanJson, editScript.shots)
  const assets = await buildAssetSnapshots(editScript.requirements)
  const generationSegments: StoryboardConsistencyGenerationSegment[] = editScript.generationSegments.map((segment, segmentIndex) => ({
    ...segment,
    segmentIndex,
    sourceGenerationSegmentId: buildEditStoryboardGenerationSegmentId(editScript.id ?? input.editScriptId, segmentIndex),
  }))
  return {
    modelConfigSnapshot: requireModelConfig(config),
    sourceSnapshot: {
      projectId: input.projectId,
      episodeId: input.episodeId,
      project: {
        videoRatio: project.videoRatio,
      },
      editScript: {
        id: editScript.id,
        durationSec: editScript.durationSec,
        shotCount: editScript.shotCount,
        userPrompt: editScript.userPrompt,
        screenplayText: editScript.screenplayText,
      },
      styleBible,
      shots: editScript.shots,
      shotExecutionPlan: {
        shots: parsedExecutionPlan.shots,
      },
      generationSegments,
      assets,
    },
  }
}
