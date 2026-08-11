import { composeModelKey } from '@/lib/ai-registry/selection'
import type { ModelCapabilities, UnifiedModelType } from '@/lib/ai-registry/types'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'

export function resolveBuiltinCapabilities(
  modelType: UnifiedModelType,
  provider: string,
  modelId: string,
): ModelCapabilities | undefined {
  const modelKey = composeModelKey(provider, modelId)
  return modelKey ? resolveBuiltinCapabilitiesByModelKey(modelType, modelKey) : undefined
}
