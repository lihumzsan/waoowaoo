'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import ProfileTransactionsTable, { type ProfileTransactionItem } from './ProfileTransactionsTable'
import { formatCredits } from '@/lib/billing/credits'

// 账户概览:大数字额度 hero、用量进度、冻结/已消费统计块与最近流水。
// 只消费 page 传入的权威 balance/transactions 投影,不发起请求。

export interface ProfileBalanceSummary {
  currency?: string
  /** Spendable total: unexpired plan credits plus bought credits. */
  balance?: number
  /** Bought outright. Never expires. */
  rechargeCredits?: number
  /** Granted by the current plan period. Cleared when the period ends. */
  subscriptionCredits?: number
  subscriptionExpiresAt?: string | null
  frozenAmount?: number
  totalSpent?: number
  subscription?: {
    planId: string
    /** What the plan grants each period — distinct from what is left of it. */
    monthlyCredits: number
    interval: string
    status: string
    currentPeriodEnd: string
  } | null
}

/**
 * Each tier gets its own accent so a glance at the card says which plan is in
 * force — a page where every plan looks identical gives the user nothing to
 * recognise, and nothing to want.
 *
 * The accent is an ink, not a fill: it colours the badge text, the meter and
 * the corner glow, while the badge surface stays white like every other tone
 * surface. See the tone system in ui-tokens-glass.css.
 */
const PLAN_INKS: Record<string, string> = {
  starter: '#52525b',
  creator: '#1d4ed8',
  pro: '#6d28d9',
  studio: '#b45309',
  flagship: '#be123c',
}

function planInk(planId: string | undefined): string | null {
  return (planId && PLAN_INKS[planId]) || null
}

function normalizeAmount(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function formatStatAmount(value: number | undefined): string {
  return formatCredits(normalizeAmount(value))
}

function daysUntil(iso: string): number {
  const end = new Date(iso).getTime()
  if (Number.isNaN(end)) return 0
  return Math.max(0, Math.ceil((end - Date.now()) / (24 * 60 * 60 * 1000)))
}

function formatDay(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  // Fixed parts rather than a locale format, so server and client agree.
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

interface ProfileOverviewSectionProps {
  balance: ProfileBalanceSummary | null
  transactions: readonly ProfileTransactionItem[]
  showUpgrade: boolean
  /** Stripe 回跳后的支付结果提示,由 page 拥有。 */
  paymentNotice: string | null
  onViewAllTransactions: () => void
}

export default function ProfileOverviewSection({
  balance,
  transactions,
  showUpgrade,
  paymentNotice,
  onViewAllTransactions,
}: ProfileOverviewSectionProps) {
  const t = useTranslations('profile')
  const currency = balance?.currency || 'CREDITS'
  const available = normalizeAmount(balance?.balance)
  const spent = normalizeAmount(balance?.totalSpent)
  const total = available + spent
  const usageRatio = total > 0 ? Math.min(1, Math.max(0, available / total)) : 1
  const subscription = balance?.subscription ?? null
  const ink = planInk(subscription?.planId)

  return (
    <div className="space-y-5">
      {paymentNotice ? (
        <div className="glass-surface-elevated flex items-center gap-2.5 px-5 py-3.5 text-sm text-[var(--glass-text-secondary)]">
          <AppIcon name="badgeCheck" className="h-4 w-4 shrink-0 text-[var(--glass-accent-from)]" />
          {paymentNotice}
        </div>
      ) : null}

      {/* Plan and balance are one fact — what you have, and what keeps refilling
          it. Split across two cards they read as unrelated numbers. */}
      <section className="glass-surface-elevated relative overflow-hidden p-7">
        {/* The plan reads from the corner glow and the badge ink. A hard bar
            across the top read as a loading indicator, not as a plan. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-28 h-64 w-64 rounded-full blur-2xl"
          style={
            ink
              ? { background: `radial-gradient(circle, ${ink}24, transparent 70%)` }
              : { backgroundImage: 'var(--glass-cta-gradient)', opacity: 0.08 }
          }
        />

        <div className="relative flex flex-wrap items-start justify-between gap-4">
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

          {subscription && ink ? (
            <div className="flex flex-col items-end gap-2">
              <span
                className="glass-chip px-3 py-1.5 text-[13px]"
                style={{ color: ink }}
              >
                <AppIcon name="sparkles" className="h-3.5 w-3.5" />
                {t(`planNames.${subscription.planId}` as 'planNames.creator')}
              </span>
              <p className="glass-num text-[12px] text-[var(--glass-text-tertiary)]">
                {t('planEndsAt')} {formatDay(subscription.currentPeriodEnd)}
                <span className="mx-1.5 opacity-40">·</span>
                {t('planDaysLeft', { days: daysUntil(subscription.currentPeriodEnd) })}
              </p>
              {showUpgrade ? (
                <Link
                  href="/pricing"
                  className="glass-btn-base glass-btn-soft rounded-lg px-3 py-1.5 text-xs font-semibold"
                >
                  {t('planExtend')}
                  <AppIcon name="arrowRight" className="h-3 w-3" />
                </Link>
              ) : null}
            </div>
          ) : showUpgrade ? (
            <Link
              href="/pricing"
              className="glass-btn-base glass-btn-cta rounded-xl px-4 py-2.5 text-sm font-semibold"
            >
              <AppIcon name="sparkles" className="h-4 w-4" />
              {t('upgrade')}
            </Link>
          ) : null}
        </div>

        <div className="glass-meter-track relative mt-6" aria-hidden="true">
          <div
            className="glass-meter-fill"
            style={{
              width: `${Math.round(usageRatio * 100)}%`,
              ...(ink ? { background: `linear-gradient(90deg, ${ink}, ${ink}99)` } : {}),
            }}
          />
        </div>

        {/* The two pools behave differently — one expires, one does not — so a
            single total hides the thing a user most needs to know. */}
        <div className="relative mt-5 grid grid-cols-2 gap-3">
          {/* Both pools share one stroke. The plan already identifies itself
              through the badge ink, the corner glow and the meter. */}
          <div className="rounded-xl border border-[var(--glass-stroke-soft)] bg-white/70 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <p className="text-xs font-medium text-[var(--glass-text-tertiary)]">{t('planCredits')}</p>
            <p className="glass-num mt-1 text-xl font-semibold tracking-tight text-[var(--glass-text-primary)]">
              {formatStatAmount(balance?.subscriptionCredits)}
              <span className="ml-1.5 text-xs font-medium text-[var(--glass-text-tertiary)]">{currency}</span>
            </p>
            {/* Remaining and granted are different numbers; showing only one of
                them under a plan name is how a part-spent month reads as wrong. */}
            {subscription ? (
              <p className="glass-num mt-1 text-[11px] text-[var(--glass-text-tertiary)]">
                {t('planMonthlyGrant', { credits: formatCredits(subscription.monthlyCredits) })}
                {balance?.subscriptionExpiresAt ? (
                  <>
                    <span className="mx-1 opacity-40">·</span>
                    {t('planCreditsExpireOn', { date: formatDay(balance.subscriptionExpiresAt) })}
                  </>
                ) : null}
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-[var(--glass-text-tertiary)]">{t('planCreditsNone')}</p>
            )}
          </div>
          <div className="rounded-xl border border-[var(--glass-stroke-soft)] bg-white/70 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            <p className="text-xs font-medium text-[var(--glass-text-tertiary)]">{t('boughtCredits')}</p>
            <p className="glass-num mt-1 text-xl font-semibold tracking-tight text-[var(--glass-text-primary)]">
              {formatStatAmount(balance?.rechargeCredits)}
              <span className="ml-1.5 text-xs font-medium text-[var(--glass-text-tertiary)]">{currency}</span>
            </p>
            <p className="mt-1 text-[11px] text-[var(--glass-text-tertiary)]">{t('boughtCreditsNeverExpire')}</p>
          </div>
        </div>

        <div className="relative mt-3 grid grid-cols-2 gap-3">
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
