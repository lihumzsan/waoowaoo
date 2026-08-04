'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useSession } from 'next-auth/react'
import Navbar from '@/components/Navbar'
import PublicFooter from '@/components/PublicFooter'
import { BrandPageLoading } from '@/components/ui/BrandLoading'
import {
  HOME_SHOWCASE_PAD_TOP,
  HomeBrandMark,
  HomeShowcaseAmbient,
  HomeShowcaseRail,
} from '@/components/home/HomeShowcase'
import { Link, useRouter } from '@/i18n/navigation'
import { buildAuthenticatedHomeTarget } from '@/lib/home/default-route'
import type { PublicDeploymentFeatures } from '@/lib/deployment/public-client'

interface HomeClientProps {
  initialDeploymentFeatures: PublicDeploymentFeatures
}

export default function HomeClient({ initialDeploymentFeatures }: HomeClientProps) {
  const t = useTranslations('landing')
  const a = useTranslations('landing.hero')
  const { status } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (status === 'authenticated') {
      router.replace(buildAuthenticatedHomeTarget())
    }
  }, [status, router])

  if (status !== 'unauthenticated') {
    return <BrandPageLoading />
  }

  return (
    <div className="glass-page min-h-screen font-sans">
      <div className="relative z-50">
        <Navbar initialDeploymentFeatures={initialDeploymentFeatures} />
      </div>

      <main>
        <section className="relative -mt-16 h-screen min-h-[780px] overflow-hidden">
          <HomeShowcaseAmbient />

          {/* 展示带:位于下方,两侧淡出 */}
          <div className="absolute inset-x-0 z-20" style={{ top: `calc(70vh - ${HOME_SHOWCASE_PAD_TOP}px)` }}>
            <HomeShowcaseRail />
          </div>

          {/* 文案:在展示带以上的区域内垂直居中(top-16 让开导航栏) */}
          <div className="absolute inset-x-0 top-16 z-30 flex h-[calc(70vh-4rem)] items-center justify-center">
            <div className="flex max-w-3xl flex-col items-center px-6 text-center">
              <div className="flex items-center gap-3">
                <HomeBrandMark size={60} />
                <span className="text-3xl font-bold tracking-tight text-[var(--glass-text-primary)]">
                  {t('title')}
                </span>
              </div>

              <h1 className="mt-7 text-5xl font-bold leading-[1.1] tracking-tight xl:text-6xl 2xl:text-7xl">
                <span className="block text-[var(--glass-text-primary)]">{a('headline')}</span>
                <span className="mt-1 block bg-gradient-to-r from-[var(--glass-accent-from)] to-[var(--glass-accent-to)] bg-clip-text text-transparent">
                  {a('highlight')}
                </span>
              </h1>

              <p className="mt-5 max-w-3xl text-base leading-relaxed text-[var(--glass-text-tertiary)] xl:text-lg">
                {a('sub')}
              </p>

              {/* 落地逻辑:三步说明整件事有多简单,放在 CTA 之前先消除门槛顾虑 */}
              <ol className="mt-7 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm text-[var(--glass-text-tertiary)]">
                {[a('steps.one'), a('steps.two'), a('steps.three')].map((step, index) => (
                  <li key={step} className="flex items-center gap-3">
                    {index > 0 ? (
                      <span aria-hidden="true" className="opacity-40">
                        →
                      </span>
                    ) : null}
                    <span className="rounded-full border border-[var(--glass-border)] px-3.5 py-1.5">
                      {step}
                    </span>
                  </li>
                ))}
              </ol>

              <div className="mt-8 flex flex-col items-center gap-3">
                <Link
                  href={{ pathname: '/auth/signin' }}
                  className="glass-btn-base glass-btn-primary rounded-xl px-9 py-4 text-lg font-semibold"
                >
                  {a('ctaPrimary')}
                </Link>
                {/* 门槛承诺:只说需要什么能力,不承诺交付时间或成片质量 */}
                <p className="text-sm text-[var(--glass-text-tertiary)]">{a('ctaNote')}</p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter initialDeploymentFeatures={initialDeploymentFeatures} />
    </div>
  )
}
