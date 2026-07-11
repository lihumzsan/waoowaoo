import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { z } from 'zod'

import type { UIMessage, UIMessageStreamWriter } from 'ai'

import type { NextRequest } from 'next/server'

import { ApiError } from '@/lib/api-errors'

import type { ProjectAgentOperationRegistry } from '@/lib/operations/types'

import { makeTestOperation, EFFECTS_NONE, EFFECTS_WRITE } from '../../helpers/project-agent-operations'

import { TASK_TYPE } from '@/lib/task/types'

import type { OperationPlan } from '@/lib/operations/planning'

const registryState = vi.hoisted(() => ({
  registry: {} as ProjectAgentOperationRegistry,
}))

vi.mock('@/lib/operations/registry', () => ({
  createProjectAgentOperationRegistry: () => registryState.registry,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(async (work: (transaction: Record<string, never>) => Promise<unknown>) =>
      await work({})),
  },
}))

vi.mock('@/lib/project-agent/operation-execution-fence', () => ({
  assertProjectAgentOperationExecutionFenceCurrent: vi.fn(async () => undefined),
  requireProjectAgentChoiceHandoffReceipt: vi.fn(() => ({
    kind: 'choice',
    handoffId: 'handoff-choice',
    executionSegmentId: 'user-turn:run-test',
    runId: 'run-test',
    operationId: 'choice_op',
    toolCallId: 'tool-choice',
  })),
  requireProjectAgentSuspensionReceipt: vi.fn(() => ({
    kind: 'choice',
    runId: 'run-test',
    operationId: 'choice_op',
    activityId: 'activity-choice',
    interruptionId: 'interruption-choice',
    cardId: 'card-choice',
    toolCallId: 'tool-choice',
    choiceType: 'script_intake',
    card: {},
  })),
  assertProjectAgentOperationExecutionFenceInTransaction: vi.fn(async () => undefined),
  runWithProjectAgentOperationExecutionFence: vi.fn(async (
    _fence: unknown,
    work: () => Promise<unknown>,
  ) => await work()),
}))

import {
  executeProjectAgentOperationFromTool as executeProjectAgentOperationFromToolAuthority,
} from '@/lib/adapters/tools/execute-project-agent-operation'

type ToolInvocation = Parameters<typeof executeProjectAgentOperationFromToolAuthority>[0]

async function executeProjectAgentOperationFromTool(
  params: Omit<ToolInvocation, 'executionFence'>,
) {
  return await executeProjectAgentOperationFromToolAuthority({
    ...params,
    executionFence: {
      runFence: { runId: 'run-test', runVersion: 1, eventSeq: '1' },
      signal: new AbortController().signal,
    },
  })
}

const originalDeploymentEdition = process.env.DEPLOYMENT_EDITION

const originalBillingMode = process.env.BILLING_MODE

function buildWriter() {
  return {
    write: vi.fn(),
    merge: vi.fn(),
    onError: vi.fn(),
  } as unknown as UIMessageStreamWriter<UIMessage>
}

function buildRequest(): NextRequest {
  return new Request('http://localhost') as unknown as NextRequest
}

export { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
export { z } from 'zod'
export type { UIMessage, UIMessageStreamWriter } from 'ai'
export type { NextRequest } from 'next/server'
export { ApiError } from '@/lib/api-errors'
export type { ProjectAgentOperationRegistry } from '@/lib/operations/types'
export { makeTestOperation, EFFECTS_NONE, EFFECTS_WRITE } from '../../helpers/project-agent-operations'
export { TASK_TYPE } from '@/lib/task/types'
export type { OperationPlan } from '@/lib/operations/planning'
export { buildRequest, buildWriter, executeProjectAgentOperationFromTool, originalBillingMode, originalDeploymentEdition, registryState }
