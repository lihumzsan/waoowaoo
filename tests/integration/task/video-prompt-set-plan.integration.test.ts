import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { creativeResourceGenerationTaskPayloadSchema } from '@/lib/creative-resource/generation-contract'
import { buildDomainCreativeResourceId } from '@/lib/creative-resource/identity'
import { CREATIVE_RESOURCE_SCHEMA } from '@/lib/creative-resource/schema-registry'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import { planOperation } from '@/lib/operations/planning'
import { TASK_TYPE } from '@/lib/task/types'
import { resetSystemState } from '../../helpers/db-reset'
import {
  createFixtureEpisode,
  createFixtureProject,
  createFixtureUser,
} from '../../helpers/fixtures'
import { prisma } from '../../helpers/prisma'

async function createReadyImageResource(input: {
  readonly userId: string
  readonly projectId: string
  readonly episodeId: string
  readonly label: string
}) {
  const media = await prisma.mediaObject.create({
    data: {
      publicId: `video-prompt-set-${randomUUID()}`,
      storageKey: `video-prompt-set/${randomUUID()}.png`,
      mimeType: 'image/png',
      width: 1024,
      height: 1792,
    },
  })
  const sourceId = `${input.label}:${randomUUID()}`
  const resourceId = buildDomainCreativeResourceId({
    sourceType: 'VideoPromptSetPlanTestImage',
    sourceId,
  })
  await prisma.creativeResource.create({
    data: {
      id: resourceId,
      userId: input.userId,
      projectId: input.projectId,
      episodeId: input.episodeId,
      scopeKind: 'episode',
      scopeId: input.episodeId,
      mediaType: 'image',
      schemaId: CREATIVE_RESOURCE_SCHEMA.GENERIC_IMAGE,
      name: input.label,
      status: 'ready',
      sourceType: 'VideoPromptSetPlanTestImage',
      sourceId,
      mediaId: media.id,
      materializedAt: new Date(),
    },
  })
  return resourceId
}

async function createVideoPromptSetResource(input: {
  readonly userId: string
  readonly projectId: string
  readonly episodeId: string
  readonly mediaResourceId: string
  readonly linkedResourceId?: string
  readonly label: string
}) {
  const sourceId = `${input.label}:${randomUUID()}`
  const resourceId = buildDomainCreativeResourceId({
    sourceType: 'CreativeWorkResult',
    sourceId,
  })
  await prisma.creativeResource.create({
    data: {
      id: resourceId,
      userId: input.userId,
      projectId: input.projectId,
      episodeId: input.episodeId,
      scopeKind: 'episode',
      scopeId: input.episodeId,
      mediaType: 'text',
      schemaId: CREATIVE_RESOURCE_SCHEMA.VIDEO_PROMPT_SET,
      name: input.label,
      status: 'ready',
      sourceType: 'CreativeWorkResult',
      sourceId,
      contentJson: {
        kind: 'video_prompt_set',
        segments: [{
          key: 'opening',
          durationSeconds: 4,
          prompt: 'Lin looks up as rain streaks across the station lights.',
          mediaResourceIds: [input.mediaResourceId],
        }],
      } satisfies Prisma.InputJsonValue,
      materializedAt: new Date(),
    },
  })
  if (input.linkedResourceId) {
    await prisma.creativeResourceLineage.create({
      data: {
        outputResourceId: resourceId,
        inputResourceId: input.linkedResourceId,
        role: 'source_material',
        position: 0,
      },
    })
  }
  return resourceId
}

describe('Video Prompt Set direct Resource planning', () => {
  beforeEach(async () => {
    await resetSystemState()
  })

  /**
   * Authority: the create_video planner is the only interpreter of a materialized
   * Video Prompt Set and its exact Resource lineage.
   * Rejects: Primary-Agent name/hash remapping, unlinked media IDs, or a second
   * video submission path.
   * Production entry: registered create_video Operation through planOperation.
   * Oracle: the frozen video Task contains the Prompt Set and image Resource IDs
   * at exact positions; unlinked and cross-Episode image Resources fail closed.
   * Command: BILLING_TEST_BOOTSTRAP=1 npx vitest run tests/integration/task/video-prompt-set-plan.integration.test.ts
   */
  it('plans exact lineaged media Resource IDs and rejects an unlinked ID', async () => {
    const user = await createFixtureUser()
    const project = await createFixtureProject(user.id)
    const episode = await createFixtureEpisode(project.id)
    const imageResourceId = await createReadyImageResource({
      userId: user.id,
      projectId: project.id,
      episodeId: episode.id,
      label: 'Lin rainy-night reference',
    })
    const promptSetResourceId = await createVideoPromptSetResource({
      userId: user.id,
      projectId: project.id,
      episodeId: episode.id,
      mediaResourceId: imageResourceId,
      linkedResourceId: imageResourceId,
      label: 'Opening prompt set',
    })
    const operation = createProjectAgentOperationRegistry().create_video
    const parsedInputResult = operation.inputSchema.safeParse({
      request: {
        kind: 'prompt_set',
        resourceId: promptSetResourceId,
      },
    })
    if (!parsedInputResult.success) throw parsedInputResult.error
    const context = {
      request: new NextRequest('http://localhost/api/operations/create-video/plan'),
      userId: user.id,
      projectId: project.id,
      context: {
        locale: 'zh',
        episodeId: episode.id,
        runId: 'video-prompt-set-plan-run',
      },
      source: 'assistant-panel',
      writer: null,
      toolCallId: 'video-prompt-set-plan-tool',
    } as const

    const plan = await planOperation({
      operation,
      ctx: context,
      input: parsedInputResult.data,
    })

    expect(plan.tasks).toHaveLength(1)
    const task = plan.tasks[0]
    expect(task).toBeDefined()
    if (!task) throw new Error('VIDEO_PROMPT_SET_TEST_TASK_REQUIRED')
    expect(task.taskType).toBe(TASK_TYPE.CREATIVE_RESOURCE_VIDEO)
    expect(task.episodeId).toBe(episode.id)
    expect(task.target.targetId).toMatch(/^r_[A-Za-z0-9_-]{22}$/)
    expect(plan.reservedIdentityIds).toEqual([task.target.targetId])
    const payload = creativeResourceGenerationTaskPayloadSchema.parse(task.payload)
    expect(payload.prompt).toBe('Lin looks up as rain streaks across the station lights.')
    expect(payload.resource).toMatchObject({
      resourceId: task.target.targetId,
      inputs: [
        {
          resourceId: promptSetResourceId,
          role: 'video_prompt_set',
          position: 0,
        },
        {
          resourceId: imageResourceId,
          role: 'reference',
          position: 1,
        },
      ],
      imageInputPositions: [1],
      audioInputPositions: [],
      videoInputPositions: [],
    })

    const unlinkedImageResourceId = await createReadyImageResource({
      userId: user.id,
      projectId: project.id,
      episodeId: episode.id,
      label: 'Unlinked reference',
    })
    const invalidPromptSetResourceId = await createVideoPromptSetResource({
      userId: user.id,
      projectId: project.id,
      episodeId: episode.id,
      mediaResourceId: unlinkedImageResourceId,
      linkedResourceId: imageResourceId,
      label: 'Invalid prompt set',
    })
    const invalidInputResult = operation.inputSchema.safeParse({
      request: {
        kind: 'prompt_set',
        resourceId: invalidPromptSetResourceId,
      },
    })
    if (!invalidInputResult.success) throw invalidInputResult.error

    await expect(planOperation({
      operation,
      ctx: context,
      input: invalidInputResult.data,
    })).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      details: expect.objectContaining({
        code: 'VIDEO_PROMPT_SET_MEDIA_RESOURCE_INVALID',
        resourceId: unlinkedImageResourceId,
      }),
    })

    const otherEpisode = await createFixtureEpisode(project.id, 2)
    const crossEpisodeImageResourceId = await createReadyImageResource({
      userId: user.id,
      projectId: project.id,
      episodeId: otherEpisode.id,
      label: 'Cross-episode reference',
    })
    const crossEpisodePromptSetResourceId = await createVideoPromptSetResource({
      userId: user.id,
      projectId: project.id,
      episodeId: episode.id,
      mediaResourceId: crossEpisodeImageResourceId,
      linkedResourceId: crossEpisodeImageResourceId,
      label: 'Cross-episode prompt set',
    })
    const crossEpisodeInputResult = operation.inputSchema.safeParse({
      request: {
        kind: 'prompt_set',
        resourceId: crossEpisodePromptSetResourceId,
      },
    })
    if (!crossEpisodeInputResult.success) throw crossEpisodeInputResult.error

    await expect(planOperation({
      operation,
      ctx: context,
      input: crossEpisodeInputResult.data,
    })).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      details: expect.objectContaining({
        code: 'VIDEO_PROMPT_SET_MEDIA_RESOURCE_INVALID',
        resourceId: crossEpisodeImageResourceId,
      }),
    })
  })
})
