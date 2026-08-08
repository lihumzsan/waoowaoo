import type { MetadataRoute } from 'next'
import { getDeploymentConfig } from '@/lib/deployment/config'
import { getDeploymentFeatures } from '@/lib/deployment/features'
import { locales } from '@/i18n/routing'
import { getPublicSiteUrl } from '@/lib/public-site/url'

// URL and edition are deployment facts supplied to the running container, not
// to the shared image build.
export const dynamic = 'force-dynamic'

const OFFICIAL_PUBLIC_PATHS = [
  '',
  '/pricing',
  '/terms',
  '/privacy',
  '/refund-policy',
  '/contact',
] as const

export default function sitemap(): MetadataRoute.Sitemap {
  const features = getDeploymentFeatures(getDeploymentConfig())
  const publicPaths = features.showOfficialPublicPages ? OFFICIAL_PUBLIC_PATHS : ['']

  return locales.flatMap((locale) => publicPaths.map((pathname) => ({
    url: getPublicSiteUrl(`/${locale}${pathname}`),
  })))
}
