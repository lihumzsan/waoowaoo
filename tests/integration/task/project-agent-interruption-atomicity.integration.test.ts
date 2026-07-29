import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import { NextRequest } from 'next/server'
import { prisma } from '../../helpers/prisma'
import { resetBillingState } from '../../helpers/db-reset'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { createProjectAgentUserTurnRun } from '@/lib/project-agent/runs'
import {
  prepareProjectAgentApprovalExecutionHandoff,
  prepareProjectAgentChoiceExecutionHandoff,
  settleProjectAgentPreparedApprovalHandoff,
  settleProjectAgentPreparedChoiceHandoff,
} from '@/lib/project-agent/execution-handoff'
import { createProjectAgentRunFence } from '@/lib/project-agent/run-fence'
import {
  consumeProjectAgentChoiceInterruption,
  readRetryableConsumedProjectAgentChoiceInterruption,
} from '@/lib/project-agent/interruptions'
import { resolveProjectAgentChoiceSubject } from '@/lib/project-agent/choice-offer'
import {
  buildDomainCreativeResourceId,
  CREATIVE_RESOURCE_SCHEMA,
} from '@/lib/creative-resource'
import { CREATIVE_WORK_TASK_PROTOCOL } from '@/lib/creative-worker'
import { TASK_TYPE } from '@/lib/task/types'
import { buildReadyProjectAgentModelHistoryCommit } from './project-agent-model-history.fixture'

const TEST_PREFIX = 'interruption-atomicity:'

async function settleApprovalHandoff(
  input: Omit<Parameters<typeof prepareProjectAgentApprovalExecutionHandoff>[0], 'executionSegmentId'> & {
    message: UIMessage
  },
) {
  const { message, ...prepareInput } = input
  const handoff = await prepareProjectAgentApprovalExecutionHandoff({
    ...prepareInput,
    executionSegmentId: `test-approval:${input.approvalId}`,
  })
  const modelHistoryCommit = await buildReadyProjectAgentModelHistoryCommit({
    projectId: input.projectId,
    userId: input.userId,
    episodeId: input.episodeId ?? null,
    assistantId: input.assistantId ?? 'workspace-command',
  }, handoff.executionSegmentId)
  return await settleProjectAgentPreparedApprovalHandoff({
    executionFence: input.executionFence,
    handoff,
    projectId: input.projectId,
    userId: input.userId,
    episodeId: input.episodeId ?? null,
    assistantId: input.assistantId,
    message,
    modelHistoryCommit,
  })
}

function styleTaskPayload(runId: string, toolCallId: string) {
  return {
    protocol: CREATIVE_WORK_TASK_PROTOCOL,
    requestKey: `${TEST_PREFIX}style-request`,
    request: {
      outputKind: 'creative_direction',
      goal: 'Create a visual direction.',
      context: {
        userRequest: 'Create a restrained visual direction.',
        sourceMaterials: [],
        constraints: [],
      },
      creativeDirection: null,
      productionContext: { video: null },
    },
    modelKey: 'golden:creative-model',
    inputFingerprint: 'a'.repeat(64),
    origin: { runId, toolCallId },
    lifecycleProjection: {
      requestKey: `${TEST_PREFIX}style-request`,
      outputKind: 'creative_direction',
      goal: 'Create a visual direction.',
      events: [],
    },
  }
}

async function seedGenericStyleChoice(params: { validCommitment: boolean }) {
  const user = await createTestUser()
  const project = await createTestProject(user.id)
  const episode = await prisma.projectEpisode.create({
    data: {
      projectId: project.id,
      episodeNumber: 1,
      name: 'Atomic generic Choice',
    },
  })
  const runId = `${TEST_PREFIX}choice-run:${episode.id}`
  const toolCallId = `${TEST_PREFIX}choice-tool:${episode.id}`
  const { run } = await createProjectAgentUserTurnRun({
    runId,
    requestId: `${TEST_PREFIX}choice-request:${episode.id}`,
    projectId: project.id,
    userId: user.id,
    episodeId: episode.id,
    assistantId: 'workspace-command',
    message: {
      id: `${TEST_PREFIX}choice-user-message:${episode.id}`,
      role: 'user',
      parts: [{ type: 'text', text: '选择当前视觉方向' }],
    },
  })
  const task = await prisma.task.create({
    data: {
      userId: user.id,
      projectId: project.id,
      episodeId: episode.id,
      type: TASK_TYPE.CREATIVE_WORK,
      targetType: 'CreativeWork',
      targetId: `${TEST_PREFIX}style-work:${episode.id}`,
      status: 'completed',
      operationId: 'creative_work',
      payload: styleTaskPayload(run.id, toolCallId),
      result: {},
      finishedAt: new Date(),
    },
  })
  const resource = await prisma.creativeResource.create({
    data: {
      id: buildDomainCreativeResourceId({
        sourceType: 'CreativeWorkResult',
        sourceId: `${task.id}:restrained`,
      }),
      userId: user.id,
      projectId: project.id,
      episodeId: null,
      scopeKind: 'project',
      scopeId: project.id,
      mediaType: 'text',
      schemaId: CREATIVE_RESOURCE_SCHEMA.CREATIVE_DIRECTION,
      name: 'Restrained visual direction',
      status: 'ready',
      sourceType: 'CreativeWorkResult',
      sourceId: `${task.id}:restrained`,
      candidateSetId: null,
      candidateIndex: 0,
      contentJson: {
        rawUserStyle: null,
        styleSummary: 'Restrained monochrome realism',
        visual: {
          visualStyle: 'Quiet, observational, low-saturation realism.',
          assetImageStyle: {
            lighting: 'Soft overcast daylight with restrained contrast.',
            texture: 'Natural film grain and tactile practical surfaces.',
          },
        },
        narrative: 'Reveal facts through restrained observation.',
        directing: 'Prefer locked frames and motivated movement.',
        editing: 'Use measured hard cuts.',
        sound: 'Preserve natural room tone and deliberate silence.',
        assetPolicy: 'Keep identities realistic, stable, and free of decorative styling.',
      },
      modelKey: 'golden:creative-model',
      operationId: 'creative_work',
      inputHash: 'a'.repeat(64),
      taskId: task.id,
      executionSegmentId: `segment:${episode.id}`,
      toolCallId,
      materializedAt: new Date(),
    },
  })

  const currentRun = await prisma.projectAgentRun.findUniqueOrThrow({
    where: { id: run.id },
    select: { id: true, runVersion: true, eventSeq: true },
  })
  const runFence = createProjectAgentRunFence(currentRun)
  const card = {
    cardId: `${TEST_PREFIX}choice-card:${episode.id}`,
    toolCallId,
    mode: 'select' as const,
    replyMode: 'none' as const,
    title: '选择当前视觉方向',
    description: '这个选择只采用当前 Creative Direction。',
    groups: [{
      key: 'style',
      label: '视觉方向',
      required: true,
      presentation: 'options' as const,
      options: [{ value: resource.id, label: '克制写实' }],
    }],
    submitLabel: '采用这个方向',
  }
  const commitments = [{
    when: { kind: 'option' as const, groupKey: 'style', optionValue: resource.id },
    operationId: 'adopt_creative_direction',
    input: {
      resourceId: params.validCommitment ? resource.id : `${resource.id}:missing`,
      expectedVersion: null,
    },
  }]
  const subject = await prisma.$transaction(async (tx) => await resolveProjectAgentChoiceSubject({
    tx,
    projectId: project.id,
    userId: user.id,
    request: {
      kind: 'resources',
      resources: [{ resourceId: resource.id }],
    },
    card,
    commitments,
  }))
  const executionFence = { runFence, signal: new AbortController().signal }
  const prepared = await prepareProjectAgentChoiceExecutionHandoff({
    executionFence,
    executionSegmentId: `${TEST_PREFIX}choice-segment:${episode.id}`,
    projectId: project.id,
    userId: user.id,
    episodeId: episode.id,
    assistantId: 'workspace-command',
    operationId: 'request_choice',
    toolCallId,
    card,
    subject,
    commitments,
    modelArguments: {
      subject: {
        kind: 'resources',
        resources: [{ resourceId: resource.id }],
      },
      card: {
        kind: 'select_with_actions',
        title: card.title,
        description: card.description,
      },
    },
  })
  const suspension = await settleProjectAgentPreparedChoiceHandoff({
    executionFence,
    handoff: prepared,
    projectId: project.id,
    userId: user.id,
    episodeId: episode.id,
    assistantId: 'workspace-command',
    message: {
      id: `${TEST_PREFIX}choice-assistant-message:${episode.id}`,
      role: 'assistant',
      parts: [{ type: 'text', text: '请选择当前视觉方向。' }],
    },
    modelHistoryCommit: await buildReadyProjectAgentModelHistoryCommit({
      projectId: project.id,
      userId: user.id,
      episodeId: episode.id,
      assistantId: 'workspace-command',
    }, prepared.executionSegmentId),
  })
  if (suspension.kind !== 'choice') throw new Error('EXPECTED_CHOICE_SUSPENSION')
  return { user, project, episode, resource, run, card: suspension.card, interruptionId: suspension.interruptionId }
}

describe('Project Agent interruption atomic replacement DB integration', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  afterEach(async () => {
    await resetBillingState()
  })

  it('replaces a pending approval without accepting an arbitrary predecessor Activity', async () => {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const { run } = await createProjectAgentUserTurnRun({
      runId: `${TEST_PREFIX}run`,
      requestId: `${TEST_PREFIX}request`,
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
      message: {
        id: `${TEST_PREFIX}message`,
        role: 'user',
        parts: [{ type: 'text', text: 'start' }],
      },
    })
    const firstSuspension = await settleApprovalHandoff({
      executionFence: {
        runFence: {
          runId: run.id,
          runVersion: run.runVersion,
          eventSeq: run.eventSeq,
        },
        signal: new AbortController().signal,
      },
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
      operationId: 'create_image',
      approvalId: `${TEST_PREFIX}approval-first`,
      toolCallId: `${TEST_PREFIX}tool-first`,
      runState: '{"checkpoint":"first"}',
      message: {
        id: `${TEST_PREFIX}assistant-first`,
        role: 'assistant',
        parts: [{ type: 'text', text: 'first approval' }],
      },
    })
    if (firstSuspension.kind !== 'approval') throw new Error('EXPECTED_APPROVAL_SUSPENSION')
    const firstInterruptionId = firstSuspension.interruptionId
    const firstInterruption = await prisma.projectAgentInterruption.findUniqueOrThrow({
      where: { id: firstInterruptionId },
      select: { activityId: true, status: true },
    })
    const currentRun = await prisma.projectAgentRun.findUniqueOrThrow({
      where: { id: run.id },
      select: { runVersion: true, eventSeq: true },
    })
    const eventCountBefore = await prisma.projectAgentEvent.count({ where: { runId: run.id } })

    const replacement = await settleApprovalHandoff({
      executionFence: {
        runFence: {
          runId: run.id,
          runVersion: currentRun.runVersion,
          eventSeq: currentRun.eventSeq.toString(),
        },
        signal: new AbortController().signal,
      },
      projectId: project.id,
      userId: user.id,
      assistantId: 'workspace-command',
      operationId: 'create_image',
      approvalId: `${TEST_PREFIX}approval-replacement`,
      toolCallId: `${TEST_PREFIX}tool-replacement`,
      runState: '{"checkpoint":"replacement"}',
      message: {
        id: `${TEST_PREFIX}assistant-replacement`,
        role: 'assistant',
        parts: [{ type: 'text', text: 'replacement approval' }],
      },
    })
    if (replacement.kind !== 'approval') throw new Error('EXPECTED_APPROVAL_SUSPENSION')

    expect(await prisma.projectAgentInterruption.findMany({
      where: { runId: run.id },
      select: { id: true, status: true },
      orderBy: { id: 'asc' },
    })).toEqual([
      { id: firstInterruptionId, status: 'superseded' },
      { id: replacement.interruptionId, status: 'pending' },
    ].sort((left, right) => left.id.localeCompare(right.id)))
    expect(await prisma.projectAgentActivity.findUnique({
      where: { id: firstInterruption.activityId ?? '' },
      select: { status: true },
    })).toEqual({ status: 'cancelled' })
    expect(await prisma.projectAgentEvent.count({ where: { runId: run.id } }))
      .toBe(eventCountBefore + 2)
  })

  it('atomically consumes a generic Choice and commits its one mapped current Operation once', async () => {
    const seeded = await seedGenericStyleChoice({ validCommitment: true })
    const request = new NextRequest(`http://localhost/api/projects/${seeded.project.id}/assistant/chat`)
    const consumeInput = {
      request,
      projectId: seeded.project.id,
      userId: seeded.user.id,
      episodeId: seeded.episode.id,
      assistantId: 'workspace-command' as const,
      runId: seeded.run.id,
      interruptionId: seeded.interruptionId,
      cardId: seeded.card.cardId,
      toolCallId: seeded.card.toolCallId,
      response: {
        kind: 'select',
        selections: [{ groupKey: 'style', kind: 'option', value: seeded.resource.id }],
      } as const,
      operationSignal: new AbortController().signal,
      locale: 'zh',
    }

    const consumed = await consumeProjectAgentChoiceInterruption(consumeInput)
    expect(consumed?.appliedOperationId).toBe('adopt_creative_direction')
    await expect(prisma.creativeResourceBinding.findFirstOrThrow({
      where: {
        projectId: seeded.project.id,
        role: 'adopted_creative_direction',
        slotKey: 'primary',
      },
      select: { resourceId: true },
    })).resolves.toEqual({ resourceId: seeded.resource.id })
    await expect(prisma.projectAgentInterruption.findUniqueOrThrow({
      where: { id: seeded.interruptionId },
      select: { status: true },
    })).resolves.toEqual({ status: 'consumed' })
    expect(await prisma.projectAgentActivity.findMany({
      where: {
        runId: seeded.run.id,
        operationId: 'adopt_creative_direction',
        sourceOperationId: 'request_choice',
      },
      select: { status: true },
    })).toEqual([{ status: 'completed' }])
    await expect(consumeProjectAgentChoiceInterruption(consumeInput)).resolves.toBeNull()
    await expect(readRetryableConsumedProjectAgentChoiceInterruption(consumeInput)).resolves.toMatchObject({
      id: seeded.interruptionId,
      status: 'consumed',
      appliedOperationId: 'adopt_creative_direction',
    })
    expect(await prisma.projectAgentActivity.count({
      where: { runId: seeded.run.id, operationId: 'adopt_creative_direction' },
    })).toBe(1)
  })

  it('rolls back the Choice, Activity, and execution segment when its frozen commitment fails', async () => {
    const seeded = await seedGenericStyleChoice({ validCommitment: false })
    const request = new NextRequest(`http://localhost/api/projects/${seeded.project.id}/assistant/chat`)

    await expect(consumeProjectAgentChoiceInterruption({
      request,
      projectId: seeded.project.id,
      userId: seeded.user.id,
      episodeId: seeded.episode.id,
      assistantId: 'workspace-command',
      runId: seeded.run.id,
      interruptionId: seeded.interruptionId,
      cardId: seeded.card.cardId,
      toolCallId: seeded.card.toolCallId,
      response: {
        kind: 'select',
        selections: [{ groupKey: 'style', kind: 'option', value: seeded.resource.id }],
      },
      operationSignal: new AbortController().signal,
      locale: 'zh',
    })).rejects.toThrow()

    await expect(prisma.creativeResourceBinding.findFirst({
      where: { projectId: seeded.project.id, role: 'adopted_creative_direction' },
    })).resolves.toBeNull()
    await expect(prisma.projectAgentInterruption.findUniqueOrThrow({
      where: { id: seeded.interruptionId },
      select: { status: true },
    })).resolves.toEqual({ status: 'pending' })
    expect(await prisma.projectAgentActivity.count({
      where: { runId: seeded.run.id, operationId: 'adopt_creative_direction' },
    })).toBe(0)
    expect(await prisma.projectAgentEvent.count({
      where: {
        runId: seeded.run.id,
        idempotencyKey: { startsWith: 'run-execution-started:decision:' },
      },
    })).toBe(0)
    await expect(prisma.projectAgentRun.findUniqueOrThrow({
      where: { id: seeded.run.id },
      select: { status: true },
    })).resolves.toEqual({ status: 'awaiting_choice' })
  })
})
