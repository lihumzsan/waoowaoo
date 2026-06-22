import { PricingGlassPageContent } from '../_pricing-glass/page-content'
import type { Locale } from '@/i18n/routing'

export const dynamic = 'force-dynamic'

export default async function PricingGlass1Page({
  params,
}: {
  readonly params: Promise<{ readonly locale: Locale }>
}) {
  return <PricingGlassPageContent params={params} />
}
