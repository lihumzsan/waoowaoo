import HomeClient from './HomeClient'
import { readPublicDeploymentFeatures } from '@/lib/deployment/server-features'

export const dynamic = 'force-dynamic'

export default function Home() {
  return <HomeClient initialDeploymentFeatures={readPublicDeploymentFeatures()} />
}
