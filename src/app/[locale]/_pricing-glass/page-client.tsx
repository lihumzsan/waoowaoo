'use client'

import { useTranslations } from 'next-intl'
import type { GlassPlan, GlassPricingContent } from './content'
import {
  CustomRecharge,
  GlassInfoFooter,
  RechargeStatus,
  Tick,
  useRecharge,
} from './shared'

const FEATURED: GlassPlan['id'] = 'creator'

function cx(...v: readonly (string | false | null | undefined)[]) {
  return v.filter(Boolean).join(' ')
}

function isCheckValue(value: string): boolean {
  return value === '有' || value.toLowerCase() === 'yes'
}

export default function PricingGlassPageClient({ content }: { readonly content: GlassPricingContent }) {
  const t = useTranslations('pricing.glass')
  const recharge = useRecharge()
  return (
    <div className="glass-page min-h-screen pb-24">
      {/* soft accent wash so the glass reads */}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 -z-0 h-[420px]"
        style={{
          background:
            'radial-gradient(60% 70% at 30% 0%, var(--glass-accent-shadow-soft), transparent 70%), radial-gradient(50% 60% at 80% 10%, rgba(186,156,255,0.18), transparent 70%)',
        }}
      />
      <main className="relative mx-auto max-w-6xl px-5 pt-16 sm:px-8">
        <span className="glass-chip glass-chip-info">{content.eyebrow}</span>
        <p className="mt-4 max-w-xl text-base leading-7 text-[var(--glass-text-secondary)]">{content.subtitle}</p>

        {/* plan cards */}
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {content.plans.map((plan) => {
            const featured = plan.id === FEATURED
            return (
              <article
                key={plan.id}
                className={cx(
                  'flex flex-col p-7 transition-transform duration-300 hover:-translate-y-1.5',
                  featured ? 'glass-surface-elevated md:-mt-2 md:mb-2' : 'glass-surface',
                )}
                style={{
                  borderRadius: 'var(--glass-radius-xl)',
                  ...(featured
                    ? {
                        backgroundImage:
                          'linear-gradient(165deg, rgba(47,123,255,0.10), rgba(255,255,255,0) 55%)',
                        boxShadow:
                          '0 0 0 1.5px var(--glass-accent-from), 0 28px 60px -28px var(--glass-accent-shadow-strong)',
                      }
                    : {}),
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="glass-chip glass-chip-info">{plan.label}</span>
                  {featured && <span className="glass-chip glass-chip-success">{t('featuredBadge')}</span>}
                </div>
                <h3 className="mt-4 text-2xl font-semibold text-[var(--glass-text-primary)]">{plan.name}</h3>
                <p className="mt-1 text-sm text-[var(--glass-text-tertiary)]">{plan.tagline}</p>

                <div className="mt-6 flex items-end gap-2">
                  <span className="text-[2.6rem] font-semibold leading-none tracking-tight text-[var(--glass-text-primary)]">
                    {plan.price}
                  </span>
                  <span className="pb-1 text-sm text-[var(--glass-text-tertiary)]">/ {plan.unit}</span>
                </div>
                <div className="mt-3 w-fit rounded-md bg-[var(--glass-bg-muted)] px-2.5 py-1 text-sm font-semibold text-[var(--glass-text-secondary)]">
                  {plan.credits}
                </div>

                <div className="glass-divider my-6" />

                <ul className="flex flex-1 flex-col gap-3 text-sm leading-6 text-[var(--glass-text-secondary)]">
                  {plan.details.map((d) => (
                    <li key={d} className="flex items-start gap-2.5">
                      <Tick className="mt-0.5 h-4 w-4 shrink-0 text-[var(--glass-tone-success-fg)]" />
                      {d}
                    </li>
                  ))}
                </ul>

                <button
                  type="button"
                  disabled={recharge.busy}
                  onClick={() => recharge.checkout(plan.creditsAmount)}
                  className={cx(
                    'glass-btn-base mt-7 h-12 w-full text-sm disabled:cursor-not-allowed disabled:opacity-50',
                    featured ? 'glass-btn-primary' : 'glass-btn-secondary',
                  )}
                >
                  {recharge.busy ? t('checkoutBusy') : t('rechargePlan', { credits: plan.credits })}
                </button>
              </article>
            )
          })}
        </div>
        <RechargeStatus status={recharge.status} />

        {/* custom amount */}
        <div className="glass-surface-soft mt-6 p-6" style={{ borderRadius: 'var(--glass-radius-lg)' }}>
          <h2 className="text-base font-semibold text-[var(--glass-text-primary)]">{t('customRechargeTitle')}</h2>
          <p className="mt-1 text-sm text-[var(--glass-text-tertiary)]">{t('customRechargeDescription')}</p>
          <CustomRecharge recharge={recharge} className="mt-4" />
        </div>

        {/* comparison */}
        <div
          className="glass-surface mt-12 overflow-hidden"
          style={{ borderRadius: 'var(--glass-radius-xl)' }}
        >
          <div className="grid grid-cols-[1.3fr_repeat(3,1fr)]">
            <div className="px-5 py-5" />
          {content.plans.map((p) => (
              <div key={p.id} className="px-3 py-5 text-center">
                <p className="text-sm font-semibold text-[var(--glass-text-primary)]">{p.name}</p>
                <p className="mt-1 text-lg font-semibold tracking-tight text-[var(--glass-text-primary)]">{p.price}</p>
              </div>
            ))}
          </div>
          {content.compareRows.map((row, ri) => (
            <div
              key={row.label}
              className="grid grid-cols-[1.3fr_repeat(3,1fr)] border-t border-[var(--glass-stroke-base)] text-sm"
              style={ri % 2 === 1 ? { background: 'var(--glass-bg-muted)' } : undefined}
            >
              <div className="px-5 py-4 text-[var(--glass-text-secondary)]">{row.label}</div>
              {row.values.map((v, ci) => (
                <div key={ci} className="flex items-center justify-center px-3 py-4 text-[var(--glass-text-secondary)]">
                  {isCheckValue(v) ? <Tick className="h-4 w-4 text-[var(--glass-tone-success-fg)]" /> : v}
                </div>
              ))}
            </div>
          ))}
        </div>

        <GlassInfoFooter content={content} />
      </main>
    </div>
  )
}
