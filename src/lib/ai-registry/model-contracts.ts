import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'
import type { AiModality, AiUnknownObject, ModelCapabilities } from '@/lib/ai-registry/types'

function resolveCapabilityModelType(modality: AiModality): 'llm' | 'image' | 'video' | 'music' | 'sound' | 'voice' {
  if (modality === 'vision') return 'llm'
  return modality
}

export function resolveAiContractsForDescriptor(input: {
  modality: AiModality
  modelKey: string
  providerId: string
  modelId: string
}): { capabilities: ModelCapabilities; inputContracts?: AiUnknownObject } {
  const capabilityModelType = resolveCapabilityModelType(input.modality)
  const capabilities = resolveBuiltinCapabilitiesByModelKey(capabilityModelType, input.modelKey)

  return {
    capabilities: capabilities || {},
  }
}
