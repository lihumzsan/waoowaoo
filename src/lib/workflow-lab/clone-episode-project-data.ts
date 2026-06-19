import { Prisma } from '@prisma/client'
import { toInputJson, type WorkflowLabIdMap } from './clone-json'
import { cloneWorkflowLabEditFirstArtifacts } from './clone-edit-first'
import { cloneWorkflowLabStoryboards } from './clone-storyboards'

export async function cloneEpisodeProjectData(params: {
  readonly tx: Prisma.TransactionClient
  readonly sourceEpisodeId: string
  readonly targetEpisodeId: string
  readonly projectId: string
}) {
  const clipIdMap: WorkflowLabIdMap = new Map()
  const storyboardIdMap: WorkflowLabIdMap = new Map()
  const panelIdMap: WorkflowLabIdMap = new Map()

  const clips = await params.tx.projectClip.findMany({
    where: { episodeId: params.sourceEpisodeId },
    orderBy: { createdAt: 'asc' },
  })
  for (const clip of clips) {
    const createdClip = await params.tx.projectClip.create({
      data: {
        episodeId: params.targetEpisodeId,
        start: clip.start,
        end: clip.end,
        duration: clip.duration,
        summary: clip.summary,
        location: clip.location,
        content: clip.content,
        characters: clip.characters,
        props: clip.props,
        endText: clip.endText,
        shotCount: clip.shotCount,
        startText: clip.startText,
        screenplay: clip.screenplay,
      },
      select: { id: true },
    })
    clipIdMap.set(clip.id, createdClip.id)
  }

  const shots = await params.tx.projectShot.findMany({
    where: { episodeId: params.sourceEpisodeId },
    orderBy: { createdAt: 'asc' },
  })
  for (const shot of shots) {
    await params.tx.projectShot.create({
      data: {
        episodeId: params.targetEpisodeId,
        clipId: shot.clipId ? clipIdMap.get(shot.clipId) ?? null : null,
        shotId: shot.shotId,
        srtStart: shot.srtStart,
        srtEnd: shot.srtEnd,
        srtDuration: shot.srtDuration,
        sequence: shot.sequence,
        locations: shot.locations,
        characters: shot.characters,
        plot: shot.plot,
        imagePrompt: shot.imagePrompt,
        scale: shot.scale,
        module: shot.module,
        focus: shot.focus,
        zhSummarize: shot.zhSummarize,
        imageUrl: shot.imageUrl,
        imageMediaId: shot.imageMediaId,
        pov: shot.pov,
      },
    })
  }

  await cloneWorkflowLabStoryboards({
    tx: params.tx,
    sourceEpisodeId: params.sourceEpisodeId,
    targetEpisodeId: params.targetEpisodeId,
    clipIdMap,
    storyboardIdMap,
    panelIdMap,
  })

  await cloneWorkflowLabEditFirstArtifacts({
    tx: params.tx,
    projectId: params.projectId,
    sourceEpisodeId: params.sourceEpisodeId,
    targetEpisodeId: params.targetEpisodeId,
  })

  const editorProject = await params.tx.videoEditorProject.findUnique({
    where: { episodeId: params.sourceEpisodeId },
  })
  if (editorProject) {
    await params.tx.videoEditorProject.create({
      data: {
        episodeId: params.targetEpisodeId,
        projectData: editorProject.projectData,
        renderStatus: editorProject.renderStatus,
        renderTaskId: editorProject.renderTaskId,
        outputUrl: editorProject.outputUrl,
      },
    })
  }

  const videoGroups = await params.tx.projectVideoGroup.findMany({
    where: { episodeId: params.sourceEpisodeId },
    orderBy: { createdAt: 'asc' },
  })
  for (const group of videoGroups) {
    await params.tx.projectVideoGroup.create({
      data: {
        projectId: params.projectId,
        episodeId: params.targetEpisodeId,
        gridMode: group.gridMode,
        shotNumbers: toInputJson(group.shotNumbers),
        durationSec: group.durationSec,
        prompt: group.prompt,
        status: group.status,
        taskId: group.taskId,
        errorCode: group.errorCode,
        errorMessage: group.errorMessage,
        referenceImageUrl: group.referenceImageUrl,
        referenceImageMediaId: group.referenceImageMediaId,
        videoUrl: group.videoUrl,
        videoMediaId: group.videoMediaId,
      },
    })
  }
}
