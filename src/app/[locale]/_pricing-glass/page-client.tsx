'use client'

import { useCallback, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/ui/icons'
import type { GlassPlan, GlassPricingContent } from './content'
import type { SubscriptionInterval } from '@/lib/billing/subscription-plans'
import {
  CustomRecharge,
  RechargeStatus,
  Tick,
  useRecharge,
  usePlanPurchase,
} from './shared'
import { useWechatRecharge, WechatQrDialog } from './wechat-recharge'
import { PlanPaymentDialog } from './plan-payment-dialog'

function cx(...v: readonly (string | false | null | undefined)[]) {
  return v.filter(Boolean).join(' ')
}

function formatCny(amount: number): string {
  return amount.toLocaleString('en-US')
}

/**
 * Billing-cycle switch.
 *
 * The yearly side carries its own incentive rather than leaving the user to
 * work the difference out from two prices.
 */
function IntervalSwitch({
  value,
  onChange,
}: {
  readonly value: SubscriptionInterval
  readonly onChange: (next: SubscriptionInterval) => void
}) {
  const t = useTranslations('pricing.glass')
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-[var(--glass-stroke-base)] p-1">
      {(['month', 'year'] as const).map((option) => {
        const active = value === option
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option)}
            className={cx(
              'flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-medium transition-all',
              active
                ? 'bg-[var(--glass-accent-from)] text-white shadow-sm'
                : 'text-[var(--glass-text-secondary)] hover:text-[var(--glass-text-primary)]',
            )}
          >
            {option === 'month' ? t('billingMonthly') : t('billingYearly')}
            {option === 'year' ? (
              <span
                className={cx(
                  'rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none',
                  active
                    ? 'bg-white/20 text-white'
                    : 'bg-[var(--glass-tone-success-bg)] text-[var(--glass-tone-success-fg)]',
                )}
              >
                {t('yearlySaveHint')}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

/**
 * The capacity block is the card's real differentiator.
 *
 * "5,600 credits" means nothing to someone choosing a plan; "about 180 images
 * or 29 clips" is the comparison they are actually making, so it gets the
 * visual weight that a feature list repeated across all five cards does not
 * deserve.
 */
function PlanCapacity({ plan }: { readonly plan: GlassPlan }) {
  const t = useTranslations('pricing.glass')
  return (
    <div className="mt-4 rounded-xl border border-[var(--glass-stroke-base)] px-3 py-3">
      <p className="text-[11px] font-medium tracking-wide text-[var(--glass-text-tertiary)]">
        {t('capacityTitle')}
      </p>
      <div className="mt-2 flex flex-col gap-1.5">
        <span className="flex items-center gap-2 text-[13px] text-[var(--glass-text-primary)]">
          <AppIcon name="image" className="h-3.5 w-3.5 shrink-0 text-[var(--glass-text-tertiary)]" aria-hidden="true" />
          <span className="glass-num font-semibold">
            {t('capacityImages', { count: formatCny(plan.monthlyImages) })}
          </span>
        </span>
        <span className="flex items-center gap-2 text-[13px] text-[var(--glass-text-primary)]">
          <AppIcon name="video" className="h-3.5 w-3.5 shrink-0 text-[var(--glass-text-tertiary)]" aria-hidden="true" />
          <span className="glass-num font-semibold">
            {t('capacityVideos', { count: formatCny(plan.monthlyVideos) })}
          </span>
        </span>
      </div>
    </div>
  )
}

function PlanCard({
  plan,
  interval,
  busy,
  onSubscribe,
}: {
  readonly plan: GlassPlan
  readonly interval: SubscriptionInterval
  readonly busy: boolean
  readonly onSubscribe: () => void
}) {
  const t = useTranslations('pricing.glass')
  const priced = plan.intervals[interval]
  const featured = plan.featured

  return (
    <article
      className="glass-surface relative flex flex-col p-5"
      style={{
        borderRadius: 'var(--glass-radius-lg)',
        ...(featured
          ? { boxShadow: '0 0 0 1.5px var(--glass-accent-from), 0 8px 30px -12px rgba(0,0,0,0.25)' }
          : {}),
      }}
    >
      {featured ? (
        <span className="absolute -top-2.5 left-5 rounded-full bg-[var(--glass-accent-from)] px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-white">
          {t('featuredBadge')}
        </span>
      ) : null}

      <h2 className="text-[15px] font-semibold text-[var(--glass-text-primary)]">{plan.label}</h2>
      <p className="mt-1 min-h-[2.5rem] text-[12px] leading-5 text-[var(--glass-text-tertiary)]">
        {plan.tagline}
      </p>

      {/* Fixed heights on the price rows keep all five cards aligned even
          though only some of them carry a promo or a yearly total. */}
      <div className="mt-3 flex items-baseline gap-1">
        <span className="glass-num text-[1.75rem] font-semibold leading-none tracking-tight text-[var(--glass-text-primary)]">
          ¥{formatCny(interval === 'year' ? priced.monthlyEquivalentCny : priced.periodPriceCny)}
        </span>
        <span className="text-[12px] text-[var(--glass-text-tertiary)]">{t('perMonth')}</span>
      </div>
      <div className="mt-1.5 flex min-h-[1.25rem] flex-wrap items-center gap-1.5 text-[11px]">
        {interval === 'year' ? (
          <>
            <span className="glass-num text-[var(--glass-text-tertiary)]">
              {t('billedYearly', { amount: formatCny(priced.periodPriceCny) })}
            </span>
            {priced.savingsVersusMonthlyCny > 0 ? (
              <span className="glass-num rounded-full bg-[var(--glass-tone-success-bg)] px-1.5 py-0.5 font-semibold text-[var(--glass-tone-success-fg)]">
                {t('yearlySaveBadge', { amount: formatCny(priced.savingsVersusMonthlyCny) })}
              </span>
            ) : null}
          </>
        ) : plan.firstMonthPromoCny !== null ? (
          <span className="glass-num rounded-full bg-[var(--glass-tone-success-bg)] px-1.5 py-0.5 font-semibold text-[var(--glass-tone-success-fg)]">
            {t('firstMonthPromo', { amount: formatCny(plan.firstMonthPromoCny) })}
          </span>
        ) : null}
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={onSubscribe}
        className={cx(
          'glass-btn-base mt-4 h-10 w-full rounded-xl text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-50',
          featured ? 'glass-btn-primary' : 'glass-btn-secondary',
        )}
      >
        {busy ? t('subscribeBusy') : t('subscribe')}
      </button>

      <p className="glass-num mt-3 text-center text-[12px] text-[var(--glass-text-secondary)]">
        {t('creditsPerMonth', { credits: formatCny(plan.creditsAmount) })}
      </p>

      <PlanCapacity plan={plan} />

      <ul className="mt-4 flex flex-1 flex-col gap-1.5 text-[12px] leading-5 text-[var(--glass-text-secondary)]">
        {plan.details.map((d) => (
          <li key={d} className="flex items-start gap-1.5">
            <Tick className="mt-1 h-3 w-3 shrink-0 text-[var(--glass-tone-success-fg)]" />
            {d}
          </li>
        ))}
      </ul>
    </article>
  )
}

export default function PricingGlassPageClient({ content }: { readonly content: GlassPricingContent }) {
  const t = useTranslations('pricing.glass')
  const recharge = useRecharge()
  const purchase = usePlanPurchase()
  const wechat = useWechatRecharge(recharge.config, useCallback(() => {
    // Credits landed. A reload is the simplest way to make every balance the
    // page shows agree with the ledger again.
    window.location.reload()
  }, []))
  const [interval, setInterval] = useState<SubscriptionInterval>('month')
  // Which plan's payment dialog is open. Clicking a card opens the choice
  // of method rather than committing to one.
  const [payingFor, setPayingFor] = useState<GlassPlan | null>(null)

  return (
    <div className="glass-page min-h-screen pb-20">
      <main className="relative mx-auto max-w-[84rem] px-6 pt-14">
        <header className="flex flex-col items-center text-center">
          <h1 className="text-[2.25rem] font-semibold leading-tight tracking-tight text-[var(--glass-text-primary)]">
            {content.title}
          </h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-7 text-[var(--glass-text-secondary)]">
            {content.subtitle}
          </p>
          <div className="mt-7">
            <IntervalSwitch value={interval} onChange={setInterval} />
          </div>
        </header>

        <div className="mt-10 grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {content.plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              interval={interval}
              busy={purchase.busy}
              onSubscribe={() => setPayingFor(plan)}
            />
          ))}
        </div>
        <RechargeStatus status={purchase.status} />

        {/* Plans are bought, not subscribed to — say so before checkout rather
            than letting the user discover it at renewal time. */}
        <p className="mx-auto mt-6 max-w-3xl text-center text-[12px] leading-5 text-[var(--glass-text-tertiary)]">
          {t('planNoAutoRenew')}
        </p>

        {/* The maths behind every card's capacity claim, stated once instead of
            repeated inside each of them. */}
        <p className="mx-auto mt-7 max-w-4xl text-center text-[12px] leading-5 text-[var(--glass-text-tertiary)]">
          {t('capacityFootnote', {
            unit: content.creditUnitCny,
            imageCredits: content.capacityReference.imageCredits,
            duration: content.capacityReference.videoDurationSeconds,
            resolution: content.capacityReference.videoResolution,
            videoCredits: content.capacityReference.videoCredits,
          })}
        </p>

        <section
          className="glass-surface-soft mt-10 px-6 py-5"
          style={{ borderRadius: 'var(--glass-radius-lg)' }}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-[var(--glass-text-primary)]">{t('oneOffTitle')}</h2>
            <p className="text-[12px] text-[var(--glass-text-tertiary)]">{t('oneOffHint')}</p>
          </div>
          <div className="mt-4">
            <CustomRecharge
              recharge={recharge}
              wechat={{
                available: wechat.available,
                busy: wechat.busy,
                start: (credits) => wechat.start({ kind: 'recharge', credits }),
              }}
            />
          </div>
          <RechargeStatus status={wechat.status} />
        </section>

        <section className="mt-14">
          <h2 className="text-sm font-semibold text-[var(--glass-text-primary)]">{t('faqTitle')}</h2>
          <dl className="mt-4 grid gap-x-10 gap-y-5 text-[13px] leading-6 sm:grid-cols-2">
            {content.faqs.map((f) => (
              <div key={f.q}>
                <dt className="font-medium text-[var(--glass-text-primary)]">{f.q}</dt>
                <dd className="mt-1 text-[var(--glass-text-secondary)]">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>

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

          <div className="mt-6 flex flex-wrap items-baseline gap-x-4 gap-y-1">
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
      <PlanPaymentDialog
        plan={payingFor}
        interval={interval}
        cardBusy={purchase.busy}
        wechat={wechat}
        onPayWithCard={() => {
          if (payingFor) purchase.start(payingFor.id, interval)
        }}
        onClose={() => {
          setPayingFor(null)
          wechat.dismiss()
        }}
      />
      {/* The top-up box has its own QR dialog; the plan dialog renders its own. */}
      <WechatQrDialog
        payment={payingFor ? null : wechat.payment}
        onClose={wechat.dismiss}
      />
    </div>
  )
}
