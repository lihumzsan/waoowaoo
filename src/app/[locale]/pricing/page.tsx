import { redirect } from '@/i18n/navigation'
import type { Locale } from '@/i18n/routing'

export default async function PricingRedirect({
  params,
}: {
  readonly params: Promise<{ readonly locale: Locale }>
}) {
  const { locale } = await params
  redirect({ href: '/', locale })
}
