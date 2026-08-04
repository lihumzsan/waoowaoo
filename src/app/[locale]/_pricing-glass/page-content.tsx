import Navbar from '@/components/Navbar'
import PublicFooter from '@/components/PublicFooter'
import { readPublicDeploymentFeatures } from '@/lib/deployment/server-features'
import {
  normalizeOfficialLocale,
  readOfficialContactPage,
  readOfficialPricingPage,
} from '@/lib/public-site/official-content'
import { requireOfficialCloudPricingPage } from '@/lib/public-site/visibility'
import type { Locale } from '@/i18n/routing'
import { buildGlassPricingContent } from './content'
import PricingGlassPageClient from './page-client'

export interface PricingGlassPageContentProps {
  readonly params: Promise<{ readonly locale: Locale }>
}

export async function PricingGlassPageContent({ params }: PricingGlassPageContentProps) {
  requireOfficialCloudPricingPage()
  const { locale } = await params
  const officialLocale = normalizeOfficialLocale(locale)
  const deploymentFeatures = readPublicDeploymentFeatures()
  const content = buildGlassPricingContent({
    pricing: readOfficialPricingPage(officialLocale),
    contact: readOfficialContactPage(officialLocale),
  })

  return (
    <>
      <Navbar reserveLayoutSpace={false} initialDeploymentFeatures={deploymentFeatures} />
      <PricingGlassPageClient content={content} />
      <PublicFooter initialDeploymentFeatures={deploymentFeatures} />
    </>
  )
}
