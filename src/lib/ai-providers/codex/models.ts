import { CODEX_DEFAULT_IMAGE_MODEL_ID, CODEX_DEFAULT_MODEL_ID } from './constants'

export const CODEX_API_CONFIG_CATALOG_MODELS = [
  { modelId: CODEX_DEFAULT_MODEL_ID, name: 'Codex', type: 'llm', provider: 'codex' },
  { modelId: CODEX_DEFAULT_IMAGE_MODEL_ID, name: 'Codex Image', type: 'image', provider: 'codex' },
] as const

export const CODEX_BUILTIN_CAPABILITY_CATALOG_ENTRIES = [
  {
    modelType: 'llm',
    provider: 'codex',
    modelId: CODEX_DEFAULT_MODEL_ID,
    capabilities: {
      llm: {
        protocol: 'codex-cli',
        publicReasoningMode: 'native',
        codexRuntimeWireApi: 'responses',
      },
    },
  },
  {
    modelType: 'image',
    provider: 'codex',
    modelId: CODEX_DEFAULT_IMAGE_MODEL_ID,
    capabilities: {
      image: {
        resolutionOptions: ['1K', '2K', '4K'],
        qualityOptions: ['low', 'medium', 'high'],
      },
    },
  },
] as const

const CODEX_ZERO_PRICE = {
  mode: 'flat' as const,
  unit: 'per_call' as const,
  flatAmount: 0,
}

export const CODEX_BUILTIN_PRICING_CATALOG_ENTRIES = [
  { apiType: 'text', provider: 'codex', modelId: CODEX_DEFAULT_MODEL_ID, cost: CODEX_ZERO_PRICE, retail: CODEX_ZERO_PRICE },
  { apiType: 'image', provider: 'codex', modelId: CODEX_DEFAULT_IMAGE_MODEL_ID, cost: CODEX_ZERO_PRICE, retail: CODEX_ZERO_PRICE },
] as const
