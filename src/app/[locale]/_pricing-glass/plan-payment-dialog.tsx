'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import GlassModalShell from '@/components/ui/primitives/GlassModalShell'
import { AppIcon } from '@/components/ui/icons'
import { WeChatIcon } from '@/components/ui/icons/WeChatIcon'
import { AlipayIcon } from '@/components/ui/icons/AlipayIcon'
import type { GlassPlan } from './content'
import type { SubscriptionInterval } from '@/lib/billing/subscription-plans'
import { WechatQrImage, type StripeWalletPaymentState } from './stripe-wallet-payment'
import PaidBetaGroupAccess from '@/components/paid-beta/PaidBetaGroupAccess'
import { apiFetch } from '@/lib/api-fetch'

/**
 * Choosing how to pay for a plan.
 *
 * Clicking a plan used to jump straight to Stripe's hosted page, which is a
 * redirect away from the site and asks for an email and a name that a QR scan
 * does not need. The methods are offered here instead, and the one that can
 * stay on the page does: WeChat renders its QR in this same dialog, and only
 * the card and Alipay authorization flows redirect to their secure pages.
 */

export type PlanPaymentMethod = 'wechat_pay' | 'alipay' | 'card'

type PlanQuote = {
  readonly amountCny: number
  readonly monthlyCredits: number
}

function readPlanQuote(value: unknown): PlanQuote | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  return typeof record.amountCny === 'number' && typeof record.monthlyCredits === 'number'
    ? { amountCny: record.amountCny, monthlyCredits: record.monthlyCredits }
    : null
}

function cx(...v: readonly (string | false | null | undefined)[]) {
  return v.filter(Boolean).join(' ')
}

function MethodCard({
  icon,
  label,
  hint,
  busy,
  onClick,
}: {
  readonly icon: 'wechat_pay' | 'alipay' | 'card'
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
      className="glass-surface-soft group flex min-h-32 w-full flex-col items-start rounded-2xl px-4 py-4 text-left transition-[background-color,transform,box-shadow] hover:-translate-y-0.5 hover:bg-[var(--glass-surface-hover,rgba(127,127,127,0.06))] hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        className={cx(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
          icon === 'wechat_pay'
            ? 'bg-[#07C160]'
            : icon === 'alipay'
              ? 'bg-[#1677FF]'
              : 'bg-[var(--glass-accent-from)]',
        )}
      >
        {icon === 'wechat_pay' ? (
          <WeChatIcon className="h-6 w-6 text-white" aria-hidden="true" />
        ) : icon === 'alipay' ? (
          <AlipayIcon className="h-6 w-6 text-white" aria-hidden="true" />
        ) : (
          <AppIcon name="card" className="h-5 w-5 text-white" aria-hidden="true" />
        )}
      </span>
      <span className="mt-3 flex w-full items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold text-[var(--glass-text-primary)]">{label}</span>
          <span className="mt-0.5 block text-[12px] leading-5 text-[var(--glass-text-tertiary)]">{hint}</span>
        </span>
        <AppIcon name="chevronRight" className="mt-1 h-4 w-4 text-[var(--glass-text-tertiary)] transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </span>
    </button>
  )
}

export function PlanPaymentDialog({
  plan,
  interval,
  onClose,
  wallet,
  cardBusy,
  onPayWithCard,
}: {
  readonly plan: GlassPlan | null
  readonly interval: SubscriptionInterval
  readonly onClose: () => void
  readonly wallet: StripeWalletPaymentState
  readonly cardBusy: boolean
  readonly onPayWithCard: () => void
}) {
  const t = useTranslations('pricing.glass')
  const [method, setMethod] = useState<PlanPaymentMethod | null>(null)
  const [quote, setQuote] = useState<PlanQuote | null>(null)
  const [quoteError, setQuoteError] = useState(false)

  // Reopening for a different plan must not inherit the previous choice.
  useEffect(() => {
    if (!plan) {
      setMethod(null)
      setQuote(null)
      setQuoteError(false)
      return
    }
    const controller = new AbortController()
    setQuote(null)
    setQuoteError(false)
    void apiFetch('/api/payments/stripe/plan/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId: plan.id, interval }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('PLAN_QUOTE_REQUEST_FAILED')
        const next = readPlanQuote(await response.json())
        if (!next) throw new Error('PLAN_QUOTE_RESPONSE_INVALID')
        setQuote(next)
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setQuoteError(true)
      })
    return () => controller.abort()
  }, [interval, plan])

  if (!plan) return null
  const settled = wallet.settled
  const quoteBusy = quote === null && !quoteError
  const qr = wallet.payment
  const walletBusy = wallet.busyMethod !== null

  return (
    <GlassModalShell
      open
      onClose={onClose}
      size="md"
      title={t('planDialogTitle', { plan: plan.label })}
      description={quote
        ? t('planDialogSummary', {
            amount: quote.amountCny.toLocaleString('en-US'),
            credits: quote.monthlyCredits.toLocaleString('en-US'),
          })
        : quoteError ? t('planQuoteLoadError') : t('planQuoteLoading')}
    >
      {settled ? (
        <PaidBetaGroupAccess onDone={onClose} />
      ) : qr ? (
        <div className="flex flex-col items-center gap-4 py-2">
          <WechatQrImage imageUrl={qr.imageUrl} />
          <p className="glass-num text-2xl font-semibold text-[var(--glass-text-primary)]">
            ¥{qr.amountCny.toFixed(2)}
          </p>
          <p className="flex items-center gap-2 text-[13px] text-[var(--glass-text-tertiary)]">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--glass-tone-success-fg)]" />
            {t('wechatWaiting')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 py-1 sm:grid-cols-3">
          {wallet.isAvailable('wechat_pay') ? (
            <MethodCard
              icon="wechat_pay"
              label={t('payWithWechat')}
              hint={t('payWithWechatHint')}
              busy={walletBusy || cardBusy || quoteBusy || quoteError}
              onClick={() => {
                setMethod('wechat_pay')
                wallet.start('wechat_pay', { kind: 'plan', planId: plan.id, interval })
              }}
            />
          ) : null}
          {wallet.isAvailable('alipay') ? (
            <MethodCard
              icon="alipay"
              label={t('payWithAlipay')}
              hint={t('payWithAlipayHint')}
              busy={walletBusy || cardBusy || quoteBusy || quoteError}
              onClick={() => {
                setMethod('alipay')
                wallet.start('alipay', { kind: 'plan', planId: plan.id, interval })
              }}
            />
          ) : null}
          <MethodCard
            icon="card"
            label={t('payWithCard')}
            hint={t('payWithCardHint')}
            busy={walletBusy || cardBusy || quoteBusy || quoteError}
            onClick={() => {
              setMethod('card')
              onPayWithCard()
            }}
          />
          {method !== null && (walletBusy || cardBusy) ? (
            <p className="col-span-full mt-1 text-center text-[12px] text-[var(--glass-text-tertiary)]">
              {t('subscribeBusy')}
            </p>
          ) : null}
          {wallet.status ? (
            <p
              className="col-span-full mt-1 text-center text-[12px]"
              style={{ color: wallet.status.kind === 'error' ? 'var(--glass-tone-danger-fg)' : 'var(--glass-text-tertiary)' }}
            >
              {wallet.status.text}
            </p>
          ) : null}
        </div>
      )}
    </GlassModalShell>
  )
}
