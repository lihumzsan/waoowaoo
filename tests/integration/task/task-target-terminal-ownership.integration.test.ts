import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSystemState } from '../../helpers/db-reset'
import { createFixtureEpisode, createFixtureProject, createFixtureUser } from '../../helpers/fixtures'
import { prisma } from '../../helpers/prisma'
import { projectTaskTargetTerminalInTransaction } from '@/lib/task/target-failure-sync'
import { commitTaskTerminal } from '@/lib/task/terminal'
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
        styleBibleJson: {
          styleSummary: 'style',
        } satisfies Prisma.InputJsonObject,
        imagePrompt: 'prompt',
        status: 'generating',
        taskId,
      },
    })
    return { preview, user, project, episode }
  }

  it('serializes duplicate concurrent cancellation and clears the owner once', async () => {
    const { preview } = await createStylePreview('task-current')
    const cancel = async () =>
      await prisma.$transaction(async (tx) => {
        await projectTaskTargetTerminalInTransaction(tx, {
          kind: 'canceled',
          taskId: 'task-current',
          type: TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
          targetType: 'ProjectEditStylePreview',
          targetId: preview.id,
        })
      })

    await Promise.all([cancel(), cancel()])

    await expect(
      prisma.projectEditStylePreview.findUniqueOrThrow({
        where: { id: preview.id },
      }),
    ).resolves.toMatchObject({
      status: 'pending',
      taskId: null,
      errorMessage: null,
    })
  })

  it('ignores late failure and cancellation after a replacement Task owns the preview', async () => {
    const { preview } = await createStylePreview('task-new')
    await Promise.all([
      prisma.$transaction(
        async (tx) =>
          await projectTaskTargetTerminalInTransaction(tx, {
            kind: 'failed',
            taskId: 'task-old',
            type: TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
            targetType: 'ProjectEditStylePreview',
            targetId: preview.id,
            errorCode: 'OLD_FAILED',
            errorMessage: 'old task failed late',
          }),
      ),
      prisma.$transaction(
        async (tx) =>
          await projectTaskTargetTerminalInTransaction(tx, {
            kind: 'canceled',
            taskId: 'task-old',
            type: TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
            targetType: 'ProjectEditStylePreview',
            targetId: preview.id,
          }),
      ),
    ])

    await expect(
      prisma.projectEditStylePreview.findUniqueOrThrow({
        where: { id: preview.id },
      }),
    ).resolves.toMatchObject({
      status: 'generating',
      taskId: 'task-new',
      errorMessage: null,
    })
  })

  it('keeps the Task active when its formal resource committed success before cancellation', async () => {
    const taskId = 'task-success-won'
    const { preview, user, project, episode } = await createStylePreview(taskId)
    await prisma.projectEditStylePreview.update({
      where: { id: preview.id },
      data: {
        status: 'completed',
        imageKey: 'edit-style-preview/completed.png',
      },
    })
    await prisma.task.create({
      data: {
        id: taskId,
        userId: user.id,
        projectId: project.id,
        episodeId: episode.id,
        type: TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
        targetType: 'ProjectEditStylePreview',
        targetId: preview.id,
        status: 'processing',
        attempt: 1,
        billingInfo: { billable: false },
        executionFingerprint: 'a'.repeat(64),
      },
    })

    const terminal = await commitTaskTerminal({
      kind: 'canceled',
      taskId,
      fence: { kind: 'active' },
      source: 'user',
      reason: 'cancel raced with success persistence',
    })

    expect(terminal).toEqual({
      applied: false,
      reason: 'completion_pending',
      existingStatus: 'processing',
      terminalEventId: null,
      outboxCommandIds: [],
    })
    await expect(prisma.task.findUniqueOrThrow({ where: { id: taskId } })).resolves.toMatchObject({
      status: 'processing',
      billingInfo: { billable: false },
    })
    await expect(
      prisma.projectEditStylePreview.findUniqueOrThrow({
        where: { id: preview.id },
      }),
    ).resolves.toMatchObject({ status: 'completed', taskId })
    await expect(prisma.taskEvent.count({ where: { taskId } })).resolves.toBe(0)
  })

  it('rejects an already-terminal Task whose durable broadcast bundle is incomplete', async () => {
    const user = await createFixtureUser()
    const project = await createFixtureProject(user.id)
    const taskId = 'task-terminal-bundle-missing'
    await prisma.task.create({
      data: {
        id: taskId,
        userId: user.id,
        projectId: project.id,
        type: TASK_TYPE.MUSIC_GENERATE,
        targetType: 'Project',
        targetId: project.id,
        status: 'canceled',
        billingInfo: { billable: false },
        executionFingerprint: 'b'.repeat(64),
      },
    })
    await prisma.taskEvent.create({
      data: {
        taskId,
        projectId: project.id,
        userId: user.id,
        eventType: 'canceled',
        idempotencyKey: `task-terminal:${taskId}`,
        payload: {},
      },
    })

    await expect(commitTaskTerminal({
      kind: 'canceled',
      taskId,
      fence: { kind: 'active' },
      source: 'system',
      reason: 'idempotent replay',
    })).rejects.toThrow(`TASK_TERMINAL_BUNDLE_MISSING:${taskId}:canceled`)
  })
})
