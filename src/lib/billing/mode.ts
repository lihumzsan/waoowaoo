import type { BillingMode } from './types'
import { getDeploymentConfig } from '@/lib/deployment/config'

const VALID_MODES: BillingMode[] = ['OFF', 'SHADOW', 'ENFORCE']

function normalizeMode(input: unknown): BillingMode | null {
  if (typeof input !== 'string') return null
  const upper = input.toUpperCase()
  if (!VALID_MODES.includes(upper as BillingMode)) return null
  return upper as BillingMode
}

function getModeFromEnv(): BillingMode {
  const deployment = getDeploymentConfig()
  const rawMode = process.env.BILLING_MODE
  if (rawMode === undefined || rawMode === null || rawMode.trim() === '') {
    if (deployment.edition === 'cloud') {
      throw new Error('BILLING_MODE_REQUIRED_FOR_CLOUD')
    }
    return 'OFF'
  }

  const mode = normalizeMode(rawMode)
  if (!mode) {
    throw new Error(`BILLING_MODE_INVALID: ${rawMode}`)
  }
  if (deployment.edition === 'cloud' && mode !== 'ENFORCE') {
    throw new Error(`BILLING_MODE_CLOUD_REQUIRES_ENFORCE: ${mode}`)
  }
  return mode
}

export async function getBillingMode(): Promise<BillingMode> {
  return getModeFromEnv()
}

export function getBootBillingEnabled() {
  return getModeFromEnv() === 'ENFORCE'
}
