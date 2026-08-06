'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import {
  creditsToPaymentCny,
  formatCredits,
  paymentCnyToCredits,
} from '@/lib/billing/credits'
import { createClientApiError } from '@/lib/errors/client'
import { useClientErrorMessage } from '@/hooks/useClientErrorMessage'

/* ----------------------------------------------------------------- */
/* Recharge hook — talks to the real recharge config + Stripe checkout */
/* ----------------------------------------------------------------- */

export interface RechargeConfig {
  enabled: boolean
  /** Present only when the in-page WeChat QR flow can run. */
  publishableKey: string | null
  wechatEnabled: boolean
  creditValueCurrency: string
  paymentCurrency: string
  minCredits: number
  maxCredits: number
}

export interface RechargeState {
  config: RechargeConfig | null
  loading: boolean
  busy: boolean
  status: { kind: 'error' | 'info'; text: string } | null
  checkout: (amountCny: number) => void
  estimateCredits: (amountCny: number) => string | null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object'
}

function rechargeAmountBounds(config: RechargeConfig): { minCny: number; maxCny: number } {
  return {
    minCny: creditsToPaymentCny(config.minCredits),
    maxCny: creditsToPaymentCny(config.maxCredits),
  }
}

function resolveRechargeCredits(amountCny: number, config: RechargeConfig): number | null {
  try {
    const credits = paymentCnyToCredits(amountCny)
    return credits >= config.minCredits && credits <= config.maxCredits ? credits : null
  } catch {
    return null
  }
}

export function useRecharge(): RechargeState {
  const t = useTranslations('pricing.glass')
  const resolveClientError = useClientErrorMessage()
  const [config, setConfig] = useState<RechargeConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<RechargeState['status']>(null)

  useEffect(() => {
    let alive = true
    void apiFetch('/api/payments/recharge/config')
      .then(async (r) => {
        const payload: unknown = await r.json().catch(() => null)
        if (!r.ok) {
          throw createClientApiError(payload, r.status)
        }
        return payload
      })
      .then((payload: unknown) => {
        if (!alive) return
        if (isRecord(payload) && isRecord(payload.recharge)) {
          setConfig(payload.recharge as unknown as RechargeConfig)
          return
        }
        setStatus({ kind: 'error', text: t('configLoadError') })
      })
      .catch((error: unknown) => {
        if (alive) setStatus({ kind: 'error', text: resolveClientError(error, t('configLoadError')) })
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [resolveClientError, t])

  const checkout = useCallback(
    (amountCny: number) => {
      if (!config?.enabled) {
        setStatus({ kind: 'info', text: t('rechargeUnavailable') })
        return
      }
      const credits = resolveRechargeCredits(amountCny, config)
      if (credits === null) {
        const bounds = rechargeAmountBounds(config)
        setStatus({
          kind: 'error',
          text: t('rechargeAmountRangeError', {
            min: bounds.minCny.toLocaleString(),
            max: bounds.maxCny.toLocaleString(),
          }),
        })
        return
      }
      setBusy(true)
      setStatus(null)
      void apiFetch('/api/payments/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credits }),
      })
        .then(async (r) => {
          const payload: unknown = await r.json().catch(() => null)
          if (!r.ok) throw createClientApiError(payload, r.status)
          if (!isRecord(payload) || typeof payload.url !== 'string') throw new Error('CHECKOUT_RESPONSE_INVALID')
          window.location.assign(payload.url)
        })
        .catch((e: unknown) => {
          setStatus({ kind: 'error', text: resolveClientError(e, t('checkoutCreateFailedFallback')) })
          setBusy(false)
        })
    },
    [config, resolveClientError, t],
  )

  const estimateCredits = useCallback(
    (amountCny: number) => {
      if (!config) return null
      const credits = resolveRechargeCredits(amountCny, config)
      return credits === null ? null : formatCredits(credits)
    },
    [config],
  )

  return { config, loading, busy, status, checkout, estimateCredits }
}

/* ----------------------------------------------------------------- */
/* Plan purchase hook — buys a plan term outright                      */
/* ----------------------------------------------------------------- */

export interface SubscriptionCheckoutState {
  busy: boolean
  status: { kind: 'error' | 'info'; text: string } | null
  start: (planId: string, interval: 'month' | 'year') => void
}

/**
 * Buying a plan is a one-off payment like a top-up, but what it buys is a term
 * of monthly credit grants rather than a lump of permanent credits — so it is
 * its own request rather than a flag on the recharge one.
 */
export function usePlanPurchase(): SubscriptionCheckoutState {
  const t = useTranslations('pricing.glass')
  const resolveClientError = useClientErrorMessage()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<SubscriptionCheckoutState['status']>(null)

  const start = useCallback(
    (planId: string, interval: 'month' | 'year') => {
      setBusy(true)
      setStatus(null)
      void apiFetch('/api/payments/stripe/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, interval }),
      })
        .then(async (r) => {
          const payload: unknown = await r.json().catch(() => null)
          if (!r.ok) throw createClientApiError(payload, r.status)
          if (!isRecord(payload) || typeof payload.url !== 'string') {
            throw new Error('CHECKOUT_RESPONSE_INVALID')
          }
          window.location.assign(payload.url)
        })
        .catch((e: unknown) => {
          setStatus({ kind: 'error', text: resolveClientError(e, t('checkoutCreateFailedFallback')) })
          setBusy(false)
        })
    },
    [resolveClientError, t],
  )

  return { busy, status, start }
}

export function RechargeStatus({ status }: { status: RechargeState['status'] | SubscriptionCheckoutState['status'] }) {
  if (!status) return null
  return (
    <p
      className="mt-3 text-xs"
      style={{ color: status.kind === 'error' ? 'var(--glass-tone-danger-fg)' : 'var(--glass-text-tertiary)' }}
    >
      {status.text}
    </p>
  )
}

/* ----------------------------------------------------------------- */
/* Custom-amount recharge field                                       */
/* ----------------------------------------------------------------- */

export function CustomRecharge({
  recharge,
  wechat,
  paymentOpen,
  className,
}: {
  recharge: RechargeState
  /** Omitted when WeChat is not configured; the option is then not offered. */
  wechat?: { available: boolean; busy: boolean; start: (credits: number) => void }
  paymentOpen: boolean
  className?: string
}) {
  const t = useTranslations('pricing.glass')
  const [value, setValue] = useState('')
  const amountCny = Number(value)
  const estimatedCredits = recharge.estimateCredits(amountCny)
  const bounds = recharge.config ? rechargeAmountBounds(recharge.config) : null
  const amountEntered = value.trim().length > 0
  const amountValid = estimatedCredits !== null
  const anyBusy = recharge.busy || Boolean(wechat?.busy)
  return (
    <div className={className}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-1">
          <span className="mb-2 block text-sm font-medium text-[var(--glass-text-primary)]">{t('customRechargeAmountLabel')}</span>
          <input
            type="number"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={bounds ? `${bounds.minCny} – ${bounds.maxCny}` : t('customRechargeAmountPlaceholder')}
            className="glass-input-base px-4 py-3 text-sm"
            min={bounds?.minCny}
            max={bounds?.maxCny}
            step="0.1"
            disabled={!paymentOpen}
          />
        </label>
        {wechat?.available ? (
          <button
            type="button"
            disabled={!paymentOpen || anyBusy || !amountEntered || !amountValid}
            onClick={() => {
              if (!recharge.config) return
              const credits = resolveRechargeCredits(amountCny, recharge.config)
              if (credits !== null) wechat.start(credits)
            }}
            className="glass-btn-base glass-btn-secondary h-12 px-5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {!paymentOpen ? t('paidBetaSoldOutCta') : wechat.busy ? t('checkoutBusy') : t('payWithWechat')}
          </button>
        ) : null}
        <button
          type="button"
          disabled={!paymentOpen || anyBusy || !amountEntered}
          onClick={() => recharge.checkout(amountCny)}
          className="glass-btn-base glass-btn-primary h-12 px-6 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {!paymentOpen
            ? t('paidBetaSoldOutCta')
            : recharge.busy
              ? t('checkoutBusy')
              : wechat?.available
                ? t('payWithCard')
                : t('checkoutNow')}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--glass-text-tertiary)]">
        {estimatedCredits && <span>{t('creditsEstimate', { credits: estimatedCredits })}</span>}
        {recharge.config && <span>{t('unitValue')}</span>}
      </div>
      <RechargeStatus status={recharge.status} />
    </div>
  )
}

export function Tick({ className }: { className?: string }) {
  return <AppIcon name="check" className={className} strokeWidth={2.4} aria-hidden="true" />
}

/**
 * The plan the visitor already holds, when they are signed in.
 *
 * The pricing page is public, so a missing session is the normal case, not an
 * error — a failed read leaves the banner off rather than surfacing anything.
 * Read-only: what the user owns is decided by the balance API, and this only
 * projects it.
 */
export interface CurrentPlanSummary {
  readonly planId: string
  readonly interval: string
  readonly currentPeriodEnd: string
  readonly daysLeft: number
  readonly balanceCredits: number
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseCurrentPlan(payload: unknown): CurrentPlanSummary | null {
  if (!isRecord(payload)) return null
  const subscription = payload.subscription
  if (!isRecord(subscription)) return null
  const planId = subscription.planId
  const interval = subscription.interval
  const currentPeriodEnd = subscription.currentPeriodEnd
  const daysLeft = readNumber(subscription.daysLeft)
  if (typeof planId !== 'string' || typeof interval !== 'string') return null
  if (typeof currentPeriodEnd !== 'string' || daysLeft === null) return null
  return {
    planId,
    interval,
    currentPeriodEnd,
    daysLeft,
    balanceCredits: readNumber(payload.balance) ?? 0,
  }
}

export function useCurrentPlan(): CurrentPlanSummary | null {
  const [plan, setPlan] = useState<CurrentPlanSummary | null>(null)

  useEffect(() => {
    let alive = true
    void apiFetch('/api/user/balance')
      .then(async (r) => (r.ok ? ((await r.json()) as unknown) : null))
      .then((payload) => {
        if (alive) setPlan(parseCurrentPlan(payload))
      })
      .catch(() => {
        // Signed out, offline, or rate limited: the page still sells plans.
      })
    return () => {
      alive = false
    }
  }, [])

  return plan
}
