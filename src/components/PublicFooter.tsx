'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { fetchPublicDeploymentFeatures } from '@/lib/deployment/public-client'
import type { PublicDeploymentFeatures } from '@/lib/deployment/public-client'

const FOOTER_LINKS = [
  { href: '/pricing', labelKey: 'pricing' },
  { href: '/terms', labelKey: 'terms' },
  { href: '/privacy', labelKey: 'privacy' },
  { href: '/refund-policy', labelKey: 'refundPolicy' },
  { href: '/contact', labelKey: 'contact' },
] as const

interface PublicFooterProps {
  initialDeploymentFeatures?: PublicDeploymentFeatures | null
}

export default function PublicFooter({ initialDeploymentFeatures = null }: PublicFooterProps) {
  const t = useTranslations('legal.publicFooter')
  const [deploymentFeatures, setDeploymentFeatures] = useState<PublicDeploymentFeatures | null>(initialDeploymentFeatures)

  useEffect(() => {
    let cancelled = false
    fetchPublicDeploymentFeatures().then((features) => {
      if (!cancelled) setDeploymentFeatures(features)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <footer className="border-t border-[var(--glass-stroke-soft)] bg-[var(--glass-bg-surface)]/55 px-4 py-8 text-sm text-[var(--glass-text-muted)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <p className="font-semibold text-[var(--glass-text-secondary)]">{t('brand')}</p>
          <p>{t('betaNotice')}</p>
        </div>
        {deploymentFeatures?.showOfficialPublicPages === true ? (
          <nav aria-label={t('navLabel')} className="flex flex-wrap gap-x-5 gap-y-2">
            {FOOTER_LINKS.map((item) => (
              <Link
                key={item.href}
                href={{ pathname: item.href }}
                className="transition-colors hover:text-[var(--glass-text-primary)]"
              >
                {t(`links.${item.labelKey}`)}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>
    </footer>
  )
}
