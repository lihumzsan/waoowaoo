'use client'

import { useMessage, type ToolCallMessagePartProps } from '@assistant-ui/react'
import type { UIMessage } from 'ai'
import { useLocale, useTranslations } from 'next-intl'
import {
  createContext,
  useContext,
  useMemo,
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
  const repeatedGroup = useContext(WorkspaceAssistantRepeatedToolCallGroupContext).get(props.toolCallId)
  const messageParts = useMessage((state) => (
    'parts' in state && Array.isArray(state.parts) ? state.parts : EMPTY_MESSAGE_PARTS
  ))
  const groupView = repeatedGroup
    ? resolveWorkspaceAssistantToolCallGroupView(messageParts, repeatedGroup)
    : null
  const operationTitle = localizeProjectAgentOperationTitle(props.toolName, locale)
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
  const summaryText = translateDisplayState(displayState, t)
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

  return (
    <div className={`text-sm leading-5 ${failed || interrupted ? 'text-[var(--glass-tone-warn-fg)]' : 'text-[var(--glass-text-tertiary)]'}`}>
      <div className="flex items-center gap-2">
        <AppIcon name={iconName} className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">{summaryText} · {displayTitle}</span>
      </div>
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
    </div>
  )
}
