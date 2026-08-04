import Navbar from '@/components/Navbar'
import PublicFooter from '@/components/PublicFooter'
import { readPublicDeploymentFeatures } from '@/lib/deployment/server-features'

export interface LegalPageSection {
  title: string
  body: string
}

export interface LegalPageShellProps {
  eyebrow: string
  title: string
  description: string
  updatedAt: string
  sections: readonly LegalPageSection[]
}

export default function LegalPageShell({
  eyebrow,
  title,
  description,
  updatedAt,
  sections,
}: LegalPageShellProps) {
  const deploymentFeatures = readPublicDeploymentFeatures()

  return (
    <div className="glass-page min-h-screen">
      <Navbar initialDeploymentFeatures={deploymentFeatures} />
      <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-12 sm:px-6 lg:px-8">
        <section className="mb-10 space-y-4">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[var(--glass-tone-info-fg)]">
            {eyebrow}
          </p>
          <h1 className="text-4xl font-semibold tracking-normal text-[var(--glass-text-primary)] md:text-5xl">
            {title}
          </h1>
          <p className="max-w-3xl text-base leading-7 text-[var(--glass-text-secondary)]">
            {description}
          </p>
          <p className="text-sm text-[var(--glass-text-muted)]">{updatedAt}</p>
        </section>

        <div className="grid gap-4">
          {sections.map((section) => (
            <section
              key={section.title}
              className="rounded-lg border border-[var(--glass-stroke-soft)] bg-[var(--glass-bg-surface)]/72 p-6 shadow-[0_18px_48px_-34px_rgba(15,23,42,0.45)] backdrop-blur-xl"
            >
              <h2 className="mb-3 text-xl font-semibold tracking-normal text-[var(--glass-text-primary)]">
                {section.title}
              </h2>
              <p className="text-sm leading-7 text-[var(--glass-text-secondary)]">
                {section.body}
              </p>
            </section>
          ))}
        </div>
      </main>
      <PublicFooter initialDeploymentFeatures={deploymentFeatures} />
    </div>
  )
}
