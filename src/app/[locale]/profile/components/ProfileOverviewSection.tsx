'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import ProfileTransactionsTable, { type ProfileTransactionItem } from './ProfileTransactionsTable'
import ProfileInviteCodeCard from './ProfileInviteCodeCard'

// 账户概览:大数字额度 hero、用量进度、冻结/已消费统计块与最近流水。
// 只消费 page 传入的权威 balance/transactions 投影,不发起请求。

export interface ProfileBalanceSummary {
  currency?: string
  balance?: number
  frozenAmount?: number
  totalSpent?: number
}

function normalizeAmount(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function formatStatAmount(value: number | undefined): string {
  return normalizeAmount(value).toFixed(2)
}

interface ProfileOverviewSectionProps {
  balance: ProfileBalanceSummary | null
  transactions: readonly ProfileTransactionItem[]
  showUpgrade: boolean
  showInviteCode: boolean
  /** Stripe 回跳后的支付结果提示,由 page 拥有。 */
  paymentNotice: string | null
  onCreditsChanged: () => Promise<void>
  onViewAllTransactions: () => void
}

export default function ProfileOverviewSection({
  balance,
  transactions,
  showUpgrade,
  showInviteCode,
  paymentNotice,
  onCreditsChanged,
  onViewAllTransactions,
}: ProfileOverviewSectionProps) {
  const t = useTranslations('profile')
  const currency = balance?.currency || 'CREDITS'
  const available = normalizeAmount(balance?.balance)
  const spent = normalizeAmount(balance?.totalSpent)
  const total = available + spent
  const usageRatio = total > 0 ? Math.min(1, Math.max(0, available / total)) : 1

  return (
    <div className="space-y-5">
      {paymentNotice ? (
        <div className="glass-surface-elevated flex items-center gap-2.5 px-5 py-3.5 text-sm text-[var(--glass-text-secondary)]">
          <AppIcon name="badgeCheck" className="h-4 w-4 shrink-0 text-[var(--glass-accent-from)]" />
          {paymentNotice}
        </div>
      ) : null}

      {/* 可用额度 hero */}
      <section className="glass-surface-elevated relative overflow-hidden p-7">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-28 h-64 w-64 rounded-full bg-[image:var(--glass-cta-gradient)] opacity-[0.08] blur-2xl"
        />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--glass-text-tertiary)]">
              {t('availableBalance')}
            </div>
            <div className="mt-2 flex items-baseline gap-2.5">
              <span className="glass-stat-figure glass-num text-5xl font-bold tracking-tight">
                {formatStatAmount(balance?.balance)}
              </span>
              <span className="text-sm font-medium text-[var(--glass-text-tertiary)]">{currency}</span>
            </div>
            <div className="mt-1.5 text-xs text-[var(--glass-text-tertiary)]">{t('recharge.unitValue')}</div>
          </div>
          {showUpgrade ? (
            <Link
              href="/pricing"
              className="glass-btn-base glass-btn-cta rounded-xl px-4 py-2.5 text-sm font-semibold"
            >
              <AppIcon name="sparkles" className="h-4 w-4" />
              {t('upgrade')}
            </Link>
          ) : null}
        </div>

        <div className="glass-meter-track mt-6" aria-hidden="true">
          <div className="glass-meter-fill" style={{ width: `${Math.round(usageRatio * 100)}%` }} />
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-[var(--glass-stroke-soft)] bg-white/70 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <p className="text-xs font-medium text-[var(--glass-text-tertiary)]">{t('frozen')}</p>
            <p className="glass-num mt-1 text-xl font-semibold tracking-tight text-[var(--glass-text-primary)]">
              {formatStatAmount(balance?.frozenAmount)}
              <span className="ml-1.5 text-xs font-medium text-[var(--glass-text-tertiary)]">{currency}</span>
            </p>
          </div>
          <div className="rounded-xl border border-[var(--glass-stroke-soft)] bg-white/70 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <p className="text-xs font-medium text-[var(--glass-text-tertiary)]">{t('totalSpent')}</p>
            <p className="glass-num mt-1 text-xl font-semibold tracking-tight text-[var(--glass-text-primary)]">
              {formatStatAmount(balance?.totalSpent)}
              <span className="ml-1.5 text-xs font-medium text-[var(--glass-text-tertiary)]">{currency}</span>
            </p>
          </div>
        </div>
      </section>

      {showInviteCode ? <ProfileInviteCodeCard onCreditsChanged={onCreditsChanged} /> : null}

      {/* 最近账户流水 */}
      <section className="glass-surface-elevated p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold tracking-tight text-[var(--glass-text-primary)]">
            {t('recentTransactions')}
          </h2>
          <button
            type="button"
            className="glass-btn-base glass-btn-soft rounded-xl px-3.5 py-2 text-sm"
            onClick={onViewAllTransactions}
          >
            {t('viewAll')}
            <AppIcon name="arrowRight" className="h-3.5 w-3.5" />
          </button>
        </div>
        <ProfileTransactionsTable items={transactions.slice(0, 5)} currency={balance?.currency} />
      </section>
    </div>
  )
}
