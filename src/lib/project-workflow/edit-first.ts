import { prisma } from '@/lib/prisma'
import {
  readCompletedMusicScoreMix,
  readMusicScoreStatus,
  readPersistedMusicScorePlan,
} from '@/lib/music-score/project-data'
import {
  readCompletedSoundscapeMix,
  readSoundscapeDecision,
} from '@/lib/soundscape/project-data'
import { editScriptStructureSchema } from '@/lib/edit-script/types'
import { TASK_TYPE } from '@/lib/task/types'
import { getEditFirstChoiceDefinition } from '@/lib/project-agent/edit-first-choice-tools'
import {
  resolveLocationSpatialProfileReadiness,
  resolveStoryboardImageReadiness,
} from './edit-first-readiness'
import {
  EDIT_FIRST_WORKFLOW_EMPTY_VIEW,
  createEditFirstWorkflowOperationPolicy,
  createEditFirstWorkflowView,
  resolveEditFirstWorkflowViewFromSnapshot,
  type EditFirstWorkflowChoiceDecision,
  type EditFirstWorkflowView,
} from './edit-first-view'

/**
 * Applies a consumed review decision to the current workflow view without
 * mutating domain resources. The returned nextAction is the only command the
 * continuation may execute; the registered Operation owns every write.
 */
export function resolveEditFirstWorkflowChoice(
  workflow: EditFirstWorkflowView,
  choice: EditFirstWorkflowChoiceDecision,
): EditFirstWorkflowView {
  const definition = getEditFirstChoiceDefinition(choice.choiceType)
  if (!definition.isEnabled(workflow)) {
    throw new Error(
      `EDIT_FIRST_REVIEW_CHOICE_POSITION_MISMATCH:${choice.choiceType}:${workflow.step}:${workflow.status.kind}`,
    )
  }
  const transition = definition.resolveWorkflowAction(choice)
  if (!transition) throw new Error(`EDIT_FIRST_REVIEW_CHOICE_ACTION_MISSING:${choice.choiceType}`)
  return createEditFirstWorkflowView({
    step: workflow.step,
    status: { kind: 'ready', reason: null },
    operationPolicy: createEditFirstWorkflowOperationPolicy({ recommendedAction: transition }),
  })
}

type StoryboardSpatialCandidate = {
  readonly id: string
  readonly editScriptId: string | null
}

type WorkflowVideoGroupCandidate = {
  readonly chapterId: string | null
  readonly shotIds: readonly string[]
  readonly status: string
  readonly videoUrl: string | null
  readonly videoMediaId: string | null
}

const ACTIVE_WORKFLOW_TASK_STATUSES = ['queued', 'processing'] as const

function hasText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function plannedBibleAssetNameKeys(value: unknown, key: 'characters' | 'locations'): ReadonlySet<string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return new Set()
  const collection = (value as Record<string, unknown>)[key]
  if (!Array.isArray(collection)) return new Set()
  return new Set(collection.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const name = (item as Record<string, unknown>).name
    return typeof name === 'string' && name.trim()
      ? [name.trim().replace(/\s+/g, ' ').toLocaleLowerCase()]
      : []
  }))
}

function isActiveWorkflowStatus(status: string | null | undefined): boolean {
  return status === 'queued' || status === 'processing'
}

function resolveEpisodeArtifactStatus(input: {
  readonly statuses: readonly string[]
  readonly expectedCount: number
  readonly activeTaskCount?: number
}): string | null {
  if (input.expectedCount <= 0 && input.statuses.length === 0) return null
  if (input.statuses.some((status) => status === 'failed')) return 'failed'
  if ((input.activeTaskCount ?? 0) > 0) return 'generating'
  if (input.statuses.length < input.expectedCount) return input.statuses.length > 0 ? 'pending' : null
  if (input.statuses.every((status) => status === 'ready' || status === 'completed')) return 'ready'
  const activeStatus = input.statuses.find((status) => status === 'pending' || status === 'generating')
  return activeStatus ?? input.statuses[0] ?? null
}

function resolveEpisodeAssetReviewStatus(statuses: readonly string[]): string | null {
  if (statuses.length === 0) return null
  if (statuses.some((status) => status === 'failed')) return 'failed'
  if (statuses.every((status) => status === 'approved')) return 'approved'
  return statuses.find((status) => status !== 'approved') ?? statuses[0] ?? null
}

function hasOutputReference(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function sameShotIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((shotId, index) => shotId === right[index])
}

function readShotIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
}

function readEditScriptGenerationSegments(corePlanJson: unknown): readonly { readonly shotIds: readonly string[] }[] {
  const parsed = editScriptStructureSchema.safeParse(corePlanJson)
  if (!parsed.success) return []
  return parsed.data.generationSegments
}

function findVideoGroupForShotIds(
  groups: readonly WorkflowVideoGroupCandidate[],
  chapterId: string | null,
  shotIds: readonly string[],
): WorkflowVideoGroupCandidate | null {
  return groups.find((group) => group.chapterId === chapterId && sameShotIds(group.shotIds, shotIds)) ?? null
}

function videoGroupHasOutput(group: WorkflowVideoGroupCandidate | null): boolean {
  return Boolean(group && (hasOutputReference(group.videoUrl) || hasOutputReference(group.videoMediaId)))
}

interface StoryboardPlanStageSummary {
  readonly matchingStoryboardIds: string[]
}

function resolveStoryboardPlanStageSummary(input: {
  readonly editScriptIds: ReadonlySet<string>
  readonly storyboards: readonly StoryboardSpatialCandidate[]
}): StoryboardPlanStageSummary {
  if (input.editScriptIds.size === 0) {
    return {
      matchingStoryboardIds: [],
    }
  }
  const matching = input.storyboards.flatMap((storyboard) => {
    if (!storyboard.editScriptId || !input.editScriptIds.has(storyboard.editScriptId)) return []
    return [{ id: storyboard.id }]
  })
  return {
    matchingStoryboardIds: matching.map((storyboard) => storyboard.id),
  }
}

export async function resolveEditFirstWorkflowView(params: {
  projectId: string
  userId: string
  episodeId?: string | null
}): Promise<EditFirstWorkflowView> {
  if (!params.episodeId) return EDIT_FIRST_WORKFLOW_EMPTY_VIEW

  const project = await prisma.project.findFirst({
    where: {
      id: params.projectId,
      userId: params.userId,
    },
    select: { id: true },
  })
  if (!project) return EDIT_FIRST_WORKFLOW_EMPTY_VIEW

  const [
    editBible,
    editScripts,
    shotExecutionPlans,
    storyboards,
    panels,
    videoGroups,
    chapters,
    finalOutput,
    musicScore,
    soundscape,
    activeSourceScriptTaskCount,
    activeBibleTaskCount,
    activeEditScriptTaskCount,
    activeShotExecutionPlanTaskCount,
    activeBgmScorePlanTaskCount,
    activeBgmScoreGenerationTaskCount,
    activeSoundscapePlanTaskCount,
    activeSoundscapeGenerationTaskCount,
    activeChapterRenderTaskCount,
    activeFinalRenderTaskCount,
    plannedCharacters,
    plannedLocations,
    activePlannedAssetTaskCount,
  ] = await Promise.all([
    prisma.projectEditBible.findFirst({
      where: {
        episodeId: params.episodeId,
        episode: { projectId: params.projectId },
      },
      select: {
        id: true,
        status: true,
        bibleJson: true,
        sourceDocument: {
          select: {
            sourceKind: true,
          },
        },
        stylePreviews: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    }),
    prisma.projectEditScript.findMany({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        chapterId: true,
        status: true,
        assetReviewStatus: true,
        corePlanJson: true,
        requirements: {
          select: {
            kind: true,
            status: true,
            targetId: true,
          },
        },
      },
    }),
    prisma.projectEditShotExecutionPlan.findMany({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        chapterId: true,
        editScriptId: true,
        status: true,
      },
    }),
    prisma.projectStoryboard.findMany({
      where: {
        episodeId: params.episodeId,
        episode: {
          projectId: params.projectId,
        },
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        editScriptId: true,
        lastError: true,
      },
    }),
    prisma.projectPanel.findMany({
      where: {
        storyboard: {
          episodeId: params.episodeId,
          episode: {
            projectId: params.projectId,
          },
        },
      },
      select: {
        id: true,
        storyboardId: true,
        imageUrl: true,
        imageMediaId: true,
        imagePrompt: true,
        videoPrompt: true,
      },
    }),
    prisma.projectVideoGroup.findMany({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
      },
      select: {
        id: true,
        chapterId: true,
        shotIds: true,
        status: true,
        videoUrl: true,
        videoMediaId: true,
      },
    }),
    prisma.projectEditChapter.findMany({
      where: {
        episodeId: params.episodeId,
        episode: { projectId: params.projectId },
      },
      select: {
        id: true,
        renderStatus: true,
        outputMediaId: true,
      },
    }),
    prisma.projectEpisodeFinalOutput.findUnique({
      where: {
        episodeId: params.episodeId,
      },
      select: {
        renderStatus: true,
        outputUrl: true,
        outputMediaId: true,
      },
    }),
    prisma.projectEditMusicScore.findUnique({
      where: {
        episodeId: params.episodeId,
      },
      select: {
        status: true,
        cuesJson: true,
        mixJson: true,
      },
    }),
    prisma.projectEditSoundscape.findUnique({
      where: {
        episodeId: params.episodeId,
      },
      select: {
        status: true,
        planJson: true,
        mixJson: true,
      },
    }),
    prisma.task.count({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        type: TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE,
        status: { in: [...ACTIVE_WORKFLOW_TASK_STATUSES] },
      },
    }),
    prisma.task.count({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        type: TASK_TYPE.EDIT_BIBLE_GENERATE,
        status: { in: [...ACTIVE_WORKFLOW_TASK_STATUSES] },
      },
    }),
    prisma.task.count({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        type: TASK_TYPE.EDIT_SCRIPT_GENERATE,
        status: { in: [...ACTIVE_WORKFLOW_TASK_STATUSES] },
      },
    }),
    prisma.task.count({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        type: TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE,
        status: { in: [...ACTIVE_WORKFLOW_TASK_STATUSES] },
      },
    }),
    prisma.task.count({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        targetType: 'ProjectEpisode',
        targetId: params.episodeId,
        type: TASK_TYPE.MUSIC_SCORE_PLAN,
        status: { in: [...ACTIVE_WORKFLOW_TASK_STATUSES] },
      },
    }),
    prisma.task.count({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        targetType: 'ProjectEpisode',
        targetId: params.episodeId,
        type: TASK_TYPE.MUSIC_SCORE_GENERATE,
        status: { in: [...ACTIVE_WORKFLOW_TASK_STATUSES] },
      },
    }),
    prisma.task.count({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        targetType: 'ProjectEpisode',
        targetId: params.episodeId,
        type: TASK_TYPE.SOUNDSCAPE_PLAN,
        status: { in: [...ACTIVE_WORKFLOW_TASK_STATUSES] },
      },
    }),
    prisma.task.count({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        targetType: 'ProjectEpisode',
        targetId: params.episodeId,
        type: TASK_TYPE.SOUNDSCAPE_GENERATE,
        status: { in: [...ACTIVE_WORKFLOW_TASK_STATUSES] },
      },
    }),
    prisma.task.count({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        type: TASK_TYPE.CHAPTER_RENDER,
        status: { in: [...ACTIVE_WORKFLOW_TASK_STATUSES] },
      },
    }),
    prisma.task.count({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        targetType: 'ProjectEpisode',
        targetId: params.episodeId,
        type: TASK_TYPE.FINAL_VIDEO_RENDER,
        status: { in: [...ACTIVE_WORKFLOW_TASK_STATUSES] },
      },
    }),
    prisma.projectCharacter.findMany({
      where: { projectId: params.projectId },
      select: {
        name: true,
        appearances: {
          orderBy: { appearanceIndex: 'asc' },
          take: 1,
          select: { imageUrl: true, imageMediaId: true, imageUrls: true },
        },
      },
    }),
    prisma.projectLocation.findMany({
      where: { projectId: params.projectId, assetKind: 'location' },
      select: {
        name: true,
        images: {
          orderBy: { imageIndex: 'asc' },
          take: 1,
          select: { imageUrl: true, imageMediaId: true },
        },
      },
    }),
    prisma.task.count({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        type: { in: [TASK_TYPE.IMAGE_CHARACTER, TASK_TYPE.IMAGE_LOCATION] },
        status: { in: [...ACTIVE_WORKFLOW_TASK_STATUSES] },
      },
    }),
  ])

  const expectedChapterCount = chapters.length
  const plannedCharacterNames = plannedBibleAssetNameKeys(editBible?.bibleJson, 'characters')
  const plannedLocationNames = plannedBibleAssetNameKeys(editBible?.bibleJson, 'locations')
  const scopedPlannedCharacters = plannedCharacters.filter((character) => plannedCharacterNames.has(
    character.name.trim().replace(/\s+/g, ' ').toLocaleLowerCase(),
  ))
  const scopedPlannedLocations = plannedLocations.filter((location) => plannedLocationNames.has(
    location.name.trim().replace(/\s+/g, ' ').toLocaleLowerCase(),
  ))
  const plannedAssetCount = scopedPlannedCharacters.length + scopedPlannedLocations.length
  const pendingPlannedAssetCount = scopedPlannedCharacters.filter((character) => {
    const appearance = character.appearances[0]
    if (!appearance) return true
    const imageUrls = typeof appearance.imageUrls === 'string'
      ? appearance.imageUrls.trim()
      : JSON.stringify(appearance.imageUrls ?? null)
    return !appearance.imageMediaId && !appearance.imageUrl && (!imageUrls || imageUrls === '[]' || imageUrls === 'null')
  }).length + scopedPlannedLocations.filter((location) => {
    const image = location.images[0]
    return !image?.imageMediaId && !image?.imageUrl
  }).length
  const editScriptIds = new Set(editScripts.map((script) => script.id))
  const allEditScriptRequirements = editScripts.flatMap((script) => script.requirements)
  const editScriptStatus = resolveEpisodeArtifactStatus({
    statuses: editScripts.map((script) => script.status),
    expectedCount: expectedChapterCount,
    activeTaskCount: activeEditScriptTaskCount,
  })
  const shotExecutionPlanStatus = resolveEpisodeArtifactStatus({
    statuses: shotExecutionPlans.map((plan) => plan.status),
    expectedCount: expectedChapterCount,
    activeTaskCount: activeShotExecutionPlanTaskCount,
  })
  const editScriptAssetReviewStatus = resolveEpisodeAssetReviewStatus(
    editScripts.map((script) => script.assetReviewStatus),
  )
  const locationTargetIds = Array.from(new Set(allEditScriptRequirements
    .filter((requirement) => requirement.kind === 'location' && typeof requirement.targetId === 'string' && requirement.targetId.trim().length > 0)
    .map((requirement) => requirement.targetId!)
    .filter(Boolean)))
  const locationRows = locationTargetIds.length > 0
    ? await prisma.projectLocation.findMany({
      where: {
        id: { in: locationTargetIds },
        projectId: params.projectId,
      },
      select: {
        id: true,
        selectedImageId: true,
        images: {
          select: {
            id: true,
            isSelected: true,
            imageUrl: true,
            imageMediaId: true,
            spatialProfileStatus: true,
            spatialProfileJson: true,
          },
        },
      },
    })
    : []
  const locationById = new Map(locationRows.map((location) => [location.id, location]))
  const locationSpatialProfileReadiness = resolveLocationSpatialProfileReadiness(
    allEditScriptRequirements
      .filter((requirement) => requirement.kind === 'location')
      .map((requirement) => {
        const targetId = requirement.targetId ?? null
	        return {
	          targetId,
	          selectedImage: targetId
	            ? (() => {
	                const location = locationById.get(targetId)
	                return location?.images.find((image) => image.id === location.selectedImageId)
	                  ?? location?.images.find((image) => image.isSelected)
	                  ?? location?.images.find((image) => Boolean(image.imageUrl || image.imageMediaId))
	                  ?? null
	              })()
	            : null,
	        }
	      }),
  )
  const storyboardPlanStageSummary = resolveStoryboardPlanStageSummary({
    editScriptIds,
    storyboards,
  })
  const generationSegments = editScripts.flatMap((script) =>
    readEditScriptGenerationSegments(script.corePlanJson).map((segment) => ({
      ...segment,
      chapterId: script.chapterId ?? null,
    })))
  const videoGroupCandidates: WorkflowVideoGroupCandidate[] = videoGroups.map((group) => ({
    chapterId: group.chapterId,
    shotIds: readShotIds(group.shotIds),
    status: group.status,
    videoUrl: group.videoUrl,
    videoMediaId: group.videoMediaId,
  }))
  const plannedVideoGroups = generationSegments.map((segment) =>
    findVideoGroupForShotIds(videoGroupCandidates, segment.chapterId, segment.shotIds))
  const renderableChapterCount = chapters.filter((chapter) => {
    const chapterSegments = generationSegments.filter((segment) => segment.chapterId === chapter.id)
    return chapterSegments.length > 0 && chapterSegments.every((segment) =>
      videoGroupHasOutput(findVideoGroupForShotIds(videoGroupCandidates, segment.chapterId, segment.shotIds)))
  }).length
  const bgmScoreStatus = readMusicScoreStatus(musicScore)
  const soundscapeStatus = typeof soundscape?.status === 'string' ? soundscape.status : null
  const editScriptStoryboardIds = new Set(storyboardPlanStageSummary.matchingStoryboardIds)
  const editScriptPanels = panels.filter((panel) => editScriptStoryboardIds.has(panel.storyboardId))
  const storyboardImageReadiness = resolveStoryboardImageReadiness(editScriptPanels)
  const activeStylePreviewTaskCount = editBible
    ? await prisma.task.count({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        status: { in: ['queued', 'processing'] },
        OR: [
          {
            targetType: 'ProjectEditBible',
            targetId: editBible.id,
            type: TASK_TYPE.EDIT_STYLE_PREVIEW_OPTIONS_GENERATE,
          },
          {
            targetType: 'ProjectEditStylePreview',
            targetId: { in: editBible.stylePreviews.map((preview) => preview.id) },
            type: TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
          },
        ],
      },
    })
    : 0
  const panelIds = editScriptPanels.map((panel) => panel.id)
  const activeStoryboardImageTaskCount = panelIds.length > 0
    ? await prisma.task.count({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        targetType: 'ProjectPanel',
        targetId: { in: panelIds },
        type: TASK_TYPE.IMAGE_PANEL,
        status: { in: ['queued', 'processing'] },
      },
    })
    : 0
  const storyboardPanelImageFailedCount = panelIds.length > 0
    ? await prisma.task.count({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        targetType: 'ProjectPanel',
        targetId: { in: panelIds },
        type: TASK_TYPE.IMAGE_PANEL,
        status: 'failed',
      },
    })
    : 0
  return resolveEditFirstWorkflowViewFromSnapshot({
    hasEpisode: true,
    hasBible: Boolean(editBible),
    bibleStatus: editBible?.status ?? null,
    sourceDocumentKind: editBible?.sourceDocument?.sourceKind ?? null,
    activeSourceScriptTaskCount,
    activeBibleTaskCount,
    stylePreviewCount: editBible?.stylePreviews.length ?? 0,
    completedStylePreviewCount: editBible?.stylePreviews.filter((preview) => preview.status === 'completed').length ?? 0,
    confirmedStylePreviewCount: editBible?.stylePreviews.filter((preview) => preview.status === 'confirmed').length ?? 0,
    failedStylePreviewCount: editBible?.stylePreviews.filter((preview) => preview.status === 'failed').length ?? 0,
    activeStylePreviewTaskCount,
    plannedAssetCount,
    pendingPlannedAssetCount,
    activePlannedAssetTaskCount,
    hasEditScript: editScripts.length > 0,
    activeEditScriptTaskCount,
    editScriptStatus,
    editScriptAssetReviewStatus,
    editAssetRequirementCount: allEditScriptRequirements.length,
    pendingAssetRequirementCount: allEditScriptRequirements.filter((requirement) => requirement.status !== 'completed').length,
    generatingAssetRequirementCount: allEditScriptRequirements.filter((requirement) => requirement.status === 'generating').length,
    requiredLocationSpatialProfileCount: locationSpatialProfileReadiness.requiredCount,
    readyLocationSpatialProfileCount: locationSpatialProfileReadiness.readyCount,
    hasShotExecutionPlan: shotExecutionPlans.length > 0,
    activeShotExecutionPlanTaskCount,
    shotExecutionPlanStatus,
    storyboardCount: editScriptStoryboardIds.size,
    panelCount: storyboardImageReadiness.panelCount,
    storyboardPanelImagePromptMissingCount: editScriptPanels.filter((panel) => !hasText(panel.imagePrompt)).length,
    storyboardPanelVideoPromptMissingCount: editScriptPanels.filter((panel) => !hasText(panel.videoPrompt)).length,
    storyboardPanelImageReadyCount: storyboardImageReadiness.readyCount,
    storyboardPanelImageMissingCount: storyboardImageReadiness.missingCount,
    storyboardPanelImageFailedCount,
    activeStoryboardImageTaskCount,
    videoPlanSegmentCount: generationSegments.length,
    completedVideoSegmentCount: plannedVideoGroups.filter(videoGroupHasOutput).length,
    failedVideoSegmentCount: plannedVideoGroups.filter((group) => group?.status === 'failed').length,
    activeVideoTaskCount: plannedVideoGroups.filter((group) => isActiveWorkflowStatus(group?.status)).length,
    chapterCount: chapters.length,
    renderableChapterCount,
    completedChapterRenderCount: chapters.filter((item) => hasOutputReference(item.outputMediaId ?? null) && item.renderStatus === 'completed').length,
    failedChapterRenderCount: chapters.filter((item) => item.renderStatus === 'failed').length,
    activeChapterRenderTaskCount,
    bgmScoreStatus,
    bgmScoreHasPlan: Boolean(readPersistedMusicScorePlan(musicScore)),
    bgmScoreHasMix: Boolean(readCompletedMusicScoreMix(musicScore)),
    activeBgmScorePlanTaskCount,
    activeBgmScoreGenerationTaskCount,
    soundscapeStatus,
    soundscapeHasMix: Boolean(readCompletedSoundscapeMix(soundscape)),
    soundscapeDecision: readSoundscapeDecision(soundscape),
    activeSoundscapePlanTaskCount,
    activeSoundscapeGenerationTaskCount,
    finalRenderStatus: finalOutput?.renderStatus ?? null,
    finalRenderHasOutput: Boolean(
      hasOutputReference(finalOutput?.outputUrl ?? null)
      || hasOutputReference(finalOutput?.outputMediaId ?? null),
    ),
    activeFinalRenderTaskCount,
  })
}
