import type { ModelCapabilities, UnifiedModelType } from '@/lib/ai-registry/types'
export type DefaultModelField =
  | 'assistantModel'
  | 'analysisModel'
  | 'characterModel'
  | 'locationModel'
  | 'editModel'
  | 'videoModel'
  | 'musicModel'
  | 'soundModel'

export interface StoredProvider {
  id: string
  name: string
  baseUrl?: string
  apiKey?: string
  hidden?: boolean
}

export interface StoredModel {
  modelId: string
  modelKey: string
  name: string
  type: UnifiedModelType
  provider: string
  // Provider metadata retained for user-owned API configuration only.
  price: number
  priceMin?: number
  priceMax?: number
  priceLabel?: string
  priceInput?: number
  priceOutput?: number
  capabilities?: ModelCapabilities
}

export interface DefaultModelsPayload {
  assistantModel?: string
  analysisModel?: string
  characterModel?: string
  locationModel?: string
  editModel?: string
  videoModel?: string
  musicModel?: string
  soundModel?: string
}

export interface WorkflowConcurrencyPayload {
  analysis?: number
  image?: number
  video?: number
}

export interface ApiConfigPutBody {
  models?: unknown
  providers?: unknown
  defaultModels?: unknown
  capabilityDefaults?: unknown
  workflowConcurrency?: unknown
}

export const DEFAULT_MODEL_FIELDS: DefaultModelField[] = [
  'assistantModel',
  'analysisModel',
  'characterModel',
  'locationModel',
  'editModel',
  'videoModel',
  'musicModel',
  'soundModel',
]
export const CAPABILITY_MODEL_TYPES: readonly UnifiedModelType[] = [
  'image',
  'video',
  'llm',
  'music',
  'sound',
]
