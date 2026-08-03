'use client'

import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { getToolName, isToolUIPart, type UIMessage } from 'ai'
import { useLocale, useTranslations } from 'next-intl'
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { AppIcon } from '@/components/ui/icons'
import { localizeProjectAgentOperationTitle } from '@/lib/project-agent/copy'
import { normalizeProjectAgentLocale } from '@/lib/project-agent/locale'
import type { AssistantRuntimeSessionTurnView } from '@/lib/assistant-runtime/view-contract'
import { useWorkspaceAssistantRunningSurface } from './WorkspaceAssistantReasoning'
import {
  isWorkspaceAssistantRuntimeInterruptedToolPart,
  resolveWorkspaceAssistantRepeatedToolCallGroups,
  resolveWorkspaceAssistantSubagentLifecycleViews,
  resolveWorkspaceAssistantToolCallDisplayState,
  resolveWorkspaceAssistantToolCallGroupView,
  type WorkspaceAssistantSubagentLifecycleView,
  type WorkspaceAssistantRepeatedToolCallGroup,
  type WorkspaceAssistantToolCallDisplayState,
  type WorkspaceAssistantToolCallGroupView,
} from './workspace-assistant-run-trace'

type RepeatedToolCallEntry = {
  readonly group: WorkspaceAssistantRepeatedToolCallGroup
  readonly view: WorkspaceAssistantToolCallGroupView
}
type WorkspaceAssistantToolCallContextValue = {
  readonly repeatedByToolCallId: ReadonlyMap<string, RepeatedToolCallEntry>
  readonly subagentsByToolCallId: ReadonlyMap<string, WorkspaceAssistantSubagentLifecycleView>
  readonly interruptedToolCallIds: ReadonlySet<string>
}
const EMPTY_TOOL_CALL_CONTEXT: WorkspaceAssistantToolCallContextValue = {
  repeatedByToolCallId: new Map(),
  subagentsByToolCallId: new Map(),
  interruptedToolCallIds: new Set(),
}
const WorkspaceAssistantToolCallContext = createContext<WorkspaceAssistantToolCallContextValue>(EMPTY_TOOL_CALL_CONTEXT)
const NATIVE_SUBAGENT_TOOL_NAMES = new Set([
  'spawnAgent',
  'spawn_agent',
  'sendInput',
  'send_message',
  'resumeAgent',
  'followup_task',
  'wait',
  'wait_agent',
  'closeAgent',
  'interrupt_agent',
  'list_agents',
  'subagent_activity',
])

type AssistantAgentTranslator = ReturnType<typeof useTranslations<'assistantAgent'>>

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function resolveNativeToolTitle(toolName: string, t: AssistantAgentTranslator): string | null {
  if (NATIVE_SUBAGENT_TOOL_NAMES.has(toolName)) {
    switch (toolName) {
      case 'spawnAgent': return t('runtime.native.subagentAction.spawnAgent')
      case 'spawn_agent': return t('runtime.native.subagentAction.spawnAgent')
      case 'sendInput': return t('runtime.native.subagentAction.sendInput')
      case 'send_message': return t('runtime.native.subagentAction.sendInput')
      case 'resumeAgent': return t('runtime.native.subagentAction.resumeAgent')
      case 'followup_task': return t('runtime.native.subagentAction.resumeAgent')
      case 'wait': return t('runtime.native.subagentAction.wait')
      case 'wait_agent': return t('runtime.native.subagentAction.wait')
      case 'closeAgent': return t('runtime.native.subagentAction.closeAgent')
      case 'interrupt_agent': return t('runtime.native.subagentAction.interruptAgent')
      case 'list_agents': return t('runtime.native.subagentAction.listAgents')
      case 'subagent_activity': return t('runtime.native.subagentAction.activity')
    }
  }
  switch (toolName) {
    case 'shell': return t('runtime.native.shell')
    case 'file_change': return t('runtime.native.fileChange')
    case 'web_search': return t('runtime.native.webSearch')
    case 'view_image': return t('runtime.native.viewImage')
    default: return toolName.includes('.') ? toolName : null
  }
}

function resolveSubagentSummary(
  args: unknown,
  result: unknown,
  t: AssistantAgentTranslator,
): string | null {
  const output = isRecord(result) ? result : null
  const input = isRecord(args) ? args : null
  const states = isRecord(output?.agentsStates)
    ? output.agentsStates
    : isRecord(input?.agentsStates)
      ? input.agentsStates
      : null
  if (!states) return null
  let active = 0
  let completed = 0
  let failed = 0
  for (const value of Object.values(states)) {
    const status = isRecord(value) ? readText(value.status) : null
    if (status === 'pendingInit' || status === 'running') active += 1
    else if (status === 'completed' || status === 'shutdown') completed += 1
    else if (status === 'interrupted' || status === 'errored' || status === 'notFound') failed += 1
  }
  return t('runtime.native.subagentSummary', { active, completed, interrupted: failed })
}

function localizeSubagentLifecycle(
  lifecycle: WorkspaceAssistantSubagentLifecycleView,
  t: AssistantAgentTranslator,
): string {
  return t('runtime.native.subagentSummary', {
    active: lifecycle.active,
    completed: lifecycle.completed,
    interrupted: lifecycle.interrupted,
  })
}

function resolveWebSearchSummary(
  args: unknown,
  result: unknown,
  t: AssistantAgentTranslator,
): string {
  const input = isRecord(args) ? args : null
  const output = isRecord(result) ? result : null
  const action = isRecord(output?.action)
    ? output.action
    : isRecord(input?.action)
      ? input.action
      : null
  const type = readText(action?.type)
  if (type === 'search') {
    const query = readText(action?.query)
      ?? (Array.isArray(action?.queries)
        ? action.queries.flatMap((value) => readText(value) ?? []).join(', ')
        : null)
      ?? readText(input?.query)
      ?? '…'
    return t('runtime.native.web.search', { query })
  }
  if (type === 'openPage') {
    return t('runtime.native.web.openPage', { value: readText(action?.url) ?? '…' })
  }
  if (type === 'findInPage') {
    return t('runtime.native.web.findInPage', { value: readText(action?.pattern) ?? '…' })
  }
  return t('runtime.native.web.other')
}

function resolveNativeDetail(toolName: string, args: unknown): string | null {
  if (!isRecord(args)) return null
  if (NATIVE_SUBAGENT_TOOL_NAMES.has(toolName)) {
    return readText(args.prompt)
      ?? readText(args.message)
      ?? readText(args.agentPath)
      ?? readText(args.target)
  }
  if (toolName === 'shell') return readText(args.command)
  return null
}

export function WorkspaceAssistantRepeatedToolCallGroupProvider({
  children,
  messages = [],
  turns = [],
}: {
  readonly children: ReactNode
  readonly messages: readonly UIMessage[]
  readonly turns: readonly AssistantRuntimeSessionTurnView[]
}) {
  const value = useMemo((): WorkspaceAssistantToolCallContextValue => {
    const repeatedByToolCallId = new Map<string, RepeatedToolCallEntry>()
    for (const group of resolveWorkspaceAssistantRepeatedToolCallGroups(messages)) {
      const entry = {
        group,
        view: resolveWorkspaceAssistantToolCallGroupView(messages, group),
      }
      for (const toolCallId of group.toolCallIds) repeatedByToolCallId.set(toolCallId, entry)
    }
    const statusByAssistantMessageId = new Map(turns.flatMap((turn) => (
      turn.assistantMessageId ? [[turn.assistantMessageId, turn.status] as const] : []
    )))
    const lifecycleByMessageId = resolveWorkspaceAssistantSubagentLifecycleViews(
      messages,
      statusByAssistantMessageId,
    )
    const subagentsByToolCallId = new Map<string, WorkspaceAssistantSubagentLifecycleView>()
    const interruptedToolCallIds = new Set<string>()
    for (const message of messages) {
      for (const part of message.parts) {
        if (isToolUIPart(part) && isWorkspaceAssistantRuntimeInterruptedToolPart(part)) {
          interruptedToolCallIds.add(part.toolCallId)
        }
      }
      const lifecycle = lifecycleByMessageId.get(message.id)
      if (!lifecycle) continue
      for (const part of message.parts) {
        if (!isToolUIPart(part) || !NATIVE_SUBAGENT_TOOL_NAMES.has(getToolName(part))) continue
        subagentsByToolCallId.set(part.toolCallId, lifecycle)
      }
    }
    return { repeatedByToolCallId, subagentsByToolCallId, interruptedToolCallIds }
  }, [messages, turns])
  return (
    <WorkspaceAssistantToolCallContext.Provider value={value}>
      {children}
    </WorkspaceAssistantToolCallContext.Provider>
  )
}

function resolveGroupDisplayState(
  group: WorkspaceAssistantToolCallGroupView,
): WorkspaceAssistantToolCallDisplayState | 'partial' {
  const populated = ([
    'success',
    'submitted',
    'failed',
    'interrupted',
    'running',
    'needsAction',
  ] as const).filter((state) => group[state] > 0)
  if (populated.length === 1) return populated[0]
  if (group.running > 0) return 'running'
  if (group.needsAction > 0) return 'needsAction'
  return 'partial'
}

function translateDisplayState(
  state: WorkspaceAssistantToolCallDisplayState | 'partial',
  t: ReturnType<typeof useTranslations<'assistantAgent'>>,
): string {
  switch (state) {
    case 'success':
      return t('toolCall.success')
    case 'submitted':
      return t('toolCall.submitted')
    case 'failed':
      return t('toolCall.failed')
    case 'interrupted':
      return t('toolCall.interrupted')
    case 'running':
      return t('toolCall.running')
    case 'needsAction':
      return t('toolCall.needsAction')
    case 'partial':
      return t('toolCall.partial')
  }
}

export function WorkspaceAssistantToolCallCard(props: ToolCallMessagePartProps) {
  const t = useTranslations('assistantAgent')
  const locale = normalizeProjectAgentLocale(useLocale())
  const [expanded, setExpanded] = useState(false)
  const context = useContext(WorkspaceAssistantToolCallContext)
  const repeatedEntry = context.repeatedByToolCallId.get(props.toolCallId)
  const subagentLifecycle = context.subagentsByToolCallId.get(props.toolCallId) ?? null
  const groupView = repeatedEntry?.view ?? null
  const operationTitle = resolveNativeToolTitle(props.toolName, t)
    ?? localizeProjectAgentOperationTitle(props.toolName, locale)
  const toolStatus = props.status.type
  useWorkspaceAssistantRunningSurface(
    `tool:${props.toolCallId}`,
    toolStatus === 'running' || toolStatus === 'requires-action',
  )
  if (groupView && groupView.leaderToolCallId !== props.toolCallId) return null

  // Two failure shapes exist: the app-level ToolResult envelope ({ok:false})
  // and the terminal-closure/SDK error output ({error}, isError=true) written
  // when a run settles failed/cancelled. Neither may render as success, and an
  // interrupted call must not keep spinning as if it were still running.
  const displayState = groupView
    ? resolveGroupDisplayState(groupView)
    : context.interruptedToolCallIds.has(props.toolCallId)
      ? 'interrupted'
      : resolveWorkspaceAssistantToolCallDisplayState({
          type: 'tool-call',
          status: props.status,
          result: props.result,
          isError: props.isError,
        })
  const failed = groupView ? groupView.failed > 0 : displayState === 'failed'
  const interrupted = groupView ? groupView.interrupted > 0 : displayState === 'interrupted'
  const nativeSummary = NATIVE_SUBAGENT_TOOL_NAMES.has(props.toolName)
      ? subagentLifecycle
        ? localizeSubagentLifecycle(subagentLifecycle, t)
        : resolveSubagentSummary(props.args, props.result, t)
      : null
  const summaryText = nativeSummary ?? translateDisplayState(displayState, t)
  const iconName = failed || interrupted ? 'alert' : 'settingsHex'
  const displayTitle = groupView
    ? t('toolCall.groupTitle', { title: operationTitle, count: groupView.total })
    : operationTitle
  const mixedGroup = groupView && ([
    groupView.success,
    groupView.submitted,
    groupView.failed,
    groupView.interrupted,
    groupView.running,
    groupView.needsAction,
  ].filter((count) => count > 0).length > 1)
  const detailsAvailable = props.args !== undefined || props.result !== undefined
  const nativeDetail = props.toolName === 'web_search'
    ? resolveWebSearchSummary(props.args, props.result, t)
    : resolveNativeDetail(props.toolName, props.args)

  return (
    <div className={`text-sm leading-5 ${failed || interrupted ? 'text-[var(--glass-tone-warn-fg)]' : 'text-[var(--glass-text-tertiary)]'}`}>
      <div className="flex items-center gap-2">
        <AppIcon name={iconName} className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">{summaryText} · {displayTitle}</span>
      </div>
      {nativeDetail && !(subagentLifecycle && props.toolName === 'subagent_activity') ? (
        <div className="ml-5 mt-1 line-clamp-2 text-xs leading-4 text-[var(--glass-text-tertiary)]">
          {nativeDetail}
        </div>
      ) : null}
      {subagentLifecycle && props.toolName === 'subagent_activity' ? (
        <div className="ml-5 mt-1 space-y-0.5 text-xs leading-4 text-[var(--glass-text-tertiary)]">
          {subagentLifecycle.agents.map((agent) => (
            <div key={agent.agentThreadId} className="flex min-w-0 items-center justify-between gap-3">
              <span className="truncate">{agent.agentPath}</span>
              <span className="shrink-0">{t(`runtime.native.subagentStatus.${agent.status}`)}</span>
            </div>
          ))}
        </div>
      ) : null}
      {mixedGroup ? (
        <div className="ml-5 mt-1 text-xs leading-4">
          {t('toolCall.groupProgressSummary', groupView)}
        </div>
      ) : null}
      {failed ? (
        <div className="ml-5 mt-1 rounded-lg bg-[var(--glass-tone-warn-bg)]/45 px-2 py-1 text-xs leading-4">
          {t('toolCall.failedDetail')}
        </div>
      ) : null}
      {detailsAvailable ? (
        <div className="ml-5 mt-1.5">
          <button
            type="button"
            className="text-xs font-medium text-[var(--glass-text-secondary)] hover:underline"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? t('toolCall.hide') : t('toolCall.show')}
          </button>
          {expanded ? (
            <div className="mt-2 space-y-2">
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide">{t('toolCall.arguments')}</div>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-neutral-100 p-2 text-[11px] text-[var(--glass-text-secondary)]">{JSON.stringify(props.args, null, 2)}</pre>
              </div>
              {props.result !== undefined ? (
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide">{t('toolCall.result')}</div>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-neutral-100 p-2 text-[11px] text-[var(--glass-text-secondary)]">{typeof props.result === 'string' ? props.result : JSON.stringify(props.result, null, 2)}</pre>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
