import { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'

export async function createProjectEpisodeInTransaction(input: {
  readonly transaction: Prisma.TransactionClient
  readonly projectId: string
  readonly userId: string
  readonly name: string
  readonly description?: string | null
  readonly novelText?: string
}) {
  const name = input.name.trim()
  if (!name) throw new ApiError('INVALID_PARAMS', { field: 'name' })

  const lockedProject = await input.transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM projects
    WHERE id = ${input.projectId} AND userId = ${input.userId}
    FOR UPDATE
  `)
  if (lockedProject.length !== 1) throw new ApiError('NOT_FOUND')

  const lastEpisode = await input.transaction.projectEpisode.findFirst({
    where: { projectId: input.projectId },
    orderBy: { episodeNumber: 'desc' },
    select: { episodeNumber: true },
  })
  const createData: Prisma.ProjectEpisodeUncheckedCreateInput = {
    projectId: input.projectId,
    episodeNumber: (lastEpisode?.episodeNumber ?? 0) + 1,
    name,
    description: input.description?.trim() || null,
    ...(typeof input.novelText === 'string' ? { novelText: input.novelText } : {}),
  }
  const episode = await input.transaction.projectEpisode.create({ data: createData })
  const project = await input.transaction.project.update({
    where: { id: input.projectId },
    data: { lastEpisodeId: episode.id },
  })
  return { project, episode }
}
