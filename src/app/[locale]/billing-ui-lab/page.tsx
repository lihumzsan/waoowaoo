import { AppIcon } from '@/components/ui/icons'
import type { Locale } from '@/i18n/routing'
import { getBillingUiLabCopy } from './billing-ui-lab-data'
import { ArchitectureNote, VariantSection } from './billing-ui-lab-previews'

type PageProps = {
  readonly params: Promise<{
    readonly locale: Locale
  }>
}

export default async function BillingUiLabPage({ params }: PageProps) {
  const { locale } = await params
  const copy = getBillingUiLabCopy(locale)
  return (
    <main className="min-h-screen bg-[#f6f7f9] px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600">
              <AppIcon name="coins" className="h-4 w-4" aria-hidden="true" />
              {copy.eyebrow}
            </div>
            <code className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-500">
              {copy.routeHint}
            </code>
          </div>
          <div className="max-w-3xl">
            <h1 className="text-3xl font-semibold leading-tight text-slate-950">{copy.title}</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">{copy.intro}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-950 text-white">
                <AppIcon name="badgeCheck" className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-950">{copy.recommendationTitle}</div>
                <div className="mt-1 text-sm leading-6 text-slate-600">{copy.recommendationBody}</div>
              </div>
            </div>
          </div>
          <ArchitectureNote copy={copy} />
        </header>

        <div>
          {copy.variants.map((variant) => (
            <VariantSection key={variant.id} variant={variant} quote={copy.quote} />
          ))}
        </div>
      </div>
    </main>
  )
}
