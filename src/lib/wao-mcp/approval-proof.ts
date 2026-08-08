import { prisma } from '@/lib/prisma'
import { lockAgentTurnEffectFence } from '@/lib/agent-turn/effect-fence'
import {
  issueApprovalGrantGroupInTransaction,
  type IssuedApprovalGrant,
} from '@/lib/operations/planned-operation-invocation'
import { WAO_MCP_APPROVAL_META_KEY } from './approval-contract'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function matchesApprovedInteraction(input: {
  readonly approvalRequestId: string
  readonly runtimeRequestId: string
  readonly payload: unknown
  readonly response: unknown
}): boolean {
  if (!isRecord(input.payload) || input.payload.method !== 'mcpServer/elicitation/request') {
    return false
  }
  const params = isRecord(input.payload.params) ? input.payload.params : null
  const meta = params && isRecord(params._meta) ? params._meta : null
  if (meta?.[WAO_MCP_APPROVAL_META_KEY] !== input.approvalRequestId) return false
  if (String(input.payload.requestId) !== input.runtimeRequestId) return false

  if (!isRecord(input.response) || String(input.response.id) !== input.runtimeRequestId) {
    return false
  }
  const result = isRecord(input.response.result) ? input.response.result : null
  const content = result && isRecord(result.content) ? result.content : null
  return result?.action === 'accept' && content?.confirmed === true
}

/**
 * A Runtime bearer authorizes capability transport, never user consent. The
 * grant writer accepts an elicitation result only when the authenticated Wao
 * interaction route has already persisted the matching browser decision.
 */
export async function requireWaoMcpBrowserApproval(input: {
  readonly userId: string
  readonly projectId: string
  readonly turnId: string
  readonly approvalRequestId: string
}): Promise<void> {
  const interactions = await prisma.agentTurnInteraction.findMany({
    where: {
      turnId: input.turnId,
      kind: 'runtime_request',
      status: { in: ['decided', 'resolved'] },
      version: { gte: 1 },
      turn: {
        userId: input.userId,
        projectId: input.projectId,
        cancelRequestId: null,
        status: { in: ['running', 'waiting_approval'] },
        thread: { clearRequestId: null },
      },
    },
    select: {
      runtimeRequestId: true,
      payloadJson: true,
      responseJson: true,
    },
  })
  const matching = interactions.filter((interaction) => (
    interaction.runtimeRequestId
    && matchesApprovedInteraction({
      approvalRequestId: input.approvalRequestId,
      runtimeRequestId: interaction.runtimeRequestId,
      payload: interaction.payloadJson,
      response: interaction.responseJson,
    })
  ))
  if (matching.length !== 1) {
    throw new Error('WAO_MCP_BROWSER_APPROVAL_PROOF_REQUIRED')
  }
}

/**
 * Serializes browser proof, Turn cancellation, and Grant issuance in one
 * transaction. A cancel that commits first cannot leave a usable late Grant.
 */
export async function issueWaoMcpApprovalGrant(input: {
  readonly userId: string
  readonly projectId: string
  readonly turnId: string
  readonly executionOwnerId: string
  readonly approvalRequestId: string
  readonly planSnapshotId: string
  readonly requireBrowserProof: boolean
}): Promise<IssuedApprovalGrant> {
  return await prisma.$transaction(async (tx) => {
    const turn = await lockAgentTurnEffectFence(tx, input)
    if (turn.executionOwnerId !== input.executionOwnerId) {
      throw new Error('WAO_MCP_APPROVAL_EXECUTION_OWNER_DIVERGED')
    }
    if (input.requireBrowserProof) {
      const interactions = await tx.agentTurnInteraction.findMany({
        where: {
          turnId: input.turnId,
          kind: 'runtime_request',
          status: { in: ['decided', 'resolved'] },
          version: { gte: 1 },
        },
        select: {
          runtimeRequestId: true,
          payloadJson: true,
          responseJson: true,
        },
      })
      const matching = interactions.filter((interaction) => (
        interaction.runtimeRequestId
        && matchesApprovedInteraction({
          approvalRequestId: input.approvalRequestId,
          runtimeRequestId: interaction.runtimeRequestId,
          payload: interaction.payloadJson,
          response: interaction.responseJson,
        })
      ))
      if (matching.length !== 1) {
        throw new Error('WAO_MCP_BROWSER_APPROVAL_PROOF_REQUIRED')
      }
    }
    const [grant] = await issueApprovalGrantGroupInTransaction(tx, {
      userId: input.userId,
      requests: [{
        planSnapshotId: input.planSnapshotId,
        requestId: input.approvalRequestId,
      }],
    })
    if (!grant) throw new Error('WAO_MCP_APPROVAL_GRANT_EMPTY')
    return grant
  })
}
