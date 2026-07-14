import { beforeEach, describe, expect, it } from 'vitest'
import {
  claimAudioDesignPlanning,
  completeAudioDesignPlanning,
  readPersistedAudioDesign,
} from '@/lib/audio-design/project-data'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { prisma } from '../../helpers/prisma'
import { createValidAudioDesign } from '../../unit/audio-design/audio-design-fixture'

/**
 * Critical Infrastructure Scenario
 * Authority: ProjectEditAudioDesign is the only durable episode sound-plan row and taskId is its current writer fence.
 * Fault seam: a late first planner attempts to complete after a second planner has claimed the same episode.
 * Rejects: late completion overwriting the new owner, split BGM/ambience plan writers, or a planned row without complete model/signature facts.
 * Final oracle: the stale completion fails, the second owner remains intact, and only its complete strict AudioDesign becomes readable.
 * Command: npx vitest run tests/integration/task/audio-design-owner-fence.integration.test.ts
 */
describe('AudioDesign durable owner fence', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  it('rejects a late planner and materializes only the current owner design', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const episode = await prisma.projectEpisode.create({
      data: { projectId: project.id, episodeNumber: 1, name: 'Audio design fence' },
    })
    const common = {
      episodeId: episode.id,
      timelineSignature: 'timeline-1',
      analysisModel: 'openrouter::analysis-model',
      musicModel: 'fal::fal-ai/lyria3/pro',
      soundEffectModel: 'elevenlabs::sound-effect-model',
    }

    await claimAudioDesignPlanning({ ...common, taskId: 'planner-1' })
    await claimAudioDesignPlanning({ ...common, taskId: 'planner-2' })

    await expect(completeAudioDesignPlanning({
      episodeId: episode.id,
      taskId: 'planner-1',
      design: createValidAudioDesign(),
      designSignature: 'design-stale',
    })).rejects.toThrow('AUDIO_DESIGN_OWNER_FENCE_REJECTED')
    await expect(prisma.projectEditAudioDesign.findUniqueOrThrow({ where: { episodeId: episode.id } }))
      .resolves.toMatchObject({ status: 'planning', taskId: 'planner-2', designSignature: null })

    await completeAudioDesignPlanning({
      episodeId: episode.id,
      taskId: 'planner-2',
      design: createValidAudioDesign(),
      designSignature: 'design-current',
    })
    const row = await prisma.projectEditAudioDesign.findUniqueOrThrow({ where: { episodeId: episode.id } })
    expect(readPersistedAudioDesign(row)).toMatchObject({
      designSignature: 'design-current',
      timelineSignature: 'timeline-1',
      musicModel: 'fal::fal-ai/lyria3/pro',
    })
  })
})
