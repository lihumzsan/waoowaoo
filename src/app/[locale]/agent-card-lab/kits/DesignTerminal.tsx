'use client'

import { useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
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
 * DesignTerminal — 「终端」方案。
 * 等宽字体的轻量日志风:`›` 前缀 + 方括号状态标记 `[ok] [err]`。
 * 浅色、不刺眼,技术感强、状态一目了然。适合工具/任务密集的流程。
 */

const SHELL = 'rounded-lg border border-neutral-200 bg-[#fafafa] font-mono'
const PRIMARY =
  'inline-flex items-center justify-center rounded-md bg-neutral-900 px-4 py-2 font-mono text-[12px] font-medium text-neutral-50 transition-colors hover:bg-neutral-700'
const GHOST =
  'inline-flex items-center justify-center rounded-md border border-neutral-300 px-4 py-2 font-mono text-[12px] font-medium text-neutral-600 transition-colors hover:bg-neutral-100'

function Bracket({ tone, children }: { tone: CardTone; children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-semibold" style={{ color: SEM[tone] }}>
      [{children}]
    </span>
  )
}

const STATUS_CODE: Record<ToolCallData['status'], string> = {
  running: 'run',
  success: 'ok',
  failed: 'err',
  'needs-action': 'wait',
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="ml-auto w-fit max-w-[88%] rounded-lg bg-neutral-900 px-3.5 py-2.5 text-sm leading-6 text-neutral-50">{text}</div>
  )
}

function AssistantText({ children }: { children: React.ReactNode }) {
  return <div className="px-0.5 text-sm leading-6 text-neutral-800">{children}</div>
}

function Reasoning({ text }: { text: string }) {
  return (
    <div className="flex gap-2 font-mono text-[11px] leading-5 text-neutral-400">
      <span className="select-none text-neutral-300">#</span>
      <span>{text}</span>
    </div>
  )
}

function Thinking() {
  return (
    <div className="flex items-center gap-1.5 font-mono text-[12px] text-neutral-400">
      <span className="text-neutral-300">›</span>
      <span>thinking</span>
      <span className="inline-block w-3 animate-pulse text-neutral-500">▋</span>
    </div>
  )
}

function CodeBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-neutral-300">{label}</div>
      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all text-[11px] leading-5 text-neutral-500">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}

function ToolCall(data: ToolCallData) {
  const [open, setOpen] = useState(data.status === 'failed')
  const tone = STATUS_TONE[data.status]
  return (
    <div className={SHELL}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
        <span className="select-none text-neutral-300">›</span>
        {data.status === 'running' ? <AppIcon name="loader" className="h-3 w-3 shrink-0 animate-spin text-neutral-400" /> : null}
        <span className="min-w-0 flex-1 truncate text-[12px] text-neutral-700">{data.title}</span>
        <Bracket tone={tone}>{STATUS_CODE[data.status]}</Bracket>
        <AppIcon name="chevronDown" className={`h-3 w-3 shrink-0 text-neutral-300 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="space-y-2.5 border-t border-neutral-200 px-3 py-2.5">
          {data.error ? <div className="text-[11px] leading-5 text-rose-600">! {data.error}</div> : null}
          <CodeBlock label="input" value={data.args} />
          {data.result ? <CodeBlock label="output" value={data.result} /> : null}
        </div>
      ) : null}
    </div>
  )
}

function Approval(data: ApprovalData) {
  const [note, setNote] = useState('')
  return (
    <div className={`${SHELL} p-3`}>
      <div className="flex items-center gap-2 text-[12px]">
        <span className="select-none text-neutral-300">›</span>
        <span className="font-semibold text-neutral-800">approval.required</span>
        <Bracket tone="warn">confirm</Bracket>
      </div>
      <div className="mt-1.5 text-[11px] leading-5 text-neutral-500">{data.summary}</div>
      {data.reasons.length > 0 ? (
        <ul className="mt-2 space-y-0.5">
          {data.reasons.map((r) => (
            <li key={r} className="text-[11px] leading-5 text-amber-600">- {r}</li>
          ))}
        </ul>
      ) : null}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="reject reason (optional)"
        className="mt-2 min-h-[52px] w-full resize-none rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-[12px] text-neutral-700 outline-none transition-colors focus:border-neutral-500"
      />
      <div className="mt-2 flex gap-2">
        <button type="button" className={`flex-1 ${PRIMARY}`}>approve</button>
        <button type="button" className={`flex-1 ${GHOST}`}>reject</button>
      </div>
    </div>
  )
}

function Confirm(data: ConfirmData) {
  return (
    <div className={`${SHELL} p-3`}>
      <div className="flex items-center gap-2 text-[12px]">
        <span className="select-none text-neutral-300">›</span>
        <span className="font-semibold text-neutral-800">{data.title}</span>
        <Bracket tone="info">confirm</Bracket>
      </div>
      <div className="mt-1.5 text-[11px] leading-5 text-neutral-500">{data.subtitle}</div>
      <div className="mt-2 flex gap-2">
        <button type="button" className={`flex-1 ${PRIMARY}`}>continue</button>
        <button type="button" className={`flex-1 ${GHOST}`}>cancel</button>
      </div>
    </div>
  )
}

function Choice(data: ChoiceData) {
  const [selected, setSelected] = useState(data.options[0]?.value ?? '')
  return (
    <div className={`${SHELL} p-3`}>
      <div className="flex items-center gap-2 text-[12px]">
        <span className="select-none text-neutral-300">›</span>
        <span className="font-semibold text-neutral-800">{data.title}</span>
        <span className="ml-auto text-[11px] text-neutral-300">{data.step}</span>
      </div>
      <div className="mt-1 text-[11px] text-neutral-400">{data.description}</div>
      <div className="mt-2.5 grid grid-cols-3 gap-2">
        {data.options.map((option) => {
          const isSelected = selected === option.value
          const dims = ratioBox(option.ratio ?? '1:1', 30)
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setSelected(option.value)}
              className={`flex flex-col items-center gap-1.5 rounded-md border p-2.5 transition-colors ${isSelected ? 'border-neutral-800 bg-white' : 'border-neutral-200 hover:border-neutral-300'}`}
            >
              <span className="flex h-8 w-12 items-center justify-center">
                <span className={`${isSelected ? 'bg-neutral-900' : 'bg-neutral-300'}`} style={{ width: `${String(dims.width)}px`, height: `${String(dims.height)}px` }} />
              </span>
              <span className={`text-[12px] font-semibold ${isSelected ? 'text-neutral-900' : 'text-neutral-500'}`}>{option.label}</span>
            </button>
          )
        })}
      </div>
      <button type="button" className={`mt-2.5 w-full ${PRIMARY}`}>{data.submitLabel}</button>
    </div>
  )
}

function TaskSubmitted(data: TaskData) {
  return (
    <div className="flex items-center gap-2 font-mono text-[11px] text-neutral-500">
      <span className="select-none text-neutral-300">›</span>
      <span className="text-neutral-700">task.submit</span>
      <span className="text-neutral-400">{data.taskId}</span>
      <Bracket tone="info">queued</Bracket>
      <span className="ml-auto tabular-nums text-neutral-400">{data.progress}%</span>
    </div>
  )
}

function ProjectPhase(data: PhaseData) {
  return (
    <div className="flex items-center gap-2 font-mono text-[11px] text-neutral-400">
      <span className="select-none text-neutral-300">#</span>
      <span className="text-neutral-600">phase</span>
      <span>clips={data.clips}</span>
      <span>scripts={data.screenplays}</span>
      <span>boards={data.storyboards}</span>
    </div>
  )
}

function AgentStop(data: StopData) {
  return (
    <div className="flex items-center gap-2 font-mono text-[11px] text-neutral-400">
      <span className="select-none text-neutral-300">›</span>
      <span className="text-neutral-600">{data.title}</span>
      <Bracket tone="danger">stop</Bracket>
    </div>
  )
}

function ActiveRun(data: ActiveRunData) {
  return (
    <div className={`${SHELL} p-3`}>
      <div className="flex items-center gap-2 text-[12px]">
        <span className="select-none text-neutral-300">›</span>
        <AppIcon name="loader" className="h-3 w-3 shrink-0 animate-spin text-neutral-400" />
        <span className="min-w-0 flex-1 truncate text-neutral-700">{data.title}</span>
        <Bracket tone="info">running</Bracket>
      </div>
      <div className="mt-1.5 flex items-start gap-2 text-[11px] leading-5 text-neutral-400">
        <span className="select-none text-neutral-300">#</span>
        <span>{data.detail}</span>
      </div>
      <div className="mt-1.5 font-mono text-[11px] text-neutral-300">
        <span className="animate-pulse">▰▰▰</span>▱▱▱▱▱
      </div>
    </div>
  )
}

function StylePreview(data: StylePreviewData) {
  const done = data.candidates.filter((c) => c.status === 'done').length
  return (
    <div className={`${SHELL} p-3`}>
      <div className="flex items-center gap-2 text-[12px]">
        <span className="select-none text-neutral-300">›</span>
        <span className="font-semibold text-neutral-800">style.preview</span>
        <span className="ml-auto text-[11px] text-neutral-400">{done}/{data.candidates.length}</span>
      </div>
      <div className="mt-2.5 space-y-1">
        {data.candidates.map((c) => {
          const tone: CardTone = c.status === 'done' ? 'success' : c.status === 'failed' ? 'danger' : 'info'
          const code = c.status === 'done' ? 'ok' : c.status === 'failed' ? 'err' : `${c.progress}%`
          return (
            <div key={c.id} className="flex items-center gap-2 text-[11px] text-neutral-500">
              <span className="select-none text-neutral-300">-</span>
              <span className="h-4 w-6 shrink-0 rounded-sm" style={{ background: c.swatch }} />
              <span className="min-w-0 flex-1 truncate text-neutral-700">{c.label}</span>
              {c.selected ? <span className="text-neutral-400">★</span> : null}
              <Bracket tone={tone}>{code}</Bracket>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BatchTask(data: BatchTaskData) {
  return (
    <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-neutral-400">
      <span className="select-none text-neutral-300">›</span>
      <span className="text-neutral-700">task.batch</span>
      <span>n={data.total}</span>
      <span className="text-neutral-300">{data.taskIds.slice(0, 3).join(' ')} …</span>
      <Bracket tone="info">queued</Bracket>
    </div>
  )
}

function ProjectContext(data: ProjectContextData) {
  return (
    <div className="flex items-center gap-2 font-mono text-[11px] text-neutral-400">
      <span className="select-none text-neutral-300">#</span>
      <span className="text-neutral-600">ctx</span>
      <span className="text-neutral-700">{data.projectName}</span>
      <span>/</span>
      <span>{data.episodeName}</span>
      <Bracket tone="neutral">{data.status}</Bracket>
    </div>
  )
}

export const designTerminal: CardKit = {
  id: 'terminal',
  label: 'Terminal 终端',
  blurb: '等宽日志 · 方括号状态 · 技术直观',
  swatch: '#374151',
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
