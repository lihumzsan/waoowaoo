'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { MarkdownTextPart } from './MarkdownTextPart'
import type {
  WorkspaceAssistantSubagentActivityView,
  WorkspaceAssistantSubagentView,
} from './workspace-assistant-run-trace'

/**
 * Subagent collaboration surface.
 *
 * The tab strip is the single renderer of child-agent lifecycle: the tool-call
 * trace deliberately hides the native subagent tool rows so one place decides
 * what a child agent is doing. A child that reaches a terminal state closes its
 * own tab, because its result already belongs to the main thread.
 *
 * A subagent tab is read-only by construction — the composer is not rendered
 * there at all. The Agent owns delegation; the user steers the main thread.
 */

const ACTIVE_TAB_MAIN = 'main'

export function useWorkspaceAssistantSubagentTab(
  agents: readonly WorkspaceAssistantSubagentView[],
): {
  readonly activeAgent: WorkspaceAssistantSubagentView | null
  readonly activeThreadId: string
  readonly selectThread: (threadId: string) => void
} {
  const [selectedThreadId, setSelectedThreadId] = useState(ACTIVE_TAB_MAIN)
  // A closed tab must never leave the panel stranded on a surface that no
  // longer exists, so the main thread is the deterministic fallback.
  const activeAgent = agents.find((agent) => agent.agentThreadId === selectedThreadId) ?? null
  return {
    activeAgent,
    activeThreadId: activeAgent?.agentThreadId ?? ACTIVE_TAB_MAIN,
    selectThread: setSelectedThreadId,
  }
}

export function WorkspaceAssistantSubagentTabStrip({
  agents,
  activeThreadId,
  onSelectThread,
}: {
  readonly agents: readonly WorkspaceAssistantSubagentView[]
  readonly activeThreadId: string
  readonly onSelectThread: (threadId: string) => void
}) {
  const t = useTranslations('assistantAgent')
  if (agents.length === 0) return null

  const tabClassName = (selected: boolean): string => [
    'flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-all duration-200',
    selected
      ? 'bg-white/90 text-[var(--glass-text-primary)] shadow-[0_2px_8px_rgba(15,23,42,0.07)] ring-1 ring-black/[0.04]'
      : 'text-[var(--glass-text-tertiary)] hover:bg-white/55',
  ].join(' ')

  return (
    <div
      className="flex shrink-0 items-center gap-1 overflow-x-auto px-4 pb-1 pt-2.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="tablist"
      aria-label={t('subagentTabs.label')}
    >
      <button
        type="button"
        role="tab"
        aria-selected={activeThreadId === ACTIVE_TAB_MAIN}
        onClick={() => onSelectThread(ACTIVE_TAB_MAIN)}
        className={tabClassName(activeThreadId === ACTIVE_TAB_MAIN)}
      >
        <AppIcon name="sparkles" className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="max-w-[96px] truncate">{t('subagentTabs.mainThread')}</span>
      </button>
      {agents.map((agent) => (
        <button
          key={agent.agentThreadId}
          type="button"
          role="tab"
          aria-selected={activeThreadId === agent.agentThreadId}
          title={agent.agentPath}
          onClick={() => onSelectThread(agent.agentThreadId)}
          className={tabClassName(activeThreadId === agent.agentThreadId)}
        >
          <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
            <span className="absolute inset-0 animate-ping rounded-full bg-[var(--glass-tone-info-fg)] opacity-60" />
            <span className="relative h-1.5 w-1.5 rounded-full bg-[var(--glass-tone-info-fg)]" />
          </span>
          <span className="max-w-[104px] truncate">{subagentTabLabel(agent.agentPath)}</span>
        </button>
      ))}
    </div>
  )
}

function subagentTabLabel(agentPath: string): string {
  const segments = agentPath.split('/').filter(Boolean)
  return segments[segments.length - 1] ?? agentPath
}

function SubagentReasoning({ text }: { readonly text: string }) {
  const t = useTranslations('assistantAgent')
  const [open, setOpen] = useState(false)
  return (
    <section className="text-sm text-[var(--glass-text-tertiary)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-2 py-0.5 text-left"
      >
        <span className="text-xs font-medium">{t('reasoning.completed')}</span>
        <AppIcon
          name="chevronDown"
          className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <div className="mt-1 whitespace-pre-wrap pl-3 leading-6 text-[var(--glass-text-secondary)]">{text}</div>
      ) : null}
    </section>
  )
}

function SubagentActivity({ activity }: { readonly activity: WorkspaceAssistantSubagentActivityView }) {
  const t = useTranslations('assistantAgent')
  const running = activity.status === 'running'

  if (activity.kind === 'tool') {
    const label = activity.label ?? t('runtime.native.subagentActivity.tool')
    return (
      <div className={`flex items-center gap-2 text-sm leading-5 ${activity.status === 'failed' ? 'text-[var(--glass-tone-warning-fg)]' : 'text-[var(--glass-text-tertiary)]'}`}>
        <AppIcon name={activity.status === 'failed' ? 'alert' : 'settingsHex'} className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate">
          <span className={running ? 'assistant-shimmer-text' : ''}>
            {running ? t('toolCall.running') : activity.status === 'failed' ? t('toolCall.failed') : t('toolCall.success')}
          </span>
          {` · ${label}`}
        </span>
      </div>
    )
  }

  const text = activity.text ?? ''
  if (!text.trim()) return null
  if (activity.kind === 'reasoning') {
    return running ? (
      <section className="text-sm text-[var(--glass-text-tertiary)]">
        <div className="flex items-center gap-2 py-0.5">
          <AppIcon name="loader" className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
          <span className="assistant-shimmer-text text-xs font-medium">{t('reasoning.running')}</span>
        </div>
        <div className="mt-1 whitespace-pre-wrap pl-3 leading-6 text-[var(--glass-text-secondary)]">{text}</div>
      </section>
    ) : (
      <SubagentReasoning text={text} />
    )
  }

  return (
    <div className="min-w-0 text-base leading-6 text-[var(--glass-text-primary)]">
      <MarkdownTextPart text={text} status={{ type: running ? 'running' : 'complete' }} />
    </div>
  )
}

/**
 * A child agent renders through the same activity vocabulary the main thread
 * uses (reasoning / message / tool), so opening its tab shows the same live
 * shape the user already understands rather than a second trace format.
 */
export function WorkspaceAssistantSubagentStream({
  agent,
}: {
  readonly agent: WorkspaceAssistantSubagentView
}) {
  const t = useTranslations('assistantAgent')
  return (
    <div className="min-w-0 space-y-3 px-1 py-1">
      <div className="flex items-center gap-2 text-[11px] leading-4 text-[var(--glass-text-tertiary)]">
        <AppIcon name="folder" className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate font-mono">{agent.agentPath}</span>
        <span className="ml-auto shrink-0">{t(`runtime.native.subagentStatus.${agent.status}`)}</span>
      </div>
      {agent.activities.length === 0 ? (
        <p className="text-sm leading-5 text-[var(--glass-text-tertiary)]">{t('subagentTabs.empty')}</p>
      ) : (
        agent.activities.map((activity) => (
          <SubagentActivity key={activity.id} activity={activity} />
        ))
      )}
    </div>
  )
}

export function WorkspaceAssistantSubagentReadOnlyNotice({
  agentPath,
  onBackToMain,
}: {
  readonly agentPath: string
  readonly onBackToMain: () => void
}) {
  const t = useTranslations('assistantAgent')
  return (
    <div className="flex items-center gap-2 rounded-full border border-[rgba(15,17,23,0.08)] bg-white/70 px-4 py-2.5 backdrop-blur-[20px]">
      <AppIcon name="eye" className="h-3.5 w-3.5 shrink-0 text-[var(--glass-text-tertiary)]" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-xs text-[var(--glass-text-tertiary)]">
        {t('subagentTabs.readOnly', { path: agentPath })}
      </span>
      <button
        type="button"
        onClick={onBackToMain}
        className="shrink-0 rounded-full bg-[var(--glass-text-primary)] px-3 py-1 text-[11px] font-medium text-white"
      >
        {t('subagentTabs.backToMain')}
      </button>
    </div>
  )
}
