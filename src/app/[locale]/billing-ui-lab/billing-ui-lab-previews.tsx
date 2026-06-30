import type { ReactNode } from 'react'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import type {
  BillingUiLabCopy,
  BillingUiLabQuoteCopy,
  BillingUiLabVariantCopy,
} from './billing-ui-lab-data'

type MetricTone = 'neutral' | 'dark' | 'teal' | 'amber' | 'blue' | 'rose'

const metricToneClass: Record<MetricTone, string> = {
  neutral: 'border-slate-200 bg-white text-slate-700',
  dark: 'border-slate-900 bg-slate-950 text-white',
  teal: 'border-teal-200 bg-teal-50 text-teal-900',
  amber: 'border-amber-200 bg-amber-50 text-amber-950',
  blue: 'border-blue-200 bg-blue-50 text-blue-950',
  rose: 'border-rose-200 bg-rose-50 text-rose-950',
}

const accentClass: Record<BillingUiLabVariantCopy['accent'], string> = {
  ink: 'bg-slate-950 text-white',
  teal: 'bg-teal-700 text-white',
  amber: 'bg-amber-500 text-slate-950',
  blue: 'bg-blue-700 text-white',
  rose: 'bg-rose-700 text-white',
}

function MetricPill(props: {
  readonly icon: AppIconName
  readonly label: string
  readonly value: string
  readonly tone?: MetricTone
}) {
  return (
    <div className={`inline-flex h-9 items-center gap-2 rounded-md border px-2.5 text-xs font-semibold ${metricToneClass[props.tone ?? 'neutral']}`}>
      <AppIcon name={props.icon} className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="text-[11px] font-medium opacity-75">{props.label}</span>
      <span className="tabular-nums">{props.value}</span>
    </div>
  )
}

function PrimaryActionButton(props: {
  readonly icon: AppIconName
  readonly label: string
  readonly metricLabel: string
  readonly metricValue: string
  readonly dark?: boolean
}) {
  const className = props.dark
    ? 'border-slate-950 bg-slate-950 text-white shadow-sm'
    : 'border-slate-200 bg-white text-slate-950'
  return (
    <button
      type="button"
      className={`grid h-[58px] min-w-0 flex-1 place-items-center rounded-md border px-3 transition-colors hover:border-slate-400 ${className}`}
    >
      <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold leading-4 opacity-85">
        <AppIcon name={props.icon} className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate tabular-nums">{props.metricValue}</span>
        <span className="truncate">{props.metricLabel}</span>
      </span>
      <span className="truncate text-sm font-semibold leading-5">{props.label}</span>
    </button>
  )
}

function AssistantShell(props: {
  readonly children: ReactNode
}) {
  return (
    <div className="mx-auto w-full max-w-[520px] rounded-lg border border-slate-200 bg-white p-3 shadow-[0_18px_48px_rgba(15,23,42,0.10)]">
      {props.children}
    </div>
  )
}

function InlineActionMetricsPreview({ quote }: { readonly quote: BillingUiLabQuoteCopy }) {
  return (
    <AssistantShell>
      <div className="space-y-3">
        <div>
          <div className="text-base font-semibold text-slate-950">{quote.operationTitle}</div>
          <div className="mt-0.5 text-xs leading-5 text-slate-500">{quote.operationSubtitle}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <MetricPill icon="image" label={quote.taskLabel} value={quote.mediaTasks} tone="blue" />
          <MetricPill icon="coins" label={quote.creditLabel} value={quote.credits} tone="teal" />
          <MetricPill icon="grid" label={quote.panelLabel} value={quote.targetPanels} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <PrimaryActionButton
            icon="coins"
            label={quote.continue}
            metricLabel={quote.creditLabel}
            metricValue={quote.creditsShort}
            dark
          />
          <PrimaryActionButton
            icon="image"
            label={quote.generateImage}
            metricLabel={quote.taskLabel}
            metricValue={quote.mediaTasks}
          />
        </div>
      </div>
    </AssistantShell>
  )
}

function QuoteSummaryBarPreview({ quote }: { readonly quote: BillingUiLabQuoteCopy }) {
  return (
    <AssistantShell>
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-teal-50 text-teal-800">
            <AppIcon name="receipt" className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold text-slate-950">{quote.operationTitle}</div>
            <div className="mt-0.5 text-xs leading-5 text-slate-500">{quote.beforeSubmit}</div>
          </div>
          <div className="grid min-w-[96px] place-items-end">
            <div className="text-lg font-semibold leading-6 tabular-nums text-slate-950">{quote.creditsShort}</div>
            <div className="text-[11px] leading-4 text-slate-500">{quote.creditLabel}</div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
          <MetricPill icon="image" label={quote.taskLabel} value={quote.mediaTasks} tone="neutral" />
          <MetricPill icon="grid" label={quote.panelLabel} value={quote.targetPanels} tone="neutral" />
          <MetricPill icon="check" label={quote.fixedQuote} value={quote.quoteReady} tone="neutral" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="h-11 rounded-md bg-slate-950 px-3 text-sm font-semibold text-white">
            {quote.continue}
          </button>
          <button type="button" className="h-11 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900">
            {quote.cancel}
          </button>
        </div>
      </div>
    </AssistantShell>
  )
}

function ReceiptListPreview({ quote }: { readonly quote: BillingUiLabQuoteCopy }) {
  const rows: ReadonlyArray<{
    readonly label: string
    readonly value: string
    readonly icon: AppIconName
  }> = [
    { label: quote.model, value: `${quote.mediaTasks} x image`, icon: 'cpu' },
    { label: quote.panelLabel, value: quote.targetPanels, icon: 'grid' },
    { label: quote.maxFreeze, value: quote.credits, icon: 'coins' },
  ]
  return (
    <AssistantShell>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-base font-semibold text-slate-950">{quote.operationTitle}</div>
            <div className="mt-0.5 text-xs leading-5 text-slate-500">{quote.priceLine}</div>
          </div>
          <div className="rounded-md bg-amber-50 px-2.5 py-1.5 text-right text-amber-950">
            <div className="text-[11px] leading-4">{quote.fixedQuote}</div>
            <div className="text-sm font-semibold tabular-nums">{quote.credits}</div>
          </div>
        </div>
        <div className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2">
              <AppIcon name={row.icon} className="h-4 w-4 text-slate-500" aria-hidden="true" />
              <span className="truncate text-xs text-slate-600">{row.label}</span>
              <span className="text-xs font-semibold tabular-nums text-slate-950">{row.value}</span>
            </div>
          ))}
        </div>
        <button type="button" className="h-11 w-full rounded-md bg-slate-950 px-3 text-sm font-semibold text-white">
          {quote.continue}
        </button>
      </div>
    </AssistantShell>
  )
}

function CanvasNodeBadgePreview({ quote }: { readonly quote: BillingUiLabQuoteCopy }) {
  return (
    <div className="mx-auto w-full max-w-[560px] rounded-lg border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.10)]">
      <div className="space-y-3 p-4">
        <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-4">
          <div className="aspect-[3/4] rounded-md bg-[linear-gradient(145deg,#dce7f7,#f8fafc_58%,#d7f2e8)] ring-1 ring-slate-200" />
          <div className="min-w-0 space-y-3">
            <div>
              <div className="text-xs font-semibold text-slate-500">Shot 04</div>
              <div className="mt-1 text-sm font-semibold text-slate-950">{quote.operationTitle}</div>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
              {quote.currentProblem}
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-950">{quote.operationTitle}</div>
          <div className="mt-0.5 flex flex-wrap gap-1.5">
            <MetricPill icon="coins" label={quote.creditLabel} value={quote.creditsShort} tone="blue" />
            <MetricPill icon="image" label={quote.taskLabel} value="1" />
          </div>
        </div>
        <button type="button" className="h-11 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-950">
          {quote.expand}
        </button>
        <button type="button" className="inline-flex h-11 items-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white">
          <AppIcon name="arrowRight" className="h-4 w-4" aria-hidden="true" />
          {quote.generateImage}
        </button>
      </div>
    </div>
  )
}

function BudgetLockPreview({ quote }: { readonly quote: BillingUiLabQuoteCopy }) {
  return (
    <AssistantShell>
      <div className="space-y-3">
        <div className="flex items-center gap-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-rose-950">
          <AppIcon name="lock" className="h-5 w-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{quote.maxFreeze}</div>
            <div className="mt-0.5 truncate text-xs opacity-75">{quote.submitBoundary}</div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <MetricPill icon="image" label={quote.taskLabel} value={quote.mediaTasks} />
          <MetricPill icon="grid" label={quote.panelLabel} value={quote.targetPanels} />
          <MetricPill icon="coins" label={quote.creditLabel} value={quote.creditsShort} tone="rose" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="h-11 rounded-md bg-slate-950 px-3 text-sm font-semibold text-white">
            {quote.continue}
          </button>
          <button type="button" className="h-11 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900">
            {quote.cancel}
          </button>
        </div>
      </div>
    </AssistantShell>
  )
}

function VariantPreview(props: {
  readonly variant: BillingUiLabVariantCopy
  readonly quote: BillingUiLabQuoteCopy
}) {
  if (props.variant.id === 'inline-action-metrics') return <InlineActionMetricsPreview quote={props.quote} />
  if (props.variant.id === 'quote-summary-bar') return <QuoteSummaryBarPreview quote={props.quote} />
  if (props.variant.id === 'receipt-list') return <ReceiptListPreview quote={props.quote} />
  if (props.variant.id === 'canvas-node-badge') return <CanvasNodeBadgePreview quote={props.quote} />
  return <BudgetLockPreview quote={props.quote} />
}

export function VariantSection(props: {
  readonly variant: BillingUiLabVariantCopy
  readonly quote: BillingUiLabQuoteCopy
}) {
  return (
    <section className="grid gap-5 border-t border-slate-200 py-8 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-8">
      <div className="min-w-0">
        <div className={`mb-3 inline-flex h-9 items-center gap-2 rounded-md px-2.5 text-xs font-semibold ${accentClass[props.variant.accent]}`}>
          <AppIcon name={props.variant.icon} className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{props.variant.index}</span>
        </div>
        <h2 className="text-xl font-semibold text-slate-950">{props.variant.title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{props.variant.subtitle}</p>
        <p className="mt-3 text-xs leading-5 text-slate-500">{props.variant.rationale}</p>
      </div>
      <div className="min-w-0 rounded-lg border border-slate-200 bg-[linear-gradient(180deg,#f8fafc,#eef2f7)] p-4">
        <VariantPreview variant={props.variant} quote={props.quote} />
      </div>
    </section>
  )
}

export function ArchitectureNote({ copy }: { readonly copy: BillingUiLabCopy }) {
  return (
    <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-3">
      <div className="flex gap-2 text-sm leading-6 text-slate-700">
        <AppIcon name="info" className="mt-1 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
        <span>{copy.quote.currentProblem}</span>
      </div>
      <div className="flex gap-2 text-sm leading-6 text-slate-700">
        <AppIcon name="receipt" className="mt-1 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
        <span>{copy.quote.directApi}</span>
      </div>
      <div className="flex gap-2 text-sm leading-6 text-slate-700">
        <AppIcon name="lock" className="mt-1 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
        <span>{copy.quote.assistantApproval}</span>
      </div>
    </div>
  )
}
