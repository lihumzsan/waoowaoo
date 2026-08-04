'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import type { GlassPricingContent } from './content'
import type { SubscriptionInterval } from '@/lib/billing/subscription-plans'
import {
  CustomRecharge,
  RechargeStatus,
  Tick,
  useRecharge,
  useSubscriptionCheckout,
} from './shared'

function cx(...v: readonly (string | false | null | undefined)[]) {
  return v.filter(Boolean).join(' ')
}

function formatCny(amount: number): string {
  return amount.toLocaleString('en-US')
}

function isCheckValue(value: string): boolean {
  return value === '有' || value.toLowerCase() === 'yes'
}

export default function PricingGlassPageClient({ content }: { readonly content: GlassPricingContent }) {
  const t = useTranslations('pricing.glass')
  const recharge = useRecharge()
  const subscription = useSubscriptionCheckout()
  const [interval, setInterval] = useState<SubscriptionInterval>('month')

  return (
    <div className="glass-page min-h-screen pb-20">
      <main className="relative mx-auto max-w-[86rem] px-6 pt-14">
        {/* 页头 */}
        <header>
          <h1 className="text-[2rem] font-semibold leading-tight tracking-tight text-[var(--glass-text-primary)]">
            {content.title}
          </h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-7 text-[var(--glass-text-secondary)]">
            {content.subtitle}
          </p>
        </header>

        {/* 计费周期切换 */}
        <div className="mt-8 flex items-center gap-1 self-start rounded-full border border-[var(--glass-stroke-base)] p-1 w-fit">
          {(['month', 'year'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setInterval(option)}
              className={cx(
                'rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors',
                interval === option
                  ? 'bg-[var(--glass-accent-from)] text-white'
                  : 'text-[var(--glass-text-secondary)]',
              )}
            >
              {option === 'month' ? t('billingMonthly') : t('billingYearly')}
            </button>
          ))}
        </div>

        {/* 套餐:五档并排 */}
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {content.plans.map((plan) => {
            const featured = plan.featured
            const priced = plan.intervals[interval]
            return (
              <article
                key={plan.id}
                className={cx('glass-surface flex flex-col p-6', featured && 'relative')}
                style={{
                  borderRadius: 'var(--glass-radius-lg)',
                  ...(featured
                    ? { boxShadow: '0 0 0 1.5px var(--glass-accent-from)' }
                    : {}),
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-[var(--glass-text-primary)]">{plan.name}</h2>
                  {featured ? (
                    <span className="rounded-full bg-[var(--glass-tone-info-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--glass-tone-info-fg)]">
                      {t('featuredBadge')}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 min-h-[2.5rem] text-[13px] leading-5 text-[var(--glass-text-tertiary)]">{plan.tagline}</p>

                <div className="mt-5 flex items-baseline gap-1.5">
                  <span className="glass-num text-[1.75rem] font-semibold leading-none tracking-tight text-[var(--glass-text-primary)]">
                    ¥{formatCny(priced.monthlyEquivalentCny)}
                  </span>
                  <span className="text-[13px] text-[var(--glass-text-tertiary)]">{t('perMonth')}</span>
                </div>
                {interval === 'year' ? (
                  <p className="glass-num mt-1 min-h-[1.25rem] text-[12px] text-[var(--glass-text-tertiary)]">
                    {t('billedYearly', { amount: formatCny(priced.periodPriceCny) })}
                    {priced.savingsVersusMonthlyCny > 0 ? (
                      <span className="ml-1.5 rounded-full bg-[var(--glass-tone-success-bg)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--glass-tone-success-fg)]">
                        {t('yearlySaveBadge', { amount: formatCny(priced.savingsVersusMonthlyCny) })}
                      </span>
                    ) : null}
                  </p>
                ) : (
                  <p className="glass-num mt-1 min-h-[1.25rem] text-[12px] text-[var(--glass-tone-success-fg)]">
                    {plan.firstMonthPromoCny !== null
                      ? t('firstMonthPromo', { amount: formatCny(plan.firstMonthPromoCny) })
                      : ''}
                  </p>
                )}
                <p className="glass-num mt-1.5 text-[13px] text-[var(--glass-text-secondary)]">
                  {t('creditsPerMonth', { credits: plan.credits })}
                </p>

                <div className="glass-divider my-5" />

                <ul className="flex flex-1 flex-col gap-2 text-[13px] leading-6 text-[var(--glass-text-secondary)]">
                  {plan.details.map((d) => (
                    <li key={d} className="flex items-start gap-2">
                      <Tick className="mt-1 h-3.5 w-3.5 shrink-0 text-[var(--glass-tone-success-fg)]" />
                      {d}
                    </li>
                  ))}
                </ul>

                <button
                  type="button"
                  disabled={subscription.busy}
                  onClick={() => subscription.start(plan.id, interval)}
                  className={cx(
                    'glass-btn-base mt-6 h-10 w-full rounded-xl text-sm disabled:cursor-not-allowed disabled:opacity-50',
                    featured ? 'glass-btn-primary' : 'glass-btn-secondary',
                  )}
                >
                  {subscription.busy ? t('subscribeBusy') : t('subscribe')}
                </button>
              </article>
            )
          })}
        </div>
        <RechargeStatus status={subscription.status} />

        {/* 一次性充值:订阅之外的补充 */}
        <div
          className="glass-surface-soft mt-6 px-6 py-5"
          style={{ borderRadius: 'var(--glass-radius-lg)' }}
        >
          <h2 className="mb-3 text-sm font-semibold text-[var(--glass-text-primary)]">{t('oneOffTitle')}</h2>
          <CustomRecharge recharge={recharge} />
        </div>

        {/* 套餐对比 */}
        <section className="mt-12">
          <h2 className="text-sm font-semibold text-[var(--glass-text-primary)]">{t('compareTitle')}</h2>
          <div
            className="glass-surface mt-3 overflow-hidden"
            style={{ borderRadius: 'var(--glass-radius-sm)' }}
          >
            <div
              className="grid text-[13px]"
              style={{ gridTemplateColumns: `1.4fr repeat(${content.plans.length}, 1fr)` }}
            >
              <div className="px-4 py-3" />
              {content.plans.map((p) => (
                <div key={p.id} className="px-3 py-3 text-center text-[13px] font-semibold text-[var(--glass-text-primary)]">
                  {p.name}
                </div>
              ))}
            </div>
            {content.compareRows.map((row) => (
              <div
                key={row.label}
                className="grid border-t border-[var(--glass-stroke-base)] text-[13px]"
                style={{ gridTemplateColumns: `1.4fr repeat(${content.plans.length}, 1fr)` }}
              >
                <div className="px-4 py-3 text-[var(--glass-text-tertiary)]">{row.label}</div>
                {row.values.map((v, ci) => (
                  <div key={ci} className="flex items-center justify-center px-3 py-3 text-[var(--glass-text-secondary)]">
                    {isCheckValue(v) ? <Tick className="h-3.5 w-3.5 text-[var(--glass-tone-success-fg)]" /> : v}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>

        {/* 细则:统一收敛为页脚小字 */}
        <section className="mt-12 border-t border-[var(--glass-stroke-base)] pt-6 text-xs leading-5 text-[var(--glass-text-tertiary)]">
          <div className="grid gap-x-10 gap-y-4 sm:grid-cols-2">
            <div>
              <h3 className="font-semibold text-[var(--glass-text-secondary)]">{content.creditPolicy.title}</h3>
              <p className="mt-1">{content.creditPolicy.body}</p>
            </div>
            <div>
              <h3 className="font-semibold text-[var(--glass-text-secondary)]">{t('paymentTitle')}</h3>
              <p className="mt-1">{content.paymentNote}</p>
            </div>
          </div>

          <dl className="mt-5 grid gap-x-10 gap-y-3 sm:grid-cols-2">
            {content.faqs.map((f) => (
              <div key={f.q}>
                <dt className="font-semibold text-[var(--glass-text-secondary)]">{f.q}</dt>
                <dd className="mt-0.5">{f.a}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="font-semibold text-[var(--glass-text-secondary)]">{content.merchant.title}</span>
            {content.merchant.fields.map((f) => (
              <span key={f.label}>
                {f.label} {f.value}
              </span>
            ))}
            <Link
              href={{ pathname: '/contact' }}
              className="text-[var(--glass-tone-info-fg)] transition-colors hover:underline"
            >
              {t('merchantMoreLink')}
            </Link>
          </div>
        </section>
      </main>
    </div>
  )
}
