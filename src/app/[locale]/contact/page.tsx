import Navbar from '@/components/Navbar'
import PublicFooter from '@/components/PublicFooter'
import { normalizeOfficialLocale, readOfficialContactPage } from '@/lib/public-site/official-content'
import { requireOfficialCloudPublicPage } from '@/lib/public-site/visibility'
import { readPublicDeploymentFeatures } from '@/lib/deployment/server-features'
import type { Locale } from '@/i18n/routing'

export const dynamic = 'force-dynamic'

export default async function ContactPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: Locale }>
}) {
  requireOfficialCloudPublicPage()
  const { locale } = await params
  const content = readOfficialContactPage(normalizeOfficialLocale(locale))
  const deploymentFeatures = readPublicDeploymentFeatures()

  return (
    <div className="glass-page min-h-screen">
      <Navbar initialDeploymentFeatures={deploymentFeatures} />
      <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-12 sm:px-6 lg:px-8">
        <section className="mb-10 space-y-4">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--glass-tone-info-fg)]">
            {content.eyebrow}
          </p>
          <h1 className="text-4xl font-semibold tracking-normal text-[var(--glass-text-primary)] md:text-5xl">
            {content.title}
          </h1>
          <p className="max-w-3xl text-base leading-7 text-[var(--glass-text-secondary)]">
            {content.description}
          </p>
        </section>

        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-lg border border-[var(--glass-stroke-soft)] bg-[var(--glass-bg-surface)]/72 p-6 backdrop-blur-xl">
            <h2 className="mb-4 text-xl font-semibold tracking-normal text-[var(--glass-text-primary)]">
              {content.publicInfo.title}
            </h2>
            <dl className="grid gap-4">
              {content.publicInfo.fields.map((field) => (
                <div key={field.label} className="grid gap-1 border-b border-[var(--glass-stroke-soft)] pb-3 last:border-b-0 last:pb-0">
                  <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--glass-text-muted)]">
                    {field.label}
                  </dt>
                  <dd className="text-sm leading-6 text-[var(--glass-text-secondary)]">
                    {field.value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="rounded-lg border border-[var(--glass-stroke-soft)] bg-[var(--glass-bg-surface)]/72 p-6 backdrop-blur-xl">
            <h2 className="mb-4 text-xl font-semibold tracking-normal text-[var(--glass-text-primary)]">
              {content.portalOnly.title}
            </h2>
            <p className="mb-4 text-sm leading-7 text-[var(--glass-text-secondary)]">
              {content.portalOnly.description}
            </p>
            <div className="grid gap-3 text-sm leading-6 text-[var(--glass-text-secondary)]">
              {content.portalOnly.items.map((item) => (
                <p key={item}>{item}</p>
              ))}
            </div>
          </section>
        </div>
      </main>
      <PublicFooter initialDeploymentFeatures={deploymentFeatures} />
    </div>
  )
}
