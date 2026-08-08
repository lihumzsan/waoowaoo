'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { UserErrorAction } from '@/lib/errors/projection'

export function UserErrorActionLink({
  action,
  className,
}: {
  readonly action: UserErrorAction
  readonly className?: string
}) {
  const t = useTranslations('errors.actions')
  if (action !== 'recharge') return null

  return (
    <Link href="/pricing" className={className}>
      {t('recharge')}
    </Link>
  )
}
