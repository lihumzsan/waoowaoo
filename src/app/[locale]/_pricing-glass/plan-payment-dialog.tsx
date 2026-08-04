'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import GlassModalShell from '@/components/ui/primitives/GlassModalShell'
import { AppIcon } from '@/components/ui/icons'
import type { GlassPlan } from './content'
import type { SubscriptionInterval } from '@/lib/billing/subscription-plans'
import type { WechatRechargeState } from './wechat-recharge'

/**
 * Choosing how to pay for a plan.
 *
 * Clicking a plan used to jump straight to Stripe's hosted page, which is a
 * redirect away from the site and asks for an email and a name that a QR scan
 * does not need. The methods are offered here instead, and the one that can
 * stay on the page does: WeChat renders its QR in this same dialog, and only
 * the card flow — which genuinely needs Stripe's hosted form — leaves.
 */

export type PlanPaymentMethod = 'wechat' | 'card'

function cx(...v: readonly (string | false | null | undefined)[]) {
  return v.filter(Boolean).join(' ')
}

function MethodRow({
  icon,
  label,
  hint,
  busy,
  onClick,
}: {
  readonly icon: 'wechat' | 'card'
  readonly label: string
  readonly hint: string
  readonly busy: boolean
  readonly onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="glass-surface-soft flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-[var(--glass-surface-hover,rgba(127,127,127,0.06))] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        className={cx(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
          icon === 'wechat' ? 'bg-[#07C160]' : 'bg-[var(--glass-accent-from)]',
        )}
      >
        <AppIcon
          name={icon === 'wechat' ? 'coins' : 'receipt'}
          className="h-4 w-4 text-white"
          aria-hidden="true"
        />
      </span>
      <span className="flex-1">
        <span className="block text-[14px] font-medium text-[var(--glass-text-primary)]">{label}</span>
        <span className="block text-[12px] text-[var(--glass-text-tertiary)]">{hint}</span>
      </span>
      <AppIcon name="chevronRight" className="h-4 w-4 text-[var(--glass-text-tertiary)]" aria-hidden="true" />
    </button>
  )
}

export function PlanPaymentDialog({
  plan,
  interval,
  onClose,
  wechat,
  cardBusy,
  onPayWithCard,
}: {
  readonly plan: GlassPlan | null
  readonly interval: SubscriptionInterval
  readonly onClose: () => void
  readonly wechat: WechatRechargeState
  readonly cardBusy: boolean
  readonly onPayWithCard: () => void
}) {
  const t = useTranslations('pricing.glass')
  const [method, setMethod] = useState<PlanPaymentMethod | null>(null)

  // Reopening for a different plan must not inherit the previous choice.
  useEffect(() => {
    if (!plan) setMethod(null)
  }, [plan])

  if (!plan) return null
  const settled = wechat.settled
  const priced = plan.intervals[interval]
  const chargedCny = interval === 'month' && plan.firstMonthPromoCny !== null
    ? plan.firstMonthPromoCny
    : priced.periodPriceCny
  const qr = wechat.payment

  return (
    <GlassModalShell
      open
      onClose={onClose}
      size="sm"
      title={t('planDialogTitle', { plan: plan.label })}
      description={t('planDialogSummary', {
        amount: chargedCny.toLocaleString('en-US'),
        credits: plan.creditsAmount.toLocaleString('en-US'),
      })}
    >
      {settled ? (
        <div className="flex flex-col items-center gap-3 py-6">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--glass-tone-success-bg)]">
            <AppIcon
              name="check"
              strokeWidth={2.6}
              className="h-7 w-7 text-[var(--glass-tone-success-fg)]"
              aria-hidden="true"
            />
          </span>
          <p className="text-[16px] font-semibold text-[var(--glass-text-primary)]">
            {t('paymentSucceeded')}
          </p>
          <p className="text-center text-[13px] leading-6 text-[var(--glass-text-secondary)]">
            {t('planActivated', {
              plan: plan.label,
              credits: plan.creditsAmount.toLocaleString('en-US'),
            })}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="glass-btn-base glass-btn-primary mt-2 h-10 w-full rounded-xl text-[13px] font-medium"
          >
            {t('paymentDone')}
          </button>
        </div>
      ) : qr ? (
        <div className="flex flex-col items-center gap-4 py-2">
          {/* A data: URI produced by Stripe. next/image would only add a proxy
              round-trip to bytes we already hold, and cannot optimise a QR
              code without risking the scan. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr.imageDataUrl} alt={t('wechatQrAlt')} className="h-56 w-56 rounded-xl bg-white p-3" />
          <p className="glass-num text-2xl font-semibold text-[var(--glass-text-primary)]">
            ¥{qr.amountCny.toFixed(2)}
          </p>
          <p className="flex items-center gap-2 text-[13px] text-[var(--glass-text-tertiary)]">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--glass-tone-success-fg)]" />
            {t('wechatWaiting')}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 py-1">
          {wechat.available ? (
            <MethodRow
              icon="wechat"
              label={t('payWithWechat')}
              hint={t('payWithWechatHint')}
              busy={wechat.busy || cardBusy}
              onClick={() => {
                setMethod('wechat')
                wechat.start({ kind: 'plan', planId: plan.id, interval })
              }}
            />
          ) : null}
          <MethodRow
            icon="card"
            label={t('payWithCard')}
            hint={t('payWithCardHint')}
            busy={wechat.busy || cardBusy}
            onClick={() => {
              setMethod('card')
              onPayWithCard()
            }}
          />
          {method !== null && (wechat.busy || cardBusy) ? (
            <p className="mt-1 text-center text-[12px] text-[var(--glass-text-tertiary)]">
              {t('subscribeBusy')}
            </p>
          ) : null}
          {wechat.status ? (
            <p
              className="mt-1 text-center text-[12px]"
              style={{ color: wechat.status.kind === 'error' ? 'var(--glass-tone-danger-fg)' : 'var(--glass-text-tertiary)' }}
            >
              {wechat.status.text}
            </p>
          ) : null}
        </div>
      )}
    </GlassModalShell>
  )
}
