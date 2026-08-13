import type { CapabilitySelections, ModelCapabilities, UnifiedModelType } from '@/lib/ai-registry/types'
export type DefaultModelField =
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
  capabilities?: ModelCapabilities
}

export interface DefaultModelsPayload {
  analysisModel?: string
  characterModel?: string
  locationModel?: string
  editModel?: string
  videoModel?: string
  musicModel?: string
  soundModel?: string
}

export type DefaultModelSource = 'user' | 'system' | 'unset'

export interface EffectiveDefaultModelsView {
  defaultModels: DefaultModelsPayload
  capabilityDefaults: CapabilitySelections
  sources: Record<DefaultModelField, DefaultModelSource>
  runtimeManagedModelKeys: string[]
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
