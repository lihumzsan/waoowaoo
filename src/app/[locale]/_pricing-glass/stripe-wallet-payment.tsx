'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { loadStripe } from '@stripe/stripe-js'
import PaidBetaGroupAccess from '@/components/paid-beta/PaidBetaGroupAccess'
import GlassModalShell from '@/components/ui/primitives/GlassModalShell'
import { apiFetch } from '@/lib/api-fetch'
import { creditsToPaymentCny } from '@/lib/billing/credits'
import { createClientApiError } from '@/lib/errors/client'
import { useClientErrorMessage } from '@/hooks/useClientErrorMessage'
import type { StripeWalletMethodId } from '@/lib/payments/stripe-wallet-methods'
import type { RechargeConfig } from './shared'

const STATUS_POLL_INTERVAL_MS = 2_000
const STATUS_POLL_TIMEOUT_MS = 10 * 60 * 1000
const ALIPAY_RETURN_MARKER = 'waoo_wallet_return'

export type StripeWalletIntentRequest =
  | { readonly kind: 'recharge'; readonly credits: number }
  | { readonly kind: 'plan'; readonly planId: string; readonly interval: 'month' | 'year' }

export interface WechatQrPayment {
  readonly paymentIntentId: string
  readonly imageUrl: string
  readonly amountCny: number
  readonly purpose: 'recharge' | 'plan'
  readonly credits: number | null
}

export interface StripeWalletSettlement {
  readonly method: StripeWalletMethodId
  readonly purpose: 'recharge' | 'plan'
  readonly credits: number
}

type ReturnState = { readonly kind: 'checking' | 'error'; readonly text: string }

export interface StripeWalletPaymentState {
  readonly isAvailable: (method: StripeWalletMethodId) => boolean
  readonly busyMethod: StripeWalletMethodId | null
  readonly payment: WechatQrPayment | null
  readonly settled: StripeWalletSettlement | null
  readonly returnState: ReturnState | null
  readonly status: { readonly kind: 'error' | 'info'; readonly text: string } | null
  readonly start: (method: StripeWalletMethodId, request: StripeWalletIntentRequest) => void
  readonly dismiss: () => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function readQrImageUrl(nextAction: unknown): string | null {
  if (!isRecord(nextAction)) return null
  const qr = nextAction.wechat_pay_display_qr_code
  if (!isRecord(qr)) return null
  for (const field of ['image_url_svg', 'image_url_png', 'image_data_url'] as const) {
    const url = qr[field]
    if (typeof url === 'string' && url.trim()) return url
  }
  return null
}

function readIntentResponse(payload: unknown): {
  readonly paymentIntentId: string
  readonly clientSecret: string
  readonly amountCny: number
} | null {
  if (!isRecord(payload)) return null
  if (
    typeof payload.paymentIntentId !== 'string'
    || typeof payload.clientSecret !== 'string'
    || typeof payload.amountCny !== 'number'
  ) return null
  return {
    paymentIntentId: payload.paymentIntentId,
    clientSecret: payload.clientSecret,
    amountCny: payload.amountCny,
  }
}

function readLedgerSettlement(payload: unknown): {
  readonly purpose: 'recharge' | 'plan'
  readonly credits: number
} | null {
  if (!isRecord(payload) || payload.credited !== true) return null
  const purpose = payload.kind
  const credits = payload.credits
  if ((purpose !== 'recharge' && purpose !== 'plan') || typeof credits !== 'number') return null
  return { purpose, credits }
}

function buildAlipayReturnUrl(): string {
  const url = new URL(window.location.href)
  url.searchParams.set(ALIPAY_RETURN_MARKER, 'alipay')
  url.searchParams.delete('payment_intent')
  url.searchParams.delete('payment_intent_client_secret')
  url.searchParams.delete('redirect_status')
  return url.toString()
}

function clearStripeReturnParameters(): void {
  const url = new URL(window.location.href)
  url.searchParams.delete(ALIPAY_RETURN_MARKER)
  url.searchParams.delete('payment_intent')
  url.searchParams.delete('payment_intent_client_secret')
  url.searchParams.delete('redirect_status')
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

export function useStripeWalletPayment(
  config: RechargeConfig | null,
  onCredited: () => void,
): StripeWalletPaymentState {
  const t = useTranslations('pricing.glass')
  const resolveClientError = useClientErrorMessage()
  const [busyMethod, setBusyMethod] = useState<StripeWalletMethodId | null>(null)
  const [payment, setPayment] = useState<WechatQrPayment | null>(null)
  const [returnedIntentId, setReturnedIntentId] = useState<string | null>(null)
  const [settled, setSettled] = useState<StripeWalletSettlement | null>(null)
  const [returnState, setReturnState] = useState<ReturnState | null>(null)
  const [status, setStatus] = useState<StripeWalletPaymentState['status']>(null)
  const creditedRef = useRef(false)
  const returnCapturedRef = useRef(false)

  const publishableKey = config?.publishableKey ?? null
  const isAvailable = useCallback((method: StripeWalletMethodId) => (
    Boolean(config?.enabled && publishableKey && config.walletMethods.includes(method))
  ), [config, publishableKey])

  const dismiss = useCallback(() => {
    setPayment(null)
    setReturnedIntentId(null)
    setSettled(null)
    setReturnState(null)
    setStatus(null)
    setBusyMethod(null)
  }, [])

  // Capture Stripe's return identity once. Query parameters are transport
  // details, never payment truth, so they are removed after capture and the
  // local ledger is queried with the PaymentIntent identity.
  useEffect(() => {
    if (returnCapturedRef.current) return
    returnCapturedRef.current = true
    const url = new URL(window.location.href)
    if (url.searchParams.get(ALIPAY_RETURN_MARKER) !== 'alipay') return

    const paymentIntentId = url.searchParams.get('payment_intent')?.trim() ?? ''
    const redirectStatus = url.searchParams.get('redirect_status')?.trim() ?? ''
    clearStripeReturnParameters()
    if (!paymentIntentId) {
      const text = t('alipayReturnInvalid')
      setStatus({ kind: 'error', text })
      setReturnState({ kind: 'error', text })
      return
    }
    if (redirectStatus === 'failed') {
      const text = t('alipayPaymentFailed')
      setStatus({ kind: 'error', text })
      setReturnState({ kind: 'error', text })
      return
    }
    creditedRef.current = false
    setReturnedIntentId(paymentIntentId)
    setBusyMethod('alipay')
    setReturnState({ kind: 'checking', text: t('walletWaitingForCredit') })
  }, [t])

  const start = useCallback((method: StripeWalletMethodId, request: StripeWalletIntentRequest) => {
    if (!isAvailable(method) || !publishableKey) {
      setStatus({ kind: 'info', text: t('rechargeUnavailable') })
      return
    }
    if (request.kind === 'recharge') {
      const credits = request.credits
      if (!config || !Number.isSafeInteger(credits) || credits < config.minCredits || credits > config.maxCredits) {
        setStatus({
          kind: 'error',
          text: t('rechargeAmountRangeError', {
            min: config ? creditsToPaymentCny(config.minCredits).toLocaleString() : '',
            max: config ? creditsToPaymentCny(config.maxCredits).toLocaleString() : '',
          }),
        })
        return
      }
    }

    setBusyMethod(method)
    setStatus(null)
    setSettled(null)
    setReturnState(null)
    creditedRef.current = false

    void (async () => {
      try {
        const response = await apiFetch('/api/payments/stripe/wallet/intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method, ...request }),
        })
        const payload: unknown = await response.json().catch(() => null)
        if (!response.ok) throw createClientApiError(payload, response.status)
        const intent = readIntentResponse(payload)
        if (!intent) throw new Error('STRIPE_WALLET_INTENT_RESPONSE_INVALID')

        const stripe = await loadStripe(publishableKey)
        if (!stripe) throw new Error('STRIPE_JS_LOAD_FAILED')

        if (method === 'alipay') {
          const confirmed = await stripe.confirmAlipayPayment(intent.clientSecret, {
            return_url: buildAlipayReturnUrl(),
          })
          if (confirmed.error) throw new Error(confirmed.error.message || 'ALIPAY_CONFIRM_FAILED')
          return
        }

        const confirmed = await stripe.confirmWechatPayPayment(
          intent.clientSecret,
          { payment_method_options: { wechat_pay: { client: 'web' } } },
          { handleActions: false },
        )
        if (confirmed.error) throw new Error(confirmed.error.message || 'WECHAT_CONFIRM_FAILED')
        const imageUrl = readQrImageUrl(confirmed.paymentIntent?.next_action)
        if (!imageUrl) throw new Error('WECHAT_QR_MISSING')
        setPayment({
          paymentIntentId: intent.paymentIntentId,
          imageUrl,
          amountCny: intent.amountCny,
          purpose: request.kind,
          credits: request.kind === 'recharge' ? request.credits : null,
        })
      } catch (error) {
        setStatus({ kind: 'error', text: resolveClientError(error, t('checkoutCreateFailedFallback')) })
      } finally {
        setBusyMethod(null)
      }
    })()
  }, [config, isAvailable, publishableKey, resolveClientError, t])

  const watchedIntentId = payment?.paymentIntentId ?? returnedIntentId
  const watchedMethod: StripeWalletMethodId | null = payment ? 'wechat_pay' : returnedIntentId ? 'alipay' : null

  useEffect(() => {
    if (!watchedIntentId || !watchedMethod) return
    let alive = true
    let timer: number | null = null
    const startedAt = Date.now()

    const stopWatching = () => {
      alive = false
      if (timer !== null) window.clearInterval(timer)
    }

    const checkLedger = () => {
      if (!alive || creditedRef.current) return
      if (Date.now() - startedAt > STATUS_POLL_TIMEOUT_MS) {
        stopWatching()
        const text = t('walletSettlementPending')
        setBusyMethod(null)
        setStatus({ kind: 'info', text })
        if (watchedMethod === 'alipay') setReturnState({ kind: 'error', text })
        return
      }
      void apiFetch(`/api/payments/stripe/wallet/status?paymentIntentId=${encodeURIComponent(watchedIntentId)}`)
        .then(async (response) => (response.ok ? await response.json() : null))
        .then((payload: unknown) => {
          if (!alive || creditedRef.current) return
          const next = readLedgerSettlement(payload)
          if (!next) return
          creditedRef.current = true
          stopWatching()
          setSettled({ method: watchedMethod, ...next })
          setPayment(null)
          setReturnedIntentId(null)
          setReturnState(null)
          setBusyMethod(null)
          onCredited()
        })
        .catch(() => {
          // A projection read can fail while the webhook still settles safely.
        })
    }

    checkLedger()
    if (alive) timer = window.setInterval(checkLedger, STATUS_POLL_INTERVAL_MS)
    return () => {
      stopWatching()
    }
  }, [onCredited, t, watchedIntentId, watchedMethod])

  return {
    isAvailable,
    busyMethod,
    payment,
    settled,
    returnState,
    status,
    start,
    dismiss,
  }
}

export function StripeWalletDialog({
  payment,
  settled,
  returnState,
  onClose,
}: {
  readonly payment: WechatQrPayment | null
  readonly settled: StripeWalletSettlement | null
  readonly returnState: ReturnState | null
  readonly onClose: () => void
}) {
  const t = useTranslations('pricing.glass')
  return (
    <GlassModalShell
      open={payment !== null || settled !== null || returnState !== null}
      onClose={onClose}
      size="sm"
      title={settled ? undefined : payment ? t('wechatDialogTitle') : t('alipayReturnTitle')}
      description={payment
        ? payment.purpose === 'plan'
          ? t('wechatDialogPlanHint')
          : t('wechatDialogHint', { credits: (payment.credits ?? 0).toLocaleString('en-US') })
        : undefined}
    >
      {settled ? (
        <PaidBetaGroupAccess onDone={onClose} />
      ) : payment ? (
        <div className="flex flex-col items-center gap-4 py-2">
          <WechatQrImage imageUrl={payment.imageUrl} />
          <p className="glass-num text-2xl font-semibold text-[var(--glass-text-primary)]">
            ¥{payment.amountCny.toFixed(2)}
          </p>
          <p className="flex items-center gap-2 text-[13px] text-[var(--glass-text-tertiary)]">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--glass-tone-success-fg)]" />
            {t('wechatWaiting')}
          </p>
        </div>
      ) : returnState ? (
        <div className="flex flex-col items-center gap-3 py-5 text-center">
          {returnState.kind === 'checking' ? (
            <span className="h-7 w-7 animate-spin rounded-full border-2 border-[var(--glass-stroke-base)] border-t-[var(--glass-accent-from)]" />
          ) : null}
          <p className="text-[13px] leading-6 text-[var(--glass-text-secondary)]">{returnState.text}</p>
        </div>
      ) : null}
    </GlassModalShell>
  )
}

export function WechatQrImage({ imageUrl }: { readonly imageUrl: string }) {
  const t = useTranslations('pricing.glass')
  return (
    <div className="rounded-xl bg-white p-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} alt={t('wechatQrAlt')} className="h-56 w-56 object-contain" />
    </div>
  )
}
