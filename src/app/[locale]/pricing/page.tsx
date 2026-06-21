import Navbar from '@/components/Navbar'
import PublicFooter from '@/components/PublicFooter'
import { normalizeOfficialLocale, readOfficialPricingPage } from '@/lib/public-site/official-content'
import { requireOfficialCloudPricingPage } from '@/lib/public-site/visibility'
import { readPublicDeploymentFeatures } from '@/lib/deployment/server-features'
import { Link } from '@/i18n/navigation'
import type { Locale } from '@/i18n/routing'

export const dynamic = 'force-dynamic'

export default async function PricingPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: Locale }>
}) {
  requireOfficialCloudPricingPage()
  const { locale } = await params
  const content = readOfficialPricingPage(normalizeOfficialLocale(locale))
  const deploymentFeatures = readPublicDeploymentFeatures()

  return (
    <div className="glass-page min-h-screen">
      <Navbar initialDeploymentFeatures={deploymentFeatures} />
      <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-12 sm:px-6 lg:px-8">
        <section className="mb-10 max-w-3xl space-y-4">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--glass-tone-info-fg)]">
            {content.eyebrow}
          </p>
          <h1 className="text-4xl font-semibold tracking-normal text-[var(--glass-text-primary)] md:text-5xl">
            {content.title}
          </h1>
          <p className="text-base leading-7 text-[var(--glass-text-secondary)]">
            {content.description}
          </p>
        </section>

        <section className="mb-8 rounded-lg border border-[var(--glass-stroke-soft)] bg-[var(--glass-tone-warning-bg)]/55 p-5 text-sm leading-7 text-[var(--glass-text-secondary)] backdrop-blur-xl">
          {content.betaNotice}
        </section>

        <section className="mb-8 rounded-lg border border-[var(--glass-stroke-soft)] bg-[var(--glass-bg-surface)]/72 p-6 backdrop-blur-xl">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl space-y-2">
              <h2 className="text-2xl font-semibold tracking-normal text-[var(--glass-text-primary)]">
                {content.checkout.title}
              </h2>
              <p className="text-sm leading-7 text-[var(--glass-text-secondary)]">
                {content.checkout.body}
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row md:flex-col">
              <Link
                href={{ pathname: '/profile', query: { section: 'billing' } }}
                className="glass-btn-base glass-btn-primary rounded-xl px-5 py-3 text-center text-sm font-semibold"
              >
                {content.checkout.primaryCta}
              </Link>
              <Link
                href={{ pathname: '/auth/signup' }}
                className="glass-btn-secondary rounded-xl px-5 py-3 text-center text-sm font-semibold"
              >
                {content.checkout.secondaryCta}
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {content.plans.map((plan) => (
            <article
              key={plan.name}
              className="flex min-h-[320px] flex-col rounded-lg border border-[var(--glass-stroke-soft)] bg-[var(--glass-bg-surface)]/72 p-6 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.45)] backdrop-blur-xl"
            >
              <p className="text-sm font-medium text-[var(--glass-tone-info-fg)]">
                {plan.label}
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-normal text-[var(--glass-text-primary)]">
                {plan.name}
              </h2>
              <p className="mt-4 text-3xl font-semibold tracking-normal text-[var(--glass-text-primary)]">
                {plan.price}
              </p>
              <p className="mt-2 text-sm text-[var(--glass-text-muted)]">
                {plan.status}
              </p>
              <div className="mt-6 grid gap-3 text-sm leading-6 text-[var(--glass-text-secondary)]">
                {plan.details.map((detail) => (
                  <p key={detail}>{detail}</p>
                ))}
              </div>
            </article>
          ))}
        </section>

        <section className="mt-8 rounded-lg border border-[var(--glass-stroke-soft)] bg-[var(--glass-bg-surface)]/72 p-6 text-sm leading-7 text-[var(--glass-text-secondary)] backdrop-blur-xl">
          <h2 className="mb-3 text-xl font-semibold tracking-normal text-[var(--glass-text-primary)]">
            {content.creditPolicy.title}
          </h2>
          <p>{content.creditPolicy.body}</p>
        </section>
      </main>
      <PublicFooter initialDeploymentFeatures={deploymentFeatures} />
    </div>
  )
}
