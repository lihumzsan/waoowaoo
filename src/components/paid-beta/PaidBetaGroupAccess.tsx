'use client'

import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'

export default function PaidBetaGroupAccess({
  onDone,
}: {
  readonly onDone: () => void
}) {
  const t = useTranslations('paidBeta')

  return (
    <div className="flex flex-col items-center py-1 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--glass-tone-soft)]">
        <AppIcon
          name="check"
          strokeWidth={2.6}
          className="h-6 w-6 text-[var(--glass-tone-success-fg)]"
          aria-hidden="true"
        />
      </span>
      <h3 className="mt-3 text-[17px] font-semibold text-[var(--glass-text-primary)]">
        {t('paymentSuccessTitle')}
      </h3>
      <p className="mt-1 max-w-sm text-[13px] leading-6 text-[var(--glass-text-secondary)]">
        {t('paymentSuccessBody')}
      </p>
      {/* The image route checks the current session and paid seat. Keeping the
          asset outside /public prevents the group entrance from becoming a
          guessable static URL. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/api/paid-beta/group-qr"
        alt={t('groupQrAlt')}
        className="mt-4 h-64 w-64 rounded-2xl border border-[var(--glass-stroke-base)] bg-white object-contain p-2 shadow-sm"
      />
      <p className="mt-3 flex items-center gap-1.5 text-[12px] text-[var(--glass-text-tertiary)]">
        <AppIcon name="usersRound" className="h-3.5 w-3.5" aria-hidden="true" />
        {t('groupQrHint')}
      </p>
      <button
        type="button"
        onClick={onDone}
        className="glass-btn-base glass-btn-primary mt-5 h-10 w-full rounded-xl text-[13px] font-medium"
      >
        {t('done')}
      </button>
    </div>
  )
}
