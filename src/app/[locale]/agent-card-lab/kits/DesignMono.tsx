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
import { DEMO_TONE_BY_STATUS } from './types'

/**
 * DesignMono — 「墨线」方案。
 * 极简、单色、发丝级边框,大量留白,无投影。
 * 状态用小圆点 + 大写字距标签表达,主按钮纯黑。Linear / Notion 风。
 */

const DOT: Record<CardTone, string> = {
  neutral: '#9ca3af',
  info: '#2563eb',
  success: '#16a34a',
  warn: '#d97706',
  danger: '#dc2626',
}

const SURFACE = 'rounded-xl border border-neutral-200 bg-white'
const PRIMARY_BTN =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-neutral-700'
const GHOST_BTN =
  'inline-flex items-center justify-center rounded-lg border border-neutral-200 px-4 py-2 text-[13px] font-medium text-neutral-600 transition-colors hover:bg-neutral-50'

function StatusTag({ tone, label }: { tone: CardTone; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400">
      <span className={`h-1.5 w-1.5 rounded-full ${tone === 'info' ? 'animate-pulse' : ''}`} style={{ backgroundColor: DOT[tone] }} />
      {label}
    </span>
  )
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="ml-auto w-fit max-w-[88%] rounded-xl bg-neutral-900 px-3.5 py-2.5 text-sm leading-6 text-neutral-50">{text}</div>
  )
}

function AssistantText({ children }: { children: React.ReactNode }) {
  return <div className="px-0.5 text-sm leading-6 text-neutral-800">{children}</div>
}

function Reasoning({ text }: { text: string }) {
  return (
    <div className="border-l border-neutral-200 pl-3 text-xs leading-5 text-neutral-400">
      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-300">思考</span>
      <span className="whitespace-pre-wrap">{text}</span>
    </div>
  )
}

function Thinking() {
  return (
    <div className="flex items-center gap-2 px-0.5 text-xs text-neutral-400">
      <span className="flex gap-1">
        <span className="h-1 w-1 animate-pulse rounded-full bg-neutral-400" />
        <span className="h-1 w-1 animate-pulse rounded-full bg-neutral-400 [animation-delay:150ms]" />
        <span className="h-1 w-1 animate-pulse rounded-full bg-neutral-400 [animation-delay:300ms]" />
      </span>
      正在思考
    </div>
  )
}

const STATUS_LABEL: Record<ToolCallData['status'], string> = {
  running: 'Running',
  success: 'Done',
  failed: 'Failed',
  'needs-action': 'Action',
}

function ToolCall(data: ToolCallData) {
  const [open, setOpen] = useState(data.status === 'failed')
  const tone = DEMO_TONE_BY_STATUS[data.status]
  return (
    <div className={SURFACE}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 px-3.5 py-3 text-left">
        <AppIcon
          name={data.status === 'running' ? 'loader' : 'cpu'}
          className={`h-4 w-4 shrink-0 text-neutral-400 ${data.status === 'running' ? 'animate-spin' : ''}`}
        />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-neutral-800">{data.title}</span>
        <StatusTag tone={tone} label={STATUS_LABEL[data.status]} />
        <AppIcon name="chevronDown" className={`h-3.5 w-3.5 shrink-0 text-neutral-300 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="space-y-3 border-t border-neutral-100 px-3.5 py-3">
          {data.error ? <div className="text-xs leading-5 text-rose-600">{data.error}</div> : null}
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-300">Input</div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-neutral-500">
              {JSON.stringify(data.args, null, 2)}
            </pre>
          </div>
          {data.result ? (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-300">Output</div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-neutral-500">
                {JSON.stringify(data.result, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function Approval(data: ApprovalData) {
  const [note, setNote] = useState('')
  return (
    <div className={SURFACE}>
      <div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-3">
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: DOT.warn }} />
        <span className="text-[13px] font-semibold text-neutral-900">{data.title}</span>
        <span className="ml-auto text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-500">需确认</span>
      </div>
      <div className="px-4 py-3">
        <div className="text-xs leading-5 text-neutral-500">{data.summary}</div>
        {data.reasons.length > 0 ? (
          <ul className="mt-3 space-y-1.5">
            {data.reasons.map((r) => (
              <li key={r} className="flex items-start gap-2 text-xs leading-5 text-neutral-600">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-neutral-300" />
                {r}
              </li>
            ))}
          </ul>
        ) : null}
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="拒绝说明（可选）"
          className="mt-3 min-h-[60px] w-full resize-none rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-700 outline-none transition-colors focus:border-neutral-400"
        />
        <div className="mt-3 flex gap-2">
          <button type="button" className={`flex-1 ${PRIMARY_BTN}`}>批准</button>
          <button type="button" className={`flex-1 ${GHOST_BTN}`}>拒绝</button>
        </div>
      </div>
    </div>
  )
}

function Confirm(data: ConfirmData) {
  return (
    <div className={`${SURFACE} px-4 py-3`}>
      <StatusTag tone="info" label="待确认" />
      <div className="mt-2 text-[13px] font-semibold text-neutral-900">{data.title}</div>
      <div className="mt-1 text-xs leading-5 text-neutral-500">{data.subtitle}</div>
      <div className="mt-3 flex gap-2">
        <button type="button" className={`flex-1 ${PRIMARY_BTN}`}>继续</button>
        <button type="button" className={`flex-1 ${GHOST_BTN}`}>取消</button>
      </div>
    </div>
  )
}

function Choice(data: ChoiceData) {
  const [selected, setSelected] = useState(data.options[0]?.value ?? '')
  return (
    <div className={`${SURFACE} px-4 py-3`}>
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-neutral-900">{data.title}</span>
        <span className="ml-auto text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-300">{data.step}</span>
      </div>
      <div className="mt-1 text-xs text-neutral-400">{data.description}</div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {data.options.map((option) => {
          const isSelected = selected === option.value
          const [w, h] = (option.ratio ?? '1:1').split(':').map(Number)
          const max = Math.max(w, h)
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setSelected(option.value)}
              className={`flex flex-col items-center gap-2 rounded-lg border p-3 transition-colors ${isSelected ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-200 hover:border-neutral-300'}`}
            >
              <div className="flex h-9 w-12 items-center justify-center">
                <div
                  className={`rounded-sm border ${isSelected ? 'border-neutral-900 bg-neutral-900' : 'border-neutral-300'}`}
                  style={{ width: `${String(Math.max(14, Math.round((32 * w) / max)))}px`, height: `${String(Math.max(14, Math.round((32 * h) / max)))}px` }}
                />
              </div>
              <div className={`text-[13px] font-semibold ${isSelected ? 'text-neutral-900' : 'text-neutral-500'}`}>{option.label}</div>
              <div className="text-center text-[10px] leading-4 text-neutral-400">{option.description}</div>
            </button>
          )
        })}
      </div>
      <button type="button" className={`mt-3 w-full ${PRIMARY_BTN}`}>{data.submitLabel}</button>
    </div>
  )
}

function TaskSubmitted(data: TaskData) {
  return (
    <div className="flex items-center gap-3 text-xs text-neutral-500">
      <AppIcon name="clock" className="h-3.5 w-3.5 shrink-0 text-neutral-300" />
      <span className="font-medium text-neutral-700">{data.title}</span>
      <span className="font-mono text-neutral-400">{data.taskId}</span>
      <span className="h-1 w-1 rounded-full bg-neutral-300" />
      <div className="flex flex-1 items-center gap-2">
        <div className="h-px flex-1 bg-neutral-200">
          <div className="h-px bg-neutral-900" style={{ width: `${String(data.progress)}%` }} />
        </div>
        <span className="text-[10px] tabular-nums text-neutral-400">{data.progress}%</span>
      </div>
    </div>
  )
}

function ProjectPhase(data: PhaseData) {
  return (
    <div className="flex items-center gap-4 text-xs text-neutral-400">
      <span className="flex items-center gap-1.5 font-medium text-neutral-500">
        <AppIcon name="chart" className="h-3.5 w-3.5 text-neutral-300" />
        项目进度
      </span>
      <span className="text-neutral-500"><span className="font-semibold text-neutral-800">{data.clips}</span> 片段</span>
      <span className="text-neutral-500"><span className="font-semibold text-neutral-800">{data.screenplays}</span> 剧本</span>
      <span className="text-neutral-500"><span className="font-semibold text-neutral-800">{data.storyboards}</span> 分镜</span>
    </div>
  )
}

function AgentStop(data: StopData) {
  return (
    <div className="flex items-center gap-2 text-xs text-neutral-400">
      <AppIcon name="pause" className="h-3.5 w-3.5 shrink-0" />
      <span className="font-medium text-neutral-600">{data.title}</span>
      <span className="text-neutral-400">— {data.detail}</span>
    </div>
  )
}

function ActiveRun(data: ActiveRunData) {
  return (
    <div className={`overflow-hidden ${SURFACE}`}>
      <div className="flex items-center gap-3 px-3.5 py-3">
        <AppIcon name="loader" className="h-4 w-4 shrink-0 animate-spin text-neutral-500" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-neutral-800">{data.title}</div>
          <div className="truncate text-[11px] text-neutral-400">{data.detail}</div>
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-400">进行中</span>
      </div>
      <div className="h-0.5 w-full overflow-hidden bg-neutral-100">
        <div className="h-full w-1/3 animate-[mono-indeterminate_1.4s_ease-in-out_infinite] bg-neutral-900" />
      </div>
      <style>{'@keyframes mono-indeterminate{0%{transform:translateX(-100%)}100%{transform:translateX(400%)}}'}</style>
    </div>
  )
}

function StylePreview(data: StylePreviewData) {
  const done = data.candidates.filter((c) => c.status === 'done').length
  return (
    <div className={`${SURFACE} p-3.5`}>
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-neutral-900">{data.title}</span>
        <span className="ml-auto text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-300">
          {done}/{data.candidates.length}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {data.candidates.map((c) => (
          <div key={c.id} className={`overflow-hidden rounded-lg border ${c.selected ? 'border-neutral-900' : 'border-neutral-200'}`}>
            <div className="relative aspect-square w-full bg-neutral-100 grayscale">
              <div className="absolute inset-0" style={{ background: c.swatch, opacity: 0.55 }} />
              {c.status === 'generating' ? (
                <div className="absolute inset-0 flex items-center justify-center bg-white/60 text-[10px] font-semibold text-neutral-700">{c.progress}%</div>
              ) : null}
              {c.status === 'failed' ? (
                <div className="absolute inset-0 flex items-center justify-center bg-white/70">
                  <span className="text-[9px] font-semibold uppercase text-rose-600">err</span>
                </div>
              ) : null}
              {c.selected ? <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-neutral-900" /> : null}
            </div>
            <div className="truncate px-1.5 py-1 text-[10px] font-medium text-neutral-600">{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function BatchTask(data: BatchTaskData) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
      <AppIcon name="package" className="h-3.5 w-3.5 shrink-0 text-neutral-300" />
      <span className="font-medium text-neutral-700">{data.title}</span>
      <span className="text-neutral-400">共 {data.total} 个</span>
      <span className="font-mono text-neutral-300">{data.taskIds.slice(0, 3).join('  ')} …</span>
    </div>
  )
}

function ProjectContext(data: ProjectContextData) {
  return (
    <div className="flex items-center gap-2 text-xs text-neutral-400">
      <AppIcon name="folder" className="h-3.5 w-3.5 shrink-0 text-neutral-300" />
      <span className="font-medium text-neutral-600">{data.projectName}</span>
      <span className="text-neutral-400">{data.episodeName}</span>
      <span className="h-1 w-1 rounded-full bg-neutral-300" />
      <span>{data.status}</span>
    </div>
  )
}

export const designMono: CardKit = {
  id: 'mono',
  label: 'Mono 墨线',
  blurb: '单色极简 · 发丝边框 · 状态点',
  swatch: '#171717',
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
