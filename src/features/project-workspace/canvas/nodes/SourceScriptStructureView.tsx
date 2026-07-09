'use client'

import { useState, type ReactNode } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { FieldGlyph } from './field-glyphs'
import {
  countSourceScriptScenes,
  countSourceScriptStructureScenes,
  type SourceScriptAct,
  type SourceScriptEpisode,
  type SourceScriptScene,
  type SourceScriptStructure,
} from './source-script-structure'
import { WorkspaceCanvasMotionPresence } from './workspace-node-motion'

const SELECTABLE_TEXT_CLASS = 'select-none'

type SourceScriptLabels = (key: string) => string

function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function renderSection(title: string, children: ReactNode) {
  return (
    <section className="space-y-1.5 rounded-[16px] bg-slate-50 p-3 ring-1 ring-slate-100">
      <p className={`${SELECTABLE_TEXT_CLASS} text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}>{title}</p>
      {children}
    </section>
  )
}

function renderSubsection(title: string, children: ReactNode) {
  return (
    <div className="space-y-1.5 border-t border-slate-200/70 pt-2">
      <p className={`${SELECTABLE_TEXT_CLASS} text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}>{title}</p>
      {children}
    </div>
  )
}

function renderValue(label: string, value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="grid grid-cols-[4.5rem_1fr] gap-2 text-xs leading-5">
      <span className={`${SELECTABLE_TEXT_CLASS} text-[var(--glass-text-tertiary)]`}>{label}</span>
      <span className={`${SELECTABLE_TEXT_CLASS} min-w-0 break-words text-[var(--glass-text-secondary)]`}>{value}</span>
    </div>
  )
}

function renderTextBlock(value: string | null | undefined) {
  if (!hasText(value)) return null
  return <p className={`${SELECTABLE_TEXT_CLASS} whitespace-pre-wrap break-words text-xs leading-5 text-[var(--glass-text-secondary)]`}>{value}</p>
}

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
  const overview = (
    <div className="space-y-1.5">
      <p className={`${SELECTABLE_TEXT_CLASS} text-sm font-semibold leading-5 text-[var(--glass-text-primary)]`}>{structure.title}</p>
      <p className={`${SELECTABLE_TEXT_CLASS} text-xs leading-5 text-[var(--glass-text-secondary)]`}>{structure.summary}</p>
      <p className={`${SELECTABLE_TEXT_CLASS} text-[11px] leading-4 text-[var(--glass-text-tertiary)]`}>{meta}</p>
    </div>
  )
  const collapsedEpisodes = structure.episodes.slice(0, 3)
  const collapsedContent = (
    <div className="space-y-2">
      {renderSection(labels('scriptOverview'), overview)}
      <div className="space-y-2">
        {collapsedEpisodes.map((episode) => (
          <SourceScriptDisclosureCard
            key={episode.episodeIndex}
            badge={String(episode.episodeIndex + 1).padStart(2, '0')}
            title={episode.title}
            summary={episode.summary}
            meta={`${episode.acts.length} ${labels('acts')} · ${countSourceScriptScenes(episode)} ${labels('scenes')}`}
          >
            {episode.acts.map((act) => (
              <SourceScriptActCard key={act.actIndex} act={act} labels={labels} />
            ))}
          </SourceScriptDisclosureCard>
        ))}
      </div>
    </div>
  )

  return (
    <>
      {!expanded ? collapsedContent : null}
      <WorkspaceCanvasMotionPresence visible={expanded} className={expandedClassName}>
        {renderSection(labels('scriptOverview'), overview)}
        <div className="space-y-2">
          <p className={`${SELECTABLE_TEXT_CLASS} flex items-center gap-1 text-[11px] font-semibold text-[var(--glass-text-tertiary)]`}><FieldGlyph name="clapper" className="h-3.5 w-3.5" />{labels('episodes')}</p>
          {structure.episodes.map((episode) => (
            <SourceScriptEpisodeCard key={episode.episodeIndex} episode={episode} labels={labels} />
          ))}
        </div>
        {hasText(scriptText) ? (
          <div className="space-y-1.5">
            <p className={`${SELECTABLE_TEXT_CLASS} flex items-center gap-1 text-[11px] font-semibold text-[var(--glass-text-tertiary)]`}><FieldGlyph name="frame" className="h-3.5 w-3.5" />{labels('scriptText')}</p>
            <SourceScriptAccordion items={[{ key: 'full-script', title: structure.title, body: scriptText }]} />
          </div>
        ) : null}
      </WorkspaceCanvasMotionPresence>
    </>
  )
}

function SourceScriptDisclosureCard({
  badge,
  title,
  summary,
  meta,
  children,
}: {
  readonly badge: string
  readonly title: string
  readonly summary: string
  readonly meta?: string
  readonly children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <article className="overflow-hidden rounded-[14px] border border-slate-200 bg-white">
      <button
        type="button"
        className={`nodrag flex w-full items-start gap-2.5 p-3 text-left transition hover:bg-slate-50 ${open ? 'bg-slate-50' : ''}`}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((current) => !current)
        }}
      >
        <span className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-[7px] bg-slate-900 px-1.5 text-[11px] font-bold text-white">{badge}</span>
        <span className="min-w-0 flex-1">
          <span className={`${SELECTABLE_TEXT_CLASS} block truncate text-xs font-semibold leading-5 text-[var(--glass-text-primary)]`}>{title}</span>
          <span className={`${SELECTABLE_TEXT_CLASS} block text-[11px] leading-5 text-[var(--glass-text-secondary)]`}>{summary}</span>
          {meta ? <span className={`${SELECTABLE_TEXT_CLASS} mt-1 block text-[10px] leading-4 text-[var(--glass-text-tertiary)]`}>{meta}</span> : null}
        </span>
        <AppIcon name={open ? 'chevronUp' : 'chevronDown'} className="mt-1 h-3.5 w-3.5 shrink-0 text-[var(--glass-text-tertiary)]" />
      </button>
      <WorkspaceCanvasMotionPresence visible={open} motionKey={title}>
        <div className="space-y-2 border-t border-slate-100 bg-slate-50/70 p-3">
          {children}
        </div>
      </WorkspaceCanvasMotionPresence>
    </article>
  )
}

function SourceScriptEpisodeCard({ episode, labels }: { readonly episode: SourceScriptEpisode; readonly labels: SourceScriptLabels }) {
  return (
    <SourceScriptDisclosureCard
      badge={String(episode.episodeIndex + 1).padStart(2, '0')}
      title={episode.title}
      summary={episode.summary}
      meta={`${episode.acts.length} ${labels('acts')} · ${countSourceScriptScenes(episode)} ${labels('scenes')}`}
    >
      {episode.acts.map((act) => (
        <SourceScriptActCard key={act.actIndex} act={act} labels={labels} />
      ))}
    </SourceScriptDisclosureCard>
  )
}

function SourceScriptActCard({ act, labels }: { readonly act: SourceScriptAct; readonly labels: SourceScriptLabels }) {
  return (
    <SourceScriptDisclosureCard
      badge={String(act.actIndex + 1)}
      title={act.title}
      summary={act.summary}
      meta={`${act.scenes.length} ${labels('scenes')}`}
    >
      {act.scenes.map((scene) => (
        <SourceScriptSceneCard key={scene.sceneIndex} scene={scene} labels={labels} />
      ))}
    </SourceScriptDisclosureCard>
  )
}

function SourceScriptSceneCard({ scene, labels }: { readonly scene: SourceScriptScene; readonly labels: SourceScriptLabels }) {
  const metaParts = [
    scene.location,
    scene.timeOfDay ?? null,
    scene.characters.length > 0 ? scene.characters.join(labels('listSeparator')) : null,
  ].filter((part): part is string => Boolean(part))
  return (
    <SourceScriptDisclosureCard
      badge={String(scene.sceneIndex + 1)}
      title={scene.title}
      summary={scene.summary}
      meta={metaParts.join(' · ')}
    >
      <div className="space-y-1.5">
        {renderValue(labels('location'), scene.location)}
        {renderValue(labels('timeOfDay'), scene.timeOfDay)}
        {scene.characters.length > 0 ? renderValue(labels('characters'), scene.characters.join(labels('listSeparator'))) : null}
      </div>
      {renderSubsection(labels('beats'), (
        <div className="space-y-1.5">
          {scene.beats.map((beat) => (
            <div key={beat.beatIndex} className="rounded-[10px] border border-slate-200 bg-white px-2.5 py-2">
              <p className={`${SELECTABLE_TEXT_CLASS} text-[11px] font-semibold leading-4 text-[var(--glass-text-primary)]`}>{beat.title}</p>
              <p className={`${SELECTABLE_TEXT_CLASS} mt-1 text-[11px] leading-5 text-[var(--glass-text-secondary)]`}>{beat.summary}</p>
            </div>
          ))}
        </div>
      ))}
      {renderSubsection(labels('sceneBody'), renderTextBlock(scene.body))}
    </SourceScriptDisclosureCard>
  )
}

function SourceScriptAccordion({ items }: { readonly items: readonly { readonly key: string; readonly title: string; readonly body: string }[] }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="divide-y divide-slate-100 overflow-hidden rounded-[14px] border border-slate-200 bg-white">
      {items.map((item) => {
        const isOpen = open === item.key
        return (
          <div key={item.key}>
            <button
              type="button"
              className={`nodrag flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition hover:bg-slate-50 ${isOpen ? 'bg-slate-50' : ''}`}
              onClick={(event) => {
                event.stopPropagation()
                setOpen(isOpen ? null : item.key)
              }}
            >
              <span className={`${SELECTABLE_TEXT_CLASS} min-w-0 flex-1 truncate text-xs font-semibold text-[var(--glass-text-primary)]`}>{item.title}</span>
              <AppIcon name={isOpen ? 'chevronUp' : 'chevronDown'} className="h-3.5 w-3.5 shrink-0 text-[var(--glass-text-tertiary)]" />
            </button>
            <WorkspaceCanvasMotionPresence visible={isOpen} motionKey={item.key}>
              <p className={`${SELECTABLE_TEXT_CLASS} whitespace-pre-wrap break-words bg-slate-50/70 px-3 pb-3 pt-1 text-[11px] leading-5 text-[var(--glass-text-secondary)]`}>{item.body}</p>
            </WorkspaceCanvasMotionPresence>
          </div>
        )
      })}
    </div>
  )
}
