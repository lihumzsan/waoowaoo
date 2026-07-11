import { beforeEach, describe, expect, it } from 'vitest'
import { projectTaskTargetTerminalInTransaction } from '@/lib/task/target-failure-sync'
import { TASK_TYPE } from '@/lib/task/types'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { prisma } from '../../helpers/prisma'

async function seedEpisode() {
  const user = await createTestUser()
  const project = await createTestProject(user.id)
  const episode = await prisma.projectEpisode.create({
    data: { projectId: project.id, episodeNumber: 1, name: 'Terminal projector episode' },
  })
  return { episode }
}

describe('Task target terminal projector ownership', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  it('projects music score failure/cancel only for the exact active Task owner', async () => {
    const { episode } = await seedEpisode()
    await prisma.projectEditMusicScore.create({
      data: { episodeId: episode.id, status: 'generating', taskId: 'music-old' },
    })

    await prisma.$transaction(async (tx) => await projectTaskTargetTerminalInTransaction(tx, {
      kind: 'failed',
      taskId: 'music-old',
      type: TASK_TYPE.MUSIC_SCORE_PLAN,
      targetType: 'ProjectEpisode',
      targetId: episode.id,
      errorCode: 'PROVIDER_FAILED',
      errorMessage: 'provider rejected the score',
    }))
    await expect(prisma.projectEditMusicScore.findUniqueOrThrow({ where: { episodeId: episode.id } }))
      .resolves.toMatchObject({ status: 'failed', taskId: 'music-old' })

    await prisma.projectEditMusicScore.update({
      where: { episodeId: episode.id },
      data: { status: 'generating', taskId: 'music-new' },
    })
    await prisma.$transaction(async (tx) => await projectTaskTargetTerminalInTransaction(tx, {
      kind: 'failed',
      taskId: 'music-old',
      type: TASK_TYPE.MUSIC_SCORE_PLAN,
      targetType: 'ProjectEpisode',
      targetId: episode.id,
      errorCode: 'LATE_FAILURE',
      errorMessage: 'must not overwrite new owner',
    }))
    await expect(prisma.projectEditMusicScore.findUniqueOrThrow({ where: { episodeId: episode.id } }))
      .resolves.toMatchObject({ status: 'generating', taskId: 'music-new' })

    await prisma.$transaction(async (tx) => await projectTaskTargetTerminalInTransaction(tx, {
      kind: 'canceled',
      taskId: 'music-new',
      type: TASK_TYPE.MUSIC_SCORE_PLAN,
      targetType: 'ProjectEpisode',
      targetId: episode.id,
    }))
    await expect(prisma.projectEditMusicScore.findUniqueOrThrow({ where: { episodeId: episode.id } }))
      .resolves.toMatchObject({ status: 'pending', taskId: null })
  })

  it('projects soundscape plan/generation terminal edges with distinct cancel states', async () => {
    const { episode } = await seedEpisode()
    await prisma.projectEditSoundscape.create({
      data: { episodeId: episode.id, status: 'planning', taskId: 'plan-task' },
    })
    await prisma.$transaction(async (tx) => await projectTaskTargetTerminalInTransaction(tx, {
      kind: 'failed',
      taskId: 'plan-task',
      type: TASK_TYPE.SOUNDSCAPE_PLAN,
      targetType: 'ProjectEpisode',
      targetId: episode.id,
      errorCode: 'PLAN_FAILED',
      errorMessage: 'plan rejected',
    }))
    await expect(prisma.projectEditSoundscape.findUniqueOrThrow({ where: { episodeId: episode.id } }))
      .resolves.toMatchObject({ status: 'failed', taskId: 'plan-task' })

    await prisma.projectEditSoundscape.update({
      where: { episodeId: episode.id },
      data: { status: 'generating', taskId: 'generate-task' },
    })
    await prisma.$transaction(async (tx) => await projectTaskTargetTerminalInTransaction(tx, {
      kind: 'canceled',
      taskId: 'generate-task',
      type: TASK_TYPE.SOUNDSCAPE_GENERATE,
      targetType: 'ProjectEpisode',
      targetId: episode.id,
    }))
    await expect(prisma.projectEditSoundscape.findUniqueOrThrow({ where: { episodeId: episode.id } }))
      .resolves.toMatchObject({ status: 'planned', taskId: null })
  })

  it('fences EditScript and ShotExecutionPlan terminal projection by generationTaskId', async () => {
    const { episode } = await seedEpisode()
    const chapter = await prisma.projectEditChapter.create({
      data: { episodeId: episode.id, chapterIndex: 0, title: 'Chapter' },
    })
    const script = await prisma.projectEditScript.create({
      data: {
        projectId: episode.projectId,
        episodeId: episode.id,
        chapterId: chapter.id,
        durationSec: 30,
        shotCount: 0,
        status: 'generating',
        generationTaskId: 'script-task',
      },
    })

    await prisma.$transaction(async (tx) => await projectTaskTargetTerminalInTransaction(tx, {
      kind: 'failed',
      taskId: 'script-task',
      type: TASK_TYPE.EDIT_SCRIPT_GENERATE,
      targetType: 'ProjectEditChapter',
      targetId: chapter.id,
      errorCode: 'SCRIPT_FAILED',
      errorMessage: 'model output invalid',
    }))
    await expect(prisma.projectEditScript.findUniqueOrThrow({ where: { id: script.id } }))
      .resolves.toMatchObject({ status: 'failed', generationTaskId: 'script-task' })

    await prisma.projectEditScript.update({
      where: { id: script.id },
      data: { status: 'generating', generationTaskId: 'script-new' },
    })
    await prisma.$transaction(async (tx) => await projectTaskTargetTerminalInTransaction(tx, {
      kind: 'canceled',
      taskId: 'script-task',
      type: TASK_TYPE.EDIT_SCRIPT_GENERATE,
      targetType: 'ProjectEditChapter',
      targetId: chapter.id,
    }))
    await expect(prisma.projectEditScript.findUniqueOrThrow({ where: { id: script.id } }))
      .resolves.toMatchObject({ status: 'generating', generationTaskId: 'script-new' })

    await prisma.projectEditShotExecutionPlan.create({
      data: {
        projectId: episode.projectId,
        episodeId: episode.id,
        chapterId: chapter.id,
        editScriptId: script.id,
        executionPlanJson: {},
        status: 'generating',
        generationTaskId: 'shot-plan-task',
      },
    })
    await prisma.$transaction(async (tx) => await projectTaskTargetTerminalInTransaction(tx, {
      kind: 'canceled',
      taskId: 'shot-plan-task',
      type: TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE,
      targetType: 'ProjectEditScript',
      targetId: script.id,
    }))
    await expect(prisma.projectEditShotExecutionPlan.findUniqueOrThrow({ where: { editScriptId: script.id } }))
      .resolves.toMatchObject({ status: 'pending', generationTaskId: null })
  })
})
