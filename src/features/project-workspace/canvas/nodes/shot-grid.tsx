'use client'

import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import type { WorkspaceCanvasStreamPresentation } from '../node-canvas-types'
import { FieldGlyph, glyphForField } from './field-glyphs'
import { WorkspaceCanvasMotionPresence } from './workspace-node-motion'

const SELECTABLE_TEXT_CLASS = 'select-none'

function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export type ShotField = { readonly label: string; readonly value: string | null | undefined }

export interface ShotGridCard {
  readonly key: string
  readonly badge: ReactNode
  readonly title: string
  readonly subtitle?: string
  readonly meta?: string
  // 计数徽标（如出场角色数）。为 undefined 时不渲染徽标，仅保留展开箭头，供非人物类实例复用。
  readonly characterCount?: number | null
  readonly countIcon?: AppIconName
  readonly detailTitle?: string
  readonly detailMeta?: string
  readonly detail: ReactNode
}

const SHOT_GRID_COLUMNS = 3

function chunkShotCards(cards: readonly ShotGridCard[], size: number): ShotGridCard[][] {
  const rows: ShotGridCard[][] = []
  for (let index = 0; index < cards.length; index += size) {
    rows.push(cards.slice(index, index + size))
  }
  return rows
}

// 图标字段卡：图标 + 标签 + 值（可读性强的三级排版）
export function shotIconField(field: ShotField, options?: { readonly allowWideFields?: boolean }) {
  if (!hasText(field.value)) return null
  const span = options?.allowWideFields !== false && (field.value ?? '').length > 40
  return (
    <div
      key={field.label}
      data-stream-field="true"
      className={`rounded-[12px] border border-slate-200 bg-white p-2.5 ${span ? 'sm:col-span-2' : ''}`}
    >
      <p className={`${SELECTABLE_TEXT_CLASS} mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase text-[var(--glass-text-tertiary)]`}>
        <FieldGlyph name={glyphForField(field.label)} className="h-3 w-3" />{field.label}
      </p>
      <p className={`${SELECTABLE_TEXT_CLASS} whitespace-pre-wrap break-words text-[11px] leading-4 text-[var(--glass-text-secondary)]`}>{field.value}</p>
    </div>
  )
}

// 三级：图标字段网格
export function shotDetailIconGrid(fields: readonly ShotField[], options?: { readonly fixedColumns?: boolean; readonly allowWideFields?: boolean }) {
  const cells = fields.map((field) => shotIconField(field, { allowWideFields: options?.allowWideFields })).filter(Boolean)
  if (cells.length === 0) return null
  return <div className={`grid gap-2 ${options?.fixedColumns === true ? 'grid-cols-2' : 'sm:grid-cols-2'}`}>{cells}</div>
}

// 网格卡片 + 整行展开：点击任意卡片，在其所在整行下方就地插入满宽详情，网格始终对齐。
// 「核心剪辑表 / 摄影指导 / 剧本创作」等同类横向节点共用此权威实现。
export function ShotGrid({
  cards,
  accent,
  columns = SHOT_GRID_COLUMNS,
  streamPresentation,
}: {
  readonly cards: readonly ShotGridCard[]
  readonly accent: 'slate' | 'cyan'
  readonly columns?: number
  readonly streamPresentation?: WorkspaceCanvasStreamPresentation
}) {
  const [pinnedKey, setPinnedKey] = useState<string | null>(null)
  const streamActiveKey = streamPresentation?.activeItemKey ?? null
  const activeKey = pinnedKey ?? streamActiveKey
  const displayedStreamKeys = useMemo(
    () => new Set(streamPresentation?.displayedItemKeys ?? []),
    [streamPresentation?.displayedItemKeys],
  )
  useEffect(() => {
    if (!pinnedKey) return
    if (cards.some((card) => card.key === pinnedKey)) return
    setPinnedKey(null)
  }, [cards, pinnedKey])
  const badgeClass = accent === 'cyan' ? 'bg-cyan-600' : 'bg-slate-900'
  const activeRingClass = accent === 'cyan'
    ? 'border-cyan-500 ring-1 ring-cyan-500'
    : 'border-slate-900 ring-1 ring-slate-900'
  const gridColsClass = columns === 2 ? 'grid-cols-2' : 'grid-cols-3'
  const rowColumns = columns === 2 ? 2 : SHOT_GRID_COLUMNS
  return (
    <div className="space-y-2.5">
      {chunkShotCards(cards, rowColumns).map((row, rowIndex) => {
        const activeCard = row.find((card) => card.key === activeKey) ?? null
        return (
          <div key={rowIndex} className="space-y-2.5">
            <div className={`grid gap-2.5 ${gridColsClass}`}>
              {row.map((card) => {
                const isActive = activeKey === card.key
                const isStreamDisplayed = streamPresentation?.isStreaming === true && displayedStreamKeys.has(card.key)
                return (
                  <button
                    key={card.key}
                    type="button"
                    className={`nodrag flex flex-col rounded-[14px] border bg-white p-3 text-left transition ${isActive ? activeRingClass : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'} ${isStreamDisplayed ? 'workspace-node-stream-soft-enter' : ''}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      setPinnedKey((current) => current === card.key ? null : card.key)
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white ${badgeClass}`}>{card.badge}</span>
                      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--glass-text-tertiary)]">
                        {typeof card.characterCount === 'number' ? (
                          <>
                            <AppIcon name={card.countIcon ?? 'usersRound'} className="h-3 w-3" />
                            {card.characterCount}
                          </>
                        ) : null}
                        <AppIcon name={isActive ? 'chevronUp' : 'chevronDown'} className="h-3.5 w-3.5" />
                      </span>
                    </div>
                    <p className={`${SELECTABLE_TEXT_CLASS} mt-2 truncate text-[11px] font-semibold leading-4 text-[var(--glass-text-primary)]`}>{card.title}</p>
                    {card.subtitle ? <p className={`${SELECTABLE_TEXT_CLASS} mt-1.5 line-clamp-2 text-[11px] leading-4 text-[var(--glass-text-secondary)]`}>{card.subtitle}</p> : null}
                    {card.meta ? <p className={`${SELECTABLE_TEXT_CLASS} mt-1 truncate text-[10px] leading-4 text-[var(--glass-text-tertiary)]`}>{card.meta}</p> : null}
                  </button>
                )
              })}
            </div>
            <WorkspaceCanvasMotionPresence
              visible={Boolean(activeCard)}
              motionKey={activeCard?.key ?? 'none'}
              className={`space-y-2 rounded-[14px] border border-slate-200 bg-slate-50 p-4 ${streamPresentation?.isStreaming === true ? 'workspace-node-stream-soft-detail' : ''}`}
            >
              {activeCard ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white ${badgeClass}`}>{activeCard.badge}</span>
                    <span className={`${SELECTABLE_TEXT_CLASS} text-sm font-semibold text-[var(--glass-text-primary)]`}>{activeCard.detailTitle ?? activeCard.title}</span>
                    {activeCard.detailMeta ?? activeCard.meta ? <span className={`${SELECTABLE_TEXT_CLASS} min-w-0 truncate text-xs text-[var(--glass-text-tertiary)]`}>{activeCard.detailMeta ?? activeCard.meta}</span> : null}
                  </div>
                  {activeCard.detail}
                </>
              ) : null}
            </WorkspaceCanvasMotionPresence>
          </div>
        )
      })}
    </div>
  )
}
