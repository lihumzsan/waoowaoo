'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { FieldGlyph } from '../field-glyphs'
import { ProductionPlanningView } from '../ProductionPlanningView'
import { hasProductionPlanningDetails } from '../production-planning-details'
import { SourceScriptStructureView } from '../SourceScriptStructureView'
import { readSourceScriptStructure } from '../source-script-structure'
import { WorkspaceCanvasMotionPresence } from '../workspace-node-motion'
import type { WorkspaceCanvasFlowNode } from '../../node-canvas-types'
import { SELECTABLE_TEXT_CLASS, nodeContentInteractionClass, renderSection, renderSummaryText, renderTextBlock } from './renderer-shared'

export function EditBibleContent({
  data,
  labels,
  expanded,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly labels: ReturnType<typeof useTranslations>
  readonly expanded: boolean
}) {
  const details = data.editBibleDetails
  if (!details) return <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
  if (hasProductionPlanningDetails(details)) {
    return <ProductionPlanningView details={details} labels={labels} expanded={expanded} className={nodeContentInteractionClass(data, 'space-y-3')} />
  }
  const parsed = parseBibleOutline(details.bibleText)

  const collapsedContent = (
    <div className="space-y-2">
      {parsed.summary
        ? renderSection(labels('summary'), renderSummaryText(parsed.summary, 4))
        : renderSection(labels('scriptText'), renderSummaryText(details.bibleText, 6))}
    </div>
  )

  return (
    <>
      {!expanded ? collapsedContent : null}
      <WorkspaceCanvasMotionPresence visible={expanded} exit={false} className={nodeContentInteractionClass(data, 'space-y-3')}>
        {parsed.summary ? renderSection(labels('summary'), renderTextBlock(parsed.summary)) : null}
        {parsed.characters.length > 0 ? (
          <div className="space-y-1.5">
            <p className={`${SELECTABLE_TEXT_CLASS} flex items-center gap-1 text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}>
              <FieldGlyph name="people" className="h-3 w-3" />
              {labels('characters')}
            </p>
            <BibleAccordion
              items={parsed.characters.map((c) => ({
                key: c.name,
                title: c.name,
                body: c.desc,
              }))}
            />
          </div>
        ) : null}
        {parsed.scenes.length > 0 ? (
          <div className="space-y-1.5">
            <p className={`${SELECTABLE_TEXT_CLASS} flex items-center gap-1 text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}>
              <FieldGlyph name="frame" className="h-3 w-3" />
              {labels('scenes')}
            </p>
            <BibleAccordion
              items={parsed.scenes.map((s, i) => ({
                key: `sc${i}`,
                badge: String(i + 1),
                title: s.header,
                body: s.actions.join('\n'),
              }))}
            />
          </div>
        ) : (
          renderSection(labels('scriptText'), renderTextBlock(details.bibleText))
        )}
        {details.chapters.length > 0
          ? renderSection(
              labels('chapters'),
              <div className="space-y-2">
                {details.chapters.map((chapter) => (
                  <div key={chapter.id} className="rounded-md border border-[var(--glass-border-subtle)] bg-[var(--glass-surface-soft)] px-2.5 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`${SELECTABLE_TEXT_CLASS} text-xs font-semibold text-[var(--glass-text-primary)]`}>
                        {String(chapter.chapterIndex + 1).padStart(2, '0')} · {chapter.title}
                      </p>
                      <p className="shrink-0 text-[10px] text-[var(--glass-text-tertiary)]">{chapter.targetDurationSec}s</p>
                    </div>
                    <p className={`${SELECTABLE_TEXT_CLASS} mt-1 line-clamp-2 text-[11px] leading-5 text-[var(--glass-text-secondary)]`}>{chapter.summary}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] text-[var(--glass-text-tertiary)]">
                      <span>
                        {labels('planStatus')}: {chapter.status}
                      </span>
                      <span>
                        {labels('renderStatus')}: {chapter.renderStatus ?? '-'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>,
            )
          : null}
      </WorkspaceCanvasMotionPresence>
    </>
  )
}
export function SourceScriptContent({
  data,
  labels,
  expanded,
}: {
  readonly data: WorkspaceCanvasFlowNode['data']
  readonly labels: ReturnType<typeof useTranslations>
  readonly expanded: boolean
}) {
  const details = data.sourceScriptDetails
  if (!details) return <p className={`${SELECTABLE_TEXT_CLASS} text-sm leading-6 text-[var(--glass-text-secondary)]`}>{data.body}</p>
  const scriptStructure = readSourceScriptStructure(details.scriptStructure)
  if (scriptStructure) {
    return (
      <SourceScriptStructureView
        structure={scriptStructure}
        scriptText={details.sourceText}
        labels={labels}
        expanded={expanded}
        expandedClassName={nodeContentInteractionClass(data, 'space-y-3')}
      />
    )
  }

  const collapsedContent = renderSection(labels('scriptText'), renderSummaryText(details.sourceText || data.body, 6))
  return (
    <>
      {!expanded ? collapsedContent : null}
      <WorkspaceCanvasMotionPresence visible={expanded} exit={false} className={nodeContentInteractionClass(data, 'space-y-3')}>
        {renderSection(labels('scriptText'), renderTextBlock(details.sourceText || data.body))}
      </WorkspaceCanvasMotionPresence>
    </>
  )
}
export interface BibleOutline {
  readonly summary: string
  readonly characters: readonly {
    readonly name: string
    readonly desc: string
  }[]
  readonly scenes: readonly {
    readonly header: string
    readonly actions: readonly string[]
  }[]
}
export function parseBibleOutline(text: string): BibleOutline {
  const lines = (text ?? '').split('\n')
  let summary = ''
  const characters: { name: string; desc: string }[] = []
  const scenes: { header: string; actions: string[] }[] = []
  let mode: 'none' | 'summary' | 'characters' | 'scene' = 'none'
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('标题')) continue
    if (line.startsWith('故事梗概')) {
      mode = 'summary'
      continue
    }
    if (line.startsWith('角色表')) {
      mode = 'characters'
      continue
    }
    if (/^场景\s*\d+/.test(line)) {
      scenes.push({
        header: line.replace(/^场景\s*\d+[｜|]?\s*/, '') || line,
        actions: [],
      })
      mode = 'scene'
      continue
    }
    if (line.startsWith('动作')) continue
    if (mode === 'summary') summary += line
    else if (mode === 'characters') {
      const m = line.split(/[：:]/)
      if (m.length >= 2)
        characters.push({
          name: m[0].trim(),
          desc: m.slice(1).join('：').trim(),
        })
    } else if (mode === 'scene' && scenes.length > 0) scenes[scenes.length - 1].actions.push(line)
  }
  return { summary, characters, scenes }
}
export function BibleAccordion({
  items,
}: {
  readonly items: readonly {
    readonly key: string
    readonly badge?: string
    readonly title: string
    readonly body: string
  }[]
}) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="divide-y divide-slate-100 overflow-hidden rounded-[14px] border border-slate-200 bg-white">
      {items.map((it) => {
        const on = open === it.key
        return (
          <div key={it.key}>
            <button
              type="button"
              className={`nodrag flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition hover:bg-slate-50 ${on ? 'bg-slate-50' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                setOpen(on ? null : it.key)
              }}
            >
              {it.badge ? (
                <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-[7px] bg-slate-900 px-1.5 text-[11px] font-bold text-white">
                  {it.badge}
                </span>
              ) : null}
              <span className={`${SELECTABLE_TEXT_CLASS} min-w-0 flex-1 truncate text-xs font-semibold text-[var(--glass-text-primary)]`}>{it.title}</span>
              <AppIcon name={on ? 'chevronUp' : 'chevronDown'} className="h-3.5 w-3.5 shrink-0 text-[var(--glass-text-tertiary)]" />
            </button>
            <WorkspaceCanvasMotionPresence visible={on} motionKey={it.key}>
              <p
                className={`${SELECTABLE_TEXT_CLASS} whitespace-pre-wrap break-words bg-slate-50/70 px-3 pb-3 pt-1 text-[11px] leading-5 text-[var(--glass-text-secondary)]`}
              >
                {it.body}
              </p>
            </WorkspaceCanvasMotionPresence>
          </div>
        )
      })}
    </div>
  )
}
