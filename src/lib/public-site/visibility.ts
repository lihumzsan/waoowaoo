import { notFound } from 'next/navigation'
import { getDeploymentConfig } from '@/lib/deployment/config'
import { getDeploymentFeatures, type DeploymentFeatures } from '@/lib/deployment/features'

function readDeploymentFeatures(): DeploymentFeatures {
  return getDeploymentFeatures(getDeploymentConfig())
}

function requireOfficialCloudFeature(enabled: boolean): void {
  if (!enabled) {
    notFound()
  }
}

export function requireOfficialCloudPublicPage(): void {
  requireOfficialCloudFeature(readDeploymentFeatures().showOfficialPublicPages)
}

export function requireOfficialCloudLegalPage(): void {
  requireOfficialCloudFeature(readDeploymentFeatures().showLegalPages)
}
