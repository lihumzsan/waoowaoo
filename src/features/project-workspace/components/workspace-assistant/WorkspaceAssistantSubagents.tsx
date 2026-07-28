'use client'

// Primary 对话中的 Subagent 入口:顶部标签栏与消息内锚点记录。
// 按 AR-04,锚点只显示状态、产物名称、Subagent 标识与详情入口;
// 推理摘要、工具轨迹、终态摘要与完整结果只属于 WorkspaceAssistantSubagentDetail。

import { useMessage } from '@assistant-ui/react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { ProjectAgentSubagentView } from '@/lib/project-agent/subagent-events'
import {
  localizeOutputKind,
  localizeStatus,
  StatusGlyph,
  type AssistantAgentTranslator,
} from './WorkspaceAssistantSubagentShared'

function readRunIdsFromMessageParts(parts: readonly unknown[]): ReadonlySet<string> {
  const runIds = new Set<string>()
  for (const part of parts) {
    if (!part || typeof part !== 'object' || Array.isArray(part)) continue
    const record = part as { type?: unknown; name?: unknown; data?: unknown }
    if (record.type !== 'data' || record.name !== 'agent-run' || !record.data || typeof record.data !== 'object' || Array.isArray(record.data)) continue
    const data = record.data as { runId?: unknown }
    if (typeof data.runId !== 'string' || !data.runId.trim()) continue
    runIds.add(data.runId.trim())
  }
  return runIds
}

function tabClassName(active: boolean): string {
  return `flex min-w-0 max-w-[220px] items-center rounded-t-xl border text-sm font-medium transition-colors ${active
    ? 'border-[var(--glass-stroke-base)] border-b-white bg-white text-[var(--glass-text-primary)]'
    : 'border-transparent bg-transparent text-[var(--glass-text-tertiary)] hover:bg-white/70 hover:text-[var(--glass-text-secondary)]'}`
}

export function WorkspaceAssistantSubagentTabs(props: {
  subagents: readonly ProjectAgentSubagentView[]
  selectedSubagentId: string | null
  onSelect: (subagentId: string | null) => void
  onDismiss: (subagentId: string) => void
  /** 主对话有待用户处理的 Choice/Approval,且当前不在 Primary 视图时点亮提示点 */
  primaryNeedsAttention?: boolean
}) {
  const t = useTranslations('assistantAgent')
  if (props.subagents.length === 0) return null
  const showAttention = props.primaryNeedsAttention === true && props.selectedSubagentId !== null

  return (
    <section className="shrink-0 border-b border-[var(--glass-stroke-base)] bg-white/72 px-4 pr-14 pt-3 backdrop-blur-xl">
      <div role="tablist" aria-label={t('subagents.tabsLabel')} className="flex min-w-0 items-end gap-1 overflow-x-auto">
        <button
          type="button"
          role="tab"
          aria-selected={props.selectedSubagentId === null}
          onClick={() => props.onSelect(null)}
          className={`${tabClassName(props.selectedSubagentId === null)} gap-2 px-3 py-2`}
        >
          <span className="min-w-0 truncate">{t('subagents.primary')}</span>
          {showAttention ? (
            <span
              role="status"
              aria-label={t('subagents.primaryAttention')}
              title={t('subagents.primaryAttention')}
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-900"
            />
          ) : null}
        </button>
        {props.subagents.map((subagent) => {
          const active = subagent.subagentId === props.selectedSubagentId
          return (
            <div key={subagent.subagentId} role="presentation" className={tabClassName(active)}>
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => props.onSelect(subagent.subagentId)}
                className="flex min-w-0 items-center gap-2 py-2 pl-3 text-left"
              >
                <StatusGlyph status={subagent.status} />
                <span className="min-w-0 truncate">{localizeOutputKind(subagent.outputKind, t)}</span>
              </button>
              {subagent.status !== 'running' ? (
                <button
                  type="button"
                  aria-label={t('subagents.close', { title: localizeOutputKind(subagent.outputKind, t) })}
                  onClick={() => props.onDismiss(subagent.subagentId)}
                  className="ml-1 mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--glass-text-tertiary)] hover:bg-neutral-100 hover:text-[var(--glass-text-primary)]"
                >
                  <AppIcon name="close" className="h-3 w-3" aria-hidden="true" />
                </button>
              ) : <span className="w-2" aria-hidden="true" />}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function SubagentRecordButton(props: {
  subagent: ProjectAgentSubagentView
  onSelect: (subagentId: string) => void
  t: AssistantAgentTranslator
}) {
  const subagent = props.subagent
  const running = subagent.status === 'running'
  return (
    <button
      type="button"
      onClick={() => props.onSelect(subagent.subagentId)}
      className={`relative flex w-full items-start gap-2 overflow-hidden rounded-xl border bg-white/88 px-3 py-2.5 text-left text-sm leading-5 transition-colors hover:bg-white ${running ? 'assistant-run-sweep border-[var(--glass-text-tertiary)]' : 'border-[var(--glass-stroke-base)]'}`}
    >
      <span className="mt-0.5 shrink-0"><StatusGlyph status={subagent.status} /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 truncate font-medium text-[var(--glass-text-primary)]">
            {localizeOutputKind(subagent.outputKind, props.t)}
          </span>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${running
              ? 'bg-neutral-900 text-white'
              : 'bg-neutral-950/[0.04] text-[var(--glass-text-tertiary)]'}`}
          >
            {localizeStatus(subagent.status, props.t)}
          </span>
          <span className="ml-auto shrink-0 text-xs text-[var(--glass-text-tertiary)]">
            {props.t('subagents.steps', { count: subagent.events.length })}
          </span>
          <AppIcon name="chevronUp" className="h-3.5 w-3.5 shrink-0 rotate-90 text-[var(--glass-text-tertiary)]" aria-hidden="true" />
        </span>
        <span className="mt-1 block truncate text-xs leading-5 text-[var(--glass-text-tertiary)]">
          {subagent.goal}
        </span>
      </span>
    </button>
  )
}

export function WorkspaceAssistantSubagentRecords(props: {
  subagents: readonly ProjectAgentSubagentView[]
  onSelect: (subagentId: string) => void
}) {
  const t = useTranslations('assistantAgent')
  const [open, setOpen] = useState(false)
  const count = props.subagents.length
  if (count === 0) return null

  // 单个直接展示;多个先折叠成一行汇总,点击才展开,避免同一条消息下并行 Subagent 刷屏。
  if (count === 1) {
    return (
      <div className="space-y-2">
        <SubagentRecordButton subagent={props.subagents[0]} onSelect={props.onSelect} t={t} />
      </div>
    )
  }

  const running = props.subagents.some((subagent) => subagent.status === 'running')
  return (
    <div className="space-y-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`relative flex w-full items-center gap-2 overflow-hidden rounded-xl border bg-white/88 px-3 py-2.5 text-left text-sm leading-5 transition-colors hover:bg-white ${running ? 'assistant-run-sweep border-[var(--glass-text-tertiary)]' : 'border-[var(--glass-stroke-base)]'}`}
      >
        {running
          ? <AppIcon name="loader" className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
          : <StatusGlyph status="completed" />}
        <span className="min-w-0 flex-1 truncate font-medium text-[var(--glass-text-primary)]">
          {t('subagents.groupCollapsed', { count })}
        </span>
        <span className="shrink-0 text-xs text-[var(--glass-text-tertiary)]">
          {open ? t('subagents.groupCollapse') : t('subagents.groupExpand')}
        </span>
        <AppIcon
          name="chevronDown"
          className={`h-3.5 w-3.5 shrink-0 text-[var(--glass-text-tertiary)] transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div className="space-y-2 pl-3">
          {props.subagents.map((subagent) => (
            <SubagentRecordButton
              key={subagent.subagentId}
              subagent={subagent}
              onSelect={props.onSelect}
              t={t}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

// 运行中的 Subagent 常驻面板底部,折叠成一行;终态后由锚点接管,回到发起它的消息下面。
// 归属仍然只由 runId 锚定决定,这里只是"正在跑什么"的临时状态窗口,不解释归属或生命周期。
export function WorkspaceAssistantRunningSubagentDock(props: {
  subagents: readonly ProjectAgentSubagentView[]
  onSelect: (subagentId: string) => void
}) {
  const t = useTranslations('assistantAgent')
  const [open, setOpen] = useState(false)
  const running = props.subagents.filter((subagent) => subagent.status === 'running')
  const count = running.length

  useEffect(() => {
    if (count === 0) setOpen(false)
  }, [count])

  if (count === 0) return null

  return (
    <div className="mb-2">
      {open ? (
        <div className="mb-2 max-h-[42vh] space-y-2 overflow-y-auto">
          {running.map((subagent) => (
            <SubagentRecordButton
              key={subagent.subagentId}
              subagent={subagent}
              onSelect={props.onSelect}
              t={t}
            />
          ))}
        </div>
      ) : null}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="assistant-run-sweep relative flex w-full items-center gap-2 overflow-hidden rounded-xl border border-[var(--glass-text-tertiary)] bg-white/92 px-3 py-2.5 text-left text-sm leading-5 shadow-sm backdrop-blur-xl transition-colors hover:bg-white"
      >
        <AppIcon name="loader" className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-medium text-[var(--glass-text-primary)]">
          {t('subagents.dockRunning', { count })}
        </span>
        <span className="shrink-0 text-xs text-[var(--glass-text-tertiary)]">
          {open ? t('subagents.groupCollapse') : t('subagents.groupExpand')}
        </span>
        <AppIcon
          name="chevronDown"
          className={`h-3.5 w-3.5 shrink-0 text-[var(--glass-text-tertiary)] transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
    </div>
  )
}

export function WorkspaceAssistantSubagentRecordsForMessage(props: {
  subagents: readonly ProjectAgentSubagentView[]
  onSelect: (subagentId: string) => void
}) {
  const parts = useMessage((state) => state.content)
  const messageRunIds = readRunIdsFromMessageParts(parts)
  // 运行中的实例交给底部常驻坞展示,终态后才在这里归位;归属判定始终只用 runId。
  const anchoredSubagents = props.subagents.filter((subagent) => (
    subagent.status !== 'running' && messageRunIds.has(subagent.runId)
  ))
  return (
    <WorkspaceAssistantSubagentRecords
      subagents={anchoredSubagents}
      onSelect={props.onSelect}
    />
  )
}
