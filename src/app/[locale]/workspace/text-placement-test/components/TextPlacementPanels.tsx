import { AppIcon } from '@/components/ui/icons'
import type { TextPlacementFinalImageResult } from '@/lib/text-placement-test/types'

export function ImagePanel(props: {
  readonly title: string
  readonly empty: string
  readonly imageUrl: string | null
  readonly storageKey?: string
  readonly actionLabel?: string
  readonly actionDisabled?: boolean
  readonly actionBusy?: boolean
  readonly onAction?: () => void
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{props.title}</h2>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {props.storageKey ? <span className="text-xs text-slate-500">{props.storageKey}</span> : null}
          {props.actionLabel && props.onAction ? (
            <button
              type="button"
              disabled={props.actionDisabled || props.actionBusy}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={props.onAction}
            >
              <AppIcon name={props.actionBusy ? 'loader' : 'refresh'} className={`h-3.5 w-3.5 ${props.actionBusy ? 'animate-spin' : ''}`} />
              {props.actionLabel}
            </button>
          ) : null}
        </div>
      </div>
      <div className="flex min-h-80 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-100">
        {props.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="max-h-[72vh] w-full object-contain" src={props.imageUrl} alt={props.title} />
        ) : (
          <p className="px-4 text-center text-sm text-slate-500">{props.empty}</p>
        )}
      </div>
    </section>
  )
}

export function FinalShotPanel(props: {
  readonly title: string
  readonly image: TextPlacementFinalImageResult | null
  readonly empty: string
  readonly actionLabel?: string
  readonly actionDisabled?: boolean
  readonly actionBusy?: boolean
  readonly onAction?: () => void
}) {
  return (
    <ImagePanel
      title={props.title}
      empty={props.empty}
      imageUrl={props.image?.imageUrl || null}
      storageKey={props.image?.storageKey}
      actionLabel={props.actionLabel}
      actionDisabled={props.actionDisabled}
      actionBusy={props.actionBusy}
      onAction={props.onAction}
    />
  )
}

export function TextPanel(props: {
  readonly title: string
  readonly value: string
  readonly empty: string
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">{props.title}</h2>
      <pre className="max-h-96 overflow-auto rounded-md bg-slate-950 p-3 text-xs leading-5 text-slate-100">
        {props.value || props.empty}
      </pre>
    </section>
  )
}
