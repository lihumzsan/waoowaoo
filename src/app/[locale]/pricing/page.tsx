import { getTranslations } from 'next-intl/server'
import Navbar from '@/components/Navbar'
import PublicFooter from '@/components/PublicFooter'

const PLAN_KEYS = ['starter', 'creator', 'studio'] as const
const DETAIL_KEYS = ['credits', 'usage', 'support'] as const

export default async function PricingPage() {
  const t = await getTranslations('pricing')

  return (
    <div className="glass-page min-h-screen">
      <Navbar />
      <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-12 sm:px-6 lg:px-8">
        <section className="mb-10 max-w-3xl space-y-4">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--glass-tone-info-fg)]">
            {t('eyebrow')}
          </p>
          <h1 className="text-4xl font-semibold tracking-normal text-[var(--glass-text-primary)] md:text-5xl">
            {t('title')}
          </h1>
          <p className="text-base leading-7 text-[var(--glass-text-secondary)]">
            {t('description')}
          </p>
        </section>

        <section className="mb-8 rounded-lg border border-[var(--glass-stroke-soft)] bg-[var(--glass-tone-warning-bg)]/55 p-5 text-sm leading-7 text-[var(--glass-text-secondary)] backdrop-blur-xl">
          {t('betaNotice')}
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {PLAN_KEYS.map((planKey) => (
            <article
              key={planKey}
              className="flex min-h-[320px] flex-col rounded-lg border border-[var(--glass-stroke-soft)] bg-[var(--glass-bg-surface)]/72 p-6 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.45)] backdrop-blur-xl"
            >
              <p className="text-sm font-medium text-[var(--glass-tone-info-fg)]">
                {t(`plans.${planKey}.label`)}
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-normal text-[var(--glass-text-primary)]">
                {t(`plans.${planKey}.name`)}
              </h2>
              <p className="mt-4 text-3xl font-semibold tracking-normal text-[var(--glass-text-primary)]">
                {t(`plans.${planKey}.price`)}
              </p>
              <p className="mt-2 text-sm text-[var(--glass-text-muted)]">
                {t(`plans.${planKey}.status`)}
              </p>
              <div className="mt-6 grid gap-3 text-sm leading-6 text-[var(--glass-text-secondary)]">
                {DETAIL_KEYS.map((detailKey) => (
                  <p key={detailKey}>{t(`plans.${planKey}.details.${detailKey}`)}</p>
                ))}
              </div>
            </article>
          ))}
        </section>

        <section className="mt-8 rounded-lg border border-[var(--glass-stroke-soft)] bg-[var(--glass-bg-surface)]/72 p-6 text-sm leading-7 text-[var(--glass-text-secondary)] backdrop-blur-xl">
          <h2 className="mb-3 text-xl font-semibold tracking-normal text-[var(--glass-text-primary)]">
            {t('creditPolicy.title')}
          </h2>
          <p>{t('creditPolicy.body')}</p>
        </section>
      </main>
      <PublicFooter />
    </div>
  )
}
