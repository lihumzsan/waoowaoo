import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'
import type { AiLlmProtocol } from '@/lib/ai-registry/types'

export function resolveRegisteredLlmProtocol(modelKey: string): AiLlmProtocol {
  const protocol = resolveBuiltinCapabilitiesByModelKey('llm', modelKey)?.llm?.protocol
  if (!protocol) {
    throw new Error(`LLM_PROTOCOL_NOT_REGISTERED:${modelKey}`)
  }
  return protocol
}
