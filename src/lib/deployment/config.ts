export type DeploymentEdition = 'self-hosted' | 'cloud'
export type ProviderCredentialMode = 'user-key' | 'platform-key'

export interface DeploymentConfig {
  edition: DeploymentEdition
  providerCredentialMode: ProviderCredentialMode
}

const DEPLOYMENT_EDITIONS: DeploymentEdition[] = ['self-hosted', 'cloud']
const PROVIDER_CREDENTIAL_MODES: ProviderCredentialMode[] = ['user-key', 'platform-key']

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function normalizeDeploymentEdition(value: unknown): DeploymentEdition | null {
  const normalized = normalizeString(value)
  if (!normalized) return null
  if (!DEPLOYMENT_EDITIONS.includes(normalized as DeploymentEdition)) return null
  return normalized as DeploymentEdition
}

function normalizeProviderCredentialMode(value: unknown): ProviderCredentialMode | null {
  const normalized = normalizeString(value)
  if (!normalized) return null
  if (!PROVIDER_CREDENTIAL_MODES.includes(normalized as ProviderCredentialMode)) return null
  return normalized as ProviderCredentialMode
}

function readDeploymentEdition(): DeploymentEdition {
  const edition = normalizeDeploymentEdition(process.env.DEPLOYMENT_EDITION)
  if (edition) return edition
  if (process.env.DEPLOYMENT_EDITION) {
    throw new Error(`DEPLOYMENT_EDITION_INVALID: ${process.env.DEPLOYMENT_EDITION}`)
  }
  return 'self-hosted'
}

function readProviderCredentialMode(edition: DeploymentEdition): ProviderCredentialMode {
  const mode = normalizeProviderCredentialMode(process.env.PROVIDER_CREDENTIAL_MODE)
  if (mode) return mode
  if (process.env.PROVIDER_CREDENTIAL_MODE) {
    throw new Error(`PROVIDER_CREDENTIAL_MODE_INVALID: ${process.env.PROVIDER_CREDENTIAL_MODE}`)
  }
  return edition === 'cloud' ? 'platform-key' : 'user-key'
}

export function getDeploymentConfig(): DeploymentConfig {
  const edition = readDeploymentEdition()
  return {
    edition,
    providerCredentialMode: readProviderCredentialMode(edition),
  }
}

export function isCloudDeployment(config: DeploymentConfig = getDeploymentConfig()): boolean {
  return config.edition === 'cloud'
}

export function isPlatformProviderCredentialMode(config: DeploymentConfig = getDeploymentConfig()): boolean {
  return config.providerCredentialMode === 'platform-key'
}

export function toPublicDeploymentConfig(config: DeploymentConfig = getDeploymentConfig()) {
  return {
    edition: config.edition,
    providerCredentialMode: config.providerCredentialMode,
    isCloud: isCloudDeployment(config),
    usesPlatformProviderKeys: isPlatformProviderCredentialMode(config),
  }
}
