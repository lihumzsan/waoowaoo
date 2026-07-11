import { prisma } from '@/lib/prisma'

export async function readWorkspaceResourceRevision(input: {
  readonly projectId: string
  readonly episodeId: string
}): Promise<number> {
  const episode = await prisma.projectEpisode.findFirst({
    where: {
      id: input.episodeId,
      projectId: input.projectId,
    },
    select: { resourceRevision: true },
  })
  if (!episode) {
    throw new Error(`WORKSPACE_RESOURCE_REVISION_EPISODE_NOT_FOUND:${input.episodeId}`)
  }
  return episode.resourceRevision
}

export async function readConsistentWorkspaceResourceSnapshot<T>(input: {
  readonly projectId: string
  readonly episodeId: string
  readonly read: () => Promise<T>
}): Promise<{ readonly data: T; readonly resourceRevision: number }> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const before = await readWorkspaceResourceRevision(input)
    const data = await input.read()
    const after = await readWorkspaceResourceRevision(input)
    if (before === after) return { data, resourceRevision: after }
  }
  throw new Error(`WORKSPACE_RESOURCE_SNAPSHOT_CHANGED_DURING_READ:${input.episodeId}`)
}
