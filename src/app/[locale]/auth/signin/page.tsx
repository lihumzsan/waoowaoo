import AuthEntryCard from '@/components/auth/AuthEntryCard'
import { readPublicDeploymentFeatures } from '@/lib/deployment/server-features'

export default function SignIn() {
  const features = readPublicDeploymentFeatures()
  return <AuthEntryCard features={features} />
}
