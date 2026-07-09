'use client'

import { type ReactNode, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import type { WorkspaceCanvasEditBibleDetails } from '../node-canvas-types'
import {
  readProductionPlanningDetails,
  styleGuideHasText,
  type PlanningBeat,
  type PlanningEmotionalCue,
  type PlanningEntity,
  type PlanningGlobalBible,
  type PlanningLedgerEvent,
  type ProductionPlanningDetails,
} from './production-planning-details'
import { WorkspaceCanvasMotionPresence } from './workspace-node-motion'

const SELECTABLE_TEXT_CLASS = 'select-none'

function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
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

function renderSummaryText(value: string | null | undefined, lines = 3) {
  if (!hasText(value)) return null
  const lineClampClass = lines === 2 ? 'line-clamp-2' : lines === 4 ? 'line-clamp-4' : 'line-clamp-3'
  return <p className={`${SELECTABLE_TEXT_CLASS} ${lineClampClass} break-words text-xs leading-5 text-[var(--glass-text-secondary)]`}>{value}</p>
}


function PlanningMetricGrid({
  planning,
  details,
  labels,
}: {
  readonly planning: ProductionPlanningDetails
  readonly details: WorkspaceCanvasEditBibleDetails
  readonly labels: ReturnType<typeof useTranslations>
}) {
  const metrics = [
    { label: labels('characters'), value: planning.globalBible?.characters.length ?? 0 },
    { label: labels('locations'), value: planning.globalBible?.locations.length ?? 0 },
    { label: labels('beats'), value: planning.beats.length },
    { label: labels('ledgerEvents'), value: planning.ledgerEvents.length },
    { label: labels('emotionalCues'), value: planning.emotionalCues.length },
    { label: labels('chapters'), value: details.chapters.length },
  ]
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
      {metrics.map((metric) => (
        <div key={metric.label} className="rounded-[12px] bg-white px-2.5 py-2 ring-1 ring-slate-100">
          <p className={`${SELECTABLE_TEXT_CLASS} text-[10px] font-medium text-[var(--glass-text-tertiary)]`}>{metric.label}</p>
          <p className={`${SELECTABLE_TEXT_CLASS} mt-0.5 text-sm font-semibold text-[var(--glass-text-primary)]`}>{metric.value}</p>
        </div>
      ))}
    </div>
  )
}

function PlanningDisclosure({
  icon,
  title,
  summary,
  meta,
  defaultOpen = false,
  children,
}: {
  readonly icon: AppIconName
  readonly title: string
  readonly summary: string | null
  readonly meta?: string | null
  readonly defaultOpen?: boolean
  readonly children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="overflow-hidden rounded-[16px] border border-slate-200 bg-white">
      <button
        type="button"
        aria-expanded={open}
        onPointerDownCapture={(event) => event.stopPropagation()}
        onClick={() => setOpen((prev) => !prev)}
        className="nodrag nowheel flex w-full items-start gap-3 px-3 py-3 text-left transition hover:bg-slate-50"
      >
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-slate-100 text-[var(--glass-text-secondary)]">
          <AppIcon name={icon} className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className={`${SELECTABLE_TEXT_CLASS} block text-sm font-semibold text-[var(--glass-text-primary)]`}>{title}</span>
          {summary ? (
            <span className={`${SELECTABLE_TEXT_CLASS} mt-1 block line-clamp-2 break-words text-xs leading-5 text-[var(--glass-text-secondary)]`}>{summary}</span>
          ) : null}
        </span>
        {meta ? (
          <span className={`${SELECTABLE_TEXT_CLASS} mt-1 shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-[var(--glass-text-tertiary)]`}>{meta}</span>
        ) : null}
        <AppIcon name="chevronDown" className={`mt-1.5 h-4 w-4 shrink-0 text-[var(--glass-text-tertiary)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <WorkspaceCanvasMotionPresence visible={open}>
        <div className="space-y-2 border-t border-slate-100 bg-slate-50/70 p-3">
          {children}
        </div>
      </WorkspaceCanvasMotionPresence>
    </section>
  )
}

function PlanningItemDisclosure({
  title,
  body,
  meta,
  children,
}: {
  readonly title: string
  readonly body: string | null
  readonly meta?: string | null
  readonly children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="overflow-hidden rounded-[14px] bg-white ring-1 ring-slate-100">
      <button
        type="button"
        aria-expanded={open}
        onPointerDownCapture={(event) => event.stopPropagation()}
        onClick={() => setOpen((prev) => !prev)}
        className="nodrag nowheel flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition hover:bg-slate-50"
      >
        <span className="min-w-0 flex-1">
          <span className={`${SELECTABLE_TEXT_CLASS} block break-words text-xs font-semibold text-[var(--glass-text-primary)]`}>{title}</span>
          {body ? <span className={`${SELECTABLE_TEXT_CLASS} mt-1 block line-clamp-2 break-words text-[11px] leading-5 text-[var(--glass-text-secondary)]`}>{body}</span> : null}
        </span>
        {meta ? <span className={`${SELECTABLE_TEXT_CLASS} shrink-0 text-[10px] text-[var(--glass-text-tertiary)]`}>{meta}</span> : null}
        <AppIcon name="chevronDown" className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--glass-text-tertiary)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <WorkspaceCanvasMotionPresence visible={open}>
        <div className="space-y-2 border-t border-slate-100 px-3 py-2.5">
          {body ? renderTextBlock(body) : null}
          {children}
        </div>
      </WorkspaceCanvasMotionPresence>
    </div>
  )
}

function renderPlanningChips(label: string, values: readonly string[]) {
  if (values.length === 0) return null
  return renderSubsection(label, (
    <div className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <span key={value} className={`${SELECTABLE_TEXT_CLASS} rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-[var(--glass-text-secondary)] ring-1 ring-slate-100`}>
          {value}
        </span>
      ))}
    </div>
  ))
}

function renderPlanningEntities(
  title: string,
  entities: readonly PlanningEntity[],
  emptyLabel: string,
  aliasesLabel: string,
) {
  return renderSubsection(title, entities.length > 0 ? (
    <div className="space-y-2">
      {entities.map((entity) => (
        <PlanningItemDisclosure key={entity.id} title={entity.name} body={entity.summary}>
          {entity.aliases.length > 0 ? renderPlanningChips(aliasesLabel, entity.aliases) : null}
        </PlanningItemDisclosure>
      ))}
    </div>
  ) : renderTextBlock(emptyLabel))
}

function renderPlanningOverview(
  planning: ProductionPlanningDetails,
  details: WorkspaceCanvasEditBibleDetails,
  labels: ReturnType<typeof useTranslations>,
) {
  const globalBible = planning.globalBible
  return (
    <div className="space-y-2">
      <PlanningMetricGrid planning={planning} details={details} labels={labels} />
      {globalBible ? (
        <div className="space-y-1.5 rounded-[14px] bg-white p-3 ring-1 ring-slate-100">
          {renderValue(labels('title'), globalBible.title)}
          {renderValue(labels('storyLogline'), globalBible.logline)}
          {globalBible.synopsis ? renderSubsection(labels('storySynopsis'), renderTextBlock(globalBible.synopsis)) : null}
          {styleGuideHasText(globalBible.styleGuide) ? renderSubsection(labels('styleGuide'), (
            <div className="space-y-1">
              {renderValue(labels('visualTone'), globalBible.styleGuide.visualTone)}
              {renderValue(labels('cameraLanguage'), globalBible.styleGuide.cameraLanguage)}
              {renderValue(labels('editingLanguage'), globalBible.styleGuide.editingLanguage)}
              {renderValue(labels('colorAndLighting'), globalBible.styleGuide.colorAndLighting)}
            </div>
          )) : null}
        </div>
      ) : renderTextBlock(details.bibleText)}
    </div>
  )
}

function renderGlobalBible(
  globalBible: PlanningGlobalBible,
  labels: ReturnType<typeof useTranslations>,
) {
  return (
    <div className="space-y-2">
      {renderPlanningEntities(labels('characters'), globalBible.characters, labels('emptyPlanningSection'), labels('aliases'))}
      {renderPlanningEntities(labels('locations'), globalBible.locations, labels('emptyPlanningSection'), labels('aliases'))}
      {renderPlanningChips(labels('worldRules'), globalBible.worldRules)}
    </div>
  )
}

function renderBeatSheet(beats: readonly PlanningBeat[], labels: ReturnType<typeof useTranslations>) {
  if (beats.length === 0) return renderTextBlock(labels('emptyPlanningSection'))
  return (
    <div className="space-y-2">
      {beats.map((beat, index) => (
        <PlanningItemDisclosure
          key={beat.id}
          title={`${String(index + 1).padStart(2, '0')} · ${beat.title}`}
          body={beat.summary}
          meta={beat.durationSec !== null ? `${beat.durationSec}s` : null}
        >
          {renderPlanningChips(labels('persistentFacts'), beat.persistentFacts)}
        </PlanningItemDisclosure>
      ))}
    </div>
  )
}

function renderLedgerEvents(events: readonly PlanningLedgerEvent[], labels: ReturnType<typeof useTranslations>) {
  if (events.length === 0) return renderTextBlock(labels('emptyPlanningSection'))
  return (
    <div className="space-y-2">
      {events.map((event, index) => (
        <PlanningItemDisclosure
          key={event.id}
          title={`${String(index + 1).padStart(2, '0')} · ${event.summary}`}
          body={event.kind ? `${labels('eventKind')}: ${event.kind}` : null}
        >
          {event.entities.length > 0 ? renderPlanningChips(labels('entities'), event.entities.map((entity) => (
            entity.entityType ? `${entity.entityType}: ${entity.entityName}` : entity.entityName
          ))) : null}
          {renderPlanningChips(labels('persistentFacts'), event.persistentFacts)}
        </PlanningItemDisclosure>
      ))}
    </div>
  )
}

function renderEmotionalCues(cues: readonly PlanningEmotionalCue[], labels: ReturnType<typeof useTranslations>) {
  if (cues.length === 0) return renderTextBlock(labels('emptyPlanningSection'))
  return (
    <div className="space-y-2">
      {cues.map((cue, index) => (
        <PlanningItemDisclosure
          key={cue.id}
          title={`${String(index + 1).padStart(2, '0')} · ${cue.mood}`}
          body={cue.note}
          meta={cue.intensity !== null ? `${Math.round(cue.intensity * 100)}%` : null}
        >
          <div className="space-y-1">
            {renderValue(labels('intensity'), cue.intensity !== null ? `${Math.round(cue.intensity * 100)}%` : null)}
            {renderValue(labels('musicPolicy'), cue.musicPolicy)}
          </div>
        </PlanningItemDisclosure>
      ))}
    </div>
  )
}

function renderChapterSplit(
  chapters: WorkspaceCanvasEditBibleDetails['chapters'],
  labels: ReturnType<typeof useTranslations>,
) {
  if (chapters.length === 0) return renderTextBlock(labels('emptyPlanningSection'))
  return (
    <div className="space-y-2">
      {chapters.map((chapter) => (
        <PlanningItemDisclosure
          key={chapter.id}
          title={`${String(chapter.chapterIndex + 1).padStart(2, '0')} · ${chapter.title}`}
          body={chapter.summary}
          meta={`${chapter.targetDurationSec}s`}
        >
          <div className="space-y-1">
            {renderValue(labels('planStatus'), chapter.status)}
            {renderValue(labels('renderStatus'), chapter.renderStatus ?? '-')}
          </div>
        </PlanningItemDisclosure>
      ))}
    </div>
  )
}

export function ProductionPlanningView({
  details,
  labels,
  expanded,
  className,
}: {
  readonly details: WorkspaceCanvasEditBibleDetails
  readonly labels: ReturnType<typeof useTranslations>
  readonly expanded: boolean
  readonly className: string
}) {
  const planning = readProductionPlanningDetails(details)
  const synopsis = planning.globalBible?.synopsis ?? details.bibleText
  const collapsedContent = (
    <div className="space-y-2">
      <PlanningMetricGrid planning={planning} details={details} labels={labels} />
      {renderSummaryText(synopsis, 4)}
      {details.chapters.length > 0 ? (
        <div className="space-y-1.5">
          {details.chapters.slice(0, 2).map((chapter) => (
            <div key={chapter.id} className="rounded-[12px] bg-white px-2.5 py-2 ring-1 ring-slate-100">
              <p className={`${SELECTABLE_TEXT_CLASS} truncate text-xs font-semibold text-[var(--glass-text-primary)]`}>
                {String(chapter.chapterIndex + 1).padStart(2, '0')} · {chapter.title}
              </p>
              {renderSummaryText(chapter.summary, 2)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
  return (
    <>
      {!expanded ? collapsedContent : null}
      <WorkspaceCanvasMotionPresence visible={expanded} className={className}>
        <PlanningDisclosure
          icon="bookOpen"
          title={labels('planningOverview')}
          summary={synopsis}
          meta={labels('productionPlanning')}
          defaultOpen
        >
          {renderPlanningOverview(planning, details, labels)}
        </PlanningDisclosure>
        {planning.globalBible ? (
          <PlanningDisclosure
            icon="globe2"
            title={labels('globalBible')}
            summary={planning.globalBible.logline ?? planning.globalBible.synopsis}
            meta={`${planning.globalBible.characters.length + planning.globalBible.locations.length}`}
          >
            {renderGlobalBible(planning.globalBible, labels)}
          </PlanningDisclosure>
        ) : null}
        <PlanningDisclosure
          icon="chart"
          title={labels('beatSheet')}
          summary={planning.beats[0]?.summary ?? null}
          meta={`${planning.beats.length}`}
        >
          {renderBeatSheet(planning.beats, labels)}
        </PlanningDisclosure>
        <PlanningDisclosure
          icon="clipboardCheck"
          title={labels('eventLedger')}
          summary={planning.ledgerEvents[0]?.summary ?? null}
          meta={`${planning.ledgerEvents.length}`}
        >
          {renderLedgerEvents(planning.ledgerEvents, labels)}
        </PlanningDisclosure>
        <PlanningDisclosure
          icon="audioWave"
          title={labels('emotionalCurve')}
          summary={planning.emotionalCues[0]?.note ?? planning.emotionalCues[0]?.mood ?? null}
          meta={`${planning.emotionalCues.length}`}
        >
          {renderEmotionalCues(planning.emotionalCues, labels)}
        </PlanningDisclosure>
        <PlanningDisclosure
          icon="grid"
          title={labels('chapterSplit')}
          summary={details.chapters[0]?.summary ?? null}
          meta={`${details.chapters.length}`}
        >
          {renderChapterSplit(details.chapters, labels)}
        </PlanningDisclosure>
      </WorkspaceCanvasMotionPresence>
    </>
  )
}
