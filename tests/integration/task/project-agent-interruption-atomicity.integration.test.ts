import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
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
import { resolveStyleChoiceResource } from '@/lib/project-agent/choice-offer'
import { buildZenStyleBibleFixture } from '../../fixtures/edit-script-style-bible'

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
  return await settleProjectAgentPreparedApprovalHandoff({
    executionFence: input.executionFence,
    handoff,
    projectId: input.projectId,
    userId: input.userId,
    episodeId: input.episodeId ?? null,
    assistantId: input.assistantId,
    message,
  })
}

async function seedStyleChoice(params: { imageKey: string | null }) {
  const user = await createTestUser()
  const project = await createTestProject(user.id)
  await prisma.project.update({
    where: { id: project.id },
    data: { videoRatio: '16:9' },
  })
  const episode = await prisma.projectEpisode.create({
    data: {
      projectId: project.id,
      episodeNumber: 1,
      name: 'Atomic style confirmation',
    },
  })
  const source = await prisma.projectEpisodeSourceDocument.create({
    data: {
      episodeId: episode.id,
      normalizedText: '阿杰走进密室。',
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
  const styleBible = buildZenStyleBibleFixture()
  const preview = await prisma.projectEditStylePreview.create({
    data: {
      projectId: project.id,
      episodeId: episode.id,
      editBibleId: bible.id,
      styleKey: 'style_a',
      aspectRatio: '16:9',
      title: '暗黑写实风格',
      summary: '冷灰绿调与手持镜头。',
      styleBibleJson: styleBible as unknown as Prisma.InputJsonValue,
      imagePrompt: 'dark realistic room',
      imageKey: params.imageKey,
      status: 'completed',
    },
  })
  const { run } = await createProjectAgentUserTurnRun({
    runId: `${TEST_PREFIX}style-run:${preview.id}`,
    requestId: `${TEST_PREFIX}style-request:${preview.id}`,
    projectId: project.id,
    userId: user.id,
    episodeId: episode.id,
    assistantId: 'workspace-command',
    message: {
      id: `${TEST_PREFIX}style-user-message:${preview.id}`,
      role: 'user',
      parts: [{ type: 'text', text: '生成恐怖短片' }],
    },
  })
  const currentRun = await prisma.projectAgentRun.findUniqueOrThrow({
    where: { id: run.id },
    select: { id: true, runVersion: true, eventSeq: true },
  })
  const runFence = createProjectAgentRunFence(currentRun)
  const toolCallId = `${TEST_PREFIX}style-tool:${preview.id}`
  const card = {
    cardId: `${TEST_PREFIX}style-card:${preview.id}`,
    toolCallId,
    choiceType: 'style' as const,
    replyMode: 'whole_card' as const,
    title: '选择视觉风格',
    groups: [{
      key: 'stylePreviewId',
      label: '视觉风格',
      required: true,
      presentation: 'image' as const,
      options: [{ value: preview.id, label: preview.title }],
    }],
    submitLabel: '确认并继续',
    submit: { kind: 'submit_tool_output' as const, decision: 'select' as const },
  }
  const reviewedResource = await prisma.$transaction(async (tx) => await resolveStyleChoiceResource({
    tx,
    projectId: project.id,
    userId: user.id,
    episodeId: episode.id,
    card: {
      ...card,
      runId: run.id,
      interruptionId: 'pending',
    },
  }))
  const executionFence = {
    runFence,
    signal: new AbortController().signal,
  }
  const prepared = await prepareProjectAgentChoiceExecutionHandoff({
    executionFence,
    executionSegmentId: `${TEST_PREFIX}style-segment:${preview.id}`,
    projectId: project.id,
    userId: user.id,
    episodeId: episode.id,
    assistantId: 'workspace-command',
    operationId: 'request_edit_style_choice',
    toolCallId,
    card,
    reviewedResource,
  })
  const suspension = await settleProjectAgentPreparedChoiceHandoff({
    executionFence,
    handoff: prepared,
    projectId: project.id,
    userId: user.id,
    episodeId: episode.id,
    assistantId: 'workspace-command',
    message: {
      id: `${TEST_PREFIX}style-assistant-message:${preview.id}`,
      role: 'assistant',
      parts: [{ type: 'text', text: '请选择视觉风格。' }],
    },
  })
  if (suspension.kind !== 'choice') throw new Error('EXPECTED_CHOICE_SUSPENSION')
  return { user, project, episode, preview, run, card: suspension.card, interruptionId: suspension.interruptionId }
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
      operationId: 'generate_edit_style_previews',
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
      operationId: 'generate_edit_style_previews',
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

  it('atomically consumes a style Choice and commits its mapped confirmation Operation once', async () => {
    const seeded = await seedStyleChoice({ imageKey: 'tests/style-preview.png' })
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
      response: { stylePreviewId: seeded.preview.id },
      latestUserText: '确认这个视觉风格',
      operationSignal: new AbortController().signal,
      locale: 'zh',
    }

    const consumed = await consumeProjectAgentChoiceInterruption(consumeInput)
    expect(consumed?.appliedOperationId).toBe('confirm_edit_style_preview')
    await expect(prisma.projectEditStylePreview.findUniqueOrThrow({
      where: { id: seeded.preview.id },
      select: { status: true },
    })).resolves.toEqual({ status: 'confirmed' })
    await expect(prisma.projectAgentInterruption.findUniqueOrThrow({
      where: { id: seeded.interruptionId },
      select: { status: true },
    })).resolves.toEqual({ status: 'consumed' })
    expect(await prisma.projectAgentActivity.findMany({
      where: {
        runId: seeded.run.id,
        operationId: 'confirm_edit_style_preview',
        sourceOperationId: 'request_edit_style_choice',
      },
      select: { status: true, choiceType: true },
    })).toEqual([{ status: 'completed', choiceType: 'style' }])
    await expect(prisma.projectAgentRun.findUniqueOrThrow({
      where: { id: seeded.run.id },
      select: { status: true, controlKind: true },
    })).resolves.toEqual({ status: 'running', controlKind: 'user_turn' })
    await expect(prisma.projectAgentEvent.findFirst({
      where: {
        runId: seeded.run.id,
        kind: 'run.execution_started',
        idempotencyKey: `run-execution-started:decision:${seeded.interruptionId}`,
      },
      select: { payload: true },
    })).resolves.toMatchObject({
      payload: expect.objectContaining({
        controlKind: 'choice_response',
        executionSegmentId: `decision:${seeded.interruptionId}`,
      }),
    })
    await expect(consumeProjectAgentChoiceInterruption(consumeInput)).resolves.toBeNull()
    await expect(readRetryableConsumedProjectAgentChoiceInterruption(consumeInput)).resolves.toMatchObject({
      id: seeded.interruptionId,
      status: 'consumed',
      appliedOperationId: 'confirm_edit_style_preview',
    })
    expect(await prisma.projectAgentActivity.count({
      where: { runId: seeded.run.id, operationId: 'confirm_edit_style_preview' },
    })).toBe(1)
  })

  it('rolls back Choice consumption, confirmation state, Activity and execution segment when the Operation fails', async () => {
    const seeded = await seedStyleChoice({ imageKey: null })
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
      response: { stylePreviewId: seeded.preview.id },
      latestUserText: '确认这个视觉风格',
      operationSignal: new AbortController().signal,
      locale: 'zh',
    })).rejects.toThrow('Selected edit style preview image is missing')

    await expect(prisma.projectEditStylePreview.findUniqueOrThrow({
      where: { id: seeded.preview.id },
      select: { status: true },
    })).resolves.toEqual({ status: 'completed' })
    await expect(prisma.projectAgentInterruption.findUniqueOrThrow({
      where: { id: seeded.interruptionId },
      select: { status: true },
    })).resolves.toEqual({ status: 'pending' })
    expect(await prisma.projectAgentActivity.count({
      where: { runId: seeded.run.id, operationId: 'confirm_edit_style_preview' },
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
