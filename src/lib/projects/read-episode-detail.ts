import { ApiError } from '@/lib/api-errors'
import { readProjectEditScripts, readProjectEditShotExecutionPlans } from '@/lib/edit-script/service'
import { attachMediaFieldsToProject } from '@/lib/media/attach'
import { normalizeFinalVideoSummary } from '@/lib/operations/domains/gui/final-video-summary'
import { prisma } from '@/lib/prisma'

export async function readProjectEpisodeDetail(input: {
  readonly projectId: string
  readonly episodeId: string
}) {
  const episode = await prisma.projectEpisode.findFirst({
    where: { id: input.episodeId, projectId: input.projectId },
    include: {
      videoSegments: {
        include: { videoMedia: true },
        orderBy: { createdAt: 'asc' },
      },
      finalOutput: {
        select: {
          id: true,
          episodeId: true,
          renderStatus: true,
          renderTaskId: true,
          outputUrl: true,
          updatedAt: true,
        },
      },
      musicScore: {
        select: {
          id: true,
          status: true,
          taskId: true,
          timelineSignature: true,
          designSignature: true,
          musicModel: true,
          cuesJson: true,
          mixJson: true,
          diagnosticsJson: true,
          updatedAt: true,
        },
      },
      bgmDesign: {
        select: {
          id: true,
          status: true,
          taskId: true,
          timelineSignature: true,
          designSignature: true,
          analysisModel: true,
          musicModel: true,
          designJson: true,
          diagnosticsJson: true,
          updatedAt: true,
        },
      },
    },
  })
  if (!episode) throw new ApiError('NOT_FOUND')

  const [episodeWithSignedUrls, editScripts, editShotExecutionPlans] = await Promise.all([
    attachMediaFieldsToProject(episode),
    readProjectEditScripts(input),
    readProjectEditShotExecutionPlans(input),
  ])
  return {
    ...episodeWithSignedUrls,
    editScript: editScripts.length === 1 ? editScripts[0] : null,
    editScripts,
    editShotExecutionPlans,
    finalVideo: normalizeFinalVideoSummary(
      episode.finalOutput,
      episode.musicScore,
      episode.bgmDesign,
      episode.id,
    ),
  }
}
