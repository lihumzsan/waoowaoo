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
 * DesignCompact — 「紧凑」方案。
 * 所有卡片压成单行/低高度的列表行,左图标 + 标题 + 右状态,可展开。
 * 信息密度高、垂直空间省,长对话也不臃肿。状态用左侧图标着色表达。
 */

const ROW = 'flex items-center gap-2.5 rounded-lg border border-neutral-200 bg-white px-3 py-2'
const PRIMARY =
  'inline-flex items-center justify-center rounded-md bg-neutral-900 px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-neutral-700'
const GHOST =
  'inline-flex items-center justify-center rounded-md border border-neutral-200 px-3 py-1.5 text-[12px] font-medium text-neutral-600 transition-colors hover:bg-neutral-50'

function LeadIcon({ tone, name, spin }: { tone: CardTone; name: AppIconName; spin?: boolean }) {
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded" style={{ color: SEM[tone] }}>
      <AppIcon name={name} className={`h-3.5 w-3.5 ${spin ? 'animate-spin' : ''}`} />
    </span>
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
    <div className="ml-auto w-fit max-w-[88%] rounded-lg bg-neutral-900 px-3 py-2 text-[13px] leading-5 text-neutral-50">{text}</div>
  )
}

function AssistantText({ children }: { children: React.ReactNode }) {
  return <div className="px-0.5 text-[13px] leading-5 text-neutral-800">{children}</div>
}

function Reasoning({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 px-0.5 text-[11px] text-neutral-400">
      <AppIcon name="brain" className="h-3 w-3 shrink-0" />
      <span className="truncate">{text}</span>
    </div>
  )
}

function Thinking() {
  return (
    <div className="flex items-center gap-1.5 px-0.5 text-[11px] text-neutral-400">
      <AppIcon name="loader" className="h-3 w-3 animate-spin" />
      生成中
    </div>
  )
}

function CodeBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-neutral-300">{label}</div>
      <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-neutral-500">
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
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left">
        <LeadIcon tone={tone} name={icon} spin={data.status === 'running'} />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-neutral-800">{data.title}</span>
        <span className="text-[11px]" style={{ color: SEM[tone] }}>{STATUS_LABEL[data.status]}</span>
        <AppIcon name="chevronDown" className={`h-3 w-3 shrink-0 text-neutral-300 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="space-y-2 border-t border-neutral-100 px-3 py-2">
          {data.error ? <div className="text-[11px] leading-5 text-rose-600">{data.error}</div> : null}
          <CodeBlock label="参数" value={data.args} />
          {data.result ? <CodeBlock label="结果" value={data.result} /> : null}
        </div>
      ) : null}
    </div>
  )
}

function Approval(data: ApprovalData) {
  const [open, setOpen] = useState(true)
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left">
        <LeadIcon tone="warn" name="alert" />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-neutral-800">{data.title}</span>
        <span className="text-[11px] text-amber-600">需确认</span>
        <AppIcon name="chevronDown" className={`h-3 w-3 shrink-0 text-neutral-300 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="border-t border-neutral-100 px-3 py-2">
          <div className="text-[11px] leading-5 text-neutral-500">{data.summary}</div>
          {data.reasons.length > 0 ? (
            <ul className="mt-1.5 space-y-0.5">
              {data.reasons.map((r) => (
                <li key={r} className="text-[11px] leading-5 text-neutral-600">· {r}</li>
              ))}
            </ul>
          ) : null}
          <div className="mt-2 flex gap-2">
            <button type="button" className={PRIMARY}>批准</button>
            <button type="button" className={GHOST}>拒绝</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Confirm(data: ConfirmData) {
  return (
    <div className={ROW}>
      <LeadIcon tone="info" name="bolt" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-medium text-neutral-800">{data.title}</div>
        <div className="truncate text-[11px] text-neutral-400">{data.subtitle}</div>
      </div>
      <div className="flex shrink-0 gap-2">
        <button type="button" className={PRIMARY}>继续</button>
        <button type="button" className={GHOST}>取消</button>
      </div>
    </div>
  )
}

function Choice(data: ChoiceData) {
  const [selected, setSelected] = useState(data.options[0]?.value ?? '')
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <LeadIcon tone="info" name="imageLandscape" />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-neutral-800">{data.title}</span>
        <span className="text-[11px] text-neutral-300">{data.step}</span>
      </div>
      <div className="mt-2 flex gap-2">
        {data.options.map((option) => {
          const isSelected = selected === option.value
          const dims = ratioBox(option.ratio ?? '1:1', 22)
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setSelected(option.value)}
              className={`flex flex-1 items-center gap-2 rounded-md border px-2.5 py-2 transition-colors ${isSelected ? 'border-blue-500 bg-blue-50/40' : 'border-neutral-200 hover:border-neutral-300'}`}
            >
              <span className="flex h-6 w-6 items-center justify-center">
                <span className={`rounded-[2px] ${isSelected ? 'bg-blue-500' : 'bg-neutral-300'}`} style={{ width: `${String(dims.width)}px`, height: `${String(dims.height)}px` }} />
              </span>
              <span className={`text-[12px] font-semibold ${isSelected ? 'text-blue-600' : 'text-neutral-600'}`}>{option.label}</span>
            </button>
          )
        })}
      </div>
      <button type="button" className={`mt-2 w-full ${PRIMARY}`}>{data.submitLabel}</button>
    </div>
  )
}

function TaskSubmitted(data: TaskData) {
  return (
    <div className={ROW}>
      <LeadIcon tone="info" name="clock" />
      <span className="shrink-0 text-[12px] font-medium text-neutral-700">{data.title}</span>
      <span className="shrink-0 font-mono text-[11px] text-neutral-400">{data.taskId}</span>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-neutral-100">
        <div className="h-full rounded-full bg-blue-500" style={{ width: `${String(data.progress)}%` }} />
      </div>
      <span className="shrink-0 text-[10px] tabular-nums text-neutral-400">{data.progress}%</span>
    </div>
  )
}

function ProjectPhase(data: PhaseData) {
  return (
    <div className={ROW}>
      <LeadIcon tone="success" name="chart" />
      <span className="text-[12px] font-medium text-neutral-600">项目进度</span>
      <span className="ml-auto flex gap-3 text-[11px] text-neutral-400">
        <span><span className="font-semibold text-neutral-800">{data.clips}</span> 片段</span>
        <span><span className="font-semibold text-neutral-800">{data.screenplays}</span> 剧本</span>
        <span><span className="font-semibold text-neutral-800">{data.storyboards}</span> 分镜</span>
      </span>
    </div>
  )
}

function AgentStop(data: StopData) {
  return (
    <div className="flex items-center gap-2 px-0.5 text-[11px] text-neutral-400">
      <AppIcon name="pause" className="h-3 w-3 shrink-0" />
      <span className="font-medium text-neutral-600">{data.title}</span>
      <span className="truncate">— {data.detail}</span>
    </div>
  )
}

function ActiveRun(data: ActiveRunData) {
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
      <div className="flex items-center gap-2.5 px-3 py-2">
        <LeadIcon tone="info" name="loader" spin />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium text-neutral-800">{data.title}</div>
          <div className="truncate text-[11px] text-neutral-400">{data.detail}</div>
        </div>
        <span className="text-[11px]" style={{ color: SEM.info }}>进行中</span>
      </div>
      <div className="h-0.5 w-full overflow-hidden bg-neutral-100">
        <div className="h-full w-1/3 animate-[compact-indeterminate_1.4s_ease-in-out_infinite]" style={{ backgroundColor: SEM.info }} />
      </div>
      <style>{'@keyframes compact-indeterminate{0%{transform:translateX(-100%)}100%{transform:translateX(400%)}}'}</style>
    </div>
  )
}

function StylePreview(data: StylePreviewData) {
  const done = data.candidates.filter((c) => c.status === 'done').length
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <LeadIcon tone="info" name="sparkles" />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-neutral-800">{data.title}</span>
        <span className="text-[11px] text-neutral-400">{done}/{data.candidates.length}</span>
      </div>
      <div className="mt-2 flex gap-1.5">
        {data.candidates.map((c) => (
          <div key={c.id} className="min-w-0 flex-1">
            <div className={`relative h-12 w-full overflow-hidden rounded-md ${c.selected ? 'ring-2 ring-blue-500' : ''}`} style={{ background: c.swatch }}>
              {c.status === 'generating' ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/25 text-[10px] font-semibold text-white">{c.progress}%</div>
              ) : null}
              {c.status === 'failed' ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/35">
                  <AppIcon name="alert" className="h-3.5 w-3.5 text-white" />
                </div>
              ) : null}
            </div>
            <div className="truncate pt-0.5 text-[10px] font-medium text-neutral-500">{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function BatchTask(data: BatchTaskData) {
  return (
    <div className={ROW}>
      <LeadIcon tone="info" name="package" />
      <span className="shrink-0 text-[12px] font-medium text-neutral-700">{data.title}</span>
      <span className="shrink-0 text-[11px] text-neutral-400">共 {data.total} 个</span>
      <span className="ml-auto truncate font-mono text-[11px] text-neutral-300">{data.taskIds.slice(0, 2).join('  ')} …</span>
    </div>
  )
}

function ProjectContext(data: ProjectContextData) {
  return (
    <div className={ROW}>
      <LeadIcon tone="neutral" name="folder" />
      <span className="shrink-0 text-[12px] font-medium text-neutral-700">{data.projectName}</span>
      <span className="shrink-0 text-[11px] text-neutral-400">{data.episodeName}</span>
      <span className="ml-auto shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-500">{data.status}</span>
    </div>
  )
}

export const designCompact: CardKit = {
  id: 'compact',
  label: 'Compact 紧凑',
  blurb: '单行密排 · 列表式 · 省空间',
  swatch: '#0f172a',
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
