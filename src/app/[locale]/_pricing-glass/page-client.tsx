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
  useCurrentPlan,
} from './shared'
import { useWechatRecharge, WechatQrDialog } from './wechat-recharge'
import { PlanPaymentDialog } from './plan-payment-dialog'
import type { PaidBetaCampaignView } from '@/lib/paid-beta/campaign'

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
                    : 'bg-[var(--glass-tone-success-bg)] text-[var(--glass-tone-success-fg)] shadow-[var(--glass-tone-shadow)]',
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
 * "9,000 credits" means nothing to someone choosing a plan; "about 134 images
 * or 29 clips" is the comparison they are actually making, so it gets the
 * visual weight that a feature list repeated across all five cards does not
 * deserve.
 */
function PlanCapacity({ plan }: { readonly plan: GlassPlan }) {
  const t = useTranslations('pricing.glass')
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 rounded-2xl bg-[var(--glass-bg-muted)] px-3.5 py-4">
      <div className="min-w-0">
        <AppIcon
          name="video"
          className="h-4 w-4 text-[var(--glass-accent-from)]"
          aria-hidden="true"
        />
        <p className="mt-3 text-[12px] leading-5 text-[var(--glass-text-primary)]">
          <span className="glass-num font-semibold">
            {t('capacityVideos', { count: formatCny(plan.monthlyVideos) })}
          </span>
        </p>
      </div>
      <div className="min-w-0">
        <AppIcon
          name="image"
          className="h-4 w-4 text-[var(--glass-accent-from)]"
          aria-hidden="true"
        />
        <p className="mt-3 text-[12px] leading-5 text-[var(--glass-text-primary)]">
          <span className="glass-num font-semibold">
            {t('capacityImages', { count: formatCny(plan.monthlyImages) })}
          </span>
        </p>
      </div>
    </div>
  )
}

function PlanCard({
  plan,
  interval,
  busy,
  onSubscribe,
  owned,
  paymentOpen,
}: {
  readonly plan: GlassPlan
  readonly interval: SubscriptionInterval
  readonly busy: boolean
  readonly onSubscribe: () => void
  /** True when this is the plan the signed-in visitor already holds. */
  readonly owned: boolean
  readonly paymentOpen: boolean
}) {
  const t = useTranslations('pricing.glass')
  const priced = plan.intervals[interval]
  const featured = plan.featured

  return (
    <article
      className="glass-surface relative flex h-full flex-col border border-[var(--glass-stroke-base)] p-5 transition-[border-color,box-shadow,transform]"
      style={{
        borderRadius: 'var(--glass-radius-lg)',
        ...(owned
          ? { boxShadow: '0 0 0 1.5px var(--glass-accent-from), 0 18px 44px -30px var(--glass-accent-shadow-strong)' }
          : featured
            ? { boxShadow: '0 0 0 1px var(--glass-accent-from), 0 18px 44px -30px var(--glass-accent-shadow-strong)' }
            : { boxShadow: '0 16px 42px -36px rgba(15, 23, 42, 0.45)' }),
      }}
    >
      <div className="flex min-h-7 items-start justify-between gap-2">
        <h2 className="text-[17px] font-semibold tracking-tight text-[var(--glass-text-primary)]">
          {plan.label}
        </h2>
        {owned || featured ? (
          <span className="shrink-0 rounded-full bg-[var(--glass-tone-info-bg)] px-2.5 py-1 text-[10px] font-semibold leading-none text-[var(--glass-accent-from)] shadow-[var(--glass-tone-shadow)]">
            {owned ? t('currentPlanBadge') : t('featuredBadge')}
          </span>
        ) : null}
      </div>
      <p className="mt-1 min-h-[2.5rem] text-[12px] leading-5 text-[var(--glass-text-tertiary)]">
        {plan.tagline}
      </p>

      {/* Fixed heights on the price rows keep all five cards aligned even
          though only some of them carry a promo or a yearly total. */}
      <div className="mt-5 flex items-baseline gap-1.5">
        <span className="glass-num text-[2rem] font-semibold leading-none tracking-[-0.035em] text-[var(--glass-text-primary)]">
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
              <span className="glass-num rounded-full bg-[var(--glass-tone-success-bg)] px-1.5 py-0.5 font-semibold text-[var(--glass-tone-success-fg)] shadow-[var(--glass-tone-shadow)]">
                {t('yearlySaveBadge', { amount: formatCny(priced.savingsVersusMonthlyCny) })}
              </span>
            ) : null}
          </>
        ) : plan.firstMonthPromoCny !== null ? (
          <span className="glass-num rounded-full bg-[var(--glass-tone-success-bg)] px-1.5 py-0.5 font-semibold text-[var(--glass-tone-success-fg)] shadow-[var(--glass-tone-shadow)]">
            {t('firstMonthPromo', { amount: formatCny(plan.firstMonthPromoCny) })}
          </span>
        ) : null}
      </div>

      <p className="glass-num mt-5 text-[13px] font-semibold text-[var(--glass-text-primary)]">
        {t('creditsPerMonth', { credits: formatCny(plan.creditsAmount) })}
      </p>

      <PlanCapacity plan={plan} />

      <ul className="mt-5 flex flex-1 flex-col gap-2 text-[12px] leading-5 text-[var(--glass-text-secondary)]">
        {plan.details.map((d) => (
          <li key={d} className="flex items-start gap-2">
            <Tick className="mt-1 h-3 w-3 shrink-0 text-[var(--glass-accent-from)]" />
            {d}
          </li>
        ))}
      </ul>

      <button
        type="button"
        disabled={busy || !paymentOpen}
        onClick={onSubscribe}
        className="glass-btn-base glass-btn-primary mt-6 h-11 w-full rounded-xl text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
      >
        {!paymentOpen ? t('paidBetaSoldOutCta') : busy ? t('subscribeBusy') : owned ? t('planExtendCta') : t('subscribe')}
      </button>
    </article>
  )
}

export default function PricingGlassPageClient({
  content,
  paidBetaCampaign,
}: {
  readonly content: GlassPricingContent
  readonly paidBetaCampaign: PaidBetaCampaignView
}) {
  const t = useTranslations('pricing.glass')
  const beta = useTranslations('paidBeta')
  const recharge = useRecharge()
  const purchase = usePlanPurchase()
  // Nothing to do the moment credits land: the dialog shows its success state
  // and the page refreshes when the user closes it, so the confirmation is not
  // yanked away by a reload.
  const wechat = useWechatRecharge(recharge.config, useCallback(() => {}, []))
  const [interval, setInterval] = useState<SubscriptionInterval>('month')
  // Which plan's payment dialog is open. Clicking a card opens the choice
  // of method rather than committing to one.
  const [payingFor, setPayingFor] = useState<GlassPlan | null>(null)
  const currentPlan = useCurrentPlan()

  return (
    <div className="glass-page min-h-screen pb-20">
      <main className="relative mx-auto max-w-[84rem] px-6 pt-14">
        <header className="flex flex-col items-center text-center">
          <section className="glass-surface-soft w-full max-w-3xl rounded-3xl border border-[var(--glass-accent-from)]/25 px-5 py-4 text-left shadow-[0_16px_45px_-35px_rgba(47,123,255,0.9)] sm:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--glass-accent-from)]">
                  {beta('eyebrow')}
                </p>
                <h2 className="mt-1 text-[17px] font-semibold text-[var(--glass-text-primary)]">
                  {beta('headline')}
                </h2>
                <p className="mt-1 text-[13px] leading-6 text-[var(--glass-text-secondary)]">
                  {beta('benefit')}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-center rounded-2xl bg-[var(--glass-tone-info-bg)] px-8 py-4 text-center shadow-[var(--glass-tone-shadow)]">
                <p className="text-[12px] font-semibold text-[var(--glass-tone-info-fg)]">
                  {paidBetaCampaign.paymentOpen ? beta('seatsLeftLabel') : beta('soldOut')}
                </p>
                <p className="glass-num mt-1 bg-gradient-to-br from-[var(--glass-accent-from)] to-[var(--glass-accent-to)] bg-clip-text text-[56px] font-bold leading-none tracking-tight text-transparent">
                  {paidBetaCampaign.paymentOpen ? paidBetaCampaign.remaining : 0}
                </p>
                <p className="mt-1.5 text-[11px] font-medium text-[var(--glass-tone-info-fg)]">
                  {beta('seatCap', { capacity: paidBetaCampaign.capacity })}
                </p>
              </div>
            </div>
            {!paidBetaCampaign.paymentOpen ? (
              <p className="mt-3 text-[12px] text-[var(--glass-text-tertiary)]">{beta('soldOutHint')}</p>
            ) : null}
          </section>
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
              owned={currentPlan?.planId === plan.id}
              paymentOpen={paidBetaCampaign.paymentOpen}
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
            duration: content.capacityReference.videoDurationSeconds,
            resolution: content.capacityReference.videoResolution,
            videoCredits: content.capacityReference.videoCredits,
            imageCredits: content.capacityReference.imageCredits,
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
              paymentOpen={paidBetaCampaign.paymentOpen}
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
          const settled = wechat.settled !== null
          setPayingFor(null)
          wechat.dismiss()
          if (settled) window.location.reload()
        }}
      />
      {/* The top-up box has its own QR dialog; the plan dialog renders its own. */}
      <WechatQrDialog
        payment={payingFor ? null : wechat.payment}
        settled={payingFor ? null : wechat.settled}
        onClose={wechat.dismiss}
      />
    </div>
  )
}
