import { randomUUID } from 'node:crypto'
import {
  OPERATION_EXECUTION_PROTOCOL,
  type DirectTaskOperationExecutionCommand,
} from '@/lib/temporal/operation-execution/contracts'
import { createProjectAgentOperationRegistryForApi } from '@/lib/operations/registry'
import { prisma } from '../../../helpers/prisma'

const OPERATION_ID = 'import_web_reference_image'

export interface OperationExecutionDurabilityFixture {
  readonly userId: string
  readonly projectId: string
  readonly threadId: string
  readonly originTurnId: string
  readonly command: DirectTaskOperationExecutionCommand
}

export async function createOperationExecutionDurabilityFixture():
Promise<OperationExecutionDurabilityFixture> {
  const suffix = randomUUID()
  const userId = `operation-durability-user-${suffix}`
  const projectId = `operation-durability-project-${suffix}`
  const threadId = `operation-durability-thread-${suffix}`
  const originTurnId = `operation-durability-turn-${suffix}`
  const registry = createProjectAgentOperationRegistryForApi()
  const operation = registry[OPERATION_ID]
  const authority = operation?.assistantWriteAuthority
  if (
    !operation
    || authority?.kind !== 'temporal_operation_execution'
    || authority.followUpPolicy !== 'after_all_terminal'
  ) {
    throw new Error('OPERATION_DURABILITY_REGISTRY_CONTRACT_MISSING')
  }
  const parsedInput = operation.inputSchema.safeParse({
    imageUrl: `https://example.test/${suffix}.png`,
    sourceWebsiteUrl: `https://example.test/${suffix}`,
    name: `Operation durability ${suffix}`,
    caption: 'Durable Operation execution fixture',
  })
  if (!parsedInput.success) {
    throw new Error('OPERATION_DURABILITY_INPUT_INVALID')
  }
  const normalizedInput = parsedInput.data

  await prisma.user.create({
    data: {
      id: userId,
      name: `Operation durability ${suffix}`,
      email: `operation-durability-${suffix}@example.com`,
      preferences: {
        create: {
          imageConcurrency: 1,
        },
      },
      projects: {
        create: {
          id: projectId,
          name: 'Operation durability project',
        },
      },
    },
  })
  await prisma.projectAssistantThread.create({
    data: {
      id: threadId,
      projectId,
      userId,
      assistantId: 'workspace-command',
      scopeRef: 'project',
      messagesJson: [],
      modelHistoryJson: [],
    },
  })
  await prisma.projectAgentTurn.create({
    data: {
      id: originTurnId,
      threadId,
      projectId,
      userId,
      sourceKind: 'user',
      sourceId: `operation-durability-source-${suffix}`,
      payloadHash: 'a'.repeat(64),
      requestId: `operation-durability-turn-${suffix}`,
      status: 'running',
      attempt: 1,
      executionOwnerId: `operation-durability-owner-${suffix}`,
      contextJson: {
        locale: 'en',
        episodeId: null,
        selectedScopeRef: null,
        selectedAssetId: null,
      },
      modelHistoryBaseVersion: 0,
      startedAt: new Date(),
    },
  })

  return {
    userId,
    projectId,
    threadId,
    originTurnId,
    command: {
      protocol: OPERATION_EXECUTION_PROTOCOL,
      kind: 'direct_task',
      executionId: `operation-durability-execution-${suffix}`,
      userId,
      projectId,
      operationId: OPERATION_ID,
      operationRequestId: `operation-durability-request-${suffix}`,
      source: 'assistant-panel',
      channel: 'tool',
      executionContractRevision: authority.contractRevision,
      context: {
        locale: 'en',
        episodeId: null,
        selectedScopeRef: null,
        selectedAssetId: null,
        origin: {
          kind: 'agent_turn',
          turnId: originTurnId,
          callId: `operation-durability-call-${suffix}`,
        },
      },
      normalizedInput,
    },
  }
}

export async function removeOperationExecutionDurabilityFixture(
  fixture: OperationExecutionDurabilityFixture,
): Promise<void> {
  await prisma.followUpBatch.deleteMany({
    where: { threadId: fixture.threadId },
  })
  await prisma.projectAssistantThread.deleteMany({
    where: { id: fixture.threadId },
  })
  await prisma.creativeResource.deleteMany({
    where: { projectId: fixture.projectId },
  })
  await prisma.task.deleteMany({
    where: {
      projectId: fixture.projectId,
      operationId: fixture.command.operationId,
    },
  })
  await prisma.operationExecution.deleteMany({
    where: {
      userId: fixture.userId,
      projectId: fixture.projectId,
      operationId: fixture.command.operationId,
    },
  })
  await prisma.project.deleteMany({
    where: { id: fixture.projectId },
  })
  await prisma.user.deleteMany({
    where: { id: fixture.userId },
  })
}
