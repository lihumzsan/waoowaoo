'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { parseApiErrorPayload } from '@/lib/api-error-payload'
import type { GlassPolicy, GlassPricingContent } from './content'

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

function readApiFailureReason(payload: unknown, fallback: string): string {
  const parsed = parseApiErrorPayload(payload)
  return parsed.code || parsed.message || fallback
}

function formatCurrencyAmount(value: number, currency: string): string {
  if (currency === 'CNY') return `¥${value.toFixed(2)}`
  return `${currency} ${value.toFixed(2)}`
}

export function useRecharge(): RechargeState {
  const t = useTranslations('pricing.glass')
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
          throw new Error(t('configLoadErrorWithReason', {
            reason: readApiFailureReason(payload, `HTTP_${r.status}`),
          }))
        }
        return payload
      })
      .then((payload: unknown) => {
        if (!alive) return
        if (isRecord(payload) && isRecord(payload.recharge)) {
          setConfig(payload.recharge as unknown as RechargeConfig)
          return
        }
        setStatus({ kind: 'error', text: t('configLoadErrorWithReason', { reason: 'PAYMENT_RECHARGE_CONFIG_INVALID' }) })
      })
      .catch((error: unknown) => {
        if (alive) setStatus({ kind: 'error', text: error instanceof Error ? error.message : t('configLoadError') })
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [t])

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
          if (!r.ok || !isRecord(payload) || typeof payload.url !== 'string') {
            throw new Error(t('checkoutCreateFailedWithReason', {
              reason: readApiFailureReason(payload, `HTTP_${r.status}`),
            }))
          }
          window.location.assign(payload.url)
        })
        .catch((e: unknown) => {
          setStatus({ kind: 'error', text: e instanceof Error ? e.message : t('checkoutCreateFailedFallback') })
          setBusy(false)
        })
    },
    [config, t],
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

export function RechargeStatus({ status }: { status: RechargeState['status'] }) {
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

/* ----------------------------------------------------------------- */
/* Collapsed glass footer — reused by all three pages                 */
/* ----------------------------------------------------------------- */

function GlassDisclosure({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-t border-[var(--glass-stroke-base)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="group flex w-full items-center gap-4 py-5 text-left"
      >
        <span className="text-base font-semibold text-[var(--glass-text-primary)]">{title}</span>
        {hint && <span className="hidden text-xs text-[var(--glass-text-tertiary)] sm:inline">{hint}</span>}
        <span className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--glass-stroke-strong)] text-[var(--glass-text-tertiary)] transition group-hover:border-[var(--glass-stroke-focus)]">
          <AppIcon name={open ? 'minus' : 'plus'} className="h-3.5 w-3.5" strokeWidth={1.8} />
        </span>
      </button>
      {open && <div className="pb-8 pt-1">{children}</div>}
    </div>
  )
}

function PolicySections({ policy }: { policy: GlassPolicy }) {
  return (
    <div className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
      {policy.sections.map((s) => (
        <div key={s.title}>
          <h4 className="text-sm font-semibold text-[var(--glass-text-secondary)]">{s.title}</h4>
          <p className="mt-1.5 text-sm leading-6 text-[var(--glass-text-tertiary)]">{s.body}</p>
        </div>
      ))}
    </div>
  )
}

function requirePolicy(content: GlassPricingContent, id: GlassPolicy['id']): GlassPolicy {
  const policy = content.policies.find((item) => item.id === id)
  if (!policy) {
    throw new Error(`PRICING_POLICY_MISSING_${id.toUpperCase()}`)
  }
  return policy
}

export function GlassInfoFooter({ content }: { content: GlassPricingContent }) {
  const t = useTranslations('pricing.glass')
  const terms = requirePolicy(content, 'terms')
  const privacy = requirePolicy(content, 'privacy')
  const refund = requirePolicy(content, 'refund')
  return (
    <section className="mt-16">
      <h2 className="text-xl font-semibold text-[var(--glass-text-primary)]">{t('infoFooterTitle')}</h2>
      <p className="mt-1.5 text-sm text-[var(--glass-text-tertiary)]">{t('infoFooterDescription')}</p>
      <div className="glass-surface-soft mt-6 px-6" style={{ borderRadius: 'var(--glass-radius-lg)' }}>
        <GlassDisclosure title={t('creditRulesTitle')} hint={t('creditRulesHint')}>
          <p className="max-w-3xl text-sm leading-7 text-[var(--glass-text-tertiary)]">{content.creditPolicy.body}</p>
        </GlassDisclosure>
        <GlassDisclosure title={t('paymentTitle')} hint={t('paymentHint')}>
          <div className="space-y-4">
            <p className="max-w-3xl text-sm leading-7 text-[var(--glass-text-tertiary)]">{content.paymentNote}</p>
            <div className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
              {content.faqs.map((f) => (
                <div key={f.q}>
                  <h4 className="text-sm font-semibold text-[var(--glass-text-secondary)]">{f.q}</h4>
                  <p className="mt-1.5 text-sm leading-6 text-[var(--glass-text-tertiary)]">{f.a}</p>
                </div>
              ))}
            </div>
          </div>
        </GlassDisclosure>
        <GlassDisclosure title="服务条款" hint={terms.updatedAt}>
          <PolicySections policy={terms} />
        </GlassDisclosure>
        <GlassDisclosure title="隐私政策" hint={privacy.updatedAt}>
          <PolicySections policy={privacy} />
        </GlassDisclosure>
        <GlassDisclosure title="退款政策" hint={refund.updatedAt}>
          <PolicySections policy={refund} />
        </GlassDisclosure>
        <GlassDisclosure title={content.merchant.title} hint={t('merchantHint')}>
          <div>
            <p className="max-w-3xl text-sm leading-6 text-[var(--glass-text-tertiary)]">{content.merchant.description}</p>
            <dl className="mt-6 grid gap-x-12 sm:grid-cols-2">
              {content.merchant.fields.map((f) => (
                <div
                  key={f.label}
                  className="flex flex-col gap-0.5 border-b border-[var(--glass-stroke-soft)] py-3.5 sm:flex-row sm:items-baseline sm:gap-5"
                >
                  <dt className="w-24 shrink-0 text-sm text-[var(--glass-text-tertiary)]">{f.label}</dt>
                  <dd className="text-sm font-medium text-[var(--glass-text-secondary)]">{f.value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-6 rounded-2xl bg-[var(--glass-bg-muted)] p-5">
              <h4 className="text-sm font-semibold text-[var(--glass-text-secondary)]">{content.merchant.portalOnly.title}</h4>
              <p className="mt-1 text-xs leading-5 text-[var(--glass-text-tertiary)]">{content.merchant.portalOnly.description}</p>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {content.merchant.portalOnly.items.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-xs leading-5 text-[var(--glass-text-tertiary)]">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--glass-text-tertiary)]" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </GlassDisclosure>
        <div className="border-t border-[var(--glass-stroke-base)]" />
      </div>

      <p className="mt-10 text-xs text-[var(--glass-text-tertiary)]">
        © 2026 {content.brand}
      </p>
    </section>
  )
}

export function Tick({ className }: { className?: string }) {
  return <AppIcon name="check" className={className} strokeWidth={2.4} aria-hidden="true" />
}
