import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/ai-registry/capabilities-catalog'
import type { AiResolvedSelection, AiUnknownObject, ModelCapabilities } from '@/lib/ai-registry/types'
import type { AiModality, AiResolvedLlmSelection } from '@/lib/ai-registry/types'

function resolveCapabilityModelType(modality: AiModality): 'llm' | 'image' | 'video' | 'music' {
  if (modality === 'vision') return 'llm'
  return modality
}

export function resolveAiContractsForDescriptor(input: {
  modality: AiModality
  modelKey: string
  providerId: string
  modelId: string
  selection?: AiResolvedSelection | AiResolvedLlmSelection | null
}): { capabilities: ModelCapabilities; inputContracts?: AiUnknownObject } {
  const capabilityModelType = resolveCapabilityModelType(input.modality)
  const capabilities = resolveBuiltinCapabilitiesByModelKey(capabilityModelType, input.modelKey)

  const contracts: AiUnknownObject = {}
  const selection = input.selection

  if (input.modality === 'llm' || input.modality === 'vision') {
    const llmSelection = selection as AiResolvedLlmSelection | null | undefined
    const variantData = llmSelection?.variantData
    const llmProtocol = variantData && typeof variantData === 'object'
      ? variantData.llmProtocol
      : undefined
    if (llmProtocol === 'responses' || llmProtocol === 'chat-completions') {
      contracts.llmProtocol = llmProtocol
    }
  }

  return {
    capabilities: capabilities || {},
    ...(Object.keys(contracts).length > 0 ? { inputContracts: contracts } : {}),
  }
}
