import type { ChangeEvent, ReactNode } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { clampInteger } from './coordinate-reference'

export function FileInput(props: {
  readonly label: string
  readonly value: string
  readonly icon: ReactNode
  readonly onChange: (event: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="font-medium text-slate-800">{props.label}</span>
      <span className="flex h-10 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-slate-700">
        {props.icon}
        <span className="min-w-0 flex-1 truncate">{props.value}</span>
        <input className="sr-only" type="file" accept="image/*" onChange={props.onChange} />
      </span>
    </label>
  )
}

export function NumberField(props: {
  readonly label: string
  readonly value: number
  readonly min: number
  readonly max: number
  readonly onChange: (value: number) => void
}) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="font-medium text-slate-800">{props.label}</span>
      <input
        className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none ring-cyan-500 focus:ring-2"
        type="number"
        min={props.min}
        max={props.max}
        value={props.value}
        onChange={(event) => props.onChange(clampInteger(Number(event.currentTarget.value), props.min, props.max))}
      />
    </label>
  )
}

export function PreviewPanel(props: {
  readonly title: string
  readonly empty: string
  readonly imageUrl: string | null
  readonly loading?: boolean
  readonly className?: string
}) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm ${props.className || ''}`}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">{props.title}</h2>
        {props.loading ? <AppIcon name="loader" className="h-4 w-4 animate-spin text-cyan-700" /> : null}
      </div>
      <div className="flex min-h-72 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-100">
        {props.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="max-h-[70vh] w-full object-contain" src={props.imageUrl} alt={props.title} />
        ) : (
          <p className="px-4 text-center text-sm text-slate-500">{props.empty}</p>
        )}
      </div>
    </section>
  )
}
