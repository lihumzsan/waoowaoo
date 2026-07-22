import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'
import type { AiModality, AiUnknownObject, ModelCapabilities } from '@/lib/ai-registry/types'
import { resolveRegisteredLlmProtocol } from '@/lib/ai-registry/llm-protocol'

function resolveCapabilityModelType(modality: AiModality): 'llm' | 'image' | 'video' | 'music' | 'voice' {
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

  const contracts: AiUnknownObject = {}
  if (input.modality === 'llm' || input.modality === 'vision') {
    contracts.llmProtocol = resolveRegisteredLlmProtocol(input.modelKey)
  }

  return {
    capabilities: capabilities || {},
    ...(Object.keys(contracts).length > 0 ? { inputContracts: contracts } : {}),
  }
}
