'use client'

import { useMemo, type ReactNode } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { FieldGlyph } from '@/features/project-workspace/canvas/nodes/field-glyphs'
import type { ProjectEditScript, ProjectEditScriptShot } from '@/types/project'
import {
  DETAIL_FIELD_COUNT,
  SHOT_GRID_COLUMNS,
  buildShotDetailGroups,
  chunkItems,
  flattenGroups,
  type DetailField,
  type DetailGroup,
  type LabelReader,
  type StreamEffectMode,
  type StreamPhase,
} from './edit-script-stream-types'
import styles from './edit-script-stream-effects.module.css'

const cardEffectClass: Record<StreamEffectMode, string> = {
  soft: styles.cardSoft,
  scan: styles.cardScan,
  hologram: styles.cardHologram,
  cascade: styles.cardCascade,
}

const shotEffectClass: Record<StreamEffectMode, string> = {
  soft: styles.shotCardSoft,
  scan: styles.shotCardScan,
  hologram: styles.shotCardHologram,
  cascade: styles.shotCardCascade,
}

const detailEffectClass: Record<StreamEffectMode, string> = {
  soft: '',
  scan: styles.detailPanelScan,
  hologram: styles.detailPanelHologram,
  cascade: styles.detailPanelCascade,
}

const fieldEffectClass: Record<StreamEffectMode, string> = {
  soft: styles.fieldCellSoft,
  scan: styles.fieldCellScan,
  hologram: styles.fieldCellHologram,
  cascade: styles.fieldCellCascade,
}

function sectionShell(title: string, children: ReactNode) {
  return (
    <section className="space-y-1.5 rounded-[16px] bg-slate-50 p-3 ring-1 ring-slate-100">
      <p className="select-none text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]">{title}</p>
      {children}
    </section>
  )
}

function MetaValue({
  label,
  value,
}: {
  readonly label: string
  readonly value: string | number | null | undefined
}) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="grid grid-cols-[4.5rem_1fr] gap-2 text-xs leading-5">
      <span className="select-none text-[var(--glass-text-tertiary)]">{label}</span>
      <span className="select-none min-w-0 break-words text-[var(--glass-text-secondary)]">{value}</span>
    </div>
  )
}

function SummaryText({
  value,
  lines = 3,
}: {
  readonly value: string | null | undefined
  readonly lines?: 2 | 3 | 4
}) {
  if (!value?.trim()) return null
  const clampClass = lines === 2 ? 'line-clamp-2' : lines === 4 ? 'line-clamp-4' : 'line-clamp-3'
  return (
    <p className={`select-none ${clampClass} break-words text-xs leading-5 text-[var(--glass-text-secondary)]`}>
      {value}
    </p>
  )
}

function FieldCell({
  field,
  revealed,
  effectMode,
}: {
  readonly field: DetailField
  readonly revealed: boolean
  readonly effectMode: StreamEffectMode
}) {
  if (!revealed) {
    return (
      <div className={`workspace-node-loading-surface min-h-[74px] rounded-[12px] border border-slate-200 bg-slate-100 ${styles.loadingCell}`} />
    )
  }
  const span = field.value.length > 40
  return (
    <div className={`${styles.fieldCell} ${fieldEffectClass[effectMode]} rounded-[12px] border border-slate-200 bg-white p-2.5 transition ${span ? 'sm:col-span-2' : ''}`}>
      <p className="mb-1 flex select-none items-center gap-1 text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]">
        <FieldGlyph name={field.glyph} className="h-3 w-3" />
        {field.label}
      </p>
      <p className="select-none whitespace-pre-wrap break-words text-[11px] leading-4 text-[var(--glass-text-secondary)]">
        {field.value}
      </p>
    </div>
  )
}

function ShotDetailPanel({
  shot,
  groups,
  revealCount,
  active,
  title,
  duration,
  effectMode,
}: {
  readonly shot: ProjectEditScriptShot
  readonly groups: readonly DetailGroup[]
  readonly revealCount: number
  readonly active: boolean
  readonly title: string
  readonly duration: string
  readonly effectMode: StreamEffectMode
}) {
  let fieldOffset = 0
  return (
    <div className={`${styles.detailPanel} ${detailEffectClass[effectMode]} space-y-2 rounded-[14px] border bg-slate-50 p-4 transition ${active ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200'}`}>
      <div className="flex items-center gap-2">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">
          {shot.shotNumber}
        </span>
        <span className="select-none text-sm font-semibold text-[var(--glass-text-primary)]">{title}</span>
        <span className="select-none text-xs text-[var(--glass-text-tertiary)]">{duration}</span>
        {active ? <AppIcon name="loader" className="h-3.5 w-3.5 animate-spin text-slate-500" /> : null}
      </div>
      <div className="space-y-2">
        {groups.map((group) => {
          const start = fieldOffset
          fieldOffset += group.fields.length
          return (
            <section key={group.key} className="space-y-1.5 rounded-[14px] bg-white p-3 ring-1 ring-slate-100">
              <p className="flex select-none items-center gap-1 text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]">
                <FieldGlyph name={group.glyph} className="h-3 w-3" />
                {group.title}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {group.fields.map((field, index) => (
                  <FieldCell
                    key={field.key}
                    field={field}
                    revealed={start + index < revealCount}
                    effectMode={effectMode}
                  />
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function ShotGrid({
  shots,
  activeShotNumber,
  manualShotNumber,
  revealCount,
  groupsByShotNumber,
  onSelectShot,
  labels,
  effectMode,
}: {
  readonly shots: readonly ProjectEditScriptShot[]
  readonly activeShotNumber: number | null
  readonly manualShotNumber: number | null
  readonly revealCount: number
  readonly groupsByShotNumber: ReadonlyMap<number, readonly DetailGroup[]>
  readonly onSelectShot: (shotNumber: number) => void
  readonly labels: LabelReader
  readonly effectMode: StreamEffectMode
}) {
  const focusedShotNumber = activeShotNumber ?? manualShotNumber

  return (
    <div className="space-y-2.5">
      {chunkItems(shots, SHOT_GRID_COLUMNS).map((row, rowIndex) => {
        const focusedShot = focusedShotNumber === null
          ? null
          : row.find((shot) => shot.shotNumber === focusedShotNumber) ?? null
        return (
          <div key={rowIndex} className="space-y-2.5">
            <div className="grid grid-cols-3 gap-2.5">
              {row.map((shot) => {
                const isActive = shot.shotNumber === activeShotNumber
                const isManual = shot.shotNumber === manualShotNumber
                const isOpen = shot.shotNumber === focusedShotNumber
                return (
                  <button
                    key={shot.shotNumber}
                    type="button"
                    className={`nodrag ${styles.shotCard} ${shotEffectClass[effectMode]} flex min-h-[138px] flex-col rounded-[14px] border bg-white p-3 text-left transition ${
                      isOpen
                        ? `border-slate-900 ring-1 ring-slate-900 ${effectMode === 'soft' || effectMode === 'cascade' ? styles.activeShot : styles.activeShotTech}`
                        : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'
                    }`}
                    style={{ animationDelay: `${Math.min(rowIndex * 80, 240)}ms` }}
                    onClick={(event) => {
                      event.stopPropagation()
                      onSelectShot(shot.shotNumber)
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">
                        {shot.shotNumber}
                      </span>
                      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--glass-text-tertiary)]">
                        {shot.durationSec}s
                        {isActive ? <AppIcon name="loader" className="h-3.5 w-3.5 animate-spin" /> : (
                          <AppIcon name={isOpen ? 'chevronUp' : 'chevronDown'} className="h-3.5 w-3.5" />
                        )}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 select-none text-[11px] font-semibold leading-4 text-[var(--glass-text-primary)]">
                      {shot.dramaticPurpose}
                    </p>
                    <p className="mt-1.5 line-clamp-3 select-none text-[11px] leading-4 text-[var(--glass-text-secondary)]">
                      {shot.visibleAction}
                    </p>
                    {isManual && !isActive ? (
                      <p className="mt-auto select-none pt-2 text-[10px] font-semibold text-slate-500">{labels('manualFocus')}</p>
                    ) : null}
                  </button>
                )
              })}
            </div>
            {focusedShot ? (
              <ShotDetailPanel
                shot={focusedShot}
                groups={groupsByShotNumber.get(focusedShot.shotNumber) ?? []}
                revealCount={focusedShot.shotNumber === activeShotNumber ? revealCount : DETAIL_FIELD_COUNT}
                active={focusedShot.shotNumber === activeShotNumber}
                title={focusedShot.dramaticPurpose}
                duration={`${focusedShot.durationSec}s`}
                effectMode={effectMode}
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

export function EditScriptStreamTableCard({
  editScript,
  visibleShots,
  activeShotNumber,
  manualShotNumber,
  revealCount,
  tableOpen,
  phase,
  onToggleTable,
  onSelectShot,
  labels,
  fieldLabels,
  nodeLabels,
  statusLabels,
  effectMode,
}: {
  readonly editScript: ProjectEditScript
  readonly visibleShots: readonly ProjectEditScriptShot[]
  readonly activeShotNumber: number | null
  readonly manualShotNumber: number | null
  readonly revealCount: number
  readonly tableOpen: boolean
  readonly phase: StreamPhase
  readonly onToggleTable: () => void
  readonly onSelectShot: (shotNumber: number) => void
  readonly labels: LabelReader
  readonly fieldLabels: LabelReader
  readonly nodeLabels: LabelReader
  readonly statusLabels: LabelReader
  readonly effectMode: StreamEffectMode
}) {
  const groupsByShotNumber = useMemo(() => {
    const entries = editScript.shots.map((shot) => [
      shot.shotNumber,
      buildShotDetailGroups(shot, fieldLabels, labels),
    ] as const)
    return new Map<number, readonly DetailGroup[]>(entries)
  }, [editScript.shots, fieldLabels, labels])
  const revealedFieldCount = activeShotNumber === null
    ? 0
    : flattenGroups(groupsByShotNumber.get(activeShotNumber) ?? []).length
  const fieldProgress = activeShotNumber === null
    ? labels('fieldProgressIdle')
    : labels('fieldProgress', {
        current: Math.min(revealCount, revealedFieldCount),
        total: revealedFieldCount,
      })
  const statusLabel = phase === 'complete'
    ? statusLabels('ready')
    : phase === 'paused'
      ? labels('paused')
      : statusLabels('processing')

  return (
    <article className={`${styles.card} ${cardEffectClass[effectMode]} w-[min(760px,calc(100vw-32px))] overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.08)]`}>
      <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--glass-text-tertiary)]">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-[11px] bg-slate-100 text-[var(--glass-text-secondary)]">
              <AppIcon name="clipboardCheck" className="h-4 w-4" />
            </span>
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-100 px-2 text-[11px] font-semibold text-[var(--glass-text-secondary)]">E</span>
            <p className="truncate">{nodeLabels('eyebrow')}</p>
          </div>
          <h1 className="mt-2 truncate text-xl font-semibold tracking-tight text-[var(--glass-text-primary)]">{editScript.title}</h1>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-[var(--glass-text-secondary)]">
          {statusLabel}
        </span>
      </header>
      <div className="space-y-3 p-4">
        {tableOpen ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              {sectionShell(fieldLabels('editScriptMeta'), (
                <div className="space-y-1">
                  <MetaValue label={fieldLabels('totalDuration')} value={editScript.durationSec} />
                  <MetaValue label={fieldLabels('shotCount')} value={editScript.shotCount} />
                </div>
              ))}
              {sectionShell(fieldLabels('description'), <SummaryText value={editScript.logline || editScript.userPrompt} />)}
            </div>
            {editScript.screenplayText ? sectionShell(fieldLabels('screenplay'), <SummaryText value={editScript.screenplayText} lines={4} />) : null}
            <ShotGrid
              shots={visibleShots}
              activeShotNumber={activeShotNumber}
              manualShotNumber={manualShotNumber}
              revealCount={revealCount}
              groupsByShotNumber={groupsByShotNumber}
              onSelectShot={onSelectShot}
              labels={labels}
              effectMode={effectMode}
            />
          </>
        ) : (
          <div className="min-h-[72px] space-y-2">
            <SummaryText value={editScript.logline || editScript.userPrompt} />
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-[var(--glass-text-secondary)]">
                {labels('shotProgress', { current: visibleShots.length, total: editScript.shotCount })}
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-[var(--glass-text-secondary)]">
                {fieldProgress}
              </span>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
          <p className="min-w-0 truncate text-xs text-[var(--glass-text-tertiary)]">
            {labels('shotProgress', { current: visibleShots.length, total: editScript.shotCount })} · {fieldProgress}
          </p>
          <button
            type="button"
            className="nodrag inline-flex shrink-0 items-center gap-1.5 rounded-[14px] border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-[var(--glass-text-secondary)] transition hover:bg-slate-50"
            onClick={onToggleTable}
          >
            <AppIcon name={tableOpen ? 'chevronUp' : 'chevronDown'} className="h-3.5 w-3.5" />
            {tableOpen ? fieldLabels('collapseDetails') : fieldLabels('expandDetails')}
          </button>
        </div>
      </div>
    </article>
  )
}
