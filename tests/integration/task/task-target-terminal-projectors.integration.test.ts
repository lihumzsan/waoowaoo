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

  it('projects BGM-design failure/cancel only for the exact active Task owner', async () => {
    const { episode } = await seedEpisode()
    await prisma.projectEditBgmDesign.create({
      data: { episodeId: episode.id, status: 'planning', taskId: 'bgm-design-old' },
    })

    await prisma.$transaction(async (tx) => await projectTaskTargetTerminalInTransaction(tx, {
      kind: 'failed',
      taskId: 'bgm-design-old',
      type: TASK_TYPE.BGM_DESIGN_PLAN,
      targetType: 'ProjectEpisode',
      targetId: episode.id,
      errorCode: 'PROVIDER_FAILED',
      errorMessage: 'provider rejected the unified design',
    }))
    await expect(prisma.projectEditBgmDesign.findUniqueOrThrow({ where: { episodeId: episode.id } }))
      .resolves.toMatchObject({ status: 'failed', taskId: 'bgm-design-old' })

    await prisma.projectEditBgmDesign.update({
      where: { episodeId: episode.id },
      data: { status: 'planning', taskId: 'bgm-design-new' },
    })
    await prisma.$transaction(async (tx) => await projectTaskTargetTerminalInTransaction(tx, {
      kind: 'failed',
      taskId: 'bgm-design-old',
      type: TASK_TYPE.BGM_DESIGN_PLAN,
      targetType: 'ProjectEpisode',
      targetId: episode.id,
      errorCode: 'LATE_FAILURE',
      errorMessage: 'must not overwrite new owner',
    }))
    await expect(prisma.projectEditBgmDesign.findUniqueOrThrow({ where: { episodeId: episode.id } }))
      .resolves.toMatchObject({ status: 'planning', taskId: 'bgm-design-new' })

    await prisma.$transaction(async (tx) => await projectTaskTargetTerminalInTransaction(tx, {
      kind: 'canceled',
      taskId: 'bgm-design-new',
      type: TASK_TYPE.BGM_DESIGN_PLAN,
      targetType: 'ProjectEpisode',
      targetId: episode.id,
    }))
    await expect(prisma.projectEditBgmDesign.findUniqueOrThrow({ where: { episodeId: episode.id } }))
      .resolves.toMatchObject({ status: 'pending', taskId: null })
  })

  it('projects BGM generation terminals without owning the frozen design', async () => {
    const { episode } = await seedEpisode()
    await prisma.projectEditMusicScore.create({
      data: {
        episodeId: episode.id,
        status: 'generating',
        taskId: 'music-generate',
        designSignature: 'design-1',
      },
    })
    await prisma.$transaction(async (tx) => await projectTaskTargetTerminalInTransaction(tx, {
      kind: 'canceled',
      taskId: 'music-generate',
      type: TASK_TYPE.MUSIC_SCORE_GENERATE,
      targetType: 'ProjectEpisode',
      targetId: episode.id,
    }))
    await expect(prisma.projectEditMusicScore.findUniqueOrThrow({ where: { episodeId: episode.id } }))
      .resolves.toMatchObject({ status: 'pending', taskId: null, designSignature: 'design-1' })

    await prisma.projectEditMusicScore.update({
      where: { episodeId: episode.id },
      data: { status: 'generating', taskId: 'music-generate' },
    })
    await prisma.$transaction(async (tx) => await projectTaskTargetTerminalInTransaction(tx, {
      kind: 'failed',
      taskId: 'music-generate',
      type: TASK_TYPE.MUSIC_SCORE_GENERATE,
      targetType: 'ProjectEpisode',
      targetId: episode.id,
      errorCode: 'GENERATION_FAILED',
      errorMessage: 'candidate generation failed',
    }))
    await expect(prisma.projectEditMusicScore.findUniqueOrThrow({ where: { episodeId: episode.id } }))
      .resolves.toMatchObject({ status: 'failed', taskId: 'music-generate', designSignature: 'design-1' })

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
