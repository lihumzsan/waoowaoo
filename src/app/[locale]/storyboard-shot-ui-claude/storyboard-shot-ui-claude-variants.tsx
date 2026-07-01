'use client'

import { Fragment, type ReactNode } from 'react'
import { AppIcon } from '@/components/ui/icons'
import {
  CanvasSurface,
  CardConnector,
  PromptEditor,
  PromptToolbar,
  ShotCardFooter,
  ShotCardFrame,
  ShotCardHeader,
  ShotImage,
  ShotMetaChips,
  shotAccentColor,
} from './storyboard-shot-ui-claude-shared'
import type {
  LayoutCopy,
  StoryboardShot,
  StoryboardShotUiClaudeCopy,
} from './storyboard-shot-ui-claude-types'

function LabFrame({
  layout,
  index,
  children,
}: {
  readonly layout: LayoutCopy
  readonly index: number
  readonly children: ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)]/90 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur">
      <header className="flex flex-col gap-1 border-b border-[var(--glass-stroke-soft)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--glass-bg-canvas)] text-xs font-semibold tabular-nums text-[var(--glass-text-secondary)]">
            {index + 1}
          </span>
          <h2 className="text-sm font-semibold text-[var(--glass-text-primary)]">{layout.title}</h2>
        </div>
        <p className="max-w-2xl text-xs leading-5 text-[var(--glass-text-secondary)] sm:text-right">
          {layout.description}
        </p>
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}

function CardRow({
  shots,
  render,
}: {
  readonly shots: readonly StoryboardShot[]
  readonly render: (shot: StoryboardShot) => ReactNode
}) {
  return (
    <CanvasSurface>
      {shots.map((shot, index) => (
        <Fragment key={shot.id}>
          {index > 0 ? <CardConnector /> : null}
          {render(shot)}
        </Fragment>
      ))}
    </CanvasSurface>
  )
}

/**
 * 所有方案共用的卡片外壳与结构 —— 头部 → 图片占位 → 结构化标签 → 最终图片提示词 → 生成图片。
 * 5 个方案整体结构一模一样,唯一的区别是传入的 promptBlock(提示词卡片的边框/图案/横线等 UI 细节)。
 */
function ShotVariantCard({
  shot,
  copy,
  promptBlock,
}: {
  readonly shot: StoryboardShot
  readonly copy: StoryboardShotUiClaudeCopy
  readonly promptBlock: ReactNode
}) {
  return (
    <ShotCardFrame width="w-[440px]">
      <ShotCardHeader shot={shot} copy={copy} />
      <div className="space-y-3 px-4 py-4">
        <ShotImage shot={shot} copy={copy} className="aspect-[4/3] w-full" />
        <ShotMetaChips shot={shot} copy={copy} />
        {promptBlock}
      </div>
      <ShotCardFooter shot={shot} copy={copy} showExpand={false} showScene={false} />
    </ShotCardFrame>
  )
}

function PromptLabel({
  copy,
  accent,
  light = false,
}: {
  readonly copy: StoryboardShotUiClaudeCopy
  readonly accent?: string
  readonly light?: boolean
}) {
  return (
    <p className={`flex min-w-0 items-center gap-1.5 text-sm font-semibold ${light ? 'text-white' : 'text-[var(--glass-text-primary)]'}`}>
      <AppIcon name="sparkles" className="h-4 w-4 shrink-0" style={accent && !light ? { color: accent } : undefined} />
      <span className="truncate">{copy.fields.finalImagePrompt}</span>
    </p>
  )
}

function PromptTextarea({
  shot,
  copy,
  className = '',
  rows = 5,
}: {
  readonly shot: StoryboardShot
  readonly copy: StoryboardShotUiClaudeCopy
  readonly className?: string
  readonly rows?: number
}) {
  return (
    <textarea
      className={`w-full resize-none bg-transparent text-sm leading-6 text-[var(--glass-text-primary)] outline-none ${className}`}
      aria-label={`${copy.fields.finalImagePrompt} · ${copy.fields.shot} ${shot.number}`}
      rows={rows}
      defaultValue={shot.prompt}
    />
  )
}

/* 皮肤 2 · 顶部强调色横线 + 描边,无分隔线。 */
function PromptSkinAccentLine({ shot, copy }: { readonly shot: StoryboardShot; readonly copy: StoryboardShotUiClaudeCopy }) {
  const accent = shotAccentColor(shot.tone)
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="h-1 w-full" style={{ background: accent }} />
      <div className="flex items-center justify-between gap-3 px-3 pb-1.5 pt-2.5">
        <PromptLabel copy={copy} accent={accent} />
        <PromptToolbar copy={copy} />
      </div>
      <PromptTextarea shot={shot} copy={copy} className="px-3 pb-3" />
    </div>
  )
}

/* 皮肤 3 · 虚线边框 + 点阵图案 + 虚线横线分隔。 */
function PromptSkinDashed({ shot, copy }: { readonly shot: StoryboardShot; readonly copy: StoryboardShotUiClaudeCopy }) {
  return (
    <div
      className="overflow-hidden rounded-2xl border border-dashed border-slate-300"
      style={{
        backgroundImage: 'radial-gradient(rgba(100,116,139,0.14) 1px, transparent 1px)',
        backgroundSize: '10px 10px',
      }}
    >
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <PromptLabel copy={copy} />
        <PromptToolbar copy={copy} />
      </div>
      <div className="mx-3 border-t border-dashed border-slate-300" />
      <PromptTextarea shot={shot} copy={copy} className="px-3 py-2.5" />
    </div>
  )
}

/* 皮肤 4 · 左侧强调色边条 + 细横线分隔,无外边框。 */
function PromptSkinLeftBar({ shot, copy }: { readonly shot: StoryboardShot; readonly copy: StoryboardShotUiClaudeCopy }) {
  const accent = shotAccentColor(shot.tone)
  return (
    <div className="relative overflow-hidden rounded-2xl bg-slate-50 py-3 pl-4 pr-3">
      <span className="absolute inset-y-3 left-0 w-1 rounded-full" style={{ background: accent }} />
      <div className="mb-2 flex items-center justify-between gap-3">
        <PromptLabel copy={copy} accent={accent} />
        <PromptToolbar copy={copy} />
      </div>
      <div className="mb-2 h-px bg-slate-200/80" />
      <PromptTextarea shot={shot} copy={copy} />
    </div>
  )
}

/* 皮肤 5 · 强调色实心标题条 + 白色正文,面板式外观。 */
function PromptSkinHeaderStrip({ shot, copy }: { readonly shot: StoryboardShot; readonly copy: StoryboardShotUiClaudeCopy }) {
  const accent = shotAccentColor(shot.tone)
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-3 px-3 py-2" style={{ background: accent }}>
        <PromptLabel copy={copy} light />
        <PromptToolbar copy={copy} light />
      </div>
      <PromptTextarea shot={shot} copy={copy} className="px-3 py-2.5" />
    </div>
  )
}

export function StoryboardShotLayoutVariants({ copy }: { readonly copy: StoryboardShotUiClaudeCopy }) {
  const shots = copy.shots.slice(0, 3)
  return (
    <div className="grid gap-5">
      <LabFrame layout={copy.layouts[0]} index={0}>
        <CardRow
          shots={shots}
          render={(shot) => (
            <ShotVariantCard shot={shot} copy={copy} promptBlock={<PromptEditor shot={shot} copy={copy} rows={5} />} />
          )}
        />
      </LabFrame>
      <LabFrame layout={copy.layouts[1]} index={1}>
        <CardRow
          shots={shots}
          render={(shot) => (
            <ShotVariantCard shot={shot} copy={copy} promptBlock={<PromptSkinAccentLine shot={shot} copy={copy} />} />
          )}
        />
      </LabFrame>
      <LabFrame layout={copy.layouts[2]} index={2}>
        <CardRow
          shots={shots}
          render={(shot) => (
            <ShotVariantCard shot={shot} copy={copy} promptBlock={<PromptSkinDashed shot={shot} copy={copy} />} />
          )}
        />
      </LabFrame>
      <LabFrame layout={copy.layouts[3]} index={3}>
        <CardRow
          shots={shots}
          render={(shot) => (
            <ShotVariantCard shot={shot} copy={copy} promptBlock={<PromptSkinLeftBar shot={shot} copy={copy} />} />
          )}
        />
      </LabFrame>
      <LabFrame layout={copy.layouts[4]} index={4}>
        <CardRow
          shots={shots}
          render={(shot) => (
            <ShotVariantCard shot={shot} copy={copy} promptBlock={<PromptSkinHeaderStrip shot={shot} copy={copy} />} />
          )}
        />
      </LabFrame>
      <p className="px-1 text-xs text-[var(--glass-text-tertiary)]">{copy.fields.promptOnlyNote}</p>
    </div>
  )
}
