'use client'

import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import ProfileTransactionsTable, { type ProfileTransactionItem } from './ProfileTransactionsTable'

// 账户流水:完整流水表 + 刷新。只消费 page 传入的权威数据。

interface ProfileBillingSectionProps {
  transactions: readonly ProfileTransactionItem[]
  currency?: string
  onRefresh: () => void
}

export default function ProfileBillingSection({
  transactions,
  currency,
  onRefresh,
}: ProfileBillingSectionProps) {
  const t = useTranslations('profile')

  return (
    <section className="glass-surface-elevated p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold tracking-tight text-[var(--glass-text-primary)]">
          {t('accountTransactions')}
        </h2>
        <button
          type="button"
          className="glass-btn-base glass-btn-soft rounded-xl px-3.5 py-2 text-sm"
          onClick={onRefresh}
        >
          <AppIcon name="refresh" className="h-3.5 w-3.5" />
          {t('refresh')}
        </button>
      </div>
      <ProfileTransactionsTable items={transactions} currency={currency} />
    </section>
  )
}
