import { notFound } from 'next/navigation'
import { getDeploymentConfig } from '@/lib/deployment/config'

export function requireOfficialCloudPublicPage(): void {
  if (getDeploymentConfig().edition !== 'cloud') {
    notFound()
  }
}
