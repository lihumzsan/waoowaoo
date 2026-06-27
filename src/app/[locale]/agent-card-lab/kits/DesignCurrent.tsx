'use client'

import { useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { AppIconName } from '@/components/ui/icons/registry'
import type {
  ActiveRunData,
  ApprovalData,
  BatchTaskData,
  CardKit,
  ChoiceData,
  ConfirmData,
  PhaseData,
  ProjectContextData,
  StopData,
  StylePreviewData,
  TaskData,
  ToolCallData,
} from './types'

/**
 * DesignCurrent — 忠实复刻当前 WorkspaceAssistantRenderers 的卡片观感,
 * 作为新方案的对照基线。样式取自现网实现的 className。
 */

function UserBubble({ text }: { text: string }) {
  return (
    <div className="ml-auto w-fit max-w-[88%] rounded-2xl bg-neutral-100 px-3 py-2.5 text-sm leading-6 text-[var(--glass-text-primary)]">
      {text}
    </div>
  )
}

function AssistantText({ children }: { children: React.ReactNode }) {
  return <div className="px-1 py-1 text-sm leading-6 text-[var(--glass-text-primary)]">{children}</div>
}

function Reasoning({ text }: { text: string }) {
  return (
    <div className="whitespace-pre-wrap border-l-2 border-[var(--glass-stroke-base)] pl-3 text-xs leading-5 text-[var(--glass-text-tertiary)]">
      {text}
    </div>
  )
}

function Thinking() {
  return (
    <div className="flex items-center gap-1 px-1 text-sm text-[var(--glass-text-secondary)]">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--glass-text-tertiary)]" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--glass-text-tertiary)] [animation-delay:120ms]" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--glass-text-tertiary)] [animation-delay:240ms]" />
    </div>
  )
}

function ToolCall(data: ToolCallData) {
  const [open, setOpen] = useState(false)
  const failed = data.status === 'failed'
  const summary =
    data.status === 'success'
      ? '成功'
      : data.status === 'failed'
        ? '失败'
        : data.status === 'needs-action'
          ? '需要操作'
          : '执行中'
  const iconName: AppIconName = data.status === 'running' ? 'loader' : failed ? 'alert' : 'settingsHex'
  return (
    <div
      className={`group text-[12px] leading-5 ${failed ? 'text-[var(--glass-tone-warning-fg)]' : 'text-[var(--glass-text-tertiary)]'}`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer list-none items-center gap-2 text-left"
      >
        <AppIcon name={iconName} className={`h-3.5 w-3.5 shrink-0 ${data.status === 'running' ? 'animate-spin' : ''}`} />
        <span className="min-w-0 truncate">
          {summary} · {data.title}
        </span>
        <AppIcon name="chevronDown" className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="ml-5 mt-1 space-y-2 text-[11px]">
          {data.error ? (
            <div className="rounded-lg bg-[var(--glass-tone-warning-bg)] px-2 py-1 leading-4">{data.error}</div>
          ) : null}
          <div>
            <div>参数</div>
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all leading-5">
              {JSON.stringify(data.args, null, 2)}
            </pre>
          </div>
          <div>
            <div>结果</div>
            {data.result === undefined ? (
              <div className="mt-1">等待结果…</div>
            ) : (
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all leading-5">
                {JSON.stringify(data.result, null, 2)}
              </pre>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Approval(data: ApprovalData) {
  const [note, setNote] = useState('')
  return (
    <div className="rounded-2xl border border-[var(--glass-tone-warning-fg)]/30 bg-[var(--glass-bg-muted)] p-3">
      <div className="text-sm font-medium text-[var(--glass-text-primary)]">{data.title}</div>
      <div className="mt-1 text-xs text-[var(--glass-text-secondary)]">{data.summary}</div>
      {data.reasons.length > 0 ? (
        <div className="mt-3 max-h-32 space-y-1 overflow-y-auto text-xs text-[var(--glass-tone-warning-fg)]">
          {data.reasons.map((reason) => (
            <div key={reason}>{reason}</div>
          ))}
        </div>
      ) : null}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="拒绝说明（可选）"
        className="mt-3 min-h-20 w-full rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-3 py-2 text-sm text-[var(--glass-text-primary)] outline-none"
      />
      <div className="mt-3 flex gap-2">
        <button type="button" className="flex-1 rounded-xl bg-[var(--glass-accent-from)] px-3 py-2 text-sm font-medium text-white">
          批准
        </button>
        <button
          type="button"
          className="flex-1 rounded-xl border border-[var(--glass-stroke-base)] px-3 py-2 text-sm font-medium text-[var(--glass-text-primary)]"
        >
          拒绝
        </button>
      </div>
    </div>
  )
}

function Confirm(data: ConfirmData) {
  return (
    <div className="rounded-2xl border border-[var(--glass-stroke-base)] bg-white/95 p-3 text-xs text-[var(--glass-text-secondary)] shadow-[0_12px_30px_rgba(15,23,42,0.08)] backdrop-blur-xl">
      <div className="text-sm font-semibold text-[var(--glass-text-primary)]">{data.title}</div>
      <div className="mt-1 leading-5">{data.subtitle}</div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="flex-1 rounded-xl bg-[var(--glass-accent-from)] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--glass-accent-to)]"
        >
          继续
        </button>
        <button
          type="button"
          className="flex-1 rounded-xl border border-[var(--glass-stroke-base)] bg-white px-3 py-2 text-sm font-medium text-[var(--glass-text-primary)] transition-colors hover:bg-neutral-100"
        >
          取消
        </button>
      </div>
    </div>
  )
}

function RatioShape({ ratio, selected }: { ratio: string; selected: boolean }) {
  const [w, h] = ratio.split(':').map(Number)
  const max = Math.max(w, h)
  return (
    <div className="flex h-9 w-12 items-center justify-center">
      <div
        className={`rounded-[4px] border-2 ${selected ? 'border-[var(--glass-accent-from)] bg-[var(--glass-accent-from)]/10' : 'border-[var(--glass-stroke-strong)] bg-white'}`}
        style={{
          width: `${String(Math.max(14, Math.round((34 * w) / max)))}px`,
          height: `${String(Math.max(14, Math.round((34 * h) / max)))}px`,
        }}
      />
    </div>
  )
}

function Choice(data: ChoiceData) {
  const [selected, setSelected] = useState(data.options[0]?.value ?? '')
  return (
    <div className="rounded-2xl border border-[var(--glass-stroke-base)] bg-white/95 p-3 text-xs text-[var(--glass-text-secondary)] shadow-[0_12px_30px_rgba(15,23,42,0.08)] backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 text-sm font-semibold text-[var(--glass-text-primary)]">{data.title}</div>
        <div className="rounded-full border border-[var(--glass-stroke-base)] bg-white/85 px-2 py-0.5 text-[10px] font-semibold text-[var(--glass-text-tertiary)]">
          {data.step}
        </div>
      </div>
      <div className="mt-1 line-clamp-2 leading-5">{data.description}</div>
      <div className="mt-2 space-y-2">
        <div className="text-[11px] font-semibold text-[var(--glass-text-tertiary)]">{data.groupLabel}</div>
        <div className="grid grid-cols-3 gap-2">
          {data.options.map((option) => {
            const isSelected = selected === option.value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setSelected(option.value)}
                className={`w-full overflow-hidden rounded-xl border text-left transition-colors ${isSelected ? 'border-[var(--glass-accent-from)] bg-[var(--glass-accent-from)]/5 ring-1 ring-[var(--glass-accent-from)]/30' : 'border-[var(--glass-stroke-base)] bg-white/80 hover:border-[var(--glass-stroke-strong)] hover:bg-neutral-100'}`}
              >
                <div className="flex flex-col items-center gap-1.5 p-2 text-center">
                  <RatioShape ratio={option.ratio ?? '1:1'} selected={isSelected} />
                  <span className={`text-sm font-semibold ${isSelected ? 'text-[var(--glass-accent-from)]' : 'text-[var(--glass-text-primary)]'}`}>
                    {option.label}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </div>
      <button
        type="button"
        className="mt-3 inline-flex w-full items-center justify-center rounded-xl bg-[var(--glass-accent-from)] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--glass-accent-to)]"
      >
        {data.submitLabel}
      </button>
    </div>
  )
}

function TaskSubmitted(data: TaskData) {
  const [open, setOpen] = useState(false)
  return (
    <div className="text-[12px] leading-5 text-[var(--glass-text-tertiary)]">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full cursor-pointer items-center gap-2 text-left">
        <AppIcon name="clock" className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">
          {data.title} · {data.taskId} · {data.stage}
        </span>
        <AppIcon name="chevronDown" className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="ml-5 mt-1 space-y-1 text-[11px]">
          <div>任务 ID: {data.taskId}</div>
          <div>阶段: {data.stage}</div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
            <div className="h-full rounded-full bg-[var(--glass-accent-from)]" style={{ width: `${String(data.progress)}%` }} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ProjectPhase(data: PhaseData) {
  const [open, setOpen] = useState(false)
  return (
    <div className="text-[12px] leading-5 text-[var(--glass-text-tertiary)]">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full cursor-pointer items-center gap-2 text-left">
        <AppIcon name="chart" className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">项目进度</span>
        <AppIcon name="chevronDown" className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="ml-5 mt-1 text-[11px] leading-5">
          {data.clips} 个片段 · {data.screenplays} 个剧本 · {data.storyboards} 个分镜
        </div>
      ) : null}
    </div>
  )
}

function AgentStop(data: StopData) {
  return (
    <div className="border-l-2 border-[var(--glass-text-tertiary)]/40 pl-2 text-[12px] leading-5 text-[var(--glass-text-secondary)]">
      <div className="flex items-center gap-2">
        <AppIcon name="alert" className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">
          {data.title} · {data.detail}
        </span>
      </div>
    </div>
  )
}

function ActiveRun(data: ActiveRunData) {
  return (
    <div className="rounded-2xl border border-[var(--glass-stroke-base)] bg-white/95 p-3 text-xs text-[var(--glass-text-secondary)] shadow-[0_12px_30px_rgba(15,23,42,0.08)] backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <AppIcon name="loader" className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--glass-text-tertiary)]" />
        <div className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--glass-text-primary)]">执行中 · {data.title}</div>
      </div>
      <div className="mt-1 ml-[22px] text-[11px] leading-5 text-[var(--glass-text-tertiary)]">{data.detail}</div>
    </div>
  )
}

function StylePreview(data: StylePreviewData) {
  const done = data.candidates.filter((c) => c.status === 'done').length
  return (
    <div className="rounded-2xl border border-[var(--glass-stroke-base)] bg-white/95 p-3 text-xs text-[var(--glass-text-secondary)] shadow-[0_12px_30px_rgba(15,23,42,0.08)] backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <AppIcon name="sparkles" className="h-3.5 w-3.5 shrink-0 text-[var(--glass-accent-from)]" />
        <div className="min-w-0 flex-1 text-sm font-semibold text-[var(--glass-text-primary)]">{data.title}</div>
        <span className="rounded-full border border-[var(--glass-stroke-base)] bg-white/85 px-2 py-0.5 text-[10px] font-semibold text-[var(--glass-text-tertiary)]">
          {done}/{data.candidates.length}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {data.candidates.map((c) => (
          <div
            key={c.id}
            className={`overflow-hidden rounded-xl border ${c.selected ? 'border-[var(--glass-accent-from)] ring-1 ring-[var(--glass-accent-from)]/30' : 'border-[var(--glass-stroke-base)]'}`}
          >
            <div className="relative h-16 w-full" style={{ background: c.swatch }}>
              {c.status === 'generating' ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30 text-[11px] font-semibold text-white">
                  {c.progress}%
                </div>
              ) : null}
              {c.status === 'failed' ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <AppIcon name="alert" className="h-4 w-4 text-white" />
                </div>
              ) : null}
              {c.selected ? (
                <div className="absolute right-1 top-1 rounded-full bg-[var(--glass-accent-from)] p-0.5">
                  <AppIcon name="check" className="h-3 w-3 text-white" />
                </div>
              ) : null}
            </div>
            <div className="px-2 py-1 text-[11px] font-medium text-[var(--glass-text-primary)]">{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function BatchTask(data: BatchTaskData) {
  const [open, setOpen] = useState(false)
  return (
    <div className="text-[12px] leading-5 text-[var(--glass-text-tertiary)]">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full cursor-pointer items-center gap-2 text-left">
        <AppIcon name="package" className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">
          {data.title} · 共 {data.total} 个
        </span>
        <AppIcon name="chevronDown" className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="ml-5 mt-1 space-y-0.5 text-[11px]">
          {data.taskIds.map((id) => (
            <div key={id} className="font-mono">{id}</div>
          ))}
          {data.total > data.taskIds.length ? <div>… 其余 {data.total - data.taskIds.length} 个</div> : null}
        </div>
      ) : null}
    </div>
  )
}

function ProjectContext(data: ProjectContextData) {
  const [open, setOpen] = useState(false)
  return (
    <div className="text-[12px] leading-5 text-[var(--glass-text-tertiary)]">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full cursor-pointer items-center gap-2 text-left">
        <AppIcon name="folder" className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">
          项目上下文 · {data.projectName} · {data.episodeName}
        </span>
        <AppIcon name="chevronDown" className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? <div className="ml-5 mt-1 text-[11px] leading-5">工作区状态: {data.status}</div> : null}
    </div>
  )
}

export const designCurrent: CardKit = {
  id: 'current',
  label: '当前 UI',
  blurb: '现网基线 · 折叠详情 + 灰阶',
  swatch: 'var(--glass-text-tertiary)',
  UserBubble,
  AssistantText,
  Reasoning,
  Thinking,
  ToolCall,
  Approval,
  Confirm,
  Choice,
  TaskSubmitted,
  ProjectPhase,
  AgentStop,
  ActiveRun,
  StylePreview,
  BatchTask,
  ProjectContext,
}
