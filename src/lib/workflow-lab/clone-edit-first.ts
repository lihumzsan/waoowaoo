import { Prisma } from '@prisma/client'
import { toInputJson, toNullableInputJson } from './clone-json'

export async function cloneWorkflowLabEditFirstArtifacts(params: {
  readonly tx: Prisma.TransactionClient
  readonly projectId: string
  readonly sourceEpisodeId: string
  readonly targetEpisodeId: string
}) {
  const screenplay = await params.tx.projectEditScreenplay.findUnique({
    where: { episodeId: params.sourceEpisodeId },
    include: {
      stylePreviews: {
        orderBy: { createdAt: 'asc' },
      },
      directorDecoupage: true,
    },
  })

  if (screenplay) {
    const createdScreenplay = await params.tx.projectEditScreenplay.create({
      data: {
        projectId: params.projectId,
        episodeId: params.targetEpisodeId,
        userPrompt: screenplay.userPrompt,
        styleBibleJson: toNullableInputJson(screenplay.styleBibleJson),
        screenplayText: screenplay.screenplayText,
        status: screenplay.status,
      },
      select: { id: true },
    })

    for (const preview of screenplay.stylePreviews) {
      await params.tx.projectEditStylePreview.create({
        data: {
          projectId: params.projectId,
          episodeId: params.targetEpisodeId,
          editScreenplayId: createdScreenplay.id,
          styleKey: preview.styleKey,
          aspectRatio: preview.aspectRatio,
          title: preview.title,
          summary: preview.summary,
          styleBibleJson: toInputJson(preview.styleBibleJson),
          imagePrompt: preview.imagePrompt,
          imageKey: preview.imageKey,
          status: preview.status,
          taskId: preview.taskId,
          errorMessage: preview.errorMessage,
        },
      })
    }

    if (screenplay.directorDecoupage) {
      await params.tx.projectEditDirectorDecoupage.create({
        data: {
          projectId: params.projectId,
          episodeId: params.targetEpisodeId,
          editScreenplayId: createdScreenplay.id,
          userPrompt: screenplay.directorDecoupage.userPrompt,
          decoupageJson: toInputJson(screenplay.directorDecoupage.decoupageJson),
          status: screenplay.directorDecoupage.status,
        },
      })
    }
  }

  const editScript = await params.tx.projectEditScript.findUnique({
    where: { episodeId: params.sourceEpisodeId },
    include: {
      requirements: {
        orderBy: { createdAt: 'asc' },
      },
      cinematographyShotPlan: true,
    },
  })

  if (!editScript) return

  const createdEditScript = await params.tx.projectEditScript.create({
    data: {
      projectId: params.projectId,
      episodeId: params.targetEpisodeId,
      userPrompt: editScript.userPrompt,
      styleBibleJson: toNullableInputJson(editScript.styleBibleJson),
      screenplayText: editScript.screenplayText,
      title: editScript.title,
      logline: editScript.logline,
      durationSec: editScript.durationSec,
      shotCount: editScript.shotCount,
      status: editScript.status,
      assetReviewStatus: editScript.assetReviewStatus,
      shotsJson: toInputJson(editScript.shotsJson),
      videoBlocksJson: toNullableInputJson(editScript.videoBlocksJson),
    },
    select: { id: true },
  })

  for (const requirement of editScript.requirements) {
    await params.tx.projectEditAssetRequirement.create({
      data: {
        editScriptId: createdEditScript.id,
        projectId: params.projectId,
        episodeId: params.targetEpisodeId,
        kind: requirement.kind,
        name: requirement.name,
        description: requirement.description,
        shotIndexes: toInputJson(requirement.shotIndexes),
        status: requirement.status,
        targetId: requirement.targetId,
        errorMessage: requirement.errorMessage,
      },
    })
  }

  if (editScript.cinematographyShotPlan) {
    await params.tx.projectEditCinematographyShotPlan.create({
      data: {
        projectId: params.projectId,
        episodeId: params.targetEpisodeId,
        editScriptId: createdEditScript.id,
        shotPlanJson: toInputJson(editScript.cinematographyShotPlan.shotPlanJson),
        status: editScript.cinematographyShotPlan.status,
      },
    })
  }
}
