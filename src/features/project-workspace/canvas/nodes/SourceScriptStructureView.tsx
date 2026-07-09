'use client'

import { type ReactNode, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { FieldGlyph } from './field-glyphs'
import { ShotGrid, shotDetailIconGrid, type ShotGridCard } from './shot-grid'
import {
  countSourceScriptScenes,
  countSourceScriptStructureScenes,
  type SourceScriptScene,
  type SourceScriptStructure,
} from './source-script-structure'
import { WorkspaceCanvasMotionPresence } from './workspace-node-motion'

const SELECTABLE_TEXT_CLASS = 'select-none'

type SourceScriptLabels = (key: string) => string

function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function sceneMetaLine(scene: SourceScriptScene, labels: SourceScriptLabels): string {
  return [
    scene.location,
    scene.timeOfDay ?? null,
    scene.characters.length > 0 ? scene.characters.join(labels('listSeparator')) : null,
  ].filter((part): part is string => Boolean(part)).join(' · ')
}

function sceneDetail(scene: SourceScriptScene, labels: SourceScriptLabels): ReactNode {
  return (
    <div className="space-y-2.5">
      {shotDetailIconGrid([
        { label: labels('location'), value: scene.location },
        { label: labels('timeOfDay'), value: scene.timeOfDay ?? null },
        { label: labels('characters'), value: scene.characters.length > 0 ? scene.characters.join('\n') : null },
      ])}
      {scene.beats.length > 0 ? (
        <div className="space-y-1.5 border-t border-slate-200/70 pt-2">
          <p className={`${SELECTABLE_TEXT_CLASS} text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}>{labels('beats')}</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {scene.beats.map((beat) => (
              <div key={beat.beatIndex} className="rounded-[10px] border border-slate-200 bg-white px-2.5 py-2">
                <p className={`${SELECTABLE_TEXT_CLASS} text-[11px] font-semibold leading-4 text-[var(--glass-text-primary)]`}>{beat.title}</p>
                <p className={`${SELECTABLE_TEXT_CLASS} mt-1 text-[11px] leading-5 text-[var(--glass-text-secondary)]`}>{beat.summary}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {shotDetailIconGrid([{ label: labels('sceneBody'), value: scene.body }])}
    </div>
  )
}

function sceneCards(
  episodeIndex: number,
  actIndex: number,
  scenes: readonly SourceScriptScene[],
  labels: SourceScriptLabels,
): ShotGridCard[] {
  return scenes.map((scene) => {
    const meta = sceneMetaLine(scene, labels)
    return {
      key: `${episodeIndex}-${actIndex}-${scene.sceneIndex}`,
      badge: scene.sceneIndex + 1,
      title: scene.title,
      subtitle: scene.summary,
      meta,
      characterCount: scene.characters.length,
      detailTitle: scene.title,
      detailMeta: meta,
      detail: sceneDetail(scene, labels),
    }
  })
}

// 剧本创作 · 方案 A：场景网格 + 整行展开，与「核心剪辑表」共用 ShotGrid 权威实现。
export function SourceScriptStructureView({
  structure,
  scriptText,
  labels,
  expanded,
  expandedClassName,
}: {
  readonly structure: SourceScriptStructure
  readonly scriptText: string
  readonly labels: SourceScriptLabels
  readonly expanded: boolean
  readonly expandedClassName: string
}) {
  const meta = `${structure.episodes.length} ${labels('episodes')} · ${countSourceScriptStructureScenes(structure)} ${labels('scenes')}`
  const overviewBar = (
    <div className="flex items-center justify-between gap-2 rounded-[14px] bg-slate-50 px-4 py-3 ring-1 ring-slate-100">
      <div className="min-w-0">
        <p className={`${SELECTABLE_TEXT_CLASS} truncate text-sm font-semibold text-[var(--glass-text-primary)]`}>{structure.title}</p>
        <p className={`${SELECTABLE_TEXT_CLASS} mt-0.5 line-clamp-1 text-xs text-[var(--glass-text-secondary)]`}>{structure.summary}</p>
      </div>
      <span className={`${SELECTABLE_TEXT_CLASS} shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-[var(--glass-text-tertiary)] ring-1 ring-slate-100`}>{meta}</span>
    </div>
  )
  const collapsedContent = (
    <div className="space-y-1.5">
      <p className={`${SELECTABLE_TEXT_CLASS} text-sm font-semibold leading-5 text-[var(--glass-text-primary)]`}>{structure.title}</p>
      <p className={`${SELECTABLE_TEXT_CLASS} line-clamp-3 text-xs leading-5 text-[var(--glass-text-secondary)]`}>{structure.summary}</p>
      <p className={`${SELECTABLE_TEXT_CLASS} text-[11px] leading-4 text-[var(--glass-text-tertiary)]`}>{meta}</p>
    </div>
  )

  return (
    <>
      {!expanded ? collapsedContent : null}
      <WorkspaceCanvasMotionPresence visible={expanded} exit={false} className={expandedClassName}>
        {overviewBar}
        {structure.episodes.map((episode) => (
          <section key={episode.episodeIndex} className="space-y-2.5">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-[7px] bg-slate-900 px-1.5 text-[11px] font-bold text-white">
                {String(episode.episodeIndex + 1).padStart(2, '0')}
              </span>
              <p className={`${SELECTABLE_TEXT_CLASS} flex items-center gap-1 text-xs font-semibold text-[var(--glass-text-primary)]`}>
                <FieldGlyph name="clapper" className="h-3.5 w-3.5" />{episode.title}
              </p>
              <span className={`${SELECTABLE_TEXT_CLASS} text-[10px] text-[var(--glass-text-tertiary)]`}>
                {episode.acts.length} {labels('acts')} · {countSourceScriptScenes(episode)} {labels('scenes')}
              </span>
            </div>
            {episode.acts.map((act) => (
              <div key={act.actIndex} className="space-y-2 rounded-[14px] border border-slate-200 bg-white p-3">
                <p className={`${SELECTABLE_TEXT_CLASS} flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-[var(--glass-text-secondary)]`}>
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-[6px] bg-slate-100 px-1 text-[10px] font-bold text-[var(--glass-text-secondary)]">{act.actIndex + 1}</span>
                  {act.title}
                  <span className={`${SELECTABLE_TEXT_CLASS} font-normal text-[var(--glass-text-tertiary)]`}>· {act.scenes.length} {labels('scenes')}</span>
                </p>
                {hasText(act.summary) ? <p className={`${SELECTABLE_TEXT_CLASS} line-clamp-1 text-[11px] text-[var(--glass-text-tertiary)]`}>{act.summary}</p> : null}
                <ShotGrid cards={sceneCards(episode.episodeIndex, act.actIndex, act.scenes, labels)} accent="slate" />
              </div>
            ))}
          </section>
        ))}
        {hasText(scriptText) ? <SourceScriptFullText label={labels('scriptText')} text={scriptText} /> : null}
      </WorkspaceCanvasMotionPresence>
    </>
  )
}

function SourceScriptFullText({ label, text }: { readonly label: string; readonly text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="overflow-hidden rounded-[14px] border border-slate-200 bg-white">
      <button
        type="button"
        className="nodrag flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition hover:bg-slate-50"
        onClick={(event) => {
          event.stopPropagation()
          setOpen((current) => !current)
        }}
      >
        <FieldGlyph name="frame" className="h-3.5 w-3.5 shrink-0 text-[var(--glass-text-tertiary)]" />
        <span className={`${SELECTABLE_TEXT_CLASS} min-w-0 flex-1 truncate text-xs font-semibold text-[var(--glass-text-primary)]`}>{label}</span>
        <AppIcon name={open ? 'chevronUp' : 'chevronDown'} className="h-3.5 w-3.5 shrink-0 text-[var(--glass-text-tertiary)]" />
      </button>
      <WorkspaceCanvasMotionPresence visible={open} motionKey={label}>
        <p className={`nowheel ${SELECTABLE_TEXT_CLASS} max-h-[420px] overflow-y-auto whitespace-pre-wrap break-words bg-slate-50/70 px-3 pb-3 pt-2 text-[11px] leading-5 text-[var(--glass-text-secondary)]`}>{text}</p>
      </WorkspaceCanvasMotionPresence>
    </div>
  )
}
