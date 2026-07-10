import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSystemState } from '../../helpers/db-reset'
import { createFixtureEpisode, createFixtureProject, createFixtureUser } from '../../helpers/fixtures'
import { prisma } from '../../helpers/prisma'
import { projectTaskTargetTerminalInTransaction } from '@/lib/task/target-failure-sync'
import { TASK_TYPE } from '@/lib/task/types'

describe('Task target terminal ownership', () => {
  beforeEach(async () => {
    await resetSystemState()
  })

  async function createStylePreview(taskId: string) {
    const user = await createFixtureUser()
    const project = await createFixtureProject(user.id)
    const episode = await createFixtureEpisode(project.id)
    const source = await prisma.projectEpisodeSourceDocument.create({
      data: {
        episodeId: episode.id,
        normalizedText: 'source',
        checksum: 'a'.repeat(64),
        sourceKind: 'paste',
        version: 1,
      },
    })
    const bible = await prisma.projectEditBible.create({
      data: {
        episodeId: episode.id,
        sourceDocumentId: source.id,
        status: 'confirmed',
      },
    })
    const preview = await prisma.projectEditStylePreview.create({
      data: {
        projectId: project.id,
        episodeId: episode.id,
        editBibleId: bible.id,
        styleKey: 'style_a',
        aspectRatio: '16:9',
        title: 'Style A',
        summary: 'summary',
        styleBibleJson: { styleSummary: 'style' } satisfies Prisma.InputJsonObject,
        imagePrompt: 'prompt',
        status: 'generating',
        taskId,
      },
    })
    return preview
  }

  it('serializes duplicate concurrent cancellation and clears the owner once', async () => {
    const preview = await createStylePreview('task-current')
    const cancel = async () => await prisma.$transaction(async (tx) => {
      await projectTaskTargetTerminalInTransaction(tx, {
        kind: 'canceled',
        taskId: 'task-current',
        type: TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
        targetType: 'ProjectEditStylePreview',
        targetId: preview.id,
      })
    })

    await Promise.all([cancel(), cancel()])

    await expect(prisma.projectEditStylePreview.findUniqueOrThrow({ where: { id: preview.id } }))
      .resolves.toMatchObject({ status: 'pending', taskId: null, errorMessage: null })
  })

  it('ignores late failure and cancellation after a replacement Task owns the preview', async () => {
    const preview = await createStylePreview('task-new')
    await Promise.all([
      prisma.$transaction(async (tx) => await projectTaskTargetTerminalInTransaction(tx, {
        kind: 'failed',
        taskId: 'task-old',
        type: TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
        targetType: 'ProjectEditStylePreview',
        targetId: preview.id,
        errorCode: 'OLD_FAILED',
        errorMessage: 'old task failed late',
      })),
      prisma.$transaction(async (tx) => await projectTaskTargetTerminalInTransaction(tx, {
        kind: 'canceled',
        taskId: 'task-old',
        type: TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
        targetType: 'ProjectEditStylePreview',
        targetId: preview.id,
      })),
    ])

    await expect(prisma.projectEditStylePreview.findUniqueOrThrow({ where: { id: preview.id } }))
      .resolves.toMatchObject({ status: 'generating', taskId: 'task-new', errorMessage: null })
  })
})
