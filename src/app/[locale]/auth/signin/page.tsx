import AuthEntryCard from '@/components/auth/AuthEntryCard'
import { readPublicDeploymentFeatures } from '@/lib/deployment/server-features'

export const dynamic = 'force-dynamic'

export default function SignIn() {
  const features = readPublicDeploymentFeatures()
  return <AuthEntryCard features={features} />
}
