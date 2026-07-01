'use client'

import type { CSSProperties, ReactNode } from 'react'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import type {
  ShotTone,
  StoryboardShot,
  StoryboardShotUiClaudeCopy,
} from './storyboard-shot-ui-claude-types'

const toneAccent: Record<ShotTone, string> = {
  violet: '#7c3aed',
  teal: '#0d9488',
  amber: '#b45309',
  crimson: '#be123c',
}

const toneGlow: Record<ShotTone, string> = {
  violet: '#c4b5fd',
  teal: '#5eead4',
  amber: '#fcd34d',
  crimson: '#fda4af',
}

export function shotAccentColor(tone: ShotTone): string {
  return toneAccent[tone]
}

/** 画布底：点阵背景,承载多张相互独立的分镜卡片,呼应真实的节点画布。 */
export function CanvasSurface({ children }: { readonly children: ReactNode }) {
  return (
    <div
      className="overflow-x-auto rounded-2xl border border-[var(--glass-stroke-soft)] p-6"
      style={{
        backgroundColor: 'var(--glass-bg-canvas)',
        backgroundImage: 'radial-gradient(rgba(100,116,139,0.28) 1px, transparent 1px)',
        backgroundSize: '18px 18px',
      }}
    >
      <div className="flex items-start gap-0">{children}</div>
    </div>
  )
}

/** 卡片之间的连接线,视觉上强调每张卡都是独立节点。 */
export function CardConnector() {
  return (
    <div className="flex h-full min-h-[220px] shrink-0 items-center px-1.5 pt-16">
      <span className="h-px w-8 bg-slate-300" />
      <span className="h-1.5 w-1.5 -ml-0.5 rounded-full bg-slate-300" />
    </div>
  )
}

/** 独立分镜卡片外壳:圆角白卡 + 左右连接点,等同真实画布节点。 */
export function ShotCardFrame({
  children,
  width = 'w-[340px]',
}: {
  readonly children: ReactNode
  readonly width?: string
}) {
  return (
    <div className={`relative shrink-0 ${width}`}>
      <span className="absolute -left-1.5 top-16 h-3.5 w-3.5 rounded-full border-2 border-white bg-slate-400 shadow-sm" />
      <span className="absolute -right-1.5 top-16 h-3.5 w-3.5 rounded-full border-2 border-white bg-slate-400 shadow-sm" />
      <article className="relative overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.08)]">
        {children}
      </article>
    </div>
  )
}

/** 卡片头部:图标 + 序号 + 「单个镜头」 + 状态角标,与真实卡片一致。 */
export function ShotCardHeader({
  shot,
  copy,
}: {
  readonly shot: StoryboardShot
  readonly copy: StoryboardShotUiClaudeCopy
}) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-[var(--glass-text-tertiary)]">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-[11px] bg-slate-100 text-[var(--glass-text-secondary)]">
          <AppIcon name="clapperboard" className="h-4 w-4" />
        </span>
        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-100 px-2 tabular-nums text-[11px] font-semibold text-[var(--glass-text-secondary)]">
          {shot.number}
        </span>
        <p className="truncate">{copy.card.eyebrow}</p>
      </div>
      <span className="inline-flex shrink-0 items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-[var(--glass-text-secondary)]">
        {shot.status}
      </span>
    </header>
  )
}

function MetaAttrChip({
  icon,
  label,
  value,
}: {
  readonly icon: AppIconName
  readonly label: string
  readonly value: string
}) {
  if (!value) return null
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-[var(--glass-text-secondary)]">
      <AppIcon name={icon} className="h-3.5 w-3.5 text-[var(--glass-text-tertiary)]" />
      <span className="text-[var(--glass-text-tertiary)]">{label}</span>
      <span>{value}</span>
    </span>
  )
}

function MetaTagChip({ icon, text }: { readonly icon: AppIconName; readonly text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-[var(--glass-text-secondary)]">
      <AppIcon name={icon} className="h-3.5 w-3.5 text-[var(--glass-text-tertiary)]" />
      {text}
    </span>
  )
}

/** 结构化标签:景别 / 场景 / 出场角色 / 道具 —— 图片的构成要素,可快速扫读。 */
export function ShotMetaChips({
  shot,
  copy,
}: {
  readonly shot: StoryboardShot
  readonly copy: StoryboardShotUiClaudeCopy
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <MetaAttrChip icon="crosshair" label={copy.card.shotTypeLabel} value={shot.shotType} />
      <MetaAttrChip icon="mapPin" label={copy.card.sceneLabel} value={shot.scene} />
      {shot.characters.map((name) => (
        <MetaTagChip key={`char-${name}`} icon="user" text={name} />
      ))}
      {shot.props.map((name) => (
        <MetaTagChip key={`prop-${name}`} icon="cube" text={name} />
      ))}
    </div>
  )
}

/** 计费动作按钮,复刻真实 BillingActionButton 的样式(标签 + 花费 + coins 图标)。 */
export function ActionButton({
  label,
  icon,
  cost,
  tone = 'primary',
}: {
  readonly label: string
  readonly icon: AppIconName
  readonly cost?: string
  readonly tone?: 'primary' | 'secondary'
}) {
  const toneClass =
    tone === 'primary'
      ? 'bg-slate-950 text-white hover:bg-slate-800'
      : 'border border-slate-200 bg-white text-[var(--glass-text-secondary)] hover:bg-slate-50'
  return (
    <button
      type="button"
      className={`nodrag inline-flex items-center justify-center gap-1.5 rounded-[14px] px-3 py-2.5 text-xs font-semibold leading-none transition whitespace-nowrap ${toneClass}`}
    >
      <AppIcon name={icon} className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
      {cost ? (
        <span className={`ml-1 inline-flex shrink-0 items-center gap-1 text-[11px] tabular-nums ${tone === 'primary' ? 'text-white/70' : 'text-slate-400'}`}>
          {cost}
          <AppIcon name="coins" className="h-3.5 w-3.5" />
        </span>
      ) : null}
    </button>
  )
}

/** 卡片底部:场景元信息 + 展开 + 生成图片(计费),与真实卡片一致。 */
export function ShotCardFooter({
  shot,
  copy,
  expanded,
  onToggle,
  showExpand = true,
  showScene = true,
}: {
  readonly shot: StoryboardShot
  readonly copy: StoryboardShotUiClaudeCopy
  readonly expanded?: boolean
  readonly onToggle?: () => void
  readonly showExpand?: boolean
  readonly showScene?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
      <p className="min-w-0 truncate text-xs text-[var(--glass-text-tertiary)]">
        {showScene ? `${copy.card.sceneLabel}: ${shot.scene}` : ''}
      </p>
      <div className="flex shrink-0 items-center gap-1.5">
        {showExpand ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="nodrag inline-flex items-center gap-1 rounded-[14px] border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-[var(--glass-text-secondary)] transition hover:bg-slate-50"
          >
            <AppIcon name={expanded ? 'chevronUp' : 'chevronDown'} className="h-3.5 w-3.5" />
            {expanded ? copy.actions.collapse : copy.actions.expand}
          </button>
        ) : null}
        <ActionButton label={copy.actions.generateImage} icon="image" cost={shot.cost} />
      </div>
    </div>
  )
}

/**
 * 图片位(占位卡):图片尚未生成时的占位样式 —— 模糊柔光底 + 居中图片 icon。
 * 各方案共用同一份占位,不承载文字详情。
 */
export function ShotImage({
  shot,
  copy,
  className = '',
  rounded = 'rounded-2xl',
}: {
  readonly shot: StoryboardShot
  readonly copy: StoryboardShotUiClaudeCopy
  readonly className?: string
  readonly rounded?: string
}) {
  const glow: CSSProperties = { background: toneGlow[shot.tone] }
  return (
    <div className={`relative overflow-hidden ${rounded} bg-slate-100 ${className}`}>
      {/* 模糊柔光:用镜头色调渲染出淡淡的氛围,再整体磨砂 */}
      <div className="absolute -left-10 -top-10 h-32 w-32 rounded-full opacity-55 blur-3xl" style={glow} />
      <div className="absolute -bottom-12 -right-8 h-36 w-36 rounded-full opacity-45 blur-3xl" style={glow} />
      <div className="absolute inset-0 bg-white/35 backdrop-blur-2xl" />

      {/* 居中图片 icon */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-white/70 shadow-sm ring-1 ring-slate-200">
          <AppIcon name="image" className="h-8 w-8 text-slate-400" />
        </span>
      </div>

      {/* 镜头序号角标 */}
      <span className="absolute left-3 top-3 inline-flex h-7 items-center rounded-full bg-white/80 px-2.5 text-xs font-semibold tabular-nums text-[var(--glass-text-secondary)] ring-1 ring-slate-200 backdrop-blur">
        {copy.fields.shot} {shot.number}
      </span>
    </div>
  )
}

/** 提示词编辑区的复用工具条(复制 / 重新生成),light 供深色底使用。 */
export function PromptToolbar({
  copy,
  light = false,
}: {
  readonly copy: StoryboardShotUiClaudeCopy
  readonly light?: boolean
}) {
  const btn = light
    ? 'border-white/25 bg-white/10 text-white hover:bg-white/20'
    : 'border-slate-200 bg-white text-[var(--glass-text-secondary)] hover:text-[var(--glass-text-primary)]'
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border transition ${btn}`}
        aria-label={copy.actions.copyPrompt}
        title={copy.actions.copyPrompt}
      >
        <AppIcon name="copy" className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border transition ${btn}`}
        aria-label={copy.actions.regenerateImage}
        title={copy.actions.regenerateImage}
      >
        <AppIcon name="imageEdit" className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

/** 图片提示词编辑区:镜头下方唯一的文字详情,只承载最终图片提示词。 */
export function PromptEditor({
  shot,
  copy,
  className = '',
  fill = false,
  rows,
}: {
  readonly shot: StoryboardShot
  readonly copy: StoryboardShotUiClaudeCopy
  readonly className?: string
  readonly fill?: boolean
  readonly rows?: number
}) {
  return (
    <div className={`flex flex-col rounded-2xl border border-slate-200 bg-slate-50 ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-slate-200/70 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <AppIcon name="sparkles" className="h-4 w-4 shrink-0 text-[var(--glass-text-secondary)]" />
          <p className="truncate text-sm font-semibold text-[var(--glass-text-primary)]">
            {copy.fields.finalImagePrompt}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-[var(--glass-text-secondary)] transition hover:text-[var(--glass-text-primary)]"
            aria-label={copy.actions.copyPrompt}
            title={copy.actions.copyPrompt}
          >
            <AppIcon name="copy" className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-[var(--glass-text-secondary)] transition hover:text-[var(--glass-text-primary)]"
            aria-label={copy.actions.regenerateImage}
            title={copy.actions.regenerateImage}
          >
            <AppIcon name="imageEdit" className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <textarea
        className={`w-full resize-none bg-transparent px-3 py-2.5 text-sm leading-6 text-[var(--glass-text-primary)] outline-none ${fill ? 'min-h-0 flex-1' : ''}`}
        aria-label={`${copy.fields.finalImagePrompt} · ${copy.fields.shot} ${shot.number}`}
        rows={rows}
        defaultValue={shot.prompt}
      />
    </div>
  )
}
