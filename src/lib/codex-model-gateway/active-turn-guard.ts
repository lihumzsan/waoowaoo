import { hasAssistantRuntimeOwnership } from '@/lib/assistant-runtime/runtime-ownership'
import { prisma } from '@/lib/prisma'
import {
  CODEX_MODEL_GATEWAY_ASSISTANT_ID,
  CodexModelGatewayError,
  type CodexModelGatewayScope,
} from './contracts'

const MODEL_GATEWAY_ACTIVE_TURN_STATUSES = [
  'running',
  'waiting_approval',
] as const

/**
 * The project Runtime bearer is placement-bound transport authority, not an
 * open-ended model API key. Its nonce must still own the Redis lease and every
 * model/search request must belong to the sole active product Turn. The inner
 * Codex workspace sandbox separately denies shell network.
 */
export async function requireCodexModelGatewayActiveTurn(
  scope: CodexModelGatewayScope,
  ownerToken: string,
): Promise<void> {
  if (!await hasAssistantRuntimeOwnership(scope, ownerToken)) {
    throw new CodexModelGatewayError('ACTIVE_TURN_REQUIRED', 403)
  }
  const thread = await prisma.projectAssistantThread.findUnique({
    where: {
      projectId_userId_assistantId: {
        projectId: scope.projectId,
        userId: scope.userId,
        assistantId: CODEX_MODEL_GATEWAY_ASSISTANT_ID,
      },
    },
    select: { id: true, clearRequestId: true },
  })
  if (!thread || thread.clearRequestId) {
    throw new CodexModelGatewayError('ACTIVE_TURN_REQUIRED', 403)
  }
  const active = await prisma.projectAgentTurn.findMany({
    where: {
      threadId: thread.id,
      projectId: scope.projectId,
      userId: scope.userId,
      status: { in: [...MODEL_GATEWAY_ACTIVE_TURN_STATUSES] },
      cancelRequestId: null,
      runtimeTurnId: { not: null },
      executionOwnerId: { not: null },
    },
    select: { id: true },
    take: 2,
  })
  if (active.length !== 1) {
    throw new CodexModelGatewayError('ACTIVE_TURN_REQUIRED', 403)
  }
}
