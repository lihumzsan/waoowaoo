'use client'

import React, { useState } from 'react'
import { useTranslations } from 'next-intl'
import { FieldGlyph } from '../field-glyphs'
import { WorkspaceCanvasMotionPresence } from '../workspace-node-motion'
import type { WorkspaceCanvasFlowNode } from '../../node-canvas-types'
import { SELECTABLE_TEXT_CLASS, renderSummaryText, renderValue } from './renderer-shared'

export function EditPipelineStepContent({
  data,
  labels,
  expanded,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly labels: ReturnType<typeof useTranslations>
  readonly expanded: boolean
}) {
  const details = data.editPipelineStepDetails
  if (!details) return <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
  if (details.items.length === 0) {
    return <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
  }
  const collapsedSummary = <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
  return (
    <>
      {!expanded ? collapsedSummary : null}
      <WorkspaceCanvasMotionPresence visible={expanded} className="space-y-2">
        {details.items.map((item, index) => (
          <section
            key={`${item.title}-${index}`}
            className={`space-y-2 rounded-[16px] bg-slate-50 p-3 ring-1 ring-slate-100 ${data.lifecycle.stream?.isStreaming === true ? 'workspace-node-stream-soft-enter' : ''}`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className={`${SELECTABLE_TEXT_CLASS} truncate text-xs font-semibold text-[var(--glass-text-primary)]`}>{item.title}</p>
              {item.chips && item.chips.length > 0 ? (
                <span className={`${SELECTABLE_TEXT_CLASS} shrink-0 text-[10px] font-semibold text-[var(--glass-text-tertiary)]`}>{labels('linkedShots')}</span>
              ) : null}
            </div>
            {item.fields.length > 0 ? (
              <div className="space-y-1">
                {item.fields.map((field) => (
                  <React.Fragment key={`${field.label}:${field.value}`}>{renderValue(field.label, field.value)}</React.Fragment>
                ))}
              </div>
            ) : null}
            {renderSummaryText(item.body, expanded ? 4 : 2)}
            {item.chips && item.chips.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {item.chips.map((chip) => (
                  <span
                    key={chip}
                    className={`${SELECTABLE_TEXT_CLASS} inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-white px-2 text-[10px] font-semibold text-slate-700 ring-1 ring-slate-200`}
                  >
                    {chip}
                  </span>
                ))}
              </div>
            ) : null}
          </section>
        ))}
      </WorkspaceCanvasMotionPresence>
    </>
  )
}
export const PROCESS_STEP_GLYPHS: Record<string, string> = {
  timeline: 'clock',
  action: 'motion',
  camera: 'target',
  audio: 'sound',
  primaryTable: 'film',
  assetExtract: 'people',
}
export function ProcessGroupContent({
  data,
  labels,
  expanded,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly labels: ReturnType<typeof useTranslations>
  readonly expanded: boolean
}) {
  const details = data.editProcessGroupDetails
  if (!details || details.steps.length === 0) {
    return <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
  }
  const collapsedSummary = <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
  return (
    <>
      {!expanded ? collapsedSummary : null}
      <WorkspaceCanvasMotionPresence visible={expanded} exit={false}>
        <ProcessStepGrid steps={details.steps} labels={labels} />
      </WorkspaceCanvasMotionPresence>
    </>
  )
}
export function ProcessStepGrid({
  steps,
  labels,
}: {
  readonly steps: NonNullable<WorkspaceCanvasFlowNode['data']['editProcessGroupDetails']>['steps']
  readonly labels: ReturnType<typeof useTranslations>
}) {
  const [active, setActive] = useState<string | null>(null)
  const current = steps.find((s) => s.key === active) ?? null
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-3 gap-2.5">
        {steps.map((step) => {
          const on = active === step.key
          return (
            <button
              key={step.key}
              type="button"
              className={`nodrag flex flex-col items-start rounded-[14px] border bg-white p-3 text-left transition ${on ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200 hover:border-slate-300'}`}
              onClick={(event) => {
                event.stopPropagation()
                setActive(on ? null : step.key)
              }}
            >
              <span className="flex items-center gap-1.5">
                <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-[7px] bg-slate-900 px-1.5 text-[10px] font-bold text-white">
                  {step.badge}
                </span>
                <FieldGlyph name={PROCESS_STEP_GLYPHS[step.key] ?? 'dot'} className="h-3.5 w-3.5 text-[var(--glass-text-tertiary)]" />
              </span>
              <p className={`${SELECTABLE_TEXT_CLASS} mt-1.5 text-xs font-semibold text-[var(--glass-text-primary)]`}>{step.title}</p>
              <p className={`${SELECTABLE_TEXT_CLASS} text-[10px] text-[var(--glass-text-tertiary)]`}>
                {labels('itemCount', { count: step.items.length })} · {step.statusLabel}
              </p>
            </button>
          )
        })}
      </div>
      <WorkspaceCanvasMotionPresence
        visible={Boolean(current)}
        motionKey={current?.key ?? 'none'}
        className="space-y-2 rounded-[14px] bg-slate-50 p-3 ring-1 ring-slate-100"
      >
        {current ? (
          <>
            <p className={`${SELECTABLE_TEXT_CLASS} flex items-center gap-1 text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}>
              <FieldGlyph name={PROCESS_STEP_GLYPHS[current.key] ?? 'dot'} className="h-3 w-3" />
              {current.title}
            </p>
            <div className="space-y-2">
              {current.items.map((item, index) => (
                <div key={`${item.title}-${index}`} className="space-y-1 rounded-[10px] bg-white p-2.5 ring-1 ring-slate-100">
                  <p className={`${SELECTABLE_TEXT_CLASS} text-xs font-semibold text-[var(--glass-text-primary)]`}>{item.title}</p>
                  {item.fields.length > 0
                    ? item.fields.map((field) => <React.Fragment key={`${field.label}:${field.value}`}>{renderValue(field.label, field.value)}</React.Fragment>)
                    : null}
                  {renderSummaryText(item.body, 3)}
                </div>
              ))}
            </div>
          </>
        ) : null}
      </WorkspaceCanvasMotionPresence>
      {!current ? <p className={`${SELECTABLE_TEXT_CLASS} text-xs text-[var(--glass-text-tertiary)]`}>{labels('expandDetails')}</p> : null}
    </div>
  )
}
