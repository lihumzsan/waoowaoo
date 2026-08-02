'use client'

import { useMessage, type ToolCallMessagePartProps } from '@assistant-ui/react'
import type { UIMessage } from 'ai'
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
import { useWorkspaceAssistantRunningSurface } from './WorkspaceAssistantReasoning'
import {
  resolveWorkspaceAssistantRepeatedToolCallGroups,
  resolveWorkspaceAssistantToolCallDisplayState,
  resolveWorkspaceAssistantToolCallGroupView,
  type WorkspaceAssistantRepeatedToolCallGroup,
  type WorkspaceAssistantToolCallDisplayState,
  type WorkspaceAssistantToolCallGroupView,
} from './workspace-assistant-run-trace'

const WorkspaceAssistantRepeatedToolCallGroupContext = createContext<
  ReadonlyMap<string, WorkspaceAssistantRepeatedToolCallGroup>
>(new Map())
const EMPTY_MESSAGE_PARTS: readonly unknown[] = []
const NATIVE_SUBAGENT_TOOL_NAMES = new Set([
  'spawnAgent',
  'sendInput',
  'resumeAgent',
  'wait',
  'closeAgent',
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
      case 'sendInput': return t('runtime.native.subagentAction.sendInput')
      case 'resumeAgent': return t('runtime.native.subagentAction.resumeAgent')
      case 'wait': return t('runtime.native.subagentAction.wait')
      case 'closeAgent': return t('runtime.native.subagentAction.closeAgent')
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
  return t('runtime.native.subagentSummary', { active, completed, failed })
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
  if (type === 'open_page') {
    return t('runtime.native.web.openPage', { value: readText(action?.url) ?? '…' })
  }
  if (type === 'find_in_page') {
    return t('runtime.native.web.findInPage', { value: readText(action?.pattern) ?? '…' })
  }
  return t('runtime.native.web.other')
}

function resolveNativeDetail(toolName: string, args: unknown): string | null {
  if (!isRecord(args)) return null
  if (NATIVE_SUBAGENT_TOOL_NAMES.has(toolName)) {
    return readText(args.prompt) ?? readText(args.agentPath)
  }
  if (toolName === 'shell') return readText(args.command)
  return null
}

export function WorkspaceAssistantRepeatedToolCallGroupProvider({
  children,
  messages,
}: {
  readonly children: ReactNode
  readonly messages: readonly UIMessage[]
}) {
  const groupByToolCallId = useMemo(() => {
    const next = new Map<string, WorkspaceAssistantRepeatedToolCallGroup>()
    for (const group of resolveWorkspaceAssistantRepeatedToolCallGroups(messages)) {
      for (const toolCallId of group.toolCallIds) next.set(toolCallId, group)
    }
    return next
  }, [messages])
  return (
    <WorkspaceAssistantRepeatedToolCallGroupContext.Provider value={groupByToolCallId}>
      {children}
    </WorkspaceAssistantRepeatedToolCallGroupContext.Provider>
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
  const repeatedGroup = useContext(WorkspaceAssistantRepeatedToolCallGroupContext).get(props.toolCallId)
  const messageParts = useMessage((state) => (
    'parts' in state && Array.isArray(state.parts) ? state.parts : EMPTY_MESSAGE_PARTS
  ))
  const groupView = repeatedGroup
    ? resolveWorkspaceAssistantToolCallGroupView(messageParts, repeatedGroup)
    : null
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
    : resolveWorkspaceAssistantToolCallDisplayState({
        type: 'tool-call',
        status: props.status,
        result: props.result,
        isError: props.isError,
      })
  const failed = groupView ? groupView.failed > 0 : displayState === 'failed'
  const interrupted = groupView ? groupView.interrupted > 0 : displayState === 'interrupted'
  const nativeSummary = props.toolName === 'web_search'
    ? resolveWebSearchSummary(props.args, props.result, t)
    : NATIVE_SUBAGENT_TOOL_NAMES.has(props.toolName)
      ? resolveSubagentSummary(props.args, props.result, t)
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
  const nativeDetail = resolveNativeDetail(props.toolName, props.args)

  return (
    <div className={`text-sm leading-5 ${failed || interrupted ? 'text-[var(--glass-tone-warn-fg)]' : 'text-[var(--glass-text-tertiary)]'}`}>
      <div className="flex items-center gap-2">
        <AppIcon name={iconName} className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">{summaryText} · {displayTitle}</span>
      </div>
      {nativeDetail ? (
        <div className="ml-5 mt-1 line-clamp-2 text-xs leading-4 text-[var(--glass-text-tertiary)]">
          {nativeDetail}
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
