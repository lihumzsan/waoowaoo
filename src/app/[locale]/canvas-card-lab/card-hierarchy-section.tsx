'use client'
/* eslint-disable no-restricted-syntax, @next/next/no-img-element */

import { useState, type ReactNode } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { AppIconName } from '@/components/ui/icons'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { REAL } from './card-hierarchy-data'

/* ================================================================== */
/* 全卡片层级体系 — 真实数据《阁楼的玩偶》。每张卡片保留当前设计 + 两种新设计  */
/* 大量使用 SVG/图标辅助理解；排版按数据定制；自适应                         */
/* ================================================================== */

const T1 = 'text-[var(--glass-text-primary)]'
const T2 = 'text-[var(--glass-text-secondary)]'
const T3 = 'text-[var(--glass-text-tertiary)]'

/* ---------- SVG 图标系统（线性 24x24） ---------- */
const GLYPHS: Record<string, string> = {
  dot: 'M12 12h.01',
  clock: 'M12 8v4l3 2 M21 12a9 9 0 11-18 0 9 9 0 0118 0',
  target: 'M12 3a9 9 0 100 18 9 9 0 000-18 M12 8a4 4 0 100 8 4 4 0 000-8 M12 12h.01',
  motion: 'M14 4l6 8-6 8 M4 12h12',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z M12 9a3 3 0 100 6 3 3 0 000-6',
  perspective: 'M3 20l18-7L3 6v5l12 2-12 2z',
  info: 'M12 16v-4 M12 8h.01 M21 12a9 9 0 11-18 0 9 9 0 0118 0',
  pulse: 'M3 12h4l2-6 4 12 2-6h6',
  link: 'M9 15l6-6 M11 6l1-1a4 4 0 016 6l-1 1 M13 18l-1 1a4 4 0 01-6-6l1-1',
  people: 'M17 21v-2a4 4 0 00-8 0v2 M13 7a4 4 0 11-8 0 4 4 0 018 0',
  sound: 'M11 5L6 9H2v6h4l5 4V5z M15.5 8.5a5 5 0 010 7 M19 5a9 9 0 010 14',
  frame: 'M3 6h18v12H3z M3 10h18',
  camera: 'M2 8h4l2-2h8l2 2h4v11H2z M12 16a3 3 0 100-6 3 3 0 000 6',
  lens: 'M12 3a9 9 0 100 18 9 9 0 000-18 M12 8a4 4 0 100 8 4 4 0 000-8',
  layers: 'M12 3l9 5-9 5-9-5 9-5z M3 13l9 5 9-5 M3 17l9 5 9-5',
  pin: 'M12 21s7-6 7-12a7 7 0 10-14 0c0 6 7 12 7 12z M12 9a2 2 0 100 4 2 2 0 000-4',
  updown: 'M12 3v18 M7 8l5-5 5 5 M7 16l5 5 5-5',
  angle: 'M4 20V6 M4 20h16 M5 13a11 11 0 0111 7',
  move: 'M12 2v20 M2 12h20 M9 5l3-3 3 3 M9 19l3 3 3-3 M5 9l-3 3 3 3 M19 9l3 3-3 3',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8 M12 2v2 M12 20v2 M4 12H2 M22 12h-2 M5 5l1.5 1.5 M17.5 17.5L19 19 M6.5 17.5L5 19 M19 5l-1.5 1.5',
  axis: 'M3 12h18 M15 7l5 5-5 5 M9 17l-5-5 5-5',
  grid: 'M3 3h18v18H3z M9 3v18 M15 3v18 M3 9h18 M3 15h18',
  palette: 'M12 3a9 9 0 1 0 0 18 1.5 1.5 0 001.4-2 1.5 1.5 0 011.4-2H17a4 4 0 004-4 9 9 0 00-9.4-8z M7.5 11h.01 M12 7.5h.01 M16 9.5h.01',
  texture: 'M4 4h16v16H4z M4 9h16 M4 14h16 M9 4v16 M14 4v16',
  funnel: 'M3 4h18l-7 9v6l-4-2v-4z',
  ban: 'M5.5 5.5l13 13 M21 12a9 9 0 11-18 0 9 9 0 0118 0',
  flag: 'M4 21V4 M4 4h12l-2 4 2 4H4',
  clapper: 'M3 8h18v11H3z M3 8l2-4h3l-1.5 4 M9 4h3l-1.5 4 M14 4h3l-1.5 4',
  film: 'M3 4h18v16H3z M7 4v16 M17 4v16 M3 9h4 M17 9h4 M3 15h4 M17 15h4',
}
function Glyph({ name, className = 'h-3.5 w-3.5' }: { readonly name: string; readonly className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={GLYPHS[name] ?? GLYPHS.dot} />
    </svg>
  )
}
function glyphFor(label: string): string {
  const l = label
  if (l.includes('时长')) return 'clock'
  if (l.includes('戏剧') || l.includes('目的')) return 'target'
  if (l.includes('可见') || l.includes('动作')) return 'motion'
  if (l.includes('焦点')) return 'eye'
  if (l.includes('视角')) return 'perspective'
  if (l.includes('信息')) return 'info'
  if (l.includes('节拍') || l.includes('节奏')) return 'pulse'
  if (l.includes('衔接')) return 'link'
  if (l.includes('人物') || l.includes('表演')) return 'people'
  if (l.includes('声音')) return 'sound'
  if (l.includes('景别')) return 'frame'
  if (l.includes('焦段')) return 'lens'
  if (l.includes('景深')) return 'layers'
  if (l.includes('机位高度') || l.includes('高度')) return 'updown'
  if (l.includes('机位')) return 'pin'
  if (l.includes('角度')) return 'angle'
  if (l.includes('运动') || l.includes('运镜') || l.includes('移')) return 'move'
  if (l.includes('光')) return 'sun'
  if (l.includes('轴线')) return 'axis'
  if (l.includes('构图')) return 'grid'
  if (l.includes('色彩')) return 'palette'
  if (l.includes('质感')) return 'texture'
  if (l.includes('滤镜')) return 'funnel'
  if (l.includes('负向') || l.includes('约束')) return 'ban'
  return 'dot'
}

/* ---------- 系统卡片外壳（对齐 WorkspaceNode） ---------- */
function SystemCard({
  icon, eyebrow, index, title, status = '已就绪', meta, summary, defaultOpen = true, width = 460, children,
}: {
  readonly icon: AppIconName; readonly eyebrow: string; readonly index?: string; readonly title: string
  readonly status?: string; readonly meta?: string; readonly summary: ReactNode; readonly defaultOpen?: boolean
  readonly width?: number; readonly children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <article className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.08)]" style={{ width }}>
      <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
        <div className="min-w-0">
          <div className={`flex items-center gap-2 text-[12px] font-semibold ${T3}`}>
            <span className={`inline-flex h-7 w-7 items-center justify-center rounded-[11px] bg-slate-100 ${T2}`}><AppIcon name={icon} className="h-4 w-4" /></span>
            {index ? <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-100 px-2 text-[11px] font-semibold ${T2}`}>{index}</span> : null}
            <p className="truncate">{eyebrow}</p>
          </div>
          <h2 className={`mt-2 truncate text-xl font-semibold tracking-tight ${T1}`}>{title}</h2>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium ${T2}`}>{status}</span>
      </header>
      <div className="space-y-4 px-5 py-5">
        {open ? children : <div className="min-h-[20px]">{summary}</div>}
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <p className={`min-w-0 truncate text-xs ${T3}`}>{meta}</p>
          <button type="button" onClick={() => setOpen(!open)} className={`inline-flex shrink-0 items-center gap-1.5 rounded-[14px] border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold ${T2} transition hover:bg-slate-50`}>
            <AppIcon name={open ? 'chevronUp' : 'chevronDown'} className="h-3.5 w-3.5" />
            {open ? '收起' : '展开'}
          </button>
        </div>
      </div>
    </article>
  )
}

function Section({ title, glyph, children }: { readonly title: string; readonly glyph?: string; readonly children: ReactNode }) {
  return (
    <section className="space-y-1.5 rounded-[16px] bg-slate-50 p-3 ring-1 ring-slate-100">
      <p className={`flex items-center gap-1 text-[10px] font-semibold uppercase ${T3}`}>{glyph ? <Glyph name={glyph} className="h-3 w-3" /> : null}{title}</p>
      {children}
    </section>
  )
}
function ValueRow({ label, value }: { readonly label: string; readonly value: string }) {
  if (!value) return null
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-2 text-xs leading-5">
      <span className={T3}>{label}</span>
      <span className={`min-w-0 break-words ${T2}`}>{value}</span>
    </div>
  )
}
function Chips({ items }: { readonly items: readonly string[] }) {
  return <div className="flex flex-wrap gap-1.5">{items.map((c) => <span key={c} className={`rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium ${T2}`}>{c}</span>)}</div>
}
function SummaryLine({ text, chips }: { readonly text: string; readonly chips?: readonly string[] }) {
  return <div className="space-y-2"><p className={`line-clamp-1 text-xs ${T3}`}>{text}</p>{chips ? <Chips items={chips} /> : null}</div>
}

// 图标字段卡：icon + 标签 + 值（用于「字段网格」三级排版）
function IconField({ label, value, span = false }: { readonly label: string; readonly value: string; readonly span?: boolean }) {
  if (!value) return null
  return (
    <div className={`rounded-[12px] border border-slate-200 bg-white p-2.5 ${span ? 'sm:col-span-2' : ''}`}>
      <p className={`mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase ${T3}`}><Glyph name={glyphFor(label)} className="h-3 w-3" />{label}</p>
      <p className={`text-[11px] leading-4 ${T2}`}>{value}</p>
    </div>
  )
}

interface DrillItem { readonly key: string; readonly badge?: string; readonly title: string; readonly hint?: string; readonly fields?: readonly { readonly label: string; readonly value: string }[]; readonly body?: ReactNode }
function DrillList({ items, noBadge = false }: { readonly items: readonly DrillItem[]; readonly noBadge?: boolean }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="divide-y divide-slate-100 overflow-hidden rounded-[14px] border border-slate-200 bg-white">
      {items.map((it) => {
        const on = open === it.key
        return (
          <div key={it.key}>
            <button onClick={() => setOpen(on ? null : it.key)} className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition hover:bg-slate-50 ${on ? 'bg-slate-50' : ''}`}>
              {!noBadge && it.badge ? <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-[7px] bg-slate-900 px-1.5 text-[11px] font-bold text-white">{it.badge}</span> : null}
              <span className={`shrink-0 text-xs font-semibold ${T2}`}>{it.title}</span>
              <span className={`min-w-0 flex-1 truncate text-[11px] ${T3}`}>{it.hint}</span>
              <AppIcon name={on ? 'chevronUp' : 'chevronDown'} className={`h-3.5 w-3.5 shrink-0 ${T3}`} />
            </button>
            {on ? (
              <div className="space-y-2 bg-slate-50/70 px-3 pb-3 pt-1">
                {it.fields && it.fields.length > 0 ? <div className="grid gap-x-5 gap-y-1.5 sm:grid-cols-2">{it.fields.map((f) => <ValueRow key={f.label} label={f.label} value={f.value} />)}</div> : null}
                {it.body}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

/* ---------- 剧本解析 ---------- */
function parseScreenplay(text: string) {
  const lines = text.split('\n'); let summary = ''
  const characters: { name: string; desc: string }[] = []; const scenes: { header: string; actions: string[] }[] = []
  let mode: 'none' | 'summary' | 'characters' | 'scene' = 'none'
  for (const raw of lines) {
    const line = raw.trim(); if (!line) continue
    if (line.startsWith('标题：')) continue
    if (line.startsWith('故事梗概')) { mode = 'summary'; continue }
    if (line.startsWith('角色表')) { mode = 'characters'; continue }
    if (/^场景\s*\d+/.test(line)) { scenes.push({ header: line, actions: [] }); mode = 'scene'; continue }
    if (line.startsWith('动作')) continue
    if (mode === 'summary') summary += line
    else if (mode === 'characters') { const m = line.split(/[：:]/); if (m.length >= 2) characters.push({ name: m[0].trim(), desc: m.slice(1).join('：').trim() }) }
    else if (mode === 'scene' && scenes.length > 0) scenes[scenes.length - 1].actions.push(line)
  }
  return { summary, characters, scenes }
}
const STYLE_GROUPS = [
  { key: 'visual', name: '视觉', glyph: 'eye', fields: [['色彩', REAL.styleBible.stylePolicy.visual.colorPrompt], ['光线', REAL.styleBible.stylePolicy.visual.lightingPrompt], ['质感', REAL.styleBible.stylePolicy.visual.texturePrompt], ['构图', REAL.styleBible.stylePolicy.visual.compositionPrompt], ['滤镜', REAL.styleBible.stylePolicy.visual.imageFilterPrompt], ['负向', REAL.styleBible.stylePolicy.visual.negativePrompt]] },
  { key: 'camera', name: '镜头', glyph: 'camera', fields: [['运镜', REAL.styleBible.stylePolicy.camera.movementPrompt], ['景深焦点', REAL.styleBible.stylePolicy.camera.lensAndDepthPrompt], ['视频节奏', REAL.styleBible.stylePolicy.camera.videoRhythmPrompt]] },
  { key: 'directing', name: '导演', glyph: 'clapper', fields: [['节奏', REAL.styleBible.stylePolicy.directing.rhythmPrompt], ['表演', REAL.styleBible.stylePolicy.directing.performancePrompt], ['视角', REAL.styleBible.stylePolicy.directing.pointOfViewPrompt], ['信息释放', REAL.styleBible.stylePolicy.directing.informationReleasePrompt]] },
  { key: 'sound', name: '声音', glyph: 'sound', fields: [['声音滤镜', REAL.styleBible.stylePolicy.sound.soundFilterPrompt]] },
] as const

/* ================================================================== */
/* 1. 剧本 — 角色表去掉首字母图案                                          */
/* ================================================================== */
function ScreenplayCard() {
  const p = parseScreenplay(REAL.screenplayText)
  return (
    <SystemCard icon="film" eyebrow="剧本" index="S" title={REAL.title.replace(/[《》]/g, '')} meta={`${p.scenes.length} 场景 · ${p.characters.length} 角色`}
      summary={<SummaryLine text={REAL.logline} chips={[`${p.scenes.length} 场景`, `${p.characters.length} 角色`]} />}>
      <div className="space-y-3">
        <Section title="故事梗概" glyph="info"><p className={`text-xs leading-5 ${T2}`}>{p.summary}</p></Section>
        <div>
          <p className={`mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase ${T3}`}><Glyph name="people" className="h-3 w-3" />角色表</p>
          <DrillList noBadge items={p.characters.map((c) => ({ key: c.name, title: c.name, hint: c.desc, body: <p className={`text-[11px] leading-5 ${T2}`}>{c.desc}</p> }))} />
        </div>
        <div>
          <p className={`mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase ${T3}`}><Glyph name="film" className="h-3 w-3" />场景</p>
          <DrillList items={p.scenes.map((s, i) => ({ key: `sc${i}`, badge: String(i + 1), title: s.header.replace(/^场景\s*\d+[｜|]\s*/, ''), hint: s.actions[0], body: <ul className="list-disc space-y-1 pl-4">{s.actions.map((a, j) => <li key={j} className={`text-[11px] leading-5 ${T2}`}>{a}</li>)}</ul> }))} />
        </div>
      </div>
    </SystemCard>
  )
}

/* ================================================================== */
/* 2. 风格圣经                                                           */
/* ================================================================== */
const STYLE_IMG = toDisplayImageUrl(REAL.stylePreview.imageKey)
function StyleHero({ small = false }: { readonly small?: boolean }) {
  return STYLE_IMG ? <img src={STYLE_IMG} alt={REAL.stylePreview.title} className={`w-full rounded-[12px] border border-slate-200 object-cover ${small ? 'aspect-[16/7]' : 'aspect-video'}`} />
    : <div className={`flex w-full items-center justify-center rounded-[12px] bg-slate-100 ${T3} ${small ? 'aspect-[16/7]' : 'aspect-video'}`}><AppIcon name="image" className="h-6 w-6" /></div>
}
// 当前设计（保留）
function StyleBibleCard() {
  const sb = REAL.styleBible, p = sb.stylePolicy
  return (
    <SystemCard icon="sparkles" eyebrow="风格圣经" index="B" title={REAL.stylePreview.title} meta={`已选 · ${REAL.stylePreview.styleKey}`}
      summary={<SummaryLine text={sb.styleSummary} chips={['视觉', '镜头', '声音', '导演']} />}>
      <div className="space-y-3">
        <StyleHero />
        <Section title="风格总结" glyph="info"><p className={`text-xs leading-5 ${T2}`}>{sb.styleSummary}</p></Section>
        <Section title="视觉策略" glyph="eye"><div className="space-y-1.5"><ValueRow label="色彩" value={p.visual.colorPrompt} /><ValueRow label="光线" value={p.visual.lightingPrompt} /><ValueRow label="质感" value={p.visual.texturePrompt} /><ValueRow label="构图" value={p.visual.compositionPrompt} /></div></Section>
        <Section title="镜头策略" glyph="camera"><div className="space-y-1.5"><ValueRow label="运镜" value={p.camera.movementPrompt} /><ValueRow label="景深" value={p.camera.lensAndDepthPrompt} /></div></Section>
      </div>
    </SystemCard>
  )
}
// 新设计 1：外部=图片+总结；内部=4 组属性网格，点组看字段
function StyleBibleGrid() {
  const [grp, setGrp] = useState<string | null>(null)
  const cur = STYLE_GROUPS.find((g) => g.key === grp)
  return (
    <SystemCard icon="sparkles" eyebrow="风格圣经" index="B" title={REAL.stylePreview.title} meta="新设计 · 属性网格"
      summary={<div className="space-y-2"><StyleHero small /><p className={`line-clamp-2 text-xs leading-5 ${T2}`}>{REAL.styleBible.styleSummary}</p></div>}>
      <div className="space-y-3">
        <StyleHero small />
        <p className={`line-clamp-2 text-xs leading-5 ${T2}`}>{REAL.styleBible.styleSummary}</p>
        <div className="grid grid-cols-2 gap-2.5">
          {STYLE_GROUPS.map((g) => {
            const on = grp === g.key
            return (
              <button key={g.key} onClick={() => setGrp(on ? null : g.key)} className={`flex flex-col items-start rounded-[14px] border p-3 text-left transition ${on ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200 hover:border-slate-300'}`}>
                <span className={`inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-slate-100 ${T2}`}><Glyph name={g.glyph} className="h-4 w-4" /></span>
                <p className={`mt-2 text-sm font-semibold ${T1}`}>{g.name}</p>
                <p className={`text-[10px] ${T3}`}>{g.fields.length} 项策略</p>
              </button>
            )
          })}
        </div>
        {cur ? (
          <Section title={cur.name + '策略'} glyph={cur.glyph}>
            <div className="grid gap-2 sm:grid-cols-2">{cur.fields.map(([l, v]) => <IconField key={l} label={l} value={v} />)}</div>
          </Section>
        ) : null}
      </div>
    </SystemCard>
  )
}
// 新设计 2：海报式 —— 图片主视觉 + 全属性图标卡瀑布
function StyleBiblePoster() {
  const flat = STYLE_GROUPS.flatMap((g) => g.fields.map(([l, v]) => [l, v] as const))
  return (
    <SystemCard icon="sparkles" eyebrow="风格圣经" index="B" title={REAL.stylePreview.title} meta="新设计 · 海报式"
      summary={<div className="space-y-2"><StyleHero small /><p className={`line-clamp-2 text-xs leading-5 ${T2}`}>{REAL.styleBible.styleSummary}</p></div>}>
      <div className="space-y-3">
        <div className="relative overflow-hidden rounded-[14px]">
          <StyleHero />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3"><p className="line-clamp-2 text-[11px] leading-4 text-white">{REAL.styleBible.styleSummary}</p></div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">{flat.map(([l, v]) => <IconField key={l} label={l} value={v} />)}</div>
      </div>
    </SystemCard>
  )
}

/* ================================================================== */
/* 3. 生成过程                                                           */
/* ================================================================== */
const PROCESS_STEPS = [
  { key: 'd', badge: 'D', glyph: 'film', title: '导演拆镜', hint: `切分为 ${REAL.shotCount} 个镜头`, rows: REAL.shots.map((s) => [`镜 ${s.shotNumber}`, s.charactersAndScene] as const) },
  { key: 'p1', badge: 'P1', glyph: 'clock', title: '时间安排', hint: `${REAL.shotCount} 镜 · ${REAL.durationSec}s`, rows: REAL.shots.map((s) => [`镜 ${s.shotNumber}`, `${s.durationSec}s`] as const) },
  { key: 'p2', badge: 'P2', glyph: 'motion', title: '可见动作', hint: '逐镜动作', rows: REAL.shots.map((s) => [`镜 ${s.shotNumber}`, s.visibleAction] as const) },
  { key: 'p3', badge: 'P3', glyph: 'target', title: '导演意图', hint: '目的/焦点/视角', rows: REAL.shots.map((s) => [`镜 ${s.shotNumber}`, s.dramaticPurpose] as const) },
  { key: 'p4', badge: 'P4', glyph: 'sound', title: '声音设计', hint: '逐镜声音', rows: REAL.shots.map((s) => [`镜 ${s.shotNumber}`, s.sound] as const) },
  { key: 'p5', badge: 'P5', glyph: 'film', title: '片段编排', hint: `${REAL.videoBlocks.length} 个片段`, rows: REAL.videoBlocks.map((b, i) => [`片段 ${i + 1}`, `镜 ${b.shotNumbers.join(',')}`] as const) },
  { key: 'p6', badge: 'P6', glyph: 'people', title: '资产提取', hint: `${REAL.assets.length} 个资产`, rows: REAL.assets.map((a) => [a.kind === 'character' ? '人物' : '场景', a.name] as const) },
]
// 当前（保留）：清单
function ProcessCard() {
  return (
    <SystemCard icon="grid" eyebrow="生成过程" title="AI 生成过程" meta="7 步已完成 · 中间产物"
      summary={<SummaryLine text="逐步搭建核心剪辑表的中间步骤。" chips={['7 步完成']} />}>
      <DrillList items={PROCESS_STEPS.map((s) => ({ key: s.key, badge: s.badge, title: s.title, hint: s.hint, body: <div className="space-y-1">{s.rows.map(([l, v]) => <ValueRow key={l} label={l} value={v} />)}</div> }))} />
    </SystemCard>
  )
}
// 新设计 1：步骤网格
function ProcessGrid() {
  const [sel, setSel] = useState<string | null>(null)
  const cur = PROCESS_STEPS.find((s) => s.key === sel)
  return (
    <SystemCard icon="grid" eyebrow="生成过程" title="AI 生成过程" meta="新设计 · 步骤网格"
      summary={<SummaryLine text="逐步搭建核心剪辑表的中间步骤。" chips={['7 步完成']} />}>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2.5">
          {PROCESS_STEPS.map((s) => {
            const on = sel === s.key
            return (
              <button key={s.key} onClick={() => setSel(on ? null : s.key)} className={`flex flex-col items-start rounded-[14px] border p-3 text-left transition ${on ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200 hover:border-slate-300'}`}>
                <span className="flex items-center gap-1.5"><span className="inline-flex h-6 min-w-6 items-center justify-center rounded-[7px] bg-slate-900 px-1.5 text-[10px] font-bold text-white">{s.badge}</span><Glyph name={s.glyph} className={`h-3.5 w-3.5 ${T3}`} /></span>
                <p className={`mt-1.5 text-xs font-semibold ${T1}`}>{s.title}</p>
                <p className={`text-[10px] ${T3}`}>{s.hint}</p>
              </button>
            )
          })}
        </div>
        {cur ? <Section title={cur.title} glyph={cur.glyph}><div className="space-y-1">{cur.rows.map(([l, v]) => <ValueRow key={l} label={l} value={v} />)}</div></Section> : null}
      </div>
    </SystemCard>
  )
}
// 新设计 2：管线流程图（SVG 连线）
function ProcessPipeline() {
  const [sel, setSel] = useState<string>('d')
  const cur = PROCESS_STEPS.find((s) => s.key === sel)!
  return (
    <SystemCard icon="grid" eyebrow="生成过程" title="AI 生成过程" meta="新设计 · 管线流程图"
      summary={<SummaryLine text="逐步搭建核心剪辑表的中间步骤。" chips={['7 步完成']} />}>
      <div className="space-y-3">
        <div className="relative">
          <div className="absolute left-[15px] top-3 bottom-3 w-px bg-slate-200" aria-hidden />
          <div className="space-y-1">
            {PROCESS_STEPS.map((s) => {
              const on = sel === s.key
              return (
                <button key={s.key} onClick={() => setSel(s.key)} className={`relative flex w-full items-center gap-3 rounded-[10px] px-1.5 py-1.5 text-left transition ${on ? 'bg-slate-50' : 'hover:bg-slate-50'}`}>
                  <span className={`relative z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border-2 ${on ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white ' + T3}`}><Glyph name={s.glyph} className="h-4 w-4" /></span>
                  <span className="min-w-0"><p className={`text-xs font-semibold ${T1}`}>{s.badge} · {s.title}</p><p className={`truncate text-[10px] ${T3}`}>{s.hint}</p></span>
                </button>
              )
            })}
          </div>
        </div>
        <Section title={`${cur.badge} · ${cur.title}`} glyph={cur.glyph}><div className="space-y-1">{cur.rows.map(([l, v]) => <ValueRow key={l} label={l} value={v} />)}</div></Section>
      </div>
    </SystemCard>
  )
}

/* ---------- 镜头网格（面） + 三级详情排版（多形态） ---------- */
type ShotCard = { readonly n: string; readonly faceTitle: string; readonly faceSub?: string; readonly fields: readonly (readonly [string, string])[] }
function ShotFaceGrid({ cards, open, setOpen }: { readonly cards: readonly ShotCard[]; readonly open: string | null; readonly setOpen: (v: string | null) => void; }) {
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {cards.map((c) => {
        const on = open === c.n
        return (
          <button key={c.n} onClick={() => setOpen(on ? null : c.n)} className={`flex flex-col rounded-[14px] border bg-white p-3 text-left transition ${on ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200 hover:border-slate-300'}`}>
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white">{c.n}</span>
            <p className={`mt-1.5 line-clamp-2 text-[11px] font-semibold leading-4 ${T1}`}>{c.faceTitle}</p>
            {c.faceSub ? <p className={`mt-0.5 line-clamp-1 text-[10px] leading-4 ${T3}`}>{c.faceSub}</p> : null}
          </button>
        )
      })}
    </div>
  )
}
// 三级 A（当前）：紧凑两列
function DetailRows({ fields }: { readonly fields: readonly (readonly [string, string])[] }) {
  return <div className="grid gap-x-5 gap-y-1.5 sm:grid-cols-2">{fields.map(([l, v]) => <ValueRow key={l} label={l} value={v} />)}</div>
}
// 三级 B（新）：图标字段网格
function DetailIconGrid({ fields }: { readonly fields: readonly (readonly [string, string])[] }) {
  return <div className="grid gap-2 sm:grid-cols-2">{fields.map(([l, v]) => <IconField key={l} label={l} value={v} span={v.length > 40} />)}</div>
}
// 三级 C（新）：分区面板
function DetailSections({ groups }: { readonly groups: readonly { readonly name: string; readonly glyph: string; readonly fields: readonly (readonly [string, string])[] }[] }) {
  return <div className="space-y-2">{groups.map((g) => <Section key={g.name} title={g.name} glyph={g.glyph}><div className="grid gap-2 sm:grid-cols-2">{g.fields.map(([l, v]) => <IconField key={l} label={l} value={v} span={v.length > 40} />)}</div></Section>)}</div>
}

function shotCards(): ShotCard[] {
  return REAL.shots.map((s) => ({ n: String(s.shotNumber), faceTitle: s.dramaticPurpose, faceSub: `${s.durationSec}s`, fields: [['时长', `${s.durationSec}s`], ['可见动作', s.visibleAction], ['观众焦点', s.audienceFocus], ['观看视角', s.viewpoint], ['信息释放', s.revealPlan], ['表演节拍', s.performanceBeat], ['入点衔接', s.continuityIn], ['出点衔接', s.continuityOut], ['人物场景', s.charactersAndScene], ['声音', s.sound]] }))
}
function cineCards(): ShotCard[] {
  return REAL.cineShots.map((s) => ({ n: String(s.shotNumber), faceTitle: s.shotScale, faceSub: s.movement, fields: [['景别', s.shotScale], ['焦段', s.lens], ['景深', s.depthOfField], ['机位', s.cameraPosition], ['机位高度', s.cameraHeight], ['拍摄角度', s.cameraAngle], ['摄影运动', s.movement], ['光线', s.lighting], ['轴线视线', s.axisAndEyeline], ['入点衔接', s.continuityIn], ['出点衔接', s.continuityOut], ['构图', s.composition]] }))
}

/* 4. 核心剪辑表 — 当前 + 两种新三级排版 */
function EditScriptVariant({ tag, detail }: { readonly tag: string; readonly detail: 'rows' | 'icongrid' | 'sections' }) {
  const [open, setOpen] = useState<string | null>('2')
  const cards = shotCards()
  const active = cards.find((c) => c.n === open)
  return (
    <SystemCard icon="clapperboard" eyebrow="核心剪辑表" index="E" title={REAL.title.replace(/[《》]/g, '')} width={720} meta={tag}
      summary={<SummaryLine text={REAL.logline} chips={[`${REAL.shotCount} 镜`, `${REAL.durationSec}s`]} />}>
      <div className="space-y-2.5">
        <ShotFaceGrid cards={cards} open={open} setOpen={setOpen} />
        {active ? (
          <Section title={`镜头 ${active.n}`} glyph="clapper">
            {detail === 'rows' ? <DetailRows fields={active.fields} /> : null}
            {detail === 'icongrid' ? <DetailIconGrid fields={active.fields} /> : null}
            {detail === 'sections' ? <DetailSections groups={[
              { name: '叙事', glyph: 'target', fields: active.fields.filter(([l]) => ['戏剧目的', '可见动作', '观众焦点', '观看视角', '信息释放', '表演节拍', '人物场景'].includes(l)) },
              { name: '视听', glyph: 'sound', fields: active.fields.filter(([l]) => ['时长', '声音'].includes(l)) },
              { name: '衔接', glyph: 'link', fields: active.fields.filter(([l]) => l.includes('衔接')) },
            ]} /> : null}
          </Section>
        ) : null}
      </div>
    </SystemCard>
  )
}

/* 5. 摄影指导 — 当前 + 两种新 */
function CineVariant({ tag, mode }: { readonly tag: string; readonly mode: 'rows' | 'icongrid' | 'diagram' }) {
  const [open, setOpen] = useState<string | null>('2')
  const cards = cineCards()
  const active = cards.find((c) => c.n === open)
  return (
    <SystemCard icon="eye" eyebrow="摄影指导" index="C" title="摄影指导方案" width={720} meta={tag}
      summary={<SummaryLine text="逐镜机位 / 运镜 / 焦段 / 光线 / 构图。" chips={[`${REAL.cineShots.length} 镜`]} />}>
      <div className="space-y-2.5">
        <ShotFaceGrid cards={cards} open={open} setOpen={setOpen} />
        {active ? (
          <Section title={`镜头 ${active.n}`} glyph="camera">
            {mode === 'rows' ? <DetailRows fields={active.fields} /> : null}
            {mode === 'icongrid' ? <DetailIconGrid fields={active.fields} /> : null}
            {mode === 'diagram' ? (
              <div className="space-y-2">
                <StageDiagram shotIndex={Number(active.n)} scale={active.fields.find(([l]) => l === '景别')?.[1] ?? ''} angle={active.fields.find(([l]) => l === '拍摄角度')?.[1] ?? ''} />
                <DetailSections groups={[
                  { name: '机位', glyph: 'pin', fields: active.fields.filter(([l]) => ['景别', '焦段', '机位', '机位高度', '拍摄角度'].includes(l)) },
                  { name: '光线构图', glyph: 'sun', fields: active.fields.filter(([l]) => ['光线', '构图', '景深'].includes(l)) },
                  { name: '运动衔接', glyph: 'move', fields: active.fields.filter(([l]) => ['摄影运动', '轴线视线'].includes(l) || l.includes('衔接')) },
                ]} />
              </div>
            ) : null}
          </Section>
        ) : null}
      </div>
    </SystemCard>
  )
}

/* SVG 俯视机位示意图（按景别/角度定制） */
function StageDiagram({ shotIndex, scale, angle }: { readonly shotIndex: number; readonly scale: string; readonly angle: string }) {
  const close = scale.includes('特写') || scale.includes('近景')
  const wide = scale.includes('远景') || scale.includes('全景')
  const camY = close ? 64 : wide ? 84 : 74
  const high = angle.includes('俯')
  const low = angle.includes('仰')
  return (
    <div className="rounded-[12px] border border-slate-200 bg-white p-2">
      <svg viewBox="0 0 160 96" className="h-auto w-full">
        <rect x="6" y="6" width="148" height="84" rx="8" className="fill-slate-50 stroke-slate-200" />
        {/* subject */}
        <circle cx="80" cy="34" r="9" className="fill-slate-200 stroke-slate-400" />
        <text x="80" y="37" textAnchor="middle" className="fill-slate-500" fontSize="7">主体</text>
        {/* sightline / axis */}
        <line x1="80" y1="34" x2="80" y2={camY} className="stroke-slate-300" strokeDasharray="3 3" />
        {/* camera */}
        <polygon points={`80,${camY} 72,${camY + 12} 88,${camY + 12}`} className="fill-slate-900" transform={`rotate(180 80 ${camY + 6})`} />
        <text x="80" y={camY + 22} textAnchor="middle" className="fill-slate-500" fontSize="7">机位 · 镜{shotIndex}</text>
        <text x="14" y="84" className="fill-slate-400" fontSize="7">{high ? '俯拍' : low ? '仰拍' : '平视'} · {scale.replace(/\s*\(.*\)/, '')}</text>
      </svg>
    </div>
  )
}

/* 6. 空间一致性 — 当前 + 两种新 */
function SpaceCardCurrent() {
  return (
    <SystemCard icon="grid" eyebrow="空间一致性" title="空间走位校验" meta="当前 · 逐镜清单"
      summary={<SummaryLine text="逐镜校验机位、轴线、走位一致性。" chips={[`${REAL.cineShots.length}/${REAL.cineShots.length} 通过`]} />}>
      <DrillList items={REAL.cineShots.map((s) => ({ key: String(s.shotNumber), badge: String(s.shotNumber), title: `镜头 ${s.shotNumber}`, hint: s.cameraPosition, fields: [{ label: '机位', value: s.cameraPosition }, { label: '机位高度', value: s.cameraHeight }, { label: '轴线视线', value: s.axisAndEyeline }, { label: '入点衔接', value: s.continuityIn }, { label: '出点衔接', value: s.continuityOut }] }))} />
    </SystemCard>
  )
}
function SpaceGrid() {
  const [open, setOpen] = useState<string | null>(null)
  const cur = REAL.cineShots.find((s) => String(s.shotNumber) === open)
  return (
    <SystemCard icon="grid" eyebrow="空间一致性" title="空间走位校验" meta="新设计 · 网格"
      summary={<SummaryLine text="逐镜校验机位、轴线、走位一致性。" chips={[`${REAL.cineShots.length}/${REAL.cineShots.length} 通过`]} />}>
      <div className="space-y-2.5">
        <div className="grid grid-cols-4 gap-2">
          {REAL.cineShots.map((s) => {
            const on = open === String(s.shotNumber)
            return (
              <button key={s.shotNumber} onClick={() => setOpen(on ? null : String(s.shotNumber))} className={`flex flex-col items-center rounded-[12px] border p-2 transition ${on ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200 hover:border-slate-300'}`}>
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white">{s.shotNumber}</span>
                <Glyph name="pin" className={`mt-1 h-4 w-4 ${T3}`} />
                <span className="mt-1 inline-flex items-center gap-0.5 text-[9px] font-semibold text-emerald-600"><AppIcon name="check" className="h-2.5 w-2.5" />通过</span>
              </button>
            )
          })}
        </div>
        {cur ? (
          <Section title={`镜头 ${cur.shotNumber}`} glyph="pin">
            <div className="grid gap-2 sm:grid-cols-2">
              <IconField label="机位" value={cur.cameraPosition} span />
              <IconField label="机位高度" value={cur.cameraHeight} />
              <IconField label="轴线视线" value={cur.axisAndEyeline} span />
            </div>
          </Section>
        ) : null}
      </div>
    </SystemCard>
  )
}
function SpaceStage() {
  const [open, setOpen] = useState<string>('1')
  const cur = REAL.cineShots.find((s) => String(s.shotNumber) === open)!
  return (
    <SystemCard icon="grid" eyebrow="空间一致性" title="空间走位校验" meta="新设计 · 俯视示意图"
      summary={<SummaryLine text="逐镜校验机位、轴线、走位一致性。" chips={[`${REAL.cineShots.length}/${REAL.cineShots.length} 通过`]} />}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {REAL.cineShots.map((s) => (
            <button key={s.shotNumber} onClick={() => setOpen(String(s.shotNumber))} className={`inline-flex h-7 w-7 items-center justify-center rounded-[8px] text-[11px] font-bold transition ${open === String(s.shotNumber) ? 'bg-slate-900 text-white' : `bg-slate-100 ${T2} hover:bg-slate-200`}`}>{s.shotNumber}</button>
          ))}
        </div>
        <StageDiagram shotIndex={cur.shotNumber} scale={cur.shotScale} angle={cur.cameraAngle} />
        <div className="grid gap-2 sm:grid-cols-2">
          <IconField label="机位" value={cur.cameraPosition} span />
          <IconField label="轴线视线" value={cur.axisAndEyeline} span />
        </div>
      </div>
    </SystemCard>
  )
}

/* ---------- 其余卡片（保留当前） ---------- */
function AssetsCard() {
  const [sel, setSel] = useState<string | null>(null)
  const cur = REAL.assets.find((a) => a.name === sel)
  const ch = REAL.assets.filter((a) => a.kind === 'character').length, lo = REAL.assets.length - ch
  return (
    <SystemCard icon="image" eyebrow="资产需求" title="角色 / 场景资产" width={720} meta={`${ch} 人物 · ${lo} 场景`}
      summary={<SummaryLine text={REAL.assets.map((a) => a.name).join(' · ')} chips={[`${REAL.assets.length} 资产`]} />}>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2.5">
          {REAL.assets.map((a) => (
            <button key={a.name} onClick={() => setSel(sel === a.name ? null : a.name)} className={`overflow-hidden rounded-[12px] border text-left transition ${sel === a.name ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200 hover:border-slate-300'}`}>
              <div className={`flex aspect-square items-center justify-center bg-slate-100 ${T3}`}><Glyph name={a.kind === 'character' ? 'people' : 'pin'} className="h-6 w-6" /></div>
              <div className="px-2.5 py-1.5"><p className={`truncate text-[11px] font-semibold ${T1}`}>{a.name}</p><p className={`text-[10px] ${T3}`}>{a.kind === 'character' ? '人物' : '场景'} · {a.shotIndexes.length} 镜</p></div>
            </button>
          ))}
        </div>
        {cur ? <Section title={cur.name} glyph={cur.kind === 'character' ? 'people' : 'pin'}><div className="mb-1.5 grid gap-2 sm:grid-cols-2"><IconField label="类型" value={cur.kind === 'character' ? '人物' : '场景'} /><IconField label="关联镜头" value={cur.shotIndexes.join(', ')} /></div><p className={`text-[11px] leading-5 ${T2}`}>{cur.description}</p></Section> : null}
      </div>
    </SystemCard>
  )
}
function VideoPlanCard() {
  const [sel, setSel] = useState('0')
  const cur = REAL.videoBlocks[Number(sel)]
  return (
    <SystemCard icon="video" eyebrow="视频规划" title="片段编排" meta={`${REAL.videoBlocks.length} 个生成片段`}
      summary={<SummaryLine text={`${REAL.shotCount} 镜编排为 ${REAL.videoBlocks.length} 个片段。`} chips={[`${REAL.videoBlocks.length} 片段`]} />}>
      <div className="space-y-3">
        <div className="flex gap-1.5">
          {REAL.videoBlocks.map((b, i) => (
            <button key={i} onClick={() => setSel(String(i))} style={{ flexGrow: b.shotNumbers.length }} className={`rounded-[8px] border px-2 py-2 text-left text-[11px] transition ${sel === String(i) ? 'border-slate-900 bg-slate-900 text-white' : `border-slate-200 bg-slate-50 ${T2} hover:bg-slate-100`}`}><span className="font-bold">片段 {i + 1}</span><span className={sel === String(i) ? 'ml-1 text-slate-300' : `ml-1 ${T3}`}>镜 {b.shotNumbers.join(',')}</span></button>
          ))}
        </div>
        {cur ? <Section title={`片段 ${Number(sel) + 1}`} glyph="film"><div className="mb-1.5 grid gap-2 sm:grid-cols-2"><IconField label="生成模式" value={cur.kind === 'group' ? `合并 (${cur.gridMode})` : '单镜连续'} /><IconField label="关联镜头" value={cur.shotNumbers.join(', ')} /></div><p className={`text-[11px] leading-5 ${T2}`}>{cur.reason}</p></Section> : null}
      </div>
    </SystemCard>
  )
}
function BgmCard() {
  return (
    <SystemCard icon="play" eyebrow="BGM 配乐" title="原创配乐" status="待生成" meta="该项目暂无 BGM 数据"
      summary={<SummaryLine text="该项目尚未生成 BGM。" chips={['待生成']} />}>
      <Section title="状态" glyph="info"><p className={`text-xs leading-5 ${T2}`}>项目《{REAL.title.replace(/[《》]/g, '')}》当前阶段暂未生成 BGM，数据库无记录。生成后将显示情绪曲线、乐器编制、分段时间线（对齐 {REAL.durationSec}s）。</p></Section>
    </SystemCard>
  )
}
function FinalCard() {
  return (
    <SystemCard icon="playCircle" eyebrow="最终成片" title={REAL.title.replace(/[《》]/g, '')} status="待合成" meta={`${REAL.durationSec}s · ${REAL.shotCount} 镜 · ${REAL.videoBlocks.length} 片段`}
      summary={<SummaryLine text="尚未渲染最终视频。" chips={[`${REAL.durationSec}s`]} />}>
      <div className="space-y-3">
        <div className="flex aspect-video w-full items-center justify-center rounded-[14px] bg-gradient-to-br from-slate-800 to-slate-950 text-white"><div className="text-center"><AppIcon name="playCircle" className="mx-auto h-10 w-10 opacity-70" /><p className="mt-1 text-[11px] opacity-70">尚未渲染</p></div></div>
        <Section title="成片信息" glyph="film"><div className="grid gap-2 sm:grid-cols-2"><IconField label="时长" value={`${REAL.durationSec}s`} /><IconField label="镜头数" value={`${REAL.shotCount} 镜`} /><IconField label="生成片段" value={`${REAL.videoBlocks.length} 个`} /><IconField label="画面比例" value="16:9" /></div></Section>
      </div>
    </SystemCard>
  )
}

/* ---------- 布局 ---------- */
function CardBlock({ title, note, children }: { readonly title: string; readonly note?: string; readonly children: ReactNode }) {
  return (
    <section className="mt-10">
      <div className="mb-3 flex items-center gap-2"><h3 className={`text-base font-bold ${T1}`}>{title}</h3>{note ? <span className={`text-xs ${T3}`}>{note}</span> : null}</div>
      <div className="flex flex-wrap items-start gap-x-8 gap-y-6">{children}</div>
    </section>
  )
}
function Tagged({ tag, children }: { readonly tag: string; readonly children: ReactNode }) {
  const isNew = tag.startsWith('新')
  return <div><p className={`mb-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${isNew ? 'bg-slate-900 text-white' : `bg-slate-100 ${T2}`}`}>{tag}</p>{children}</div>
}

export default function CardHierarchySection() {
  return (
    <div>
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {[
          { lv: '一级 · 默认折叠', desc: '图标 + 阶段名 + 状态 + 摘要（风格圣经为图+总结）。一眼看懂。' },
          { lv: '二级 · 点「展开」', desc: '该卡定制的网格 / 分区 / 流程图，配图标。' },
          { lv: '三级 · 点明细', desc: '单条全部字段（图标字段网格 / 分区 / 示意图）。' },
        ].map((x) => <div key={x.lv} className="rounded-[16px] border border-slate-200 bg-white p-3"><p className={`text-xs font-bold ${T1}`}>{x.lv}</p><p className={`mt-1 text-[11px] leading-4 ${T3}`}>{x.desc}</p></div>)}
      </div>
      <p className={`mb-2 text-xs ${T3}`}>真实数据《{REAL.title.replace(/[《》]/g, '')}》。需要重做的卡片同时给出「当前 + 两种新设计」；其余保留当前。展开态预览，真实画布默认折叠。</p>

      <CardBlock title="剧本" note="角色表已去掉首字母图案"><ScreenplayCard /></CardBlock>

      <CardBlock title="风格圣经" note="外部=图+总结；内部网格化（新增两种）">
        <Tagged tag="当前"><StyleBibleCard /></Tagged>
        <Tagged tag="新设计 1 · 属性网格"><StyleBibleGrid /></Tagged>
        <Tagged tag="新设计 2 · 海报式"><StyleBiblePoster /></Tagged>
      </CardBlock>

      <CardBlock title="生成过程" note="二级网格化（新增两种）">
        <Tagged tag="当前"><ProcessCard /></Tagged>
        <Tagged tag="新设计 1 · 步骤网格"><ProcessGrid /></Tagged>
        <Tagged tag="新设计 2 · 管线流程图"><ProcessPipeline /></Tagged>
      </CardBlock>

      <CardBlock title="核心剪辑表" note="三级详情可读性重排（新增两种）">
        <Tagged tag="当前 · 两列"><EditScriptVariant tag="当前 · 两列" detail="rows" /></Tagged>
        <Tagged tag="新设计 1 · 图标字段网格"><EditScriptVariant tag="新 · 图标网格" detail="icongrid" /></Tagged>
        <Tagged tag="新设计 2 · 分区面板"><EditScriptVariant tag="新 · 分区" detail="sections" /></Tagged>
      </CardBlock>

      <CardBlock title="摄影指导" note="三级辅以图标（新增两种）">
        <Tagged tag="当前 · 两列"><CineVariant tag="当前 · 两列" mode="rows" /></Tagged>
        <Tagged tag="新设计 1 · 图标字段网格"><CineVariant tag="新 · 图标网格" mode="icongrid" /></Tagged>
        <Tagged tag="新设计 2 · 机位示意图"><CineVariant tag="新 · 机位图" mode="diagram" /></Tagged>
      </CardBlock>

      <CardBlock title="资产需求"><AssetsCard /></CardBlock>

      <CardBlock title="空间一致性" note="网格化（新增两种）">
        <Tagged tag="当前 · 清单"><SpaceCardCurrent /></Tagged>
        <Tagged tag="新设计 1 · 状态网格"><SpaceGrid /></Tagged>
        <Tagged tag="新设计 2 · 俯视示意图"><SpaceStage /></Tagged>
      </CardBlock>

      <CardBlock title="视频规划"><VideoPlanCard /></CardBlock>
      <CardBlock title="BGM 配乐"><BgmCard /></CardBlock>
      <CardBlock title="最终成片"><FinalCard /></CardBlock>
    </div>
  )
}
