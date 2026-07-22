import { ApiError } from '@/lib/api-errors'
import { attachMediaFieldsToProject } from '@/lib/media/attach'
import { prisma } from '@/lib/prisma'

export async function readProjectEpisodeDetail(input: {
  readonly projectId: string
  readonly episodeId: string
}) {
  const episode = await prisma.projectEpisode.findFirst({
    where: { id: input.episodeId, projectId: input.projectId },
  })
  if (!episode) throw new ApiError('NOT_FOUND')
  return await attachMediaFieldsToProject(episode)
}
