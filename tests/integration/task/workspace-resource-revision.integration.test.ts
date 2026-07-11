import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { prisma } from '../../helpers/prisma'
import { installProjectEpisodeResourceRevisionTriggers } from '../../../scripts/install-resource-revision-triggers'

async function installResourceRevisionTriggers() {
  const databaseUrl = new URL(process.env.DATABASE_URL ?? '')
  const installed = await installProjectEpisodeResourceRevisionTriggers({
    databaseUrl: databaseUrl.toString(),
  })
  if (installed.outcome !== 'installed' || installed.count !== 40) {
    throw new Error('RESOURCE_REVISION_TRIGGER_INSTALLER_INTEGRATION_FAILED')
  }
  const verified = await installProjectEpisodeResourceRevisionTriggers({
    databaseUrl: databaseUrl.toString(),
  })
  if (verified.outcome !== 'already_installed' || verified.count !== 40) {
    throw new Error('RESOURCE_REVISION_TRIGGER_INSTALLER_IDEMPOTENCY_FAILED')
  }
}

async function readRevision(episodeId: string) {
  return (await prisma.projectEpisode.findUniqueOrThrow({
    where: { id: episodeId },
    select: { resourceRevision: true },
  })).resourceRevision
}

describe('workspace resource revision MySQL integration', () => {
  beforeAll(async () => {
    await installResourceRevisionTriggers()
  })

  beforeEach(async () => {
    await resetBillingState()
  })

  it('strictly advances for same-clock child writes and a physical delete', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const episode = await prisma.projectEpisode.create({
      data: {
        projectId: project.id,
        episodeNumber: 1,
        name: 'Revision episode',
      },
    })
    expect(await readRevision(episode.id)).toBe(0)

    const source = await prisma.projectEpisodeSourceDocument.create({
      data: {
        episodeId: episode.id,
        normalizedText: 'v1',
        checksum: 'checksum-v1',
        sourceKind: 'text',
        version: 1,
      },
    })
    expect(await readRevision(episode.id)).toBe(1)

    await prisma.$transaction([
      prisma.projectEpisodeSourceDocument.update({
        where: { id: source.id },
        data: { normalizedText: 'v2' },
      }),
      prisma.projectEpisodeSourceDocument.update({
        where: { id: source.id },
        data: { checksum: 'checksum-v2' },
      }),
    ])
    expect(await readRevision(episode.id)).toBe(3)

    await prisma.projectEpisodeSourceDocument.delete({ where: { id: source.id } })
    expect(await readRevision(episode.id)).toBe(4)
  })

  it('advances through the storyboard relation for panel insert, update, and delete', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const episode = await prisma.projectEpisode.create({
      data: {
        projectId: project.id,
        episodeNumber: 1,
        name: 'Panel revision episode',
      },
    })
    const chapter = await prisma.projectEditChapter.create({
      data: { episodeId: episode.id, chapterIndex: 0 },
    })
    const storyboard = await prisma.projectStoryboard.create({
      data: {
        episodeId: episode.id,
        chapterId: chapter.id,
        panelCount: 1,
      },
    })
    const beforePanel = await readRevision(episode.id)

    const panel = await prisma.projectPanel.create({
      data: {
        storyboardId: storyboard.id,
        panelIndex: 0,
        description: 'initial',
      },
    })
    expect(await readRevision(episode.id)).toBe(beforePanel + 1)

    await prisma.projectPanel.update({
      where: { id: panel.id },
      data: { description: 'updated' },
    })
    expect(await readRevision(episode.id)).toBe(beforePanel + 2)

    await prisma.projectPanel.delete({ where: { id: panel.id } })
    expect(await readRevision(episode.id)).toBe(beforePanel + 3)
  })
})
