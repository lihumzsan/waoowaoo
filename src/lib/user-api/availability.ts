import { ApiError } from '@/lib/api-errors'
import { getDeploymentConfig, isUserProviderCredentialMode } from '@/lib/deployment/config'

export function assertUserProviderConfigurationAvailable(): void {
  if (isUserProviderCredentialMode(getDeploymentConfig())) return
  throw new ApiError('FORBIDDEN', {
    code: 'API_CONFIG_MANAGED_BY_PLATFORM',
  })
}
