import AuthEntryCard from '@/components/auth/AuthEntryCard'
import { parseSsoPostAuthTarget } from '@/lib/auth/sso/post-auth-target'
import { readPublicDeploymentFeatures } from '@/lib/deployment/server-features'

export const dynamic = 'force-dynamic'

export default async function SignIn(props: {
  readonly searchParams: Promise<{ readonly postAuthTarget?: string | readonly string[] }>
}) {
  const features = readPublicDeploymentFeatures()
  const searchParams = await props.searchParams
  const rawTarget = typeof searchParams.postAuthTarget === 'string' ? searchParams.postAuthTarget : null
  return <AuthEntryCard features={features} postAuthTarget={parseSsoPostAuthTarget(rawTarget)} />
}
