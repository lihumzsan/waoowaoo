'use client'

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AppIcon } from '@/components/ui/icons'

/* ------------------------------------------------------------------ */
/* Mock data — 取自「生成视觉风格候选图」截图                             */
/* 剧本氛围：深夜客厅、手机监控、阴暗悬疑                                   */
/* ------------------------------------------------------------------ */

interface MockStyle {
  readonly key: string
  readonly title: string
  readonly summary: string
  readonly ratio: string
  readonly progress: number
  readonly art: string
}

const MOCK_STYLES: readonly MockStyle[] = [
  {
    key: 'style_a',
    title: '深渊之瞳',
    summary:
      '风格化 3D 暗黑微缩模型风格，冷冽蓝灰调与极简硬核光影，营造密闭空间的窒息感与被注视的不安，强调手机屏幕冷光在黑暗客厅里的孤立投射。',
    ratio: '16:9',
    progress: 36,
    art: 'radial-gradient(120% 90% at 30% 20%, #2b3a55 0%, #16202f 45%, #070b12 100%)',
  },
  {
    key: 'style_b',
    title: '黑漬异境',
    summary:
      '暗黑手绘墨渍与粗粝排线风格，高对比度黑白配冷蓝，展现扭曲狂乱的内心恐惧；笔触飞溅、边缘破碎，像监控雪花噪点中渗出的潜意识。',
    ratio: '16:9',
    progress: 35,
    art: 'linear-gradient(135deg, #0b0e14 0%, #1c2230 40%, #2a3550 70%, #0c1018 100%)',
  },
  {
    key: 'style_c',
    title: '剪影幽邃',
    summary:
      '高反差剪影与幽深景深风格，人物隐入暗部仅余轮廓，冷蓝夜色与一束手机冷光勾边，强化悬疑窥视的距离感与未知威胁。',
    ratio: '16:9',
    progress: 35,
    art: 'radial-gradient(130% 100% at 70% 80%, #1a2740 0%, #101826 50%, #05070c 100%)',
  },
]

type LabState = 'generating' | 'completed'
type Version = 'focus' | 'ring' | 'minimal' | 'tall' | 'film'

const VERSIONS: readonly { id: Version; label: string }[] = [
  { id: 'focus', label: '焦点经典' },
  { id: 'ring', label: '圆环大图' },
  { id: 'minimal', label: '极简边缘' },
  { id: 'tall', label: '竖版大图' },
  { id: 'film', label: '胶片编号' },
]

const avg = (m: Record<string, number>) => MOCK_STYLES.reduce((a, s) => a + (m[s.key] ?? 0), 0) / MOCK_STYLES.length

/* ------------------------------------------------------------------ */
/* 通用小部件                                                          */
/* ------------------------------------------------------------------ */

function ProgressRing({ percent, size = 56 }: { percent: number; size?: number }) {
  const r = size * 0.34
  const circ = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(100, percent))
  const offset = circ * (1 - clamped / 100)
  const stroke = size < 40 ? 3 : 3.5
  return (
    <div className="relative flex items-center justify-center" style={{ height: size, width: size }}>
      <svg viewBox="0 0 48 48" className="h-full w-full -rotate-90">
        <circle cx="24" cy="24" r={r} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={stroke} />
        <circle cx="24" cy="24" r={r} fill="none" stroke="url(#splRingGrad)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset} style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.22,0.61,0.36,1)' }} />
        <defs>
          <linearGradient id="splRingGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--glass-accent-from)" />
            <stop offset="100%" stopColor="var(--glass-accent-to)" />
          </linearGradient>
        </defs>
      </svg>
      <span className="absolute font-semibold tabular-nums text-white" style={{ fontSize: size < 40 ? 9 : 13 }}>{Math.floor(clamped)}</span>
    </div>
  )
}

function StatusPill({ generating, percent }: { generating: boolean; percent: number }) {
  if (!generating) {
    return (
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/92 text-[var(--glass-accent-from)] shadow-sm">
        <AppIcon name="check" className="h-4 w-4" />
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-md ring-1 ring-white/15">
      <span className="spl-pulse-dot h-1.5 w-1.5 rounded-full bg-[var(--glass-accent-to)]" />
      {Math.floor(percent)}%
    </span>
  )
}

/* 叠在预览图右下角的「选择此风格」按钮 */
function ConfirmButton() {
  return (
    <button type="button" className="group/btn inline-flex items-center gap-1 rounded-full bg-white/92 px-3.5 py-1.5 text-[12px] font-semibold text-[var(--glass-text-primary)] shadow-[0_4px_14px_rgba(15,23,42,0.28)] backdrop-blur-md transition-colors hover:bg-white">
      选择此风格
      <AppIcon name="chevronRight" className="h-3.5 w-3.5 text-[var(--glass-accent-from)] transition-transform group-hover/btn:translate-x-0.5" />
    </button>
  )
}

/* 卡片底部信息：标题 + 简介在图下（确认按钮已移到图上） */
function CardBody({ s, p, generating }: { s: MockStyle; p: number; generating: boolean }) {
  return (
    <div className="p-3">
      <div className="text-[15px] font-semibold text-[var(--glass-text-primary)]">{s.title}</div>
      <p className="mt-1.5 text-[12px] leading-5 text-[var(--glass-text-secondary)]">{s.summary}</p>
      {generating ? (
        <div className="mt-2.5 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200/80">
            <div className="h-full rounded-full bg-gradient-to-r from-[var(--glass-accent-from)] to-[var(--glass-accent-to)] transition-[width] duration-700 ease-out" style={{ width: `${p}%` }} />
          </div>
          <span className="text-[11px] font-medium tabular-nums text-[var(--glass-text-tertiary)]">生成中 {Math.floor(p)}%</span>
        </div>
      ) : null}
    </div>
  )
}

/* 卡片内紧凑表头（缩小，避免遮挡） */
function CardHeader({ state, overall }: { state: LabState; overall: number }) {
  const generating = state === 'generating'
  return (
    <div className="mb-2.5 flex items-center gap-2">
      <AppIcon name={generating ? 'loader' : 'check'} className={`h-3.5 w-3.5 shrink-0 text-[var(--glass-text-tertiary)] ${generating ? 'animate-spin' : ''}`} />
      <div className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--glass-text-primary)]">
        {generating ? '正在生成视觉风格候选图' : '视觉风格候选图已就绪'}
      </div>
      {generating ? (
        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-[var(--glass-text-secondary)]">{Math.floor(overall)}%</span>
      ) : (
        <span className="shrink-0 rounded-full border border-[var(--glass-stroke-base)] bg-white/85 px-2 py-0.5 text-[10px] font-semibold text-[var(--glass-text-tertiary)]">{MOCK_STYLES.length} 个候选</span>
      )}
    </div>
  )
}

const CARD = 'rounded-2xl border border-[var(--glass-stroke-base)] bg-white/95 p-3 shadow-[0_2px_10px_rgba(15,23,42,0.04)]'

/* 折叠小行（各版本通用） */
function CollapsedRow({ s, p, generating, accent }: { s: MockStyle; p: number; generating: boolean; accent?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-[14px] border border-[var(--glass-stroke-base)] bg-white/80 px-2.5 py-2 transition-colors hover:bg-neutral-50">
      <div className="relative h-10 w-14 shrink-0 overflow-hidden rounded-[10px] ring-1 ring-[var(--glass-stroke-base)]" style={{ background: s.art }}>
        {accent ?? (generating ? <div className="absolute inset-0 flex items-center justify-center"><ProgressRing percent={p} size={28} /></div> : null)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-[var(--glass-text-primary)]">{s.title}</div>
        <div className="truncate text-[11px] leading-4 text-[var(--glass-text-tertiary)]">{s.summary}</div>
      </div>
      <AppIcon name="chevronRight" className="h-4 w-4 shrink-0 text-[var(--glass-text-tertiary)]" />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 手风琴外壳：一张放大 + 其余缩小，点击切换                              */
/* ------------------------------------------------------------------ */

function AccordionCard({
  state,
  m,
  renderImage,
  renderRow,
}: {
  state: LabState
  m: Record<string, number>
  renderImage: (s: MockStyle, p: number, generating: boolean) => ReactNode
  renderRow?: (s: MockStyle, p: number, generating: boolean) => ReactNode
}) {
  const generating = state === 'generating'
  const [focusKey, setFocusKey] = useState<string>(MOCK_STYLES[0]?.key ?? '')
  return (
    <div className={CARD}>
      <CardHeader state={state} overall={avg(m)} />
      <div className="space-y-2">
        {MOCK_STYLES.map((s) => {
          const p = m[s.key] ?? 0
          if (s.key === focusKey) {
            return (
              <div key={s.key} className="overflow-hidden rounded-[16px] border border-[var(--glass-stroke-base)] bg-white/85">
                <div className="relative">
                  {renderImage(s, p, generating)}
                  {!generating ? (
                    <div className="absolute bottom-3 right-3 z-30">
                      <ConfirmButton />
                    </div>
                  ) : null}
                </div>
                <CardBody s={s} p={p} generating={generating} />
              </div>
            )
          }
          return (
            <button key={s.key} type="button" onClick={() => setFocusKey(s.key)} className="block w-full text-left">
              {renderRow ? renderRow(s, p, generating) : <CollapsedRow s={s} p={p} generating={generating} />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ================================================================== */
/* 各版本仅在「大图区」表现不同；文字与确认按钮统一在卡片下方 / 右下角        */
/* ================================================================== */

/* 版本一 · 焦点经典：干净大图 + 角标状态 */
function VersionFocus({ state, m }: { state: LabState; m: Record<string, number> }) {
  return (
    <AccordionCard
      state={state}
      m={m}
      renderImage={(s, p, generating) => (
        <div className="relative aspect-[16/10] overflow-hidden" style={{ background: s.art }}>
          {generating ? <div className="spl-shimmer absolute inset-0 z-0" /> : null}
          <div className="absolute inset-0 z-10 bg-gradient-to-t from-black/30 to-transparent" />
          <div className="absolute right-3 top-3 z-20"><StatusPill generating={generating} percent={p} /></div>
        </div>
      )}
    />
  )
}

/* 版本二 · 圆环大图：生成中居中圆环 */
function VersionRing({ state, m }: { state: LabState; m: Record<string, number> }) {
  return (
    <AccordionCard
      state={state}
      m={m}
      renderImage={(s, p, generating) => (
        <div className="relative aspect-[16/10] overflow-hidden" style={{ background: s.art }}>
          {generating ? (
            <>
              <div className="spl-shimmer absolute inset-0 z-0" />
              <div className="absolute inset-0 z-10 bg-gradient-to-t from-black/40 via-transparent to-black/10" />
              <div className="absolute inset-0 z-20 flex items-center justify-center"><ProgressRing percent={p} size={64} /></div>
            </>
          ) : (
            <div className="absolute right-3 top-3 z-20"><StatusPill generating={false} percent={p} /></div>
          )}
        </div>
      )}
    />
  )
}

/* 版本三 · 极简边缘：底边进度线、无浮层 */
function VersionMinimal({ state, m }: { state: LabState; m: Record<string, number> }) {
  return (
    <AccordionCard
      state={state}
      m={m}
      renderImage={(s, p, generating) => (
        <div className="relative aspect-[16/9] overflow-hidden" style={{ background: s.art }}>
          {generating ? <div className="spl-shimmer-soft absolute inset-0 z-0" /> : null}
          <div className="absolute right-3 top-3 z-20"><StatusPill generating={generating} percent={p} /></div>
          <div className="absolute inset-x-0 bottom-0 z-20 h-[3px] bg-white/15">
            <div className="h-full bg-gradient-to-r from-[var(--glass-accent-from)] to-[var(--glass-accent-to)] transition-[width] duration-700 ease-out" style={{ width: `${generating ? p : 100}%` }} />
          </div>
        </div>
      )}
    />
  )
}

/* 版本四 · 竖版大图：更高的画面占比 */
function VersionTall({ state, m }: { state: LabState; m: Record<string, number> }) {
  return (
    <AccordionCard
      state={state}
      m={m}
      renderImage={(s, p, generating) => (
        <div className="relative aspect-[4/3] overflow-hidden" style={{ background: s.art }}>
          {generating ? (
            <>
              <div className="spl-shimmer absolute inset-0 z-0" />
              <div className="absolute inset-0 z-10 bg-gradient-to-t from-black/30 to-transparent" />
              <div className="absolute inset-0 z-20 flex items-center justify-center"><ProgressRing percent={p} size={68} /></div>
            </>
          ) : (
            <div className="absolute right-3 top-3 z-20"><StatusPill generating={false} percent={p} /></div>
          )}
        </div>
      )}
    />
  )
}

/* 版本五 · 胶片编号：大号序号 */
function VersionFilm({ state, m }: { state: LabState; m: Record<string, number> }) {
  const idx = (k: string) => MOCK_STYLES.findIndex((s) => s.key === k) + 1
  return (
    <AccordionCard
      state={state}
      m={m}
      renderImage={(s, p, generating) => (
        <div className="relative aspect-[16/10] overflow-hidden" style={{ background: s.art }}>
          {generating ? <div className="spl-shimmer absolute inset-0 z-0" /> : null}
          <div className="absolute inset-0 z-10 bg-gradient-to-t from-black/35 to-transparent" />
          <span className="absolute left-3 top-2.5 z-20 text-[34px] font-bold leading-none text-white/85 drop-shadow">0{idx(s.key)}</span>
          <div className="absolute right-3 top-3 z-20"><StatusPill generating={generating} percent={p} /></div>
        </div>
      )}
      renderRow={(s, p, generating) => (
        <div className="flex items-center gap-3 overflow-hidden rounded-[14px] border border-[var(--glass-stroke-base)] bg-white/80 transition-colors hover:bg-neutral-50">
          <div className="flex h-12 w-9 shrink-0 items-center justify-center bg-gradient-to-b from-[var(--glass-accent-from)] to-[var(--glass-accent-to)] text-[15px] font-bold text-white">0{idx(s.key)}</div>
          <div className="min-w-0 flex-1 py-1.5">
            <div className="truncate text-[13px] font-semibold text-[var(--glass-text-primary)]">{s.title}</div>
            <div className="truncate text-[11px] leading-4 text-[var(--glass-text-tertiary)]">{s.summary}</div>
          </div>
          <AppIcon name="chevronRight" className="mr-3 h-4 w-4 shrink-0 text-[var(--glass-text-tertiary)]" />
        </div>
      )}
    />
  )
}

/* ------------------------------------------------------------------ */
/* 模拟 assistant 聊天框（窄栏，从上往下）                                */
/* ------------------------------------------------------------------ */

function ChatFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex h-[84vh] max-h-[840px] w-full max-w-[440px] flex-col overflow-hidden rounded-[34px] border border-white/80 bg-white/82 ring-1 ring-[var(--glass-stroke-base)]/70 backdrop-blur-2xl">
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="space-y-2.5 text-[13px] leading-6 text-[var(--glass-text-primary)]">
          <p>剧本已通过 ✦ 正在为你生成 3 个视觉风格候选图：</p>
          {children}
          <div className="flex items-center gap-2 pt-1 text-[12.5px] text-[var(--glass-text-tertiary)]">
            <span className="spl-pulse-dot h-2 w-2 rounded-full bg-[var(--glass-text-tertiary)]" />
            和 AI 一起创造
          </div>
        </div>
      </div>
      <div className="shrink-0 px-3 pb-3">
        <div className="rounded-[24px] border border-[var(--glass-stroke-base)] bg-white/92 px-4 pb-2 pt-3 shadow-[0_4px_16px_rgba(15,23,42,0.05)]">
          <div className="text-[13px] text-[var(--glass-text-tertiary)]">和 AI 一起创造</div>
          <div className="mt-2.5 flex items-center justify-between">
            <button type="button" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--glass-text-secondary)]">
              <AppIcon name="lock" className="h-3.5 w-3.5" />Ask<AppIcon name="chevronDown" className="h-3.5 w-3.5" />
            </button>
            <button type="button" className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-neutral-700 text-white transition-colors hover:bg-neutral-800">
              <AppIcon name="arrowRight" className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 页面外壳（测试控制条，已缩小）                                         */
/* ------------------------------------------------------------------ */

export default function StylePreviewLabClient() {
  const [version, setVersion] = useState<Version>('focus')
  const [state, setState] = useState<LabState>('generating')
  const [autoPlay, setAutoPlay] = useState(true)
  const [m, setM] = useState<Record<string, number>>(() => Object.fromEntries(MOCK_STYLES.map((s) => [s.key, s.progress])))
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (state !== 'generating' || !autoPlay) return
    let active = true
    const tick = () => {
      if (!active) return
      setM((cur) => {
        const next: Record<string, number> = {}
        let allDone = true
        for (const s of MOCK_STYLES) {
          const v = cur[s.key] ?? 0
          const step = 0.25 + (s.key.charCodeAt(s.key.length - 1) % 3) * 0.12
          const nv = Math.min(99, v + step)
          next[s.key] = nv
          if (nv < 99) allDone = false
        }
        if (allDone) setTimeout(() => setState('completed'), 500)
        return next
      })
      rafRef.current = window.requestAnimationFrame(tick)
    }
    rafRef.current = window.requestAnimationFrame(tick)
    return () => {
      active = false
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current)
    }
  }, [state, autoPlay])

  const replay = () => {
    setM(Object.fromEntries(MOCK_STYLES.map((s) => [s.key, s.progress])))
    setState('generating')
    setAutoPlay(true)
  }

  return (
    <div className="min-h-screen w-full bg-[var(--glass-bg-canvas,#f4f6fa)] spl-dotted">
      <style>{`
        .spl-dotted { background-image: radial-gradient(rgba(100,116,139,0.16) 1px, transparent 1px); background-size: 24px 24px; }
        @keyframes spl-shimmer-move { 0% { transform: translateX(-60%);} 100% { transform: translateX(160%);} }
        .spl-shimmer::after, .spl-shimmer-soft::after { content:''; position:absolute; inset:0; background:linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.14) 50%, transparent 70%); animation: spl-shimmer-move 1.8s ease-in-out infinite; }
        .spl-shimmer-soft::after { background:linear-gradient(110deg, transparent 35%, rgba(255,255,255,0.10) 50%, transparent 65%); }
        @keyframes spl-pulse { 0%,100%{opacity:1;transform:scale(1);} 50%{opacity:.35;transform:scale(.7);} }
        .spl-pulse-dot { animation: spl-pulse 1.2s ease-in-out infinite; }
      `}</style>

      <div className="sticky top-0 z-40 border-b border-[var(--glass-stroke-base)] bg-white/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1000px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
          <div className="flex flex-wrap gap-1">
            {VERSIONS.map((v) => (
              <button key={v.id} type="button" onClick={() => setVersion(v.id)} className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${version === v.id ? 'bg-[var(--glass-accent-from)] text-white shadow-sm' : 'border border-[var(--glass-stroke-base)] bg-white/85 text-[var(--glass-text-secondary)] hover:border-[var(--glass-stroke-strong)]'}`}>
                {v.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <div className="inline-flex rounded-full border border-[var(--glass-stroke-base)] bg-white/85 p-0.5">
              {(['generating', 'completed'] as const).map((s) => (
                <button key={s} type="button" onClick={() => { setState(s); if (s === 'completed') setAutoPlay(false) }} className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${state === s ? 'bg-[var(--glass-accent-from)] text-white shadow-sm' : 'text-[var(--glass-text-secondary)] hover:text-[var(--glass-text-primary)]'}`}>
                  {s === 'generating' ? '生成中' : '已完成'}
                </button>
              ))}
            </div>
            <button type="button" onClick={replay} aria-label="重播" className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--glass-stroke-base)] bg-white/85 text-[var(--glass-text-secondary)] transition-colors hover:text-[var(--glass-text-primary)]">
              <AppIcon name="refresh" className="h-3.5 w-3.5" />
            </button>
            {state === 'generating' ? (
              <button type="button" onClick={() => setAutoPlay((v) => !v)} aria-label={autoPlay ? '暂停' : '继续'} className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--glass-stroke-base)] bg-white/85 text-[var(--glass-text-secondary)] transition-colors hover:text-[var(--glass-text-primary)]">
                <AppIcon name={autoPlay ? 'pause' : 'play'} className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="px-4 py-5">
        <ChatFrame>
          {version === 'focus' ? <VersionFocus state={state} m={m} /> : null}
          {version === 'ring' ? <VersionRing state={state} m={m} /> : null}
          {version === 'minimal' ? <VersionMinimal state={state} m={m} /> : null}
          {version === 'tall' ? <VersionTall state={state} m={m} /> : null}
          {version === 'film' ? <VersionFilm state={state} m={m} /> : null}
        </ChatFrame>
      </div>
    </div>
  )
}
