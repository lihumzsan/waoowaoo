import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { creativeResourceGenerationTaskPayloadSchema } from '@/lib/creative-resource/generation-contract'
import { buildDomainCreativeResourceId } from '@/lib/creative-resource/identity'
import { CREATIVE_RESOURCE_SCHEMA } from '@/lib/creative-resource/schema-registry'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import { persistOperationPlanSnapshot } from '@/lib/operations/operation-plan-snapshot'
import { issueApprovalGrant } from '@/lib/operations/planned-operation-invocation'
import { planOperation, quoteOperationPlan } from '@/lib/operations/planning'
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
  readonly segments?: readonly {
    readonly key: string
    readonly durationSeconds: number
    readonly prompt: string
  }[]
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
        segments: (input.segments ?? [{
          key: 'opening',
          durationSeconds: 4,
          prompt: 'Lin looks up as rain streaks across the station lights.',
          mediaResourceIds: [input.mediaResourceId],
        }]).map((segment) => ({
          ...segment,
          mediaResourceIds: [input.mediaResourceId],
        })),
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

  /**
   * Authority: CR-03 makes the original non-retry Task payload the sole
   * generation fact for retry, including Tasks expanded from prompt_set.
   * Rejects: treating only request.kind=new as an original Task, copying the
   * segment prompt through the Agent, or retrying a successful sibling.
   * Production entry: create_video prompt_set and retry planners with real
   * OperationExecution, PlanSnapshot, Task, and Resource rows.
   * Oracle: retry plans exactly the failed Resource from its byte-equivalent
   * frozen payload while the completed sibling remains untouched.
   * Command: BILLING_TEST_BOOTSTRAP=1 npx vitest run tests/integration/task/video-prompt-set-plan.integration.test.ts
   */
  it('retries one failed prompt-set segment from its frozen Task without touching its sibling', async () => {
    const user = await createFixtureUser()
    const project = await createFixtureProject(user.id)
    const episode = await createFixtureEpisode(project.id)
    const imageResourceId = await createReadyImageResource({
      userId: user.id,
      projectId: project.id,
      episodeId: episode.id,
      label: 'Retry reference',
    })
    const promptSetResourceId = await createVideoPromptSetResource({
      userId: user.id,
      projectId: project.id,
      episodeId: episode.id,
      mediaResourceId: imageResourceId,
      linkedResourceId: imageResourceId,
      label: 'Retry prompt set',
      segments: [
        {
          key: 'failed-opening',
          durationSeconds: 4,
          prompt: 'Frozen failed opening prompt.',
        },
        {
          key: 'completed-ending',
          durationSeconds: 4,
          prompt: 'Frozen completed ending prompt.',
        },
      ],
    })
    const operation = createProjectAgentOperationRegistry().create_video
    const initialInputResult = operation.inputSchema.safeParse({
      request: {
        kind: 'prompt_set',
        resourceId: promptSetResourceId,
      },
    })
    if (!initialInputResult.success) throw initialInputResult.error
    const initialInput = initialInputResult.data
    const initialPlan = await planOperation({
      operation,
      ctx: {
        request: new NextRequest('http://localhost/api/operations/create-video/plan'),
        userId: user.id,
        projectId: project.id,
        context: {
          locale: 'zh',
          episodeId: episode.id,
          runId: 'video-prompt-set-initial-run',
        },
        source: 'assistant-panel',
        writer: null,
        toolCallId: 'video-prompt-set-initial-tool',
      },
      input: initialInput,
    })
    expect(initialPlan.tasks).toHaveLength(2)
    const snapshot = await persistOperationPlanSnapshot({
      plan: initialPlan,
      normalizedInput: initialInput,
      quote: await quoteOperationPlan(initialPlan),
      episodeId: episode.id,
    })
    const issued = await issueApprovalGrant({
      userId: user.id,
      planSnapshotId: snapshot.id,
      requestId: 'video-prompt-set-initial-approval',
    })
    const execution = await prisma.operationExecution.create({
      data: {
        userId: user.id,
        scopeKind: 'episode',
        scopeId: episode.id,
        projectId: project.id,
        episodeId: episode.id,
        operationId: operation.id,
        planSnapshotId: snapshot.id,
        approvalGrantId: issued.approvalGrantId,
        requestId: issued.operationRequestId,
        status: 'failed',
      },
    })
    const [failedTaskPlan, completedTaskPlan] = initialPlan.tasks
    if (!failedTaskPlan || !completedTaskPlan) {
      throw new Error('VIDEO_PROMPT_SET_RETRY_TASKS_REQUIRED')
    }
    const failedResourceId = failedTaskPlan.target.targetId
    const completedResourceId = completedTaskPlan.target.targetId
    await prisma.creativeResource.createMany({
      data: [
        {
          id: failedResourceId,
          userId: user.id,
          projectId: project.id,
          episodeId: episode.id,
          scopeKind: 'episode',
          scopeId: episode.id,
          mediaType: 'video',
          schemaId: CREATIVE_RESOURCE_SCHEMA.GENERIC_VIDEO,
          name: 'Failed opening',
          status: 'failed',
          errorCode: 'PROVIDER_SUBMISSION_OUTCOME_UNKNOWN',
          errorMessage: 'Provider submission outcome unknown',
        },
        {
          id: completedResourceId,
          userId: user.id,
          projectId: project.id,
          episodeId: episode.id,
          scopeKind: 'episode',
          scopeId: episode.id,
          mediaType: 'video',
          schemaId: CREATIVE_RESOURCE_SCHEMA.GENERIC_VIDEO,
          name: 'Completed ending',
          status: 'ready',
          materializedAt: new Date(),
        },
      ],
    })
    const createOriginalTask = async (
      taskPlan: typeof failedTaskPlan,
      status: 'failed' | 'completed',
    ) => await prisma.task.create({
      data: {
        id: `prompt-set-original:${taskPlan.target.targetId}`,
        userId: user.id,
        projectId: project.id,
        episodeId: episode.id,
        type: taskPlan.taskType,
        targetType: taskPlan.target.targetType,
        targetId: taskPlan.target.targetId,
        status,
        payload: taskPlan.payload as Prisma.InputJsonValue,
        operationId: operation.id,
        operationSource: 'assistant-panel',
        operationRequestId: issued.operationRequestId,
        approvalGrantId: issued.approvalGrantId,
        operationExecutionId: execution.id,
        operationPlanTaskId: taskPlan.id,
        ...(status === 'failed'
          ? {
              errorCode: 'PROVIDER_SUBMISSION_OUTCOME_UNKNOWN',
              errorMessage: 'Provider submission outcome unknown',
            }
          : {}),
      },
    })
    const [failedTask, completedTask] = await Promise.all([
      createOriginalTask(failedTaskPlan, 'failed'),
      createOriginalTask(completedTaskPlan, 'completed'),
    ])
    const retryInputResult = operation.inputSchema.safeParse({
      request: {
        kind: 'retry',
        resourceIds: [failedResourceId],
      },
    })
    if (!retryInputResult.success) throw retryInputResult.error
    const retryInput = retryInputResult.data

    const retryPlan = await planOperation({
      operation,
      ctx: {
        request: new NextRequest('http://localhost/api/operations/create-video/retry-plan'),
        userId: user.id,
        projectId: project.id,
        context: {
          locale: 'zh',
          episodeId: episode.id,
          runId: 'video-prompt-set-retry-run',
        },
        source: 'assistant-panel',
        writer: null,
        toolCallId: 'video-prompt-set-retry-tool',
      },
      input: retryInput,
    })

    expect(retryPlan.tasks).toHaveLength(1)
    const retryTaskPlan = retryPlan.tasks[0]
    if (!retryTaskPlan) throw new Error('VIDEO_PROMPT_SET_RETRY_PLAN_REQUIRED')
    expect(retryTaskPlan.target).toEqual({
      targetType: 'CreativeResource',
      targetId: failedResourceId,
    })
    const originalPayload = creativeResourceGenerationTaskPayloadSchema.parse(failedTaskPlan.payload)
    const retryPayload = creativeResourceGenerationTaskPayloadSchema.parse(retryTaskPlan.payload)
    expect(retryPayload).toEqual({
      ...originalPayload,
      resource: {
        ...originalPayload.resource,
        executionSegmentId: null,
        toolCallId: 'video-prompt-set-retry-tool',
      },
    })
    expect(retryPlan.metadata).toMatchObject({
      retry: true,
      resources: [{
        resourceId: failedResourceId,
        sourceTaskId: failedTask.id,
      }],
    })
    await expect(prisma.task.findUniqueOrThrow({
      where: { id: completedTask.id },
      select: { status: true, targetId: true },
    })).resolves.toEqual({
      status: 'completed',
      targetId: completedResourceId,
    })
    await expect(prisma.creativeResource.findUniqueOrThrow({
      where: { id: completedResourceId },
      select: { status: true },
    })).resolves.toEqual({ status: 'ready' })
    await expect(prisma.task.count({
      where: {
        projectId: project.id,
        episodeId: episode.id,
        type: TASK_TYPE.CREATIVE_RESOURCE_VIDEO,
      },
    })).resolves.toBe(2)
  })
})
