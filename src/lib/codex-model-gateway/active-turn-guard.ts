import {
  AssistantRuntimeCapabilityTurnError,
  requireAssistantRuntimeCapabilityTurn,
  requireAssistantRuntimeModelCapabilityTurn,
} from '@/lib/assistant-runtime/capability-turn'
import {
  CodexModelGatewayError,
  type CodexModelGatewayScope,
} from './contracts'

/**
 * The project Runtime bearer is placement-bound transport authority, not an
 * open-ended model API key. Its nonce must still own the Redis lease and every
 * model/search request must belong to the sole active product Turn. The inner
 * Codex workspace sandbox separately denies shell network.
 */
export async function requireCodexModelGatewayActiveTurn(
  scope: CodexModelGatewayScope,
  ownerToken: string,
): Promise<{ readonly turnId: string; readonly attempt: number }> {
  try {
    const active = await requireAssistantRuntimeCapabilityTurn({
      scope,
      ownerToken,
    })
    return { turnId: active.turnId, attempt: active.attempt }
  } catch (error) {
    if (!(error instanceof AssistantRuntimeCapabilityTurnError)) throw error
    throw new CodexModelGatewayError('ACTIVE_TURN_REQUIRED', 403, error)
  }
}

export async function requireCodexModelGatewayModelActiveTurn(
  scope: CodexModelGatewayScope,
  ownerToken: string,
  runtimeTurnId: string,
): Promise<{ readonly turnId: string; readonly attempt: number }> {
  try {
    const active = await requireAssistantRuntimeModelCapabilityTurn({
      scope,
      ownerToken,
      runtimeTurnId,
    })
    return { turnId: active.turnId, attempt: active.attempt }
  } catch (error) {
    if (!(error instanceof AssistantRuntimeCapabilityTurnError)) throw error
    throw new CodexModelGatewayError('ACTIVE_TURN_REQUIRED', 403, error)
  }
}
