import { getTranslations } from 'next-intl/server'
import Navbar from '@/components/Navbar'
import PublicFooter from '@/components/PublicFooter'

const PUBLIC_INFO_KEYS = [
  'companyName',
  'registrationRegion',
  'registrationNumber',
  'registeredAddress',
  'supportEmail',
  'supportPhone',
  'supportHours',
] as const

const PORTAL_ONLY_KEYS = [
  'certificate',
  'businessRegistration',
  'directors',
  'owners',
  'bank',
] as const

export default async function ContactPage() {
  const t = await getTranslations('contact')

  return (
    <div className="glass-page min-h-screen">
      <Navbar />
      <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-12 sm:px-6 lg:px-8">
        <section className="mb-10 space-y-4">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--glass-tone-info-fg)]">
            {t('eyebrow')}
          </p>
          <h1 className="text-4xl font-semibold tracking-normal text-[var(--glass-text-primary)] md:text-5xl">
            {t('title')}
          </h1>
          <p className="max-w-3xl text-base leading-7 text-[var(--glass-text-secondary)]">
            {t('description')}
          </p>
        </section>

        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-lg border border-[var(--glass-stroke-soft)] bg-[var(--glass-bg-surface)]/72 p-6 backdrop-blur-xl">
            <h2 className="mb-4 text-xl font-semibold tracking-normal text-[var(--glass-text-primary)]">
              {t('publicInfo.title')}
            </h2>
            <dl className="grid gap-4">
              {PUBLIC_INFO_KEYS.map((key) => (
                <div key={key} className="grid gap-1 border-b border-[var(--glass-stroke-soft)] pb-3 last:border-b-0 last:pb-0">
                  <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--glass-text-muted)]">
                    {t(`publicInfo.fields.${key}.label`)}
                  </dt>
                  <dd className="text-sm leading-6 text-[var(--glass-text-secondary)]">
                    {t(`publicInfo.fields.${key}.value`)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="rounded-lg border border-[var(--glass-stroke-soft)] bg-[var(--glass-bg-surface)]/72 p-6 backdrop-blur-xl">
            <h2 className="mb-4 text-xl font-semibold tracking-normal text-[var(--glass-text-primary)]">
              {t('portalOnly.title')}
            </h2>
            <p className="mb-4 text-sm leading-7 text-[var(--glass-text-secondary)]">
              {t('portalOnly.description')}
            </p>
            <div className="grid gap-3 text-sm leading-6 text-[var(--glass-text-secondary)]">
              {PORTAL_ONLY_KEYS.map((key) => (
                <p key={key}>{t(`portalOnly.items.${key}`)}</p>
              ))}
            </div>
          </section>
        </div>
      </main>
      <PublicFooter />
    </div>
  )
}
