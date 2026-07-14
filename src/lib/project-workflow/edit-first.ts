import { prisma } from '@/lib/prisma'
import {
  readCompletedMusicScoreMix,
  readMusicScoreStatus,
} from '@/lib/music-score/project-data'
import {
  readCompletedAmbientSoundMix,
} from '@/lib/ambient-sound/project-data'
import { readPersistedAudioDesign } from '@/lib/audio-design/project-data'
import { editScriptStructureSchema } from '@/lib/edit-script/types'
import { TASK_TYPE } from '@/lib/task/types'
import { getEditFirstChoiceDefinition } from '@/lib/project-agent/edit-first-choice-tools'
import {
  EDIT_FIRST_WORKFLOW_EMPTY_VIEW,
  createEditFirstWorkflowOperationPolicy,
  createEditFirstWorkflowView,
  resolveEditFirstWorkflowViewFromSnapshot,
  type EditFirstWorkflowChoiceDecision,
  type EditFirstWorkflowView,
} from './edit-first-view'

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

const ACTIVE_WORKFLOW_TASK_STATUSES = ['queued', 'processing'] as const

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

export async function resolveEditFirstWorkflowView(params: {
  projectId: string
  userId: string
  episodeId?: string | null
}): Promise<EditFirstWorkflowView> {
  if (!params.episodeId) return EDIT_FIRST_WORKFLOW_EMPTY_VIEW

  const project = await prisma.project.findFirst({
    where: { id: params.projectId, userId: params.userId },
    select: { id: true },
  })
  if (!project) return EDIT_FIRST_WORKFLOW_EMPTY_VIEW

  const [
    editBible,
    editScripts,
    shotExecutionPlans,
    videoSegments,
    chapters,
    finalOutput,
    musicScore,
    ambientSound,
    audioDesignRow,
    activeSourceScriptTaskCount,
    activeBibleTaskCount,
    activeEditScriptTaskCount,
    activeShotExecutionPlanTaskCount,
    activeVideoTaskCount,
    activeAudioDesignPlanTaskCount,
    activeBgmScoreGenerationTaskCount,
    activeAmbientSoundGenerationTaskCount,
    activeChapterRenderTaskCount,
    activeFinalRenderTaskCount,
  ] = await Promise.all([
    prisma.projectEditBible.findFirst({
      where: { episodeId: params.episodeId, episode: { projectId: params.projectId } },
      select: {
        id: true,
        status: true,
        sourceDocument: { select: { sourceKind: true } },
        stylePreviews: { select: { id: true, status: true } },
      },
    }),
    prisma.projectEditScript.findMany({
      where: { projectId: params.projectId, episodeId: params.episodeId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        chapterId: true,
        status: true,
        assetReviewStatus: true,
        corePlanJson: true,
        requirements: { select: { kind: true, status: true, targetId: true } },
      },
    }),
    prisma.projectEditShotExecutionPlan.findMany({
      where: { projectId: params.projectId, episodeId: params.episodeId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, status: true },
    }),
    prisma.projectVideoSegment.findMany({
      where: { projectId: params.projectId, episodeId: params.episodeId },
      select: {
        editScriptId: true,
        segmentId: true,
        status: true,
        videoMediaId: true,
      },
    }),
    prisma.projectEditChapter.findMany({
      where: { episodeId: params.episodeId, episode: { projectId: params.projectId } },
      select: { id: true, renderStatus: true, outputMediaId: true },
    }),
    prisma.projectEpisodeFinalOutput.findUnique({
      where: { episodeId: params.episodeId },
      select: { renderStatus: true, outputUrl: true, outputMediaId: true },
    }),
    prisma.projectEditMusicScore.findUnique({
      where: { episodeId: params.episodeId },
      select: { status: true, cuesJson: true, mixJson: true },
    }),
    prisma.projectEditAmbientSound.findUnique({
      where: { episodeId: params.episodeId },
      select: { status: true, mixJson: true },
    }),
    prisma.projectEditAudioDesign.findUnique({
      where: { episodeId: params.episodeId },
      select: {
        status: true,
        designJson: true,
        timelineSignature: true,
        designSignature: true,
        analysisModel: true,
        musicModel: true,
        soundEffectModel: true,
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
        type: TASK_TYPE.VIDEO_SEGMENT,
        status: { in: [...ACTIVE_WORKFLOW_TASK_STATUSES] },
      },
    }),
    prisma.task.count({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        targetType: 'ProjectEpisode',
        targetId: params.episodeId,
        type: TASK_TYPE.AUDIO_DESIGN_PLAN,
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
        type: TASK_TYPE.AMBIENT_SOUND_GENERATE,
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
  ])

  const expectedChapterCount = chapters.length
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
  const plannedSegments = editScripts.flatMap((script) => {
    const parsed = editScriptStructureSchema.safeParse(script.corePlanJson)
    if (!parsed.success) return []
    return parsed.data.generationSegments.map((segment) => ({
      editScriptId: script.id,
      chapterId: script.chapterId,
      segmentId: segment.segmentId,
    }))
  })
  const segmentByIdentity = new Map(videoSegments.map((segment) => [
    `${segment.editScriptId}:${segment.segmentId}`,
    segment,
  ]))
  const plannedVideoSegments = plannedSegments.map((segment) =>
    segmentByIdentity.get(`${segment.editScriptId}:${segment.segmentId}`) ?? null)
  const hasCompletedVideoSegment = (segment: (typeof plannedVideoSegments)[number]): boolean =>
    Boolean(segment && segment.status === 'completed' && hasOutputReference(segment.videoMediaId))
  const renderableChapterCount = chapters.filter((chapter) => {
    const chapterSegments = plannedSegments.filter((segment) => segment.chapterId === chapter.id)
    return chapterSegments.length > 0 && chapterSegments.every((segment) =>
      hasCompletedVideoSegment(segmentByIdentity.get(`${segment.editScriptId}:${segment.segmentId}`) ?? null))
  }).length
  const bgmScoreStatus = readMusicScoreStatus(musicScore)
  const ambientSoundStatus = typeof ambientSound?.status === 'string' ? ambientSound.status : null
  const audioDesign = readPersistedAudioDesign(audioDesignRow)
  const activeStylePreviewTaskCount = editBible
    ? await prisma.task.count({
      where: {
        projectId: params.projectId,
        episodeId: params.episodeId,
        status: { in: [...ACTIVE_WORKFLOW_TASK_STATUSES] },
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
    hasEditScript: editScripts.length > 0,
    activeEditScriptTaskCount,
    editScriptStatus,
    editScriptAssetReviewStatus,
    editAssetRequirementCount: allEditScriptRequirements.length,
    pendingAssetRequirementCount: allEditScriptRequirements.filter((requirement) => requirement.status !== 'completed').length,
    generatingAssetRequirementCount: allEditScriptRequirements.filter((requirement) => requirement.status === 'generating').length,
    hasShotExecutionPlan: shotExecutionPlans.length > 0,
    activeShotExecutionPlanTaskCount,
    shotExecutionPlanStatus,
    videoPlanSegmentCount: plannedSegments.length,
    completedVideoSegmentCount: plannedVideoSegments.filter(hasCompletedVideoSegment).length,
    failedVideoSegmentCount: plannedVideoSegments.filter((segment) => segment?.status === 'failed').length,
    activeVideoTaskCount,
    chapterCount: chapters.length,
    renderableChapterCount,
    completedChapterRenderCount: chapters.filter((chapter) =>
      chapter.renderStatus === 'completed' && hasOutputReference(chapter.outputMediaId)).length,
    failedChapterRenderCount: chapters.filter((chapter) => chapter.renderStatus === 'failed').length,
    activeChapterRenderTaskCount,
    audioDesignStatus: audioDesignRow?.status ?? null,
    audioDesignHasPlan: Boolean(audioDesign),
    audioDesignHasScore: (audioDesign?.design.scoreCues.length ?? 0) > 0,
    audioDesignHasAmbience: (audioDesign?.design.ambienceSources.length ?? 0) > 0,
    activeAudioDesignPlanTaskCount,
    bgmScoreStatus,
    bgmScoreHasMix: Boolean(readCompletedMusicScoreMix(musicScore)),
    activeBgmScoreGenerationTaskCount,
    ambientSoundStatus,
    ambientSoundHasMix: Boolean(readCompletedAmbientSoundMix(ambientSound)),
    activeAmbientSoundGenerationTaskCount,
    finalRenderStatus: finalOutput?.renderStatus ?? null,
    finalRenderHasOutput: Boolean(
      hasOutputReference(finalOutput?.outputUrl) || hasOutputReference(finalOutput?.outputMediaId),
    ),
    activeFinalRenderTaskCount,
  })
}
