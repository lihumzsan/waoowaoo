'use client'

import { type ReactNode, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import type { WorkspaceCanvasEditBibleDetails } from '../node-canvas-types'
import { ShotGrid, shotDetailIconGrid, type ShotGridCard } from './shot-grid'
import {
  readProductionPlanningDetails,
  styleGuideHasText,
  type PlanningEntity,
  type ProductionPlanningDetails,
} from './production-planning-details'
import { WorkspaceCanvasMotionPresence } from './workspace-node-motion'

const SELECTABLE_TEXT_CLASS = 'select-none'
type Labels = ReturnType<typeof useTranslations>

interface PlanningSection {
  readonly key: string
  readonly icon: AppIconName
  readonly title: string
  readonly count: number
  readonly render: () => ReactNode
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function padIndex(index: number): string {
  return String(index + 1).padStart(2, '0')
}

function renderSubsection(title: string, children: ReactNode) {
  return (
    <div className="space-y-1.5 border-t border-slate-200/70 pt-2">
      <p className={`${SELECTABLE_TEXT_CLASS} text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}>{title}</p>
      {children}
    </div>
  )
}

function renderSummaryText(value: string | null | undefined, lines = 3) {
  if (!hasText(value)) return null
  const lineClampClass = lines === 2 ? 'line-clamp-2' : lines === 4 ? 'line-clamp-4' : 'line-clamp-3'
  return <p className={`${SELECTABLE_TEXT_CLASS} ${lineClampClass} break-words text-xs leading-5 text-[var(--glass-text-secondary)]`}>{value}</p>
}

function renderChips(label: string, values: readonly string[]) {
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

function PlanningMetricGrid({
  planning,
  details,
  labels,
}: {
  readonly planning: ProductionPlanningDetails
  readonly details: WorkspaceCanvasEditBibleDetails
  readonly labels: Labels
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
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
      {metrics.map((metric) => (
        <div key={metric.label} className="rounded-[12px] bg-white px-2.5 py-2 ring-1 ring-slate-100">
          <p className={`${SELECTABLE_TEXT_CLASS} text-[10px] font-medium text-[var(--glass-text-tertiary)]`}>{metric.label}</p>
          <p className={`${SELECTABLE_TEXT_CLASS} mt-0.5 text-sm font-semibold text-[var(--glass-text-primary)]`}>{metric.value}</p>
        </div>
      ))}
    </div>
  )
}

function entityCards(entities: readonly PlanningEntity[], aliasesLabel: string): ShotGridCard[] {
  return entities.map((entity, index) => ({
    key: entity.id,
    badge: padIndex(index),
    title: entity.name,
    subtitle: entity.summary,
    detail: entity.aliases.length > 0 ? renderChips(aliasesLabel, entity.aliases) : <p className={`${SELECTABLE_TEXT_CLASS} text-[11px] text-[var(--glass-text-tertiary)]`}>{entity.summary}</p>,
  }))
}

function renderOverview(planning: ProductionPlanningDetails, details: WorkspaceCanvasEditBibleDetails, labels: Labels): ReactNode {
  const globalBible = planning.globalBible
  return (
    <div className="space-y-2.5">
      <PlanningMetricGrid planning={planning} details={details} labels={labels} />
      {globalBible ? (
        <div className="space-y-2">
          {shotDetailIconGrid([
            { label: labels('title'), value: globalBible.title },
            { label: labels('storyLogline'), value: globalBible.logline },
          ])}
          {hasText(globalBible.synopsis) ? renderSubsection(labels('storySynopsis'), (
            <p className={`${SELECTABLE_TEXT_CLASS} whitespace-pre-wrap break-words text-xs leading-5 text-[var(--glass-text-secondary)]`}>{globalBible.synopsis}</p>
          )) : null}
          {styleGuideHasText(globalBible.styleGuide) ? renderSubsection(labels('styleGuide'), shotDetailIconGrid([
            { label: labels('visualTone'), value: globalBible.styleGuide.visualTone },
            { label: labels('cameraLanguage'), value: globalBible.styleGuide.cameraLanguage },
            { label: labels('editingLanguage'), value: globalBible.styleGuide.editingLanguage },
            { label: labels('colorAndLighting'), value: globalBible.styleGuide.colorAndLighting },
          ])) : null}
        </div>
      ) : (
        <p className={`${SELECTABLE_TEXT_CLASS} whitespace-pre-wrap text-xs leading-5 text-[var(--glass-text-secondary)]`}>{details.bibleText}</p>
      )}
    </div>
  )
}

function renderGlobalBible(planning: ProductionPlanningDetails, labels: Labels): ReactNode {
  const globalBible = planning.globalBible
  if (!globalBible) return <p className={`${SELECTABLE_TEXT_CLASS} text-xs text-[var(--glass-text-tertiary)]`}>{labels('emptyPlanningSection')}</p>
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p className={`${SELECTABLE_TEXT_CLASS} text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}>{labels('characters')}</p>
        {globalBible.characters.length > 0 ? <ShotGrid cards={entityCards(globalBible.characters, labels('aliases'))} accent="slate" /> : <p className={`${SELECTABLE_TEXT_CLASS} text-xs text-[var(--glass-text-tertiary)]`}>{labels('emptyPlanningSection')}</p>}
      </div>
      <div className="space-y-1.5">
        <p className={`${SELECTABLE_TEXT_CLASS} text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}>{labels('locations')}</p>
        {globalBible.locations.length > 0 ? <ShotGrid cards={entityCards(globalBible.locations, labels('aliases'))} accent="slate" /> : <p className={`${SELECTABLE_TEXT_CLASS} text-xs text-[var(--glass-text-tertiary)]`}>{labels('emptyPlanningSection')}</p>}
      </div>
      {globalBible.worldRules.length > 0 ? renderChips(labels('worldRules'), globalBible.worldRules) : null}
    </div>
  )
}

function renderBeatSheet(planning: ProductionPlanningDetails, labels: Labels): ReactNode {
  if (planning.beats.length === 0) return <p className={`${SELECTABLE_TEXT_CLASS} text-xs text-[var(--glass-text-tertiary)]`}>{labels('emptyPlanningSection')}</p>
  const cards: ShotGridCard[] = planning.beats.map((beat, index) => ({
    key: beat.id,
    badge: padIndex(index),
    title: beat.title,
    subtitle: beat.summary,
    meta: beat.durationSec !== null ? `${beat.durationSec}s` : undefined,
    detail: <p className={`${SELECTABLE_TEXT_CLASS} text-[11px] text-[var(--glass-text-secondary)]`}>{beat.summary}</p>,
  }))
  return <ShotGrid cards={cards} accent="slate" />
}

function renderLedger(planning: ProductionPlanningDetails, labels: Labels): ReactNode {
  if (planning.ledgerEvents.length === 0) return <p className={`${SELECTABLE_TEXT_CLASS} text-xs text-[var(--glass-text-tertiary)]`}>{labels('emptyPlanningSection')}</p>
  const cards: ShotGridCard[] = planning.ledgerEvents.map((event, index) => ({
    key: event.id,
    badge: padIndex(index),
    title: event.summary,
    subtitle: event.kind ? `${labels('eventKind')}: ${event.kind}` : undefined,
    detail: (
      <div className="space-y-2">
        {event.entities.length > 0 ? renderChips(labels('entities'), event.entities.map((entity) => (entity.entityType ? `${entity.entityType}: ${entity.entityName}` : entity.entityName))) : null}
        {renderChips(labels('persistentFacts'), event.persistentFacts)}
      </div>
    ),
  }))
  return <ShotGrid cards={cards} accent="slate" />
}

function renderEmotion(planning: ProductionPlanningDetails, labels: Labels): ReactNode {
  if (planning.emotionalCues.length === 0) return <p className={`${SELECTABLE_TEXT_CLASS} text-xs text-[var(--glass-text-tertiary)]`}>{labels('emptyPlanningSection')}</p>
  const cards: ShotGridCard[] = planning.emotionalCues.map((cue, index) => ({
    key: cue.id,
    badge: padIndex(index),
    title: cue.mood,
    subtitle: cue.note ?? undefined,
    meta: cue.intensity !== null ? `${Math.round(cue.intensity * 100)}%` : undefined,
    detail: shotDetailIconGrid([
      { label: labels('intensity'), value: cue.intensity !== null ? `${Math.round(cue.intensity * 100)}%` : null },
      { label: labels('musicPolicy'), value: cue.musicPolicy },
    ]) ?? <p className={`${SELECTABLE_TEXT_CLASS} text-[11px] text-[var(--glass-text-secondary)]`}>{cue.mood}</p>,
  }))
  return <ShotGrid cards={cards} accent="slate" />
}

function renderChapters(details: WorkspaceCanvasEditBibleDetails, labels: Labels): ReactNode {
  if (details.chapters.length === 0) return <p className={`${SELECTABLE_TEXT_CLASS} text-xs text-[var(--glass-text-tertiary)]`}>{labels('emptyPlanningSection')}</p>
  const cards: ShotGridCard[] = details.chapters.map((chapter) => ({
    key: chapter.id,
    badge: padIndex(chapter.chapterIndex),
    title: chapter.title,
    subtitle: chapter.summary,
    meta: `${chapter.targetDurationSec}s`,
    detail: shotDetailIconGrid([
      { label: labels('planStatus'), value: chapter.status },
      { label: labels('renderStatus'), value: chapter.renderStatus ?? '—' },
    ]),
  }))
  return <ShotGrid cards={cards} accent="slate" />
}

function buildSections(
  planning: ProductionPlanningDetails,
  details: WorkspaceCanvasEditBibleDetails,
  labels: Labels,
): PlanningSection[] {
  const sections: PlanningSection[] = [
    { key: 'overview', icon: 'bookOpen', title: labels('planningOverview'), count: 0, render: () => renderOverview(planning, details, labels) },
  ]
  if (planning.globalBible) {
    sections.push({
      key: 'globalBible',
      icon: 'globe2',
      title: labels('globalBible'),
      count: planning.globalBible.characters.length + planning.globalBible.locations.length,
      render: () => renderGlobalBible(planning, labels),
    })
  }
  sections.push(
    { key: 'beatSheet', icon: 'chart', title: labels('beatSheet'), count: planning.beats.length, render: () => renderBeatSheet(planning, labels) },
    { key: 'eventLedger', icon: 'clipboardCheck', title: labels('eventLedger'), count: planning.ledgerEvents.length, render: () => renderLedger(planning, labels) },
    { key: 'emotionalCurve', icon: 'audioWave', title: labels('emotionalCurve'), count: planning.emotionalCues.length, render: () => renderEmotion(planning, labels) },
    { key: 'chapterSplit', icon: 'grid', title: labels('chapterSplit'), count: details.chapters.length, render: () => renderChapters(details, labels) },
  )
  return sections
}

// 制作规划 · 方案 B：左侧分区导航 + 右侧横向内容；列表分区复用「核心剪辑表」ShotGrid。
export function ProductionPlanningView({
  details,
  labels,
  expanded,
  className,
}: {
  readonly details: WorkspaceCanvasEditBibleDetails
  readonly labels: Labels
  readonly expanded: boolean
  readonly className: string
}) {
  const planning = readProductionPlanningDetails(details)
  const sections = buildSections(planning, details, labels)
  const [activeKey, setActiveKey] = useState<string>(sections[0]?.key ?? 'overview')
  const active = sections.find((section) => section.key === activeKey) ?? sections[0]
  const synopsis = planning.globalBible?.synopsis ?? details.bibleText

  const collapsedContent = (
    <div className="space-y-2">
      <PlanningMetricGrid planning={planning} details={details} labels={labels} />
      {renderSummaryText(synopsis, 4)}
    </div>
  )

  return (
    <>
      {!expanded ? collapsedContent : null}
      <WorkspaceCanvasMotionPresence visible={expanded} exit={false} className={className}>
        <div className="grid gap-3 md:grid-cols-[200px_1fr]">
          <nav className="space-y-1.5 rounded-[14px] border border-slate-200 bg-white p-2">
            {sections.map((section) => {
              const isActive = section.key === active?.key
              return (
                <button
                  key={section.key}
                  type="button"
                  onPointerDownCapture={(event) => event.stopPropagation()}
                  onClick={() => setActiveKey(section.key)}
                  className={`nodrag nowheel flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left transition ${isActive ? 'bg-slate-900 text-white' : 'text-[var(--glass-text-secondary)] hover:bg-slate-50'}`}
                >
                  <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] ${isActive ? 'bg-white/15 text-white' : 'bg-slate-100 text-[var(--glass-text-secondary)]'}`}>
                    <AppIcon name={section.icon} className="h-4 w-4" />
                  </span>
                  <span className={`${SELECTABLE_TEXT_CLASS} min-w-0 flex-1 truncate text-xs font-semibold`}>{section.title}</span>
                  {section.count > 0 ? (
                    <span className={`${SELECTABLE_TEXT_CLASS} shrink-0 rounded-full px-1.5 text-[10px] ${isActive ? 'bg-white/15 text-white' : 'bg-slate-100 text-[var(--glass-text-tertiary)]'}`}>{section.count}</span>
                  ) : null}
                </button>
              )
            })}
          </nav>
          <div className="min-w-0 rounded-[16px] border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-2">
              <AppIcon name={active?.icon ?? 'bookOpen'} className="h-4 w-4 text-[var(--glass-text-tertiary)]" />
              <p className={`${SELECTABLE_TEXT_CLASS} text-sm font-semibold text-[var(--glass-text-primary)]`}>{active?.title}</p>
            </div>
            {active?.render()}
          </div>
        </div>
      </WorkspaceCanvasMotionPresence>
    </>
  )
}
