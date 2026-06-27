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
import { ratioBox, SEM, SEM_SOFT, STATUS_TONE } from './shared'

/**
 * DesignTag — 「标签」方案。
 * 无卡片外壳,完全扁平。每段内容以一个语义色小标签引导(类似文档批注),
 * 信息层级靠标签 + 缩进表达。极度轻量、扫读性强。
 */

const PRIMARY =
  'inline-flex items-center justify-center gap-1.5 rounded-md bg-neutral-900 px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-neutral-700'
const GHOST =
  'inline-flex items-center justify-center rounded-md px-4 py-2 text-[13px] font-medium text-neutral-500 transition-colors hover:bg-neutral-100'

function Tag({ tone, children }: { tone: CardTone; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]"
      style={{ backgroundColor: SEM_SOFT[tone], color: SEM[tone] }}
    >
      {children}
    </span>
  )
}

/** 标签引导 + 左缩进的内容块。 */
function Block({ tone, tag, children }: { tone: CardTone; tag: string; children: React.ReactNode }) {
  return (
    <div className="border-l-2 pl-3" style={{ borderColor: SEM_SOFT[tone] }}>
      <Tag tone={tone}>{tag}</Tag>
      <div className="mt-1.5">{children}</div>
    </div>
  )
}

const STATUS_TAG: Record<ToolCallData['status'], string> = {
  running: '执行中',
  success: '完成',
  failed: '失败',
  'needs-action': '待操作',
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
    <Block tone="neutral" tag="思考">
      <div className="text-xs leading-5 text-neutral-400">{text}</div>
    </Block>
  )
}

function Thinking() {
  return (
    <div className="flex items-center gap-2 text-xs text-neutral-400">
      <Tag tone="info">生成中</Tag>
      <span className="flex gap-1">
        <span className="h-1 w-1 animate-pulse rounded-full bg-neutral-400" />
        <span className="h-1 w-1 animate-pulse rounded-full bg-neutral-400 [animation-delay:150ms]" />
        <span className="h-1 w-1 animate-pulse rounded-full bg-neutral-400 [animation-delay:300ms]" />
      </span>
    </div>
  )
}

function CodeBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-300">{label}</div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-neutral-50 p-2.5 font-mono text-[11px] leading-5 text-neutral-500">
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
    <Block tone={tone} tag={`工具 · ${STATUS_TAG[data.status]}`}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-left">
        <AppIcon name={icon} className={`h-3.5 w-3.5 shrink-0 text-neutral-400 ${data.status === 'running' ? 'animate-spin' : ''}`} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-neutral-800">{data.title}</span>
        <AppIcon name="chevronDown" className={`h-3.5 w-3.5 shrink-0 text-neutral-300 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          {data.error ? <div className="text-xs leading-5 text-rose-600">{data.error}</div> : null}
          <CodeBlock label="参数" value={data.args} />
          {data.result ? <CodeBlock label="结果" value={data.result} /> : null}
        </div>
      ) : null}
    </Block>
  )
}

function Approval(data: ApprovalData) {
  const [note, setNote] = useState('')
  return (
    <Block tone="warn" tag="审批 · 需确认">
      <div className="text-[13px] font-semibold text-neutral-900">{data.title}</div>
      <div className="mt-1 text-xs leading-5 text-neutral-500">{data.summary}</div>
      {data.reasons.length > 0 ? (
        <ul className="mt-2 space-y-1">
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
        className="mt-2 min-h-[56px] w-full resize-none rounded-md bg-neutral-50 px-3 py-2 text-sm text-neutral-700 outline-none ring-1 ring-transparent transition focus:ring-neutral-300"
      />
      <div className="mt-2 flex gap-2">
        <button type="button" className={`flex-1 ${PRIMARY}`}>批准</button>
        <button type="button" className={`flex-1 ${GHOST}`}>拒绝</button>
      </div>
    </Block>
  )
}

function Confirm(data: ConfirmData) {
  return (
    <Block tone="info" tag="确认">
      <div className="text-[13px] font-semibold text-neutral-900">{data.title}</div>
      <div className="mt-1 text-xs leading-5 text-neutral-500">{data.subtitle}</div>
      <div className="mt-2 flex gap-2">
        <button type="button" className={`flex-1 ${PRIMARY}`}>继续</button>
        <button type="button" className={`flex-1 ${GHOST}`}>取消</button>
      </div>
    </Block>
  )
}

function Choice(data: ChoiceData) {
  const [selected, setSelected] = useState(data.options[0]?.value ?? '')
  return (
    <Block tone="info" tag={`选择 · ${data.step}`}>
      <div className="text-[13px] font-semibold text-neutral-900">{data.title}</div>
      <div className="mt-0.5 text-xs text-neutral-400">{data.description}</div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {data.options.map((option) => {
          const isSelected = selected === option.value
          const dims = ratioBox(option.ratio ?? '1:1', 30)
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setSelected(option.value)}
              className={`flex flex-col items-center gap-1.5 rounded-md px-2 py-2.5 transition-colors ${isSelected ? 'bg-blue-50' : 'hover:bg-neutral-50'}`}
            >
              <span className="flex h-8 w-12 items-center justify-center">
                <span
                  className={`rounded-sm ${isSelected ? 'bg-blue-500' : 'bg-neutral-300'}`}
                  style={{ width: `${String(dims.width)}px`, height: `${String(dims.height)}px` }}
                />
              </span>
              <span className={`text-[13px] font-semibold ${isSelected ? 'text-blue-600' : 'text-neutral-500'}`}>{option.label}</span>
            </button>
          )
        })}
      </div>
      <button type="button" className={`mt-2 w-full ${PRIMARY}`}>{data.submitLabel}</button>
    </Block>
  )
}

function TaskSubmitted(data: TaskData) {
  return (
    <Block tone="info" tag="任务">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium text-neutral-700">{data.title}</span>
        <span className="font-mono text-neutral-400">{data.taskId}</span>
        <span className="ml-auto tabular-nums text-neutral-400">{data.progress}%</span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-neutral-100">
        <div className="h-full rounded-full bg-blue-500" style={{ width: `${String(data.progress)}%` }} />
      </div>
    </Block>
  )
}

function ProjectPhase(data: PhaseData) {
  return (
    <Block tone="success" tag="进度">
      <div className="flex items-center gap-3 text-xs text-neutral-400">
        <span><span className="font-semibold text-neutral-800">{data.clips}</span> 片段</span>
        <span><span className="font-semibold text-neutral-800">{data.screenplays}</span> 剧本</span>
        <span><span className="font-semibold text-neutral-800">{data.storyboards}</span> 分镜</span>
      </div>
    </Block>
  )
}

function AgentStop(data: StopData) {
  return (
    <Block tone="neutral" tag="停止">
      <div className="text-xs text-neutral-500">
        <span className="font-medium text-neutral-600">{data.title}</span> — {data.detail}
      </div>
    </Block>
  )
}

function ActiveRun(data: ActiveRunData) {
  return (
    <Block tone="info" tag="进行中">
      <div className="flex items-center gap-2">
        <AppIcon name="loader" className="h-3.5 w-3.5 shrink-0 animate-spin" style={{ color: SEM.info }} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-neutral-800">{data.title}</span>
      </div>
      <div className="mt-1 text-xs leading-5 text-neutral-400">{data.detail}</div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-neutral-100">
        <div className="h-full w-1/3 animate-[tag-indeterminate_1.5s_ease-in-out_infinite] rounded-full" style={{ backgroundColor: SEM.info }} />
      </div>
      <style>{'@keyframes tag-indeterminate{0%{transform:translateX(-110%)}100%{transform:translateX(420%)}}'}</style>
    </Block>
  )
}

function StylePreview(data: StylePreviewData) {
  const done = data.candidates.filter((c) => c.status === 'done').length
  return (
    <Block tone="info" tag={`风格预览 · ${done}/${data.candidates.length}`}>
      <div className="text-[13px] font-semibold text-neutral-900">{data.title}</div>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {data.candidates.map((c) => (
          <div key={c.id} className="overflow-hidden rounded-md">
            <div className={`relative aspect-square w-full ${c.selected ? 'ring-2 ring-blue-500' : ''}`} style={{ background: c.swatch }}>
              {c.status === 'generating' ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/25 text-[10px] font-semibold text-white">{c.progress}%</div>
              ) : null}
              {c.status === 'failed' ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/35">
                  <AppIcon name="alert" className="h-3.5 w-3.5 text-white" />
                </div>
              ) : null}
            </div>
            <div className="truncate pt-1 text-[10px] font-medium text-neutral-500">{c.label}</div>
          </div>
        ))}
      </div>
    </Block>
  )
}

function BatchTask(data: BatchTaskData) {
  return (
    <Block tone="info" tag="批量任务">
      <div className="flex items-center gap-2 text-xs text-neutral-400">
        <span className="font-medium text-neutral-700">{data.title}</span>
        <span>共 {data.total} 个</span>
        <span className="font-mono text-neutral-300">{data.taskIds.slice(0, 3).join('  ')} …</span>
      </div>
    </Block>
  )
}

function ProjectContext(data: ProjectContextData) {
  return (
    <Block tone="neutral" tag="项目上下文">
      <div className="flex items-center gap-2 text-xs text-neutral-400">
        <span className="font-medium text-neutral-700">{data.projectName}</span>
        <span>·</span>
        <span>{data.episodeName}</span>
        <span className="ml-auto text-neutral-400">{data.status}</span>
      </div>
    </Block>
  )
}

export const designTag: CardKit = {
  id: 'tag',
  label: 'Tag 标签',
  blurb: '标签引导 · 扁平无壳 · 扫读性强',
  swatch: '#2563eb',
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
