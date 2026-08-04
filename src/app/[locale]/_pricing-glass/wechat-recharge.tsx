'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { loadStripe } from '@stripe/stripe-js'
import GlassModalShell from '@/components/ui/primitives/GlassModalShell'
import { apiFetch } from '@/lib/api-fetch'
import { createClientApiError } from '@/lib/errors/client'
import { useClientErrorMessage } from '@/hooks/useClientErrorMessage'
import type { RechargeConfig } from './shared'

/**
 * WeChat Pay without leaving the page.
 *
 * Stripe returns a QR code instead of redirecting, so the user scans it here
 * and watches the balance land. Two facts stay server-side: only the webhook
 * credits the balance, and this dialog only asks our own ledger whether that
 * has happened — Stripe reporting success is not the same thing as the credits
 * being spendable, and the user is waiting on the latter.
 */

const STATUS_POLL_INTERVAL_MS = 2_000
/** Stripe QR codes do not last forever; stop polling rather than spin all day. */
const STATUS_POLL_TIMEOUT_MS = 10 * 60 * 1000

export interface WechatQrPayment {
  readonly paymentIntentId: string
  readonly imageDataUrl: string
  readonly credits: number
  readonly paymentAmount: number
  readonly paymentCurrency: string
}

export interface WechatRechargeState {
  readonly available: boolean
  readonly busy: boolean
  readonly payment: WechatQrPayment | null
  readonly status: { kind: 'error' | 'info'; text: string } | null
  readonly start: (credits: number) => void
  readonly dismiss: () => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

/**
 * Read the QR image out of a confirmed PaymentIntent.
 *
 * `wechat_pay_display_qr_code` is not in Stripe.js's published types, so it is
 * narrowed explicitly here rather than cast — a shape change should surface as
 * a missing QR, not as a runtime crash deep in the render.
 */
function readQrImageDataUrl(nextAction: unknown): string | null {
  if (!isRecord(nextAction)) return null
  const qr = nextAction.wechat_pay_display_qr_code
  if (!isRecord(qr)) return null
  const url = qr.image_data_url
  return typeof url === 'string' && url.trim() ? url : null
}

function readIntentResponse(payload: unknown): {
  paymentIntentId: string
  clientSecret: string
  credits: number
  paymentAmount: number
  paymentCurrency: string
} | null {
  if (!isRecord(payload)) return null
  const quote = isRecord(payload.quote) ? payload.quote : null
  if (
    typeof payload.paymentIntentId !== 'string'
    || typeof payload.clientSecret !== 'string'
    || !quote
    || typeof quote.credits !== 'number'
    || typeof quote.paymentAmount !== 'number'
    || typeof quote.paymentCurrency !== 'string'
  ) {
    return null
  }
  return {
    paymentIntentId: payload.paymentIntentId,
    clientSecret: payload.clientSecret,
    credits: quote.credits,
    paymentAmount: quote.paymentAmount,
    paymentCurrency: quote.paymentCurrency,
  }
}

export function useWechatRecharge(
  config: RechargeConfig | null,
  onCredited: () => void,
): WechatRechargeState {
  const t = useTranslations('pricing.glass')
  const resolveClientError = useClientErrorMessage()
  const [busy, setBusy] = useState(false)
  const [payment, setPayment] = useState<WechatQrPayment | null>(null)
  const [status, setStatus] = useState<WechatRechargeState['status']>(null)
  const creditedRef = useRef(false)

  const publishableKey = config?.publishableKey ?? null
  const available = Boolean(config?.enabled && config.wechatEnabled && publishableKey)

  const dismiss = useCallback(() => {
    setPayment(null)
    setStatus(null)
    setBusy(false)
  }, [])

  const start = useCallback(
    (credits: number) => {
      if (!available || !publishableKey) {
        setStatus({ kind: 'info', text: t('rechargeUnavailable') })
        return
      }
      if (!config || !Number.isSafeInteger(credits) || credits < config.minCredits || credits > config.maxCredits) {
        setStatus({
          kind: 'error',
          text: t('creditRangeError', {
            min: config?.minCredits.toLocaleString() ?? '',
            max: config?.maxCredits.toLocaleString() ?? '',
          }),
        })
        return
      }

      setBusy(true)
      setStatus(null)
      creditedRef.current = false

      void (async () => {
        try {
          const response = await apiFetch('/api/payments/stripe/wechat/intent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credits }),
          })
          const payload: unknown = await response.json().catch(() => null)
          if (!response.ok) throw createClientApiError(payload, response.status)
          const intent = readIntentResponse(payload)
          if (!intent) throw new Error('WECHAT_INTENT_RESPONSE_INVALID')

          const stripe = await loadStripe(publishableKey)
          if (!stripe) throw new Error('STRIPE_JS_LOAD_FAILED')

          // handleActions: false is required — Stripe hands back the QR and we
          // render it, instead of Stripe taking over the page.
          const confirmed = await stripe.confirmWechatPayPayment(
            intent.clientSecret,
            { payment_method_options: { wechat_pay: { client: 'web' } } },
            { handleActions: false },
          )
          if (confirmed.error) throw new Error(confirmed.error.message || 'WECHAT_CONFIRM_FAILED')

          const imageDataUrl = readQrImageDataUrl(confirmed.paymentIntent?.next_action)
          if (!imageDataUrl) throw new Error('WECHAT_QR_MISSING')

          setPayment({
            paymentIntentId: intent.paymentIntentId,
            imageDataUrl,
            credits: intent.credits,
            paymentAmount: intent.paymentAmount,
            paymentCurrency: intent.paymentCurrency,
          })
        } catch (error) {
          setStatus({ kind: 'error', text: resolveClientError(error, t('checkoutCreateFailedFallback')) })
        } finally {
          setBusy(false)
        }
      })()
    },
    [available, config, publishableKey, resolveClientError, t],
  )

  // Watch our ledger, not Stripe: the dialog closes when the credits are
  // actually spendable.
  useEffect(() => {
    if (!payment) return
    let alive = true
    const startedAt = Date.now()

    const timer = window.setInterval(() => {
      if (!alive) return
      if (Date.now() - startedAt > STATUS_POLL_TIMEOUT_MS) {
        window.clearInterval(timer)
        return
      }
      void apiFetch(`/api/payments/stripe/wechat/status?paymentIntentId=${encodeURIComponent(payment.paymentIntentId)}`)
        .then(async (response) => (response.ok ? await response.json() : null))
        .then((payload: unknown) => {
          if (!alive || creditedRef.current) return
          if (isRecord(payload) && payload.credited === true) {
            creditedRef.current = true
            window.clearInterval(timer)
            setPayment(null)
            onCredited()
          }
        })
        .catch(() => {
          // A failed poll is not a failed payment. The webhook still credits;
          // the next tick will see it.
        })
    }, STATUS_POLL_INTERVAL_MS)

    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [payment, onCredited])

  return { available, busy, payment, status, start, dismiss }
}

export function WechatQrDialog({
  payment,
  onClose,
}: {
  readonly payment: WechatQrPayment | null
  readonly onClose: () => void
}) {
  const t = useTranslations('pricing.glass')
  return (
    <GlassModalShell
      open={payment !== null}
      onClose={onClose}
      size="sm"
      title={t('wechatDialogTitle')}
      description={payment ? t('wechatDialogHint', { credits: payment.credits.toLocaleString('en-US') }) : undefined}
    >
      {payment ? (
        <div className="flex flex-col items-center gap-4 py-2">
          {/* A data: URI produced by Stripe. next/image would only add a
              proxy round-trip to bytes we already hold, and cannot optimise
              a QR code without risking the scan. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={payment.imageDataUrl}
            alt={t('wechatQrAlt')}
            className="h-56 w-56 rounded-xl bg-white p-3"
          />
          <p className="glass-num text-2xl font-semibold text-[var(--glass-text-primary)]">
            ¥{payment.paymentAmount.toFixed(2)}
          </p>
          <p className="flex items-center gap-2 text-[13px] text-[var(--glass-text-tertiary)]">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--glass-tone-success-fg)]" />
            {t('wechatWaiting')}
          </p>
        </div>
      ) : null}
    </GlassModalShell>
  )
}
