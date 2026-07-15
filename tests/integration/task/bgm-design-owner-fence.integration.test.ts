import { beforeEach, describe, expect, it } from 'vitest'
import {
  claimBgmDesignPlanning,
  completeBgmDesignPlanning,
  readPersistedBgmDesign,
} from '@/lib/bgm-design/project-data'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { prisma } from '../../helpers/prisma'
import { createValidBgmDesign } from '../../unit/bgm-design/bgm-design-fixture'

/**
 * Critical Infrastructure Scenario
 * Authority: ProjectEditBgmDesign is the only durable generated-audio plan row and taskId is its current writer fence.
 * Fault seam: a late first planner attempts to complete after a second planner has claimed the same episode.
 * Rejects: late completion overwriting the new owner, a second generated-audio plan writer, or a planned row without complete model/signature facts.
 * Final oracle: the stale completion fails, the second owner remains intact, and only its complete strict BgmDesign becomes readable.
 * Command: npx vitest run tests/integration/task/bgm-design-owner-fence.integration.test.ts
 */
describe('BgmDesign durable owner fence', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  it('rejects a late planner and materializes only the current owner design', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const episode = await prisma.projectEpisode.create({
      data: { projectId: project.id, episodeNumber: 1, name: 'BGM design fence' },
    })
    const common = {
      episodeId: episode.id,
      timelineSignature: 'timeline-1',
      analysisModel: 'openrouter::analysis-model',
      musicModel: 'fal::fal-ai/lyria3/pro',
    }

    await claimBgmDesignPlanning({ ...common, taskId: 'planner-1' })
    await claimBgmDesignPlanning({ ...common, taskId: 'planner-2' })

    await expect(completeBgmDesignPlanning({
      episodeId: episode.id,
      taskId: 'planner-1',
      design: createValidBgmDesign(),
      designSignature: 'design-stale',
    })).rejects.toThrow('BGM_DESIGN_OWNER_FENCE_REJECTED')
    await expect(prisma.projectEditBgmDesign.findUniqueOrThrow({ where: { episodeId: episode.id } }))
      .resolves.toMatchObject({ status: 'planning', taskId: 'planner-2', designSignature: null })

    await completeBgmDesignPlanning({
      episodeId: episode.id,
      taskId: 'planner-2',
      design: createValidBgmDesign(),
      designSignature: 'design-current',
    })
    const row = await prisma.projectEditBgmDesign.findUniqueOrThrow({ where: { episodeId: episode.id } })
    expect(readPersistedBgmDesign(row)).toMatchObject({
      designSignature: 'design-current',
      timelineSignature: 'timeline-1',
      musicModel: 'fal::fal-ai/lyria3/pro',
    })
  })
})
