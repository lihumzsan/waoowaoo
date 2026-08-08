import { randomUUID } from 'node:crypto'
import {
  OPERATION_EXECUTION_PROTOCOL,
  type DirectTaskOperationExecutionCommand,
} from '@/lib/temporal/operation-execution/contracts'
import { createProjectAgentOperationRegistryForApi } from '@/lib/operations/registry'
import { ensureMediaObjectFromStorageKey } from '@/lib/media/service'
import type { WorkspaceResourceInputRef } from '@/lib/workspace-resource/contracts'
import { buildWorkspaceResourceId } from '@/lib/workspace-resource/identity'
import {
  materializeWorkspaceResourceInTransaction,
  reserveWorkspaceResourceInTransaction,
} from '@/lib/workspace-resource/persistence'
import { WORKSPACE_RESOURCE_SCHEMA } from '@/lib/workspace-resource/schema-registry'
import { prisma } from '../../../helpers/prisma'

const OPERATION_ID = 'merge_videos'

export interface OperationExecutionDurabilityFixture {
  readonly userId: string
  readonly projectId: string
  readonly threadId: string
  readonly originTurnId: string
  readonly mediaObjectIds: readonly string[]
  readonly command: DirectTaskOperationExecutionCommand
}

async function seedVideoInputs(input: {
  readonly suffix: string
  readonly userId: string
  readonly projectId: string
}) {
  const media = await Promise.all([0, 1].map(async (index) => (
    await ensureMediaObjectFromStorageKey(
      `tests/temporal/operation-durability/${input.suffix}-${String(index)}.mp4`,
      {
        mimeType: 'video/mp4',
        sizeBytes: 1,
        width: 1,
        height: 1,
        durationMs: 1_000,
      },
    )
  )))
  const resources = await prisma.$transaction(async (tx) => {
    const created: WorkspaceResourceInputRef[] = []
    for (const [index, mediaObject] of media.entries()) {
      const resourceId = buildWorkspaceResourceId({
        operationId: 'operation_durability_source',
        requestId: input.suffix,
        memberIndex: index,
      })
      const workspacePath = `operation-durability-${input.suffix}-${String(index)}`
      await reserveWorkspaceResourceInTransaction(tx, {
        resourceId,
        userId: input.userId,
        projectId: input.projectId,
        outputPath: workspacePath,
        mediaType: 'video',
        schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_VIDEO,
        sourceType: 'temporal_test_fixture',
        sourceId: `${input.suffix}:${String(index)}`,
      })
      await materializeWorkspaceResourceInTransaction(tx, {
        resourceId,
        userId: input.userId,
        projectId: input.projectId,
        mediaType: 'video',
        schemaId: WORKSPACE_RESOURCE_SCHEMA.GENERIC_VIDEO,
        content: { kind: 'media', mediaId: mediaObject.id },
        inputs: [],
        provenance: {
          operationId: null,
          inputHash: null,
          taskId: null,
          operationExecutionId: null,
          toolCallId: null,
          prompt: null,
          modelKey: null,
          generationOptions: null,
        },
      })
      created.push({
        resourceId,
        contentVersion: 1,
        workspacePath,
        role: 'source_video' as const,
        position: index,
      })
    }
    return created
  })
  return { resources, mediaObjectIds: media.map((item) => item.id) }
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
  await prisma.user.create({
    data: {
      id: userId,
      name: `Operation durability ${suffix}`,
      email: `operation-durability-${suffix}@example.com`,
      preferences: {
        create: {
          imageConcurrency: 1,
          videoConcurrency: 1,
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
  const seededInputs = await seedVideoInputs({ suffix, userId, projectId })
  const parsedInput = operation.inputSchema.safeParse({
    folderPath: null,
    name: `Operation durability output ${suffix}`,
    videos: seededInputs.resources.map(({ resourceId, contentVersion }) => ({
      resourceId,
      contentVersion,
    })),
  })
  if (!parsedInput.success) {
    throw new Error('OPERATION_DURABILITY_INPUT_INVALID')
  }
  const normalizedInput = parsedInput.data
  await prisma.projectAssistantThread.create({
    data: {
      id: threadId,
      projectId,
      userId,
      assistantId: 'workspace-command',
      messagesJson: [],
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
        selectedScopeRef: null,
        selectedAssetId: null,
      },
      startedAt: new Date(),
    },
  })

  return {
    userId,
    projectId,
    threadId,
    originTurnId,
    mediaObjectIds: seededInputs.mediaObjectIds,
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
  await prisma.workspaceResource.deleteMany({
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
  await prisma.mediaObject.deleteMany({
    where: { id: { in: [...fixture.mediaObjectIds] } },
  })
}
