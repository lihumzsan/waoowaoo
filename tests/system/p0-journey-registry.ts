import journeyData from './p0-journeys.json'

export type P0SystemJourneyStatus = 'protected' | 'scenario-required'

export type P0SystemJourney = {
  readonly id: string
  readonly status: P0SystemJourneyStatus
}

function parseStatus(value: string): P0SystemJourneyStatus {
  if (value === 'protected' || value === 'scenario-required') return value
  throw new Error(`Unknown P0 system journey status: ${value}`)
}

export const P0_SYSTEM_JOURNEY_REGISTRY: readonly P0SystemJourney[] = journeyData.map((journey) => ({
  id: journey.id,
  status: parseStatus(journey.status),
}))

export function validateP0SystemJourneyRegistry(): void {
  if (P0_SYSTEM_JOURNEY_REGISTRY.length < 10) {
    throw new Error(`P0 system journey registry must contain at least 10 journeys, received ${P0_SYSTEM_JOURNEY_REGISTRY.length}`)
  }
  const ids = P0_SYSTEM_JOURNEY_REGISTRY.map((journey) => journey.id)
  if (new Set(ids).size !== ids.length) throw new Error('P0 system journey ids must be unique')
}
