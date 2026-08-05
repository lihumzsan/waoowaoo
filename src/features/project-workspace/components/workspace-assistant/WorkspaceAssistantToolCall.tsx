'use client'

import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { getToolName, isToolUIPart, type UIMessage } from 'ai'
import { useLocale, useTranslations } from 'next-intl'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AppIcon } from '@/components/ui/icons'
import { WebSourceFavicon } from './WebSourceFavicon'
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
  resolveWorkspaceAssistantTurnStatusByMessageId,
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

function readPublicWebUrl(value: unknown): string | null {
  const raw = readText(value)
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
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
    default: return null
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

type WebSearchSource = {
  readonly url: string
  readonly title: string
  readonly domain: string
  readonly previewImageUrl: string | null
}

/**
 * Reads the cited sources out of a completed research result.
 *
 * The Operation's output is wrapped by the MCP success envelope, and its
 * citations are `sources` — the contract guarantees the array is non-empty, so
 * an empty render here means the shape moved, not that the research found
 * nothing. Preview images are matched back to their own source page; a source
 * without one simply renders without a thumbnail.
 */
function resolveWebSearchSources(result: unknown): WebSearchSource[] {
  const envelope = isRecord(result) ? result : null
  const data = isRecord(envelope?.data) ? envelope.data : envelope
  if (!Array.isArray(data?.sources)) return []
  const previewBySourceUrl = new Map<string, string>()
  if (Array.isArray(data.images)) {
    for (const entry of data.images) {
      if (!isRecord(entry)) continue
      const sourceUrl = readPublicWebUrl(entry.sourceUrl)
      const imageUrl = readPublicWebUrl(entry.thumbnailUrl) ?? readPublicWebUrl(entry.imageUrl)
      if (sourceUrl && imageUrl && !previewBySourceUrl.has(sourceUrl)) {
        previewBySourceUrl.set(sourceUrl, imageUrl)
      }
    }
  }
  const byUrl = new Map<string, WebSearchSource>()
  for (const entry of data.sources) {
    if (!isRecord(entry)) continue
    const url = readPublicWebUrl(entry.url)
    if (!url || byUrl.has(url)) continue
    try {
      const domain = new URL(url).hostname.replace(/^www\./, '')
      byUrl.set(url, {
        url,
        title: readText(entry.title) ?? domain,
        domain,
        previewImageUrl: previewBySourceUrl.get(url) ?? null,
      })
    } catch {}
  }
  return [...byUrl.values()].slice(0, 6)
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
    const lifecycleByMessageId = resolveWorkspaceAssistantSubagentLifecycleViews(
      messages,
      resolveWorkspaceAssistantTurnStatusByMessageId(messages, turns),
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

/**
 * Seconds a still-running row has been running.
 *
 * A long tool call must prove it is alive on its own. Making that proof depend
 * on provider progress events was the earlier mistake: when they did not
 * arrive, a research call sat on one static line for minutes and read as
 * frozen. A local clock cannot fail to arrive.
 */
function useRunningSeconds(running: boolean): number {
  const startedAtRef = useRef<number | null>(null)
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!running) {
      startedAtRef.current = null
      setSeconds(0)
      return
    }
    startedAtRef.current ??= Date.now()
    const tick = (): void => {
      const startedAt = startedAtRef.current
      if (startedAt !== null) setSeconds(Math.floor((Date.now() - startedAt) / 1_000))
    }
    tick()
    const timer = window.setInterval(tick, 1_000)
    return () => window.clearInterval(timer)
  }, [running])
  return seconds
}

function formatRunningSeconds(seconds: number): string {
  if (seconds < 60) return `${String(seconds)}s`
  return `${String(Math.floor(seconds / 60))}m${String(seconds % 60).padStart(2, '0')}s`
}

export function WorkspaceAssistantToolCallCard(props: ToolCallMessagePartProps) {
  const t = useTranslations('assistantAgent')
  const locale = normalizeProjectAgentLocale(useLocale())
  const context = useContext(WorkspaceAssistantToolCallContext)
  const repeatedEntry = context.repeatedByToolCallId.get(props.toolCallId)
  const subagentLifecycle = context.subagentsByToolCallId.get(props.toolCallId) ?? null
  const groupView = repeatedEntry?.view ?? null
  const operationId = props.toolName.startsWith('wao.')
    ? props.toolName.slice('wao.'.length)
    : props.toolName
  const operationTitle = resolveNativeToolTitle(props.toolName, t)
    ?? localizeProjectAgentOperationTitle(operationId, locale)
  const toolStatus = props.status.type
  const runningSeconds = useRunningSeconds(toolStatus === 'running')
  useWorkspaceAssistantRunningSurface(
    `tool:${props.toolCallId}`,
    toolStatus === 'running' || toolStatus === 'requires-action',
  )
  if (groupView && groupView.leaderToolCallId !== props.toolCallId) return null
  // The subagent tab strip is the single renderer of child-agent lifecycle.
  // Keeping these rows in the trace would give the same facts a second,
  // competing surface that can disagree with the tabs.
  if (subagentLifecycle && NATIVE_SUBAGENT_TOOL_NAMES.has(props.toolName)) return null

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
    ? resolveSubagentSummary(props.args, props.result, t)
    : null
  const summaryText = nativeSummary ?? translateDisplayState(displayState, t)
  const iconName = failed || interrupted ? 'alert' : 'settingsHex'
  const displayTitle = groupView
    ? props.toolName === 'web_search'
      ? operationTitle
      : t('toolCall.groupTitle', { title: operationTitle, count: groupView.total })
    : operationTitle
  const mixedGroup = groupView && ([
    groupView.success,
    groupView.submitted,
    groupView.failed,
    groupView.interrupted,
    groupView.running,
    groupView.needsAction,
  ].filter((count) => count > 0).length > 1)
  const webSearchSources = operationId === 'web_search'
    ? resolveWebSearchSources(props.result)
    : []
  // Codex creates one webSearch item per call carrying the model's own query,
  // so a run of three searches is three rows that each say what they are for.
  // That per-item query is the live signal; there is no progress channel here
  // and none is needed.
  const webSearchQuery = operationId === 'web_search' && displayState === 'running'
    ? readText(isRecord(props.args) ? props.args.query : null)
    : null

  return (
    <div className={`text-sm leading-5 ${failed || interrupted ? 'text-[var(--glass-tone-warning-fg)]' : 'text-[var(--glass-text-tertiary)]'}`}>
      <div className="flex items-center gap-2">
        <AppIcon name={iconName} className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">{summaryText} · {displayTitle}</span>
        {runningSeconds > 0 ? (
          <span className="shrink-0 tabular-nums opacity-60">{formatRunningSeconds(runningSeconds)}</span>
        ) : null}
      </div>
      {webSearchQuery ? (
        <div className="ml-5 mt-1 flex min-w-0 items-center gap-1.5 text-xs leading-4">
          <AppIcon name="search" className="h-3 w-3 shrink-0 opacity-70" aria-hidden="true" />
          <span className="min-w-0 truncate text-[var(--glass-text-secondary)]">{webSearchQuery}</span>
        </div>
      ) : null}
      {webSearchSources.length > 0 ? (
        <div className="ml-5 mt-2 grid grid-cols-2 gap-2">
          {webSearchSources.map((source) => (
            <a
              key={source.url}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="group flex min-w-0 items-center gap-2 rounded-xl bg-slate-50/80 p-2 ring-1 ring-slate-200/70 transition hover:bg-white hover:ring-slate-300"
            >
              {source.previewImageUrl ? (
                // Search previews are public source thumbnails, never workspace assets.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={source.previewImageUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover bg-slate-100" />
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-slate-200">
                  <WebSourceFavicon domain={source.domain} className="h-5 w-5" />
                </span>
              )}
              <span className="min-w-0">
                <span className="line-clamp-2 text-xs font-medium leading-4 text-[var(--glass-text-secondary)] group-hover:text-[var(--glass-text-primary)]">{source.title}</span>
                <span className="mt-0.5 block truncate text-[10px] text-[var(--glass-text-tertiary)]">{source.domain}</span>
              </span>
            </a>
          ))}
        </div>
      ) : null}
      {mixedGroup ? (
        <div className="ml-5 mt-1 text-xs leading-4">
          {t('toolCall.groupProgressSummary', groupView)}
        </div>
      ) : null}
      {failed ? (
        <div className="ml-5 mt-1 rounded-lg bg-[var(--glass-tone-surface)] shadow-[var(--glass-tone-shadow)] px-2 py-1 text-xs leading-4">
          {t('toolCall.failedDetail')}
        </div>
      ) : null}
    </div>
  )
}
