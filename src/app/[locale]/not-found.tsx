import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'

export default function LocaleNotFoundPage() {
  const t = useTranslations('errors.notFoundPage')
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm font-semibold text-[var(--glass-text-tertiary)]">404</p>
      <h1 className="text-2xl font-semibold text-[var(--glass-text-primary)]">{t('title')}</h1>
      <p className="max-w-md text-sm text-[var(--glass-text-secondary)]">{t('description')}</p>
      <Link
        href={{ pathname: '/workspace' }}
        className="glass-btn-base glass-btn-primary rounded-full px-6 py-2 text-sm font-medium"
      >
        {t('back')}
      </Link>
    </main>
  )
}
