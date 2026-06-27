'use client'

import { useMemo, useState } from 'react'
import { designCurrent } from './kits/DesignCurrent'
import { designMono } from './kits/DesignMono'
import { designSoft } from './kits/DesignSoft'
import { designEdge } from './kits/DesignEdge'
import { designTag } from './kits/DesignTag'
import { designTerminal } from './kits/DesignTerminal'
import { designCompact } from './kits/DesignCompact'
import { CARD_SAMPLES, KitConversation } from './kits/Conversation'
import type { CardKit } from './kits/types'

/**
 * Agent Card Lab — assistant 卡片设计走查页面。
 *
 * 两个视图:
 *  1. 单卡横排对比 — 每个卡片类型一行,横向滚动浏览全部方案(当前 UI 居首作基线)。
 *  2. 完整对话对比 — 多个并列会话窗口,展示整体观感。
 *
 * 顶部芯片可筛选要对比的方案。仅供设计评审,不接入运行时;文案为演示固定中文。
 */

const BASELINE: CardKit = designCurrent
const NEW_KITS: readonly CardKit[] = [designMono, designSoft, designEdge, designTag, designTerminal, designCompact]
const ALL_KITS: readonly CardKit[] = [BASELINE, ...NEW_KITS]

type ViewMode = 'cards' | 'conversation'

function SwatchDot({ swatch }: { swatch: string }) {
  return <span className="h-3 w-3 shrink-0 rounded-full ring-1 ring-black/5" style={{ background: swatch }} />
}

function KitColumnHeader({ kit }: { kit: CardKit }) {
  const isBaseline = kit.id === BASELINE.id
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-1.5">
        <SwatchDot swatch={kit.swatch} />
        <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500">{kit.label}</span>
      </span>
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${isBaseline ? 'bg-slate-200 text-slate-500' : 'bg-emerald-100 text-emerald-600'}`}
      >
        {isBaseline ? '基线' : '新'}
      </span>
    </div>
  )
}

function CardComparison({ kits }: { kits: readonly CardKit[] }) {
  return (
    <div className="space-y-9">
      {CARD_SAMPLES.map((sample) => (
        <section key={sample.id}>
          <div className="mb-3 flex items-center gap-2">
            <span className="h-4 w-1 rounded-full bg-slate-900" />
            <h3 className="text-sm font-semibold text-slate-700">{sample.title}</h3>
          </div>
          <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-2">
            {kits.map((kit) => (
              <div
                key={kit.id}
                className={`flex w-[300px] shrink-0 flex-col rounded-2xl border p-4 ${kit.id === BASELINE.id ? 'border-dashed border-slate-300 bg-slate-50/50' : 'border-slate-200 bg-white'}`}
              >
                <div className="mb-3">
                  <KitColumnHeader kit={kit} />
                </div>
                <div className="flex flex-1 items-start">{sample.render(kit)}</div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function ConversationComparison({ kits }: { kits: readonly CardKit[] }) {
  return (
    <div className="-mx-1 flex gap-5 overflow-x-auto px-1 pb-3">
      {kits.map((kit) => (
        <div
          key={kit.id}
          className="flex h-[760px] w-[370px] shrink-0 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-b from-slate-50/60 to-white shadow-sm"
        >
          <div className="border-b border-slate-100 bg-white/70 px-4 py-3 backdrop-blur">
            <KitColumnHeader kit={kit} />
            <div className="mt-1 truncate text-[11px] text-slate-400">{kit.blurb}</div>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-5">
            <KitConversation kit={kit} />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function AgentCardLabClient() {
  const [mode, setMode] = useState<ViewMode>('cards')
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())

  const visibleKits = useMemo(() => ALL_KITS.filter((kit) => !hidden.has(kit.id)), [hidden])

  const toggle = (id: string) => {
    if (id === BASELINE.id) return // 基线常驻
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="min-h-screen bg-[var(--glass-bg-canvas)] px-6 py-8 text-slate-900">
      <div className="mx-auto max-w-[1500px]">
        <header className="mb-7">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Agent 卡片设计走查</h1>
          <p className="mt-1 text-sm text-slate-500">
            当前 UI 对照 6 套极简新方案 · 覆盖全部 17 种卡片(审批 / 工具 / 选择 / 风格预览 / 任务 / 进行中 …)
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setMode('cards')}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${mode === 'cards' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-800'}`}
              >
                单卡横排对比
              </button>
              <button
                type="button"
                onClick={() => setMode('conversation')}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${mode === 'conversation' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-800'}`}
              >
                完整对话对比
              </button>
            </div>

            <div className="h-5 w-px bg-slate-200" />

            <div className="flex flex-wrap items-center gap-1.5">
              {ALL_KITS.map((kit) => {
                const active = !hidden.has(kit.id)
                const isBaseline = kit.id === BASELINE.id
                return (
                  <button
                    key={kit.id}
                    type="button"
                    onClick={() => toggle(kit.id)}
                    disabled={isBaseline}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                      active ? 'border-slate-300 bg-white text-slate-700' : 'border-slate-200 bg-slate-100 text-slate-400'
                    } ${isBaseline ? 'cursor-default opacity-90' : 'hover:border-slate-400'}`}
                  >
                    <SwatchDot swatch={kit.swatch} />
                    {kit.label}
                  </button>
                )
              })}
            </div>
          </div>
        </header>

        {mode === 'cards' ? <CardComparison kits={visibleKits} /> : <ConversationComparison kits={visibleKits} />}
      </div>
    </div>
  )
}
