import type { CreativeDomainKind } from '@/lib/creative-skills/types'
import type { WorkspaceResourceSchemaId } from '@/lib/workspace-resource/schema-registry'

export const PRODUCTION_PROFILE_IDS = [
  'narrative_video',
  'commercial_video',
] as const

export type ProductionProfileId = (typeof PRODUCTION_PROFILE_IDS)[number]

export const PRODUCTION_JOURNEY_STATUSES = [
  'not_started',
  'in_progress',
  'completed',
  'needs_attention',
] as const

export type ProductionJourneyStatus = (typeof PRODUCTION_JOURNEY_STATUSES)[number]

export interface ProductionJourneyStageDefinition {
  readonly id: string
  readonly schemaIds: readonly WorkspaceResourceSchemaId[]
}

export interface ProductionProfileDefinition {
  readonly id: ProductionProfileId
  readonly version: number
  readonly purpose: string
  readonly allowedDomains: readonly CreativeDomainKind[]
  readonly developerInstructions: readonly string[]
  readonly domainInstructions: Readonly<Partial<
    Record<CreativeDomainKind, readonly string[]>
  >>
  readonly journey: readonly ProductionJourneyStageDefinition[] | null
}

export interface ProductionJourneyStageView {
  readonly id: string
  readonly status: ProductionJourneyStatus
  readonly resourceIds: readonly string[]
}

export interface ProductionJourneyView {
  readonly profileId: ProductionProfileId
  readonly profileVersion: number
  readonly stages: readonly ProductionJourneyStageView[]
}
