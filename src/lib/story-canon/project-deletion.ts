import type { Prisma } from '@prisma/client'

export async function deleteProjectNarrativeProjections(params: {
  projectId: string
  transaction: Prisma.TransactionClient
}): Promise<void> {
  const projectEpisodeScope = {
    episode: {
      projectId: params.projectId,
    },
  } as const

  await params.transaction.projectStoryCanon.deleteMany({
    where: projectEpisodeScope,
  })
  await params.transaction.projectEditChapter.deleteMany({
    where: projectEpisodeScope,
  })
  await params.transaction.projectEpisodeSourceDocument.deleteMany({
    where: projectEpisodeScope,
  })
}
