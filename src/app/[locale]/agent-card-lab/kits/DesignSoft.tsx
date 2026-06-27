'use client'

import { useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { AppIconName } from '@/components/ui/icons/registry'
import type {
  ActiveRunData,
  ApprovalData,
  BatchTaskData,
  CardKit,
  CardTone,
  ChoiceData,
  ConfirmData,
  PhaseData,
  ProjectContextData,
  StopData,
  StylePreviewData,
  TaskData,
  ToolCallData,
} from './types'
import { ratioBox, SEM, STATUS_TONE } from './shared'

/**
 * DesignSoft — 「微卡」方案。
 * 无边框、无投影,仅靠极浅灰底色区分层级,圆角柔和。
 * 状态用一个小圆点表达,主按钮纯黑。安静、克制,接近 Apple Notes。
 */

const CARD = 'rounded-2xl bg-neutral-50 p-4'
const PRIMARY =
  'inline-flex items-center justify-center gap-1.5 rounded-xl bg-neutral-900 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-neutral-700'
const SECONDARY =
  'inline-flex items-center justify-center rounded-xl bg-white px-4 py-2 text-[13px] font-medium text-neutral-600 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors hover:bg-neutral-100'

function Dot({ tone, pulse }: { tone: CardTone; pulse?: boolean }) {
  return <span className={`h-2 w-2 shrink-0 rounded-full ${pulse ? 'animate-pulse' : ''}`} style={{ backgroundColor: SEM[tone] }} />
}

const STATUS_LABEL: Record<ToolCallData['status'], string> = {
  running: '执行中',
  success: '完成',
  failed: '失败',
  'needs-action': '待操作',
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="ml-auto w-fit max-w-[88%] rounded-2xl bg-neutral-900 px-3.5 py-2.5 text-sm leading-6 text-neutral-50">{text}</div>
  )
}

function AssistantText({ children }: { children: React.ReactNode }) {
  return <div className="px-0.5 text-sm leading-6 text-neutral-700">{children}</div>
}

function Reasoning({ text }: { text: string }) {
  return (
    <div className="rounded-2xl bg-neutral-50 px-3.5 py-2.5 text-xs leading-5 text-neutral-400">
      <span className="mb-0.5 block font-medium text-neutral-300">思考</span>
      {text}
    </div>
  )
}

function Thinking() {
  return (
    <div className="flex w-fit items-center gap-2 rounded-full bg-neutral-100 px-3 py-1.5 text-xs text-neutral-400">
      <span className="flex gap-1">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 [animation-delay:-200ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 [animation-delay:-100ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400" />
      </span>
      正在思考
    </div>
  )
}

function CodeBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-xl bg-white p-3">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-300">{label}</div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-neutral-500">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}

function ToolCall(data: ToolCallData) {
  const [open, setOpen] = useState(data.status === 'failed')
  const tone = STATUS_TONE[data.status]
  const icon: AppIconName = data.status === 'running' ? 'loader' : 'cpu'
  return (
    <div className={CARD}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 text-left">
        <AppIcon name={icon} className={`h-4 w-4 shrink-0 text-neutral-400 ${data.status === 'running' ? 'animate-spin' : ''}`} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-neutral-800">{data.title}</span>
        <span className="flex items-center gap-1.5 text-[11px] text-neutral-400">
          <Dot tone={tone} pulse={data.status === 'running'} />
          {STATUS_LABEL[data.status]}
        </span>
        <AppIcon name="chevronDown" className={`h-3.5 w-3.5 shrink-0 text-neutral-300 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="mt-3 space-y-2">
          {data.error ? <div className="rounded-xl bg-white px-3 py-2 text-xs leading-5 text-rose-600">{data.error}</div> : null}
          <CodeBlock label="参数" value={data.args} />
          {data.result ? <CodeBlock label="结果" value={data.result} /> : null}
        </div>
      ) : null}
    </div>
  )
}

function Approval(data: ApprovalData) {
  const [note, setNote] = useState('')
  return (
    <div className={CARD}>
      <div className="flex items-center gap-2">
        <Dot tone="warn" />
        <span className="text-[13px] font-semibold text-neutral-900">{data.title}</span>
      </div>
      <div className="mt-1.5 text-xs leading-5 text-neutral-500">{data.summary}</div>
      {data.reasons.length > 0 ? (
        <ul className="mt-3 space-y-1.5 rounded-xl bg-white p-3">
          {data.reasons.map((r) => (
            <li key={r} className="flex items-start gap-2 text-xs leading-5 text-neutral-600">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-400" />
              {r}
            </li>
          ))}
        </ul>
      ) : null}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="拒绝说明（可选）"
        className="mt-3 min-h-[60px] w-full resize-none rounded-xl bg-white px-3 py-2 text-sm text-neutral-700 outline-none ring-1 ring-transparent transition focus:ring-neutral-300"
      />
      <div className="mt-3 flex gap-2">
        <button type="button" className={`flex-1 ${PRIMARY}`}>批准</button>
        <button type="button" className={`flex-1 ${SECONDARY}`}>拒绝</button>
      </div>
    </div>
  )
}

function Confirm(data: ConfirmData) {
  return (
    <div className={CARD}>
      <div className="flex items-center gap-2">
        <Dot tone="info" />
        <span className="text-[13px] font-semibold text-neutral-900">{data.title}</span>
      </div>
      <div className="mt-1.5 text-xs leading-5 text-neutral-500">{data.subtitle}</div>
      <div className="mt-3 flex gap-2">
        <button type="button" className={`flex-1 ${PRIMARY}`}>继续</button>
        <button type="button" className={`flex-1 ${SECONDARY}`}>取消</button>
      </div>
    </div>
  )
}

function Choice(data: ChoiceData) {
  const [selected, setSelected] = useState(data.options[0]?.value ?? '')
  return (
    <div className={CARD}>
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-neutral-900">{data.title}</span>
        <span className="ml-auto text-[11px] text-neutral-300">{data.step}</span>
      </div>
      <div className="mt-1 text-xs text-neutral-400">{data.description}</div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {data.options.map((option) => {
          const isSelected = selected === option.value
          const dims = ratioBox(option.ratio ?? '1:1', 32)
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setSelected(option.value)}
              className={`flex flex-col items-center gap-2 rounded-xl p-3 transition-colors ${isSelected ? 'bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)]' : 'bg-white/40 hover:bg-white/80'}`}
            >
              <span className="flex h-9 w-12 items-center justify-center">
                <span
                  className={`rounded-sm ${isSelected ? 'bg-neutral-900' : 'bg-neutral-300'}`}
                  style={{ width: `${String(dims.width)}px`, height: `${String(dims.height)}px` }}
                />
              </span>
              <span className={`text-[13px] font-semibold ${isSelected ? 'text-neutral-900' : 'text-neutral-500'}`}>{option.label}</span>
              <span className="text-center text-[10px] leading-4 text-neutral-400">{option.description}</span>
            </button>
          )
        })}
      </div>
      <button type="button" className={`mt-3 w-full ${PRIMARY}`}>{data.submitLabel}</button>
    </div>
  )
}

function TaskSubmitted(data: TaskData) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-neutral-50 px-3.5 py-2.5">
      <AppIcon name="clock" className="h-4 w-4 shrink-0 text-neutral-400" />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-neutral-700">
          {data.title} · <span className="font-mono text-neutral-400">{data.taskId}</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-200">
            <div className="h-full rounded-full bg-neutral-800" style={{ width: `${String(data.progress)}%` }} />
          </div>
          <span className="text-[10px] tabular-nums text-neutral-400">{data.progress}%</span>
        </div>
      </div>
    </div>
  )
}

function ProjectPhase(data: PhaseData) {
  const items = [
    { label: '片段', value: data.clips },
    { label: '剧本', value: data.screenplays },
    { label: '分镜', value: data.storyboards },
  ]
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-neutral-50 px-4 py-2.5 text-xs text-neutral-400">
      <span className="flex items-center gap-1.5 font-medium text-neutral-500">
        <AppIcon name="chart" className="h-3.5 w-3.5 text-neutral-300" />
        项目进度
      </span>
      {items.map((it) => (
        <span key={it.label}>
          <span className="font-semibold text-neutral-800">{it.value}</span> {it.label}
        </span>
      ))}
    </div>
  )
}

function AgentStop(data: StopData) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-neutral-50 px-3.5 py-2.5">
      <AppIcon name="pause" className="h-4 w-4 shrink-0 text-neutral-400" />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-neutral-600">{data.title}</div>
        <div className="truncate text-[11px] text-neutral-400">{data.detail}</div>
      </div>
    </div>
  )
}

function ActiveRun(data: ActiveRunData) {
  return (
    <div className={CARD}>
      <div className="flex items-center gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white">
          <AppIcon name="loader" className="h-3.5 w-3.5 animate-spin text-neutral-500" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-neutral-800">{data.title}</div>
          <div className="truncate text-[11px] text-neutral-400">{data.detail}</div>
        </div>
        <Dot tone="info" pulse />
      </div>
      <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-white">
        <div className="h-full w-1/3 animate-[soft-indeterminate_1.5s_ease-in-out_infinite] rounded-full bg-neutral-800" />
      </div>
      <style>{'@keyframes soft-indeterminate{0%{transform:translateX(-110%)}100%{transform:translateX(420%)}}'}</style>
    </div>
  )
}

function StylePreview(data: StylePreviewData) {
  const done = data.candidates.filter((c) => c.status === 'done').length
  return (
    <div className={CARD}>
      <div className="flex items-center gap-2">
        <AppIcon name="sparkles" className="h-4 w-4 shrink-0 text-neutral-500" />
        <span className="text-[13px] font-semibold text-neutral-900">{data.title}</span>
        <span className="ml-auto text-[11px] text-neutral-400">{done}/{data.candidates.length}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        {data.candidates.map((c) => (
          <div key={c.id} className={`overflow-hidden rounded-xl bg-white ${c.selected ? 'ring-2 ring-neutral-900' : ''}`}>
            <div className="relative h-16 w-full" style={{ background: c.swatch }}>
              {c.status === 'generating' ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/25 text-[11px] font-semibold text-white">{c.progress}%</div>
              ) : null}
              {c.status === 'failed' ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/35">
                  <AppIcon name="alert" className="h-4 w-4 text-white" />
                </div>
              ) : null}
              {c.selected ? (
                <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-neutral-900">
                  <AppIcon name="check" className="h-2.5 w-2.5 text-white" />
                </span>
              ) : null}
            </div>
            <div className="px-2.5 py-1.5 text-[11px] font-medium text-neutral-700">{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function BatchTask(data: BatchTaskData) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-neutral-50 px-3.5 py-2.5">
      <AppIcon name="package" className="h-4 w-4 shrink-0 text-neutral-400" />
      <span className="text-xs font-medium text-neutral-700">{data.title}</span>
      <span className="text-[11px] text-neutral-400">共 {data.total} 个任务</span>
      <span className="ml-auto font-mono text-[11px] text-neutral-300">{data.taskIds[0]} …</span>
    </div>
  )
}

function ProjectContext(data: ProjectContextData) {
  return (
    <div className="flex items-center gap-2.5 rounded-2xl bg-neutral-50 px-3.5 py-2.5 text-xs text-neutral-400">
      <AppIcon name="folder" className="h-4 w-4 shrink-0 text-neutral-400" />
      <span className="font-medium text-neutral-700">{data.projectName}</span>
      <span>·</span>
      <span>{data.episodeName}</span>
      <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-neutral-500">{data.status}</span>
    </div>
  )
}

export const designSoft: CardKit = {
  id: 'soft',
  label: 'Soft 微卡',
  blurb: '无边框 · 柔灰底 · 安静克制',
  swatch: '#e5e7eb',
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
