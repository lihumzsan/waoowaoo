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
 * DesignEdge — 「色边」方案。
 * 白卡 + 发丝边框,左侧一条语义色边:颜色即状态,一眼可读。
 * 其余保持中性,主按钮纯黑。直观、信息密度低、易扫读。
 */

const PRIMARY =
  'inline-flex items-center justify-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-neutral-700'
const GHOST =
  'inline-flex items-center justify-center rounded-lg border border-neutral-200 px-4 py-2 text-[13px] font-medium text-neutral-600 transition-colors hover:bg-neutral-50'

function EdgeCard({ tone, children }: { tone: CardTone; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="flex">
        <span className="w-[3px] shrink-0" style={{ backgroundColor: SEM[tone] }} />
        <div className="min-w-0 flex-1 p-3.5">{children}</div>
      </div>
    </div>
  )
}

const STATUS_LABEL: Record<ToolCallData['status'], string> = {
  running: '执行中',
  success: '完成',
  failed: '失败',
  'needs-action': '待操作',
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
    <div className="flex">
      <span className="w-[3px] shrink-0 rounded-full bg-neutral-200" />
      <div className="pl-3 text-xs leading-5 text-neutral-400">
        <span className="mb-0.5 block font-medium text-neutral-300">思考</span>
        {text}
      </div>
    </div>
  )
}

function Thinking() {
  return (
    <div className="flex items-center gap-2 px-0.5 text-xs text-neutral-400">
      <AppIcon name="loader" className="h-3.5 w-3.5 animate-spin text-neutral-300" />
      正在生成
    </div>
  )
}

function CodeBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-lg bg-neutral-50 p-3">
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
    <EdgeCard tone={tone}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 text-left">
        <AppIcon name={icon} className={`h-4 w-4 shrink-0 text-neutral-400 ${data.status === 'running' ? 'animate-spin' : ''}`} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-neutral-800">{data.title}</span>
        <span className="text-[11px] font-medium" style={{ color: SEM[tone] }}>{STATUS_LABEL[data.status]}</span>
        <AppIcon name="chevronDown" className={`h-3.5 w-3.5 shrink-0 text-neutral-300 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="mt-3 space-y-2">
          {data.error ? <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-600">{data.error}</div> : null}
          <CodeBlock label="参数" value={data.args} />
          {data.result ? <CodeBlock label="结果" value={data.result} /> : null}
        </div>
      ) : null}
    </EdgeCard>
  )
}

function Approval(data: ApprovalData) {
  const [note, setNote] = useState('')
  return (
    <EdgeCard tone="warn">
      <div className="flex items-center gap-2">
        <AppIcon name="alert" className="h-4 w-4 shrink-0 text-amber-500" />
        <span className="text-[13px] font-semibold text-neutral-900">{data.title}</span>
        <span className="ml-auto text-[11px] font-medium text-amber-600">不可撤销</span>
      </div>
      <div className="mt-1.5 text-xs leading-5 text-neutral-500">{data.summary}</div>
      {data.reasons.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
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
        className="mt-3 min-h-[60px] w-full resize-none rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-700 outline-none transition-colors focus:border-neutral-400"
      />
      <div className="mt-3 flex gap-2">
        <button type="button" className={`flex-1 ${PRIMARY}`}>批准</button>
        <button type="button" className={`flex-1 ${GHOST}`}>拒绝</button>
      </div>
    </EdgeCard>
  )
}

function Confirm(data: ConfirmData) {
  return (
    <EdgeCard tone="info">
      <div className="flex items-center gap-2">
        <AppIcon name="bolt" className="h-4 w-4 shrink-0 text-blue-500" />
        <span className="text-[13px] font-semibold text-neutral-900">{data.title}</span>
      </div>
      <div className="mt-1.5 text-xs leading-5 text-neutral-500">{data.subtitle}</div>
      <div className="mt-3 flex gap-2">
        <button type="button" className={`flex-1 ${PRIMARY}`}>继续</button>
        <button type="button" className={`flex-1 ${GHOST}`}>取消</button>
      </div>
    </EdgeCard>
  )
}

function Choice(data: ChoiceData) {
  const [selected, setSelected] = useState(data.options[0]?.value ?? '')
  return (
    <EdgeCard tone="info">
      <div className="flex items-center gap-2">
        <AppIcon name="imageLandscape" className="h-4 w-4 shrink-0 text-blue-500" />
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
              className={`flex flex-col items-center gap-2 rounded-lg border p-3 transition-colors ${isSelected ? 'border-blue-500 bg-blue-50/40' : 'border-neutral-200 hover:border-neutral-300'}`}
            >
              <span className="flex h-9 w-12 items-center justify-center">
                <span
                  className={`rounded-sm ${isSelected ? 'bg-blue-500' : 'bg-neutral-300'}`}
                  style={{ width: `${String(dims.width)}px`, height: `${String(dims.height)}px` }}
                />
              </span>
              <span className={`text-[13px] font-semibold ${isSelected ? 'text-blue-600' : 'text-neutral-500'}`}>{option.label}</span>
              <span className="text-center text-[10px] leading-4 text-neutral-400">{option.description}</span>
            </button>
          )
        })}
      </div>
      <button type="button" className={`mt-3 w-full ${PRIMARY}`}>{data.submitLabel}</button>
    </EdgeCard>
  )
}

function TaskSubmitted(data: TaskData) {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="flex">
        <span className="w-[3px] shrink-0" style={{ backgroundColor: SEM.info }} />
        <div className="flex min-w-0 flex-1 items-center gap-3 p-3">
          <AppIcon name="clock" className="h-4 w-4 shrink-0 text-neutral-400" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-neutral-700">
              {data.title} · <span className="font-mono text-neutral-400">{data.taskId}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-100">
                <div className="h-full rounded-full bg-blue-500" style={{ width: `${String(data.progress)}%` }} />
              </div>
              <span className="text-[10px] tabular-nums text-neutral-400">{data.progress}%</span>
            </div>
          </div>
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
    <div className="flex items-center gap-4 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-xs text-neutral-400">
      <span className="flex items-center gap-1.5 font-medium text-neutral-500">
        <AppIcon name="chart" className="h-3.5 w-3.5 text-emerald-500" />
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
    <div className="flex items-center gap-2 text-xs text-neutral-400">
      <AppIcon name="pause" className="h-3.5 w-3.5 shrink-0" />
      <span className="font-medium text-neutral-600">{data.title}</span>
      <span>— {data.detail}</span>
    </div>
  )
}

function ActiveRun(data: ActiveRunData) {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="flex">
        <span className="w-[3px] shrink-0" style={{ backgroundColor: SEM.info }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 p-3.5">
            <AppIcon name="loader" className="h-4 w-4 shrink-0 animate-spin" style={{ color: SEM.info }} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-neutral-800">{data.title}</div>
              <div className="truncate text-[11px] text-neutral-400">{data.detail}</div>
            </div>
            <span className="text-[11px] font-medium" style={{ color: SEM.info }}>进行中</span>
          </div>
          <div className="h-0.5 w-full overflow-hidden bg-neutral-100">
            <div className="h-full w-1/3 animate-[edge-indeterminate_1.4s_ease-in-out_infinite]" style={{ backgroundColor: SEM.info }} />
          </div>
        </div>
      </div>
      <style>{'@keyframes edge-indeterminate{0%{transform:translateX(-100%)}100%{transform:translateX(400%)}}'}</style>
    </div>
  )
}

function StylePreview(data: StylePreviewData) {
  const done = data.candidates.filter((c) => c.status === 'done').length
  return (
    <EdgeCard tone="info">
      <div className="flex items-center gap-2">
        <AppIcon name="sparkles" className="h-4 w-4 shrink-0 text-blue-500" />
        <span className="text-[13px] font-semibold text-neutral-900">{data.title}</span>
        <span className="ml-auto text-[11px] text-neutral-400">{done}/{data.candidates.length}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {data.candidates.map((c) => {
          const failed = c.status === 'failed'
          return (
            <div key={c.id} className={`overflow-hidden rounded-lg border ${c.selected ? 'border-blue-500' : failed ? 'border-rose-200' : 'border-neutral-200'}`}>
              <div className="relative h-16 w-full" style={{ background: c.swatch }}>
                {c.status === 'generating' ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/25 text-[11px] font-semibold text-white">{c.progress}%</div>
                ) : null}
                {failed ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/35">
                    <AppIcon name="alert" className="h-4 w-4 text-white" />
                  </div>
                ) : null}
                {c.selected ? (
                  <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500">
                    <AppIcon name="check" className="h-2.5 w-2.5 text-white" />
                  </span>
                ) : null}
              </div>
              <div className="px-2 py-1 text-[11px] font-medium text-neutral-700">{c.label}</div>
            </div>
          )
        })}
      </div>
    </EdgeCard>
  )
}

function BatchTask(data: BatchTaskData) {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="flex">
        <span className="w-[3px] shrink-0" style={{ backgroundColor: SEM.info }} />
        <div className="flex min-w-0 flex-1 items-center gap-2.5 p-3">
          <AppIcon name="package" className="h-4 w-4 shrink-0 text-neutral-400" />
          <span className="text-xs font-medium text-neutral-700">{data.title}</span>
          <span className="text-[11px] text-neutral-400">共 {data.total} 个</span>
          <span className="ml-auto font-mono text-[11px] text-neutral-300">{data.taskIds.slice(0, 2).join('  ')} …</span>
        </div>
      </div>
    </div>
  )
}

function ProjectContext(data: ProjectContextData) {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="flex">
        <span className="w-[3px] shrink-0" style={{ backgroundColor: SEM.neutral }} />
        <div className="flex min-w-0 flex-1 items-center gap-2.5 p-3 text-xs text-neutral-400">
          <AppIcon name="folder" className="h-4 w-4 shrink-0 text-neutral-400" />
          <span className="font-medium text-neutral-700">{data.projectName}</span>
          <span>·</span>
          <span>{data.episodeName}</span>
          <span className="ml-auto rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-500">{data.status}</span>
        </div>
      </div>
    </div>
  )
}

export const designEdge: CardKit = {
  id: 'edge',
  label: 'Edge 色边',
  blurb: '白卡 + 状态色边 · 一眼读状态',
  swatch: 'linear-gradient(180deg,#2563eb,#16a34a,#dc2626)',
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
