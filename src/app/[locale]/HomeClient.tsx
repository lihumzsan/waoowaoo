'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useSession } from 'next-auth/react'
import Navbar from '@/components/Navbar'
import PublicFooter from '@/components/PublicFooter'
import { BrandPageLoading } from '@/components/ui/BrandLoading'
import { Link, useRouter } from '@/i18n/navigation'
import { buildAuthenticatedHomeTarget } from '@/lib/home/default-route'
import type { PublicDeploymentFeatures } from '@/lib/deployment/public-client'

interface HomeClientProps {
  initialDeploymentFeatures: PublicDeploymentFeatures
}

export default function HomeClient({ initialDeploymentFeatures }: HomeClientProps) {
  const t = useTranslations('landing')
  const tn = useTranslations('nav')
  const { status } = useSession()
  const router = useRouter()
  const showPricingLink = initialDeploymentFeatures.showPricingPage === true

  useEffect(() => {
    if (status === 'authenticated') {
      router.replace(buildAuthenticatedHomeTarget())
    }
  }, [status, router])

  if (status !== 'unauthenticated') {
    return <BrandPageLoading />
  }

  return (
    <div className="glass-page min-h-screen overflow-hidden font-sans selection:bg-[var(--glass-tone-info-bg)]">
      <div className="relative z-50">
        <Navbar initialDeploymentFeatures={initialDeploymentFeatures} />
      </div>

      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-0 bg-[radial-gradient(1200px_600px_at_80%_-10%,rgba(138,170,255,0.12),transparent),radial-gradient(900px_500px_at_0%_100%,rgba(148,163,184,0.16),transparent)]" />
      </div>

      <main className="relative z-10">
        <section className="relative -mt-16 flex min-h-screen items-center justify-center px-4">
          <div className="container mx-auto grid items-center gap-16 lg:grid-cols-2">
            <div className="animate-slide-up space-y-8 text-left" style={{ animationDuration: '0.8s' }}>
              <h1 className="animate-fade-in text-5xl font-bold leading-[1.1] tracking-normal md:text-7xl" style={{ animationDelay: '0.2s' }}>
                <span className="block text-[var(--glass-text-primary)]">
                  {t('title')}
                </span>
                <span className="text-[var(--glass-tone-info-fg)]">
                  {t('subtitle')}
                </span>
              </h1>

              <div className="animate-fade-in flex flex-wrap gap-4 pt-4" style={{ animationDelay: '0.6s' }}>
                <Link
                  href={{ pathname: '/auth/signup' }}
                  className="glass-btn-base glass-btn-primary rounded-xl px-8 py-4 font-semibold transition-all duration-300"
                >
                  {t('getStarted')}
                </Link>
                {showPricingLink ? (
                  <Link
                    href={{ pathname: '/pricing' }}
                    className="glass-btn-base glass-btn-secondary rounded-xl px-8 py-4 font-semibold transition-all duration-300"
                  >
                    {tn('pricing')}
                  </Link>
                ) : null}
              </div>
            </div>

            <div className="relative hidden h-[600px] animate-scale-in items-center justify-center lg:flex" style={{ animationDuration: '1s' }}>
              <div className="relative aspect-square w-full max-w-md">
                <div className="absolute left-1/2 top-1/2 h-[120%] w-[120%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(148,163,184,0.2),transparent_65%)] opacity-70 blur-3xl" />
                <div className="glass-surface animate-float-delayed absolute right-10 top-0 h-80 w-64 rotate-6 rounded-3xl" />
                <div className="glass-surface-soft animate-float-slow absolute bottom-10 left-10 h-80 w-72 -rotate-3 rounded-3xl" />
                <div className="glass-surface-modal animate-float absolute left-1/2 top-1/2 h-96 w-80 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-3xl">
                  <div className="flex h-full flex-col p-6">
                    <div className="group relative mb-6 h-48 w-full overflow-hidden rounded-2xl bg-[var(--glass-bg-muted)]">
                      <div className="absolute inset-0 bg-[var(--glass-tone-info-bg)]/20 transition-colors group-hover:bg-[var(--glass-tone-info-bg)]/35" />
                      <div className="absolute right-4 top-4 h-8 w-8 rounded-full bg-[var(--glass-bg-surface)]" />
                      <div className="absolute bottom-4 left-4 h-12 w-12 rotate-12 rounded-lg bg-[var(--glass-bg-surface-strong)]" />
                    </div>
                    <div className="space-y-3">
                      <div className="h-3 w-3/4 rounded-full bg-[var(--glass-bg-muted)]" />
                      <div className="h-3 w-1/2 rounded-full bg-[var(--glass-bg-muted)]" />
                      <div className="flex gap-2 pt-4">
                        <div className="h-10 w-10 rounded-full border border-[var(--glass-stroke-soft)] bg-[var(--glass-bg-surface)]" />
                        <div className="h-10 flex-1 rounded-full border border-[var(--glass-stroke-base)] bg-[var(--glass-tone-info-bg)]/40" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
      <div className="relative z-10">
        <PublicFooter initialDeploymentFeatures={initialDeploymentFeatures} />
      </div>
    </div>
  )
}
