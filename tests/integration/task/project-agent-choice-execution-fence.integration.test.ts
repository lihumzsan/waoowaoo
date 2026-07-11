import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetBillingState } from '../../helpers/db-reset'
import {
  createFixtureEpisode,
  createFixtureProject,
  createFixtureUser,
} from '../../helpers/fixtures'
import { invokeProjectAgentOperation } from '@/lib/operations/invocation'
import { createProjectAgentRun } from '@/lib/project-agent/runs'
import { createProjectAgentOperationRegistry } from '@/lib/operations/registry'
import { prisma } from '../../helpers/prisma'

const PREFIX = 'choice-execution-fence-integration:'

vi.mock('@/lib/project-agent/script-intake', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/project-agent/script-intake')>()
  return {
    ...actual,
    planScriptIntakeQuestions: vi.fn(async () => ({
      questions: [{
        key: 'subgenre',
        label: '恐怖类型',
        options: [
          { value: 'folk_horror', label: '民俗恐怖', description: '仪式和禁忌推动恐惧。' },
          { value: 'psychological_horror', label: '心理恐怖', description: '认知和压迫感推动恐惧。' },
        ],
      }, {
        key: 'pace',
        label: '叙事节奏',
        options: [
          { value: 'slow_burn', label: '慢热压迫', description: '逐步积累不安。' },
          { value: 'reversal_driven', label: '反转驱动', description: '用连续反转推动剧情。' },
        ],
      }],
    })),
  }
})

describe('Project Agent Choice execution fence DB integration', () => {
  beforeEach(async () => {
    await resetBillingState()
  })

  afterEach(async () => {
    await resetBillingState()
  })

  it('prepares a durable Choice handoff without treating awaiting_choice as an operation fence outcome', async () => {
    const user = await createFixtureUser()
    const project = await createFixtureProject(user.id)
    const episode = await createFixtureEpisode(project.id)
    const run = await createProjectAgentRun({
      projectId: project.id,
      userId: user.id,
      episodeId: episode.id,
      requestId: `${PREFIX}request`,
      controlKind: 'user_turn',
    })
    const controller = new AbortController()
    const executionFence = {
      runFence: {
        runId: run.id,
        runVersion: run.runVersion,
        eventSeq: run.eventSeq,
      },
      signal: controller.signal,
    }
    const registry = createProjectAgentOperationRegistry()

    await expect(invokeProjectAgentOperation({
      registry,
      channel: 'tool',
      operationId: 'request_script_intake_choice',
      context: {
        request: new Request('http://localhost') as never,
        userId: user.id,
        projectId: project.id,
        context: {
          runId: run.id,
          runFence: executionFence.runFence,
          executionSegmentId: `user-turn:${run.id}`,
          episodeId: episode.id,
          locale: 'zh',
        },
        source: 'assistant-panel',
        writer: null,
        toolCallId: 'tool-choice-1',
        executionFence,
      },
      input: { seedText: '恐怖故事' },
    })).resolves.toMatchObject({
      kind: 'executed',
      data: { emitted: true, choiceType: 'script_intake' },
      choiceHandoff: {
        kind: 'choice',
        runId: run.id,
        operationId: 'request_script_intake_choice',
        toolCallId: 'tool-choice-1',
      },
    })

    const [persistedRun, interruptions, activities, handoffs] = await Promise.all([
      prisma.projectAgentRun.findUniqueOrThrow({
        where: { id: run.id },
        select: { status: true, runVersion: true, eventSeq: true },
      }),
      prisma.projectAgentInterruption.findMany({
        where: { runId: run.id },
        select: { status: true, operationId: true, toolCallId: true },
      }),
      prisma.projectAgentActivity.findMany({
        where: { runId: run.id },
        select: { status: true, type: true, operationId: true, toolCallId: true },
      }),
      prisma.projectAgentExecutionHandoff.findMany({
        where: { runId: run.id },
        select: { status: true, kind: true, operationId: true, executionSegmentId: true },
      }),
    ])
    expect(persistedRun).toMatchObject({
      status: 'running',
      runVersion: executionFence.runFence.runVersion,
      eventSeq: BigInt(executionFence.runFence.eventSeq),
    })
    expect(interruptions).toEqual([])
    expect(activities).toEqual([])
    expect(handoffs).toEqual([{
      status: 'prepared',
      kind: 'choice',
      operationId: 'request_script_intake_choice',
      executionSegmentId: `user-turn:${run.id}`,
    }])
  })
})
