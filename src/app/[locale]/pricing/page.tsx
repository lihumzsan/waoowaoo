import Navbar from '@/components/Navbar'
import PublicFooter from '@/components/PublicFooter'
import { normalizeOfficialLocale, readOfficialPricingPage } from '@/lib/public-site/official-content'
import { requireOfficialCloudPublicPage } from '@/lib/public-site/visibility'
import type { Locale } from '@/i18n/routing'

export const dynamic = 'force-dynamic'

export default async function PricingPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: Locale }>
}) {
  requireOfficialCloudPublicPage()
  const { locale } = await params
  const content = readOfficialPricingPage(normalizeOfficialLocale(locale))

  return (
    <div className="glass-page min-h-screen">
      <Navbar />
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
      <PublicFooter />
    </div>
  )
}
