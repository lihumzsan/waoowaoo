import { ApiError } from '@/lib/api-errors'
import { readProjectEditScripts, readProjectEditShotExecutionPlans } from '@/lib/edit-script/service'
import { attachMediaFieldsToProject } from '@/lib/media/attach'
import { normalizeFinalVideoSummary } from '@/lib/operations/domains/gui/final-video-summary'
import { prisma } from '@/lib/prisma'
import { createEpisodeDataQueryDto } from '@/lib/workspace-resource/query-dto-version'

export async function readProjectEpisodeDetail(input: {
  readonly projectId: string
  readonly episodeId: string
}) {
  const episode = await prisma.projectEpisode.findFirst({
    where: { id: input.episodeId, projectId: input.projectId },
    include: {
      storyboards: {
        include: {
          panels: { orderBy: { panelIndex: 'asc' } },
        },
        orderBy: { createdAt: 'asc' },
      },
      videoGroups: {
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
          version: true,
          taskId: true,
          timelineSignature: true,
          musicModel: true,
          cuesJson: true,
          mixJson: true,
          diagnosticsJson: true,
          updatedAt: true,
        },
      },
      soundscape: {
        select: {
          id: true,
          status: true,
          version: true,
          taskId: true,
          timelineSignature: true,
          soundEffectModel: true,
          planJson: true,
          sourcesJson: true,
          mixJson: true,
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
  return createEpisodeDataQueryDto({
    ...episodeWithSignedUrls,
    editScript: editScripts.length === 1 ? editScripts[0] : null,
    editScripts,
    editShotExecutionPlans,
    finalVideo: normalizeFinalVideoSummary(episode.finalOutput, episode.musicScore, episode.soundscape),
  })
}
