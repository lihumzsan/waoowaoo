import type { ModelCapabilities } from '@/lib/ai-registry/types'
import type { VideoPricingTier } from '@/lib/ai-registry/video-capabilities'

export interface WorkspaceVideoGenerationModelOption {
  readonly value: string
  readonly label: string
  readonly provider?: string
  readonly providerName?: string
  readonly disabled?: boolean
  readonly capabilities?: ModelCapabilities
  readonly videoPricingTiers?: VideoPricingTier[]
}

export type WorkspaceVideoGenerationOptionValue = string | number | boolean
export type WorkspaceVideoGenerationOptions = Record<string, WorkspaceVideoGenerationOptionValue>

export interface WorkspaceBatchVideoGenerationParams {
  readonly generationOptions?: WorkspaceVideoGenerationOptions
  readonly mode?: 'single' | 'grid' | 'auto' | 'asset-reference'
  readonly gridMode?: '2x2' | '3x3'
  readonly shotNumbers?: readonly number[]
  readonly segmentIndex?: number
  readonly referenceImageUrls?: readonly string[]
}
