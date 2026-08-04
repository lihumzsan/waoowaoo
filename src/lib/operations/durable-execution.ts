import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { hashCanonicalJson } from '@/lib/operation-plan-contract/canonical-json'
import { prisma } from '@/lib/prisma'
import { lockAgentTurnEffectFence } from '@/lib/agent-turn/effect-fence'
import type {
  DirectTaskOperationExecutionCommand,
  OperationExecutionCommandEnvelope,
} from '@/lib/temporal/operation-execution/contracts'

function toJson(value: unknown): Prisma.InputJsonValue {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) {
    throw new Error('OPERATION_EXECUTION_VALUE_NOT_JSON')
  }
  return JSON.parse(serialized) as Prisma.InputJsonValue
}

function buildDirectOperationExecutionRecordId(
  executionId: string,
): string {
  const normalized = executionId.trim()
  if (!normalized || normalized !== executionId) {
    throw new Error('OPERATION_EXECUTION_ID_INVALID')
  }
  return `opx_${createHash('sha256')
    .update(normalized, 'utf8')
    .digest('hex')
    .slice(0, 40)}`
}

function contextSnapshot(
  command: DirectTaskOperationExecutionCommand,
): Prisma.InputJsonValue {
  return toJson(command.context)
}

function assertStoredExecution(
  row: {
    id: string
    executionKind: string
    commandId: string | null
    payloadHash: string | null
    contractRevision: string | null
    normalizedInput: Prisma.JsonValue | null
    contextSnapshot: Prisma.JsonValue | null
    source: string | null
    userId: string
    scopeKind: string
    scopeId: string
    projectId: string | null
    operationId: string
    planSnapshotId: string | null
    approvalGrantId: string | null
    requestId: string
    status: string
    output: Prisma.JsonValue | null
  },
  envelope: OperationExecutionCommandEnvelope & {
    command: DirectTaskOperationExecutionCommand
  },
): void {
  const { command } = envelope
  if (
    row.id !== buildDirectOperationExecutionRecordId(command.executionId) ||
    row.executionKind !== 'direct_task' ||
    row.commandId !== envelope.commandId ||
    row.payloadHash !== envelope.payloadHash ||
    row.contractRevision !== command.executionContractRevision ||
    row.source !== command.source ||
    row.userId !== command.userId ||
    row.scopeKind !== 'project' ||
    row.scopeId !== command.projectId ||
    row.projectId !== command.projectId ||
    row.operationId !== command.operationId ||
    row.planSnapshotId !== null ||
    row.approvalGrantId !== null ||
    row.requestId !== command.operationRequestId ||
    (row.status !== 'executing' && row.status !== 'completed') ||
    row.normalizedInput === null ||
    hashCanonicalJson(row.normalizedInput) !==
      hashCanonicalJson(command.normalizedInput) ||
    row.contextSnapshot === null ||
    hashCanonicalJson(row.contextSnapshot) !==
      hashCanonicalJson(command.context) ||
    (row.status === 'completed' && row.output === null) ||
    (row.status === 'executing' && row.output !== null)
  ) {
    throw new Error(
      `OPERATION_EXECUTION_STORED_FACTS_DIVERGED:${command.executionId}`,
    )
  }
}

export interface DirectOperationExecutionState {
  operationExecutionId: string
  output: unknown
}

export async function executeDirectOperationTransaction(params: {
  envelope: OperationExecutionCommandEnvelope & {
    command: DirectTaskOperationExecutionCommand
  }
  execute(
    tx: Prisma.TransactionClient,
    operationExecutionId: string,
  ): Promise<unknown>
}): Promise<DirectOperationExecutionState> {
  const envelope = params.envelope
  const { command } = envelope
  const id = buildDirectOperationExecutionRecordId(command.executionId)
  return await prisma.$transaction(
    async (tx) => {
      const project =
        (
          await tx.$queryRaw<
            Array<{
              id: string
              userId: string
            }>
          >(Prisma.sql`
        SELECT id, userId
        FROM projects
        WHERE id = ${command.projectId}
        FOR UPDATE
      `)
        )[0] ?? null
      if (!project || project.userId !== command.userId) {
        throw new Error('OPERATION_EXECUTION_PROJECT_SCOPE_DIVERGED')
      }
      let row = await tx.operationExecution.findUnique({ where: { id } })
      if (!row && command.context.origin.kind === 'agent_turn') {
        await lockAgentTurnEffectFence(tx, {
          turnId: command.context.origin.turnId,
          projectId: command.projectId,
          userId: command.userId,
        })
      }
      if (!row) {
        row = await tx.operationExecution.create({
          data: {
            id,
            executionKind: 'direct_task',
            commandId: envelope.commandId,
            payloadHash: envelope.payloadHash,
            contractRevision: command.executionContractRevision,
            normalizedInput: toJson(command.normalizedInput),
            contextSnapshot: contextSnapshot(command),
            source: command.source,
            userId: command.userId,
            scopeKind: 'project',
            scopeId: command.projectId,
            projectId: command.projectId,
            operationId: command.operationId,
            planSnapshotId: null,
            approvalGrantId: null,
            requestId: command.operationRequestId,
            status: 'executing',
          },
        })
      }
      assertStoredExecution(row, envelope)
      if (row.status === 'completed') {
        return {
          operationExecutionId: row.id,
          output: row.output,
        }
      }

      const output = await params.execute(tx, row.id)
      const updated = await tx.operationExecution.updateMany({
        where: {
          id,
          status: 'executing',
          output: { equals: Prisma.DbNull },
        },
        data: {
          status: 'completed',
          output: toJson(output),
          completedAt: new Date(),
        },
      })
      if (updated.count !== 1) {
        throw new Error(`OPERATION_EXECUTION_COMMIT_RACED:${id}`)
      }
      row = await tx.operationExecution.findUnique({ where: { id } })
      if (!row) throw new Error(`OPERATION_EXECUTION_NOT_FOUND:${id}`)
      assertStoredExecution(row, envelope)
      if (
        row.output === null ||
        hashCanonicalJson(row.output) !== hashCanonicalJson(output)
      ) {
        throw new Error(`OPERATION_EXECUTION_OUTPUT_DIVERGED:${id}`)
      }
      return {
        operationExecutionId: row.id,
        output: row.output,
      }
    },
    {
      maxWait: 10_000,
      timeout: 120_000,
    },
  )
}
