'use client'

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import type { BillingActionQuotePreview } from '@/lib/billing/action-quote-preview'

type BillingActionButtonTone = 'primary' | 'secondary'

interface BillingActionButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  readonly label: ReactNode
  readonly icon: AppIconName
  readonly quote?: BillingActionQuotePreview | null
  readonly tone?: BillingActionButtonTone
  readonly loading?: boolean
}

const baseClassName = 'nodrag inline-flex items-center justify-center gap-1.5 rounded-[14px] px-3 py-2.5 text-xs font-semibold leading-none transition whitespace-nowrap disabled:cursor-not-allowed'
const toneClassNames: Record<BillingActionButtonTone, string> = {
  primary: 'bg-slate-950 text-white hover:bg-slate-800 disabled:bg-slate-400',
  secondary: 'border border-slate-200 bg-white text-[var(--glass-text-secondary)] hover:bg-slate-50 disabled:opacity-50',
}

function BillingCostSuffix({
  quote,
  tone,
}: {
  readonly quote: BillingActionQuotePreview | null | undefined
  readonly tone: BillingActionButtonTone
}) {
  if (!quote?.costLabel) return null
  return (
    <span
      className={`ml-1 inline-flex shrink-0 items-center gap-1 text-[11px] tabular-nums ${
        tone === 'primary' ? 'text-white/70' : 'text-slate-400'
      }`}
      aria-label={quote.fullLabel}
      title={quote.fullLabel}
    >
      {quote.costLabel}
      <AppIcon name="coins" className="h-3.5 w-3.5" aria-hidden="true" />
    </span>
  )
}

export default function BillingActionButton({
  label,
  icon,
  quote,
  tone = 'primary',
  loading = false,
  className = '',
  title,
  ...buttonProps
}: BillingActionButtonProps) {
  const resolvedTitle = title ?? quote?.fullLabel
  return (
    <button
      {...buttonProps}
      title={resolvedTitle}
      className={`${baseClassName} ${toneClassNames[tone]} ${className}`.trim()}
    >
      <AppIcon name={loading ? 'loader' : icon} className={`h-3.5 w-3.5 shrink-0 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
      <span className="min-w-0 truncate">{label}</span>
      <BillingCostSuffix quote={quote} tone={tone} />
    </button>
  )
}
