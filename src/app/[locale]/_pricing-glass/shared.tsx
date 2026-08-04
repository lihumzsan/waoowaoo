'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { createClientApiError } from '@/lib/errors/client'
import { useClientErrorMessage } from '@/hooks/useClientErrorMessage'

/* ----------------------------------------------------------------- */
/* Recharge hook — talks to the real recharge config + Stripe checkout */
/* ----------------------------------------------------------------- */

export interface RechargeConfig {
  enabled: boolean
  creditValueCurrency: string
  paymentCurrency: string
  minCredits: number
  maxCredits: number
}

interface RechargeState {
  config: RechargeConfig | null
  loading: boolean
  busy: boolean
  status: { kind: 'error' | 'info'; text: string } | null
  checkout: (credits: number) => void
  estimate: (credits: number) => string | null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object'
}

function formatCurrencyAmount(value: number, currency: string): string {
  if (currency === 'CNY') return `¥${value.toFixed(2)}`
  return `${currency} ${value.toFixed(2)}`
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
    (credits: number) => {
      if (!config?.enabled) {
        setStatus({ kind: 'info', text: t('rechargeUnavailable') })
        return
      }
      if (!Number.isFinite(credits) || credits < config.minCredits || credits > config.maxCredits) {
        setStatus({
          kind: 'error',
          text: t('creditRangeError', {
            min: config.minCredits.toLocaleString(),
            max: config.maxCredits.toLocaleString(),
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

  const estimate = useCallback(
    (credits: number) => {
      if (!config || !Number.isFinite(credits) || credits <= 0) return null
      return t('estimateAmount', {
        amount: formatCurrencyAmount(credits, config.paymentCurrency),
      })
    },
    [config, t],
  )

  return { config, loading, busy, status, checkout, estimate }
}

/* ----------------------------------------------------------------- */
/* Subscription hook — starts a recurring Stripe Checkout              */
/* ----------------------------------------------------------------- */

export interface SubscriptionCheckoutState {
  busy: boolean
  status: { kind: 'error' | 'info'; text: string } | null
  start: (planId: string, interval: 'month' | 'year') => void
}

/**
 * Subscribing is a different Stripe mode from topping up, so it is a different
 * request. Sharing the recharge hook would have meant one call site deciding
 * between a one-off payment and a recurring one from a flag.
 */
export function useSubscriptionCheckout(): SubscriptionCheckoutState {
  const t = useTranslations('pricing.glass')
  const resolveClientError = useClientErrorMessage()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<SubscriptionCheckoutState['status']>(null)

  const start = useCallback(
    (planId: string, interval: 'month' | 'year') => {
      setBusy(true)
      setStatus(null)
      void apiFetch('/api/payments/stripe/subscription/checkout', {
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

export function CustomRecharge({ recharge, className }: { recharge: RechargeState; className?: string }) {
  const t = useTranslations('pricing.glass')
  const [value, setValue] = useState('')
  const credits = Number(value)
  const est = recharge.estimate(credits)
  return (
    <div className={className}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-1">
          <span className="mb-2 block text-sm font-medium text-[var(--glass-text-primary)]">{t('customCreditLabel')}</span>
          <input
            type="number"
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={recharge.config ? `${recharge.config.minCredits} – ${recharge.config.maxCredits}` : t('customCreditPlaceholder')}
            className="glass-input-base px-4 py-3 text-sm"
            min={recharge.config?.minCredits}
            max={recharge.config?.maxCredits}
          />
        </label>
        <button
          type="button"
          disabled={recharge.busy || !value.trim()}
          onClick={() => recharge.checkout(credits)}
          className="glass-btn-base glass-btn-primary h-12 px-6 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {recharge.busy ? t('checkoutBusy') : t('checkoutNow')}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--glass-text-tertiary)]">
        {est && <span>{t('estimatePrefix', { amount: est })}</span>}
        {recharge.config && <span>{t('unitValue')}</span>}
      </div>
      <RechargeStatus status={recharge.status} />
    </div>
  )
}

export function Tick({ className }: { className?: string }) {
  return <AppIcon name="check" className={className} strokeWidth={2.4} aria-hidden="true" />
}
