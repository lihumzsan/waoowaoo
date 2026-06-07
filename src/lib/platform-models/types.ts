import type { UnifiedModelType } from '@/lib/ai-registry/types'

export interface PlatformModelPreset {
  provider: string
  modelId: string
  name: string
  type: UnifiedModelType
}
