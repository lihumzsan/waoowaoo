import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { decodeImageUrlsFromDb } from '@/lib/contracts/image-urls-contract'
import { editScriptStyleBibleSchema } from '@/lib/edit-script/types'
import { parsePersistedEditShotExecutionPlan } from '@/lib/edit-script/normalize'
import { projectEditScriptCoreNames } from '@/lib/edit-script/core-view'
import { loadKnownPlanAssets, type KnownPlanAsset } from '@/lib/edit-chapter/asset-menu'
import { parseLocationSpatialProfile, type LocationSpatialProfile } from '@/lib/location-spatial-profile/types'
import type { EditAssetRequirement, EditScriptPayload } from '@/lib/edit-script/types'
import type {
  StoryboardConsistencyAssetSnapshot,
  StoryboardConsistencyGenerationSegment,
  StoryboardConsistencySourceSnapshot,
} from './types'

interface PersistedRequirement {
  readonly id: string
  readonly kind: string
  readonly name: string
  readonly description: string
  readonly requiredForShotIds: Prisma.JsonValue
  readonly status: string
  readonly targetId: string | null
  readonly errorMessage: string | null
}

function readShotIds(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
}

function mapRequirements(requirements: readonly PersistedRequirement[]): EditAssetRequirement[] {
  return requirements.map((requirement) => ({
    id: requirement.id,
    kind: requirement.kind === 'location' ? 'location' : 'character',
    name: requirement.name,
    description: requirement.description,
    shotIds: readShotIds(requirement.requiredForShotIds),
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
            shotIds: requirement.shotIds,
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

export function assembleStoryboardConsistencySourceSnapshot(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly videoRatio: string
  readonly editScript: EditScriptPayload
  readonly shotExecutionPlan: StoryboardConsistencySourceSnapshot['shotExecutionPlan']
  readonly assets: readonly StoryboardConsistencyAssetSnapshot[]
}): StoryboardConsistencySourceSnapshot {
  const editScriptId = input.editScript.id
  const chapterId = input.editScript.chapterId
  const styleBible = input.editScript.styleBible
  if (!editScriptId || !chapterId) throw new Error('EDIT_SCRIPT_ID_REQUIRED')
  if (!styleBible) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDIT_SCRIPT_STYLE_BIBLE_REQUIRED',
      message: 'Style Bible is required before storyboard projection',
    })
  }
  const generationSegments: StoryboardConsistencyGenerationSegment[] = input.editScript.generationSegments.map(
    (segment, segmentIndex) => ({
      ...segment,
      segmentIndex,
      sourceGenerationSegmentId: buildEditStoryboardGenerationSegmentId(editScriptId, segmentIndex),
    }),
  )
  return {
    projectId: input.projectId,
    episodeId: input.episodeId,
    chapterId,
    project: { videoRatio: input.videoRatio },
    editScript: {
      id: editScriptId,
      chapterId,
      durationSec: input.editScript.durationSec,
      shotCount: input.editScript.shotCount,
      sourceDocumentId: input.editScript.sourceDocumentId,
      sourceStart: input.editScript.sourceStart,
      sourceEnd: input.editScript.sourceEnd,
      sourceText: input.editScript.sourceText,
    },
    styleBible,
    shots: input.editScript.shots,
    shotExecutionPlan: input.shotExecutionPlan,
    generationSegments,
    assets: input.assets,
  }
}

function mapEditScriptPayload(input: {
  readonly script: {
    readonly id: string
	    readonly projectId: string
	    readonly episodeId: string
	    readonly chapterId: string
	    readonly corePlanJson: Prisma.JsonValue | null
	    readonly durationSec: number
	    readonly shotCount: number
	    readonly status: string
	    readonly assetReviewStatus: string
	    readonly chapter: {
	      readonly sourceDocumentId: string | null
	      readonly sourceStart: number | null
	      readonly sourceEnd: number | null
	      readonly sourceDocument: {
	        readonly normalizedText: string
	      } | null
	    }
	    readonly requirements: readonly PersistedRequirement[]
	  }
	  readonly styleBibleJson: Prisma.JsonValue | null
	  readonly knownAssets: readonly KnownPlanAsset[]
	}): EditScriptPayload {
	  if (!input.script.corePlanJson) throw new Error(`EDIT_SCRIPT_CORE_PLAN_REQUIRED:${input.script.id}`)
	  const core = projectEditScriptCoreNames(input.script.corePlanJson, input.knownAssets)
	  const requirements = mapRequirements(input.script.requirements).map((requirement) => {
	    if (!requirement.targetId) return requirement
	    const asset = input.knownAssets.find((candidate) => (
	      candidate.id === requirement.targetId && candidate.kind === requirement.kind
	    ))
	    if (!asset) throw new Error(`EDIT_SCRIPT_REQUIREMENT_ASSET_UNKNOWN:${requirement.id}:${requirement.targetId}`)
	    return { ...requirement, name: asset.name }
	  })
	  const sourceStart = input.script.chapter.sourceStart
	  const sourceEnd = input.script.chapter.sourceEnd
	  const sourceDocument = input.script.chapter.sourceDocument
	  const sourceText =
	    sourceDocument && sourceStart !== null && sourceEnd !== null
	      ? sourceDocument.normalizedText.slice(sourceStart, sourceEnd)
	      : null
	  return {
	    id: input.script.id,
	    projectId: input.script.projectId,
	    episodeId: input.script.episodeId,
	    chapterId: input.script.chapterId,
	    ...(input.script.chapter.sourceDocumentId ? { sourceDocumentId: input.script.chapter.sourceDocumentId } : {}),
	    ...(sourceStart !== null ? { sourceStart } : {}),
	    ...(sourceEnd !== null ? { sourceEnd } : {}),
	    sourceText,
	    styleBible: parseStyleBible(input.styleBibleJson),
    durationSec: core.durationSec,
    shotCount: core.shotCount,
    status: input.script.status,
    assetReviewStatus: input.script.assetReviewStatus === 'approved' ? 'approved' : 'pending',
    shots: core.shots,
    generationSegments: core.generationSegments,
    requirements,
  }
}

export async function buildStoryboardConsistencySource(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly chapterId?: string
  readonly editScriptId: string
  readonly userId: string
}): Promise<{
  readonly sourceSnapshot: StoryboardConsistencySourceSnapshot
}> {
  const [project, script, editBible, executionPlan, knownAssets] = await Promise.all([
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
        ...(input.chapterId ? { chapterId: input.chapterId } : {}),
      },
      include: {
        chapter: {
          include: {
            sourceDocument: true,
          },
        },
        requirements: {
          orderBy: [
            { kind: 'asc' },
            { name: 'asc' },
          ],
        },
      },
    }),
    prisma.projectEditBible.findUnique({
      where: { episodeId: input.episodeId },
      select: { styleBibleJson: true },
    }),
    prisma.projectEditShotExecutionPlan.findFirst({
      where: {
        projectId: input.projectId,
        episodeId: input.episodeId,
        ...(input.chapterId ? { chapterId: input.chapterId } : {}),
        editScriptId: input.editScriptId,
      },
    }),
    loadKnownPlanAssets(input.projectId),
  ])
  if (!project || !script || !editBible) throw new ApiError('NOT_FOUND')
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
  const editScript = mapEditScriptPayload({ script, styleBibleJson: editBible.styleBibleJson, knownAssets })
  if (!editScript.id) throw new Error('EDIT_SCRIPT_ID_REQUIRED')
  const parsedExecutionPlan = parsePersistedEditShotExecutionPlan(
    executionPlan.executionPlanJson,
    editScript.shots,
    editScript.generationSegments,
  )
  const assets = await buildAssetSnapshots(editScript.requirements)
  return {
    sourceSnapshot: assembleStoryboardConsistencySourceSnapshot({
      projectId: input.projectId,
      episodeId: input.episodeId,
      videoRatio: project.videoRatio,
      editScript,
      shotExecutionPlan: {
        shots: parsedExecutionPlan.shots,
        generationSegmentExecutions: parsedExecutionPlan.generationSegmentExecutions,
      },
      assets,
    }),
  }
}
