'use client'

// 选中 Subagent 的详情视图:公开推理摘要、Skill/工具轨迹、终态摘要与完整 strict JSON。
// 按 AR-04,这些内容只属于详情视图,不出现在 Primary 对话的 Subagent 锚点上。

import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import type {
  ProjectAgentSubagentEventPartData,
  ProjectAgentSubagentStatus,
  ProjectAgentSubagentView,
} from '@/lib/project-agent/subagent-events'
import { WorkspaceAssistantAnimatedPlainText } from './WorkspaceAssistantTextPlayback'
import {
  localizeEvent,
  localizeOutputKind,
  localizeStatus,
  StatusGlyph,
  type AssistantAgentTranslator,
  type ErrorTranslator,
  type SubagentReasoningEvent,
} from './WorkspaceAssistantSubagentShared'
import { resolveWorkspaceAssistantSubagentEventGlyph } from './workspace-assistant-panel-state'

function SubagentEventGlyph(props: {
  part: ProjectAgentSubagentEventPartData
  subagentStatus: ProjectAgentSubagentStatus
  isLast: boolean
}) {
  const glyph = resolveWorkspaceAssistantSubagentEventGlyph(props)
  if (glyph === 'loader') {
    return <AppIcon name="loader" className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
  }
  if (glyph === 'alert') {
    return <AppIcon name="alert" className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
  }
  if (glyph === 'globe') {
    return <AppIcon name="globe" className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
  }
  if (glyph === 'tool') {
    return <AppIcon name="settingsHex" className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
  }
  if (glyph === 'check') {
    return <AppIcon name="check" className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
  }
  return null
}

function SubagentEventBody(props: {
  part: ProjectAgentSubagentEventPartData
  t: AssistantAgentTranslator
}) {
  const event = props.part.event
  const label = localizeEvent(props.part, props.t)
  if (event.kind === 'reasoning') {
    return (
      <SubagentReasoningEventBody
        event={event}
        label={label}
        t={props.t}
      />
    )
  }
  if (event.kind === 'tool_completed') {
    return (
      <details className="group min-w-0 flex-1">
        <summary className="flex cursor-pointer list-none items-center gap-1.5">
          <span className="min-w-0 break-words">{label}</span>
          <AppIcon name="chevronDown" className="h-3 w-3 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 text-xs leading-5 text-[var(--glass-text-tertiary)]">
          <dt>{props.t('subagents.events.toolName')}</dt>
          <dd className="break-all">read_skill</dd>
          <dt>{props.t('subagents.events.toolResult')}</dt>
          <dd className="break-words">
            {props.t('subagents.events.skillReadResult', {
              version: event.trace.version,
              chars: event.trace.contentChars,
            })}
          </dd>
          <dt>{props.t('subagents.events.toolUri')}</dt>
          <dd className="break-all">{event.trace.uri}</dd>
        </dl>
      </details>
    )
  }
  if (event.kind === 'submission_rejected') {
    const topLevelKeys = event.inputDiagnostic.topLevelKeys.length > 0
      ? event.inputDiagnostic.topLevelKeys.join(', ')
      : props.t('subagents.events.submissionInputNoKeys')
    return (
      <details className="group min-w-0 flex-1">
        <summary className="flex cursor-pointer list-none items-center gap-1.5">
          <span className="min-w-0 break-words">{label}</span>
          <AppIcon name="chevronDown" className="h-3 w-3 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="mt-1 break-words text-xs leading-5 text-[var(--glass-text-tertiary)]">
          {props.t('subagents.events.submissionInputDiagnostic', {
            type: props.t(`subagents.events.submissionInputTypes.${event.inputDiagnostic.inputType}`),
            chars: event.inputDiagnostic.rawArgumentChars,
            keys: topLevelKeys,
          })}
        </div>
        <p className="mt-1 text-xs leading-5 text-[var(--glass-text-tertiary)]">
          {props.t('subagents.events.submissionIssueHelp')}
        </p>
      </details>
    )
  }
  return <span className="min-w-0 break-words">{label}</span>
}

function SubagentReasoningEventBody(props: {
  event: SubagentReasoningEvent
  label: string
  t: AssistantAgentTranslator
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="text-xs font-medium text-[var(--glass-text-tertiary)]">{props.label}</div>
      {props.event.text ? (
        <div className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[var(--glass-text-secondary)]">
          <WorkspaceAssistantAnimatedPlainText
            text={props.event.text}
            running={props.event.status === 'running'}
          />
        </div>
      ) : null}
      {props.event.truncated ? (
        <div className="mt-1 text-xs text-[var(--glass-text-tertiary)]">
          {props.t('subagents.events.reasoningTruncated')}
        </div>
      ) : null}
    </div>
  )
}

function SubagentExecutionDisclosure(props: {
  subagent: ProjectAgentSubagentView
  t: AssistantAgentTranslator
}) {
  const running = props.subagent.status === 'running'
  const [open, setOpen] = useState(true)

  return (
    <section className="mt-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-2 text-left text-sm font-medium text-[var(--glass-text-tertiary)]"
      >
        <StatusGlyph status={props.subagent.status} />
        <span>{running ? props.t('subagents.execution.running') : props.t('subagents.execution.completed')}</span>
        <AppIcon
          name="chevronDown"
          className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open ? (
        <ol className="mt-3 space-y-3" aria-live="polite">
          {props.subagent.events.map((event, index) => (
            <li key={`${event.subagentId}:${String(event.sequence)}`} className="flex items-start gap-2 leading-5 text-[var(--glass-text-secondary)]">
              <span className="mt-0.5 empty:hidden">
                <SubagentEventGlyph
                  part={event}
                  subagentStatus={props.subagent.status}
                  isLast={index === props.subagent.events.length - 1}
                />
              </span>
              <SubagentEventBody part={event} t={props.t} />
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  )
}

function SubagentFailureNotice(props: {
  taskId: string
  errorCode: string | null
  t: AssistantAgentTranslator
  tErrors: ErrorTranslator
}) {
  const errorCode = props.errorCode?.trim() ?? ''
  const reason = errorCode && props.tErrors.has(errorCode)
    ? props.tErrors(errorCode)
    : props.t('subagents.failure.reasonFallback')

  return (
    <section
      role="alert"
      className="mt-5 rounded-xl border border-[var(--glass-tone-warn-fg)]/25 bg-[var(--glass-tone-warn-bg)]/70 px-3 py-3 leading-5 text-[var(--glass-tone-warn-fg)]"
    >
      <div className="flex items-start gap-2">
        <AppIcon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">{props.t('subagents.failure.title')}</div>
          <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs leading-5">
            <dt className="opacity-70">{props.t('subagents.failure.reasonLabel')}</dt>
            <dd className="min-w-0 break-words">{reason}</dd>
          </dl>
          <p className="mt-2 text-xs leading-5">{props.t('subagents.failure.nextStep')}</p>
          <p className="mt-1 break-all text-xs opacity-70">
            {props.tErrors('referenceId', { id: props.taskId })}
          </p>
        </div>
      </div>
    </section>
  )
}

export function WorkspaceAssistantSubagentView(props: {
  projectId: string
  subagent: ProjectAgentSubagentView | null
  structuredOutputText?: string | null
}) {
  const t = useTranslations('assistantAgent')
  const tErrors = useTranslations('errors')
  const subagent = props.subagent
  const subagentTaskId = subagent?.taskId ?? null
  const subagentStatus = subagent?.status ?? null
  const [detail, setDetail] = useState<{ taskId: string; output: unknown } | null>(null)
  const [detailError, setDetailError] = useState(false)
  useEffect(() => {
    if (!subagentTaskId || subagentStatus !== 'completed') {
      setDetail(null)
      setDetailError(false)
      return
    }
    const abortController = new AbortController()
    setDetail(null)
    setDetailError(false)
    void apiFetch(`/api/projects/${props.projectId}/assistant/subagents/${subagentTaskId}`, {
      signal: abortController.signal,
    })
      .then(async (response) => {
        const payload: unknown = await response.json().catch(() => null)
        if (!response.ok || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
          throw new Error('PROJECT_AGENT_SUBAGENT_DETAIL_FETCH_FAILED')
        }
        const value = payload as { detail?: unknown }
        if (!value.detail || typeof value.detail !== 'object' || Array.isArray(value.detail)) {
          throw new Error('PROJECT_AGENT_SUBAGENT_DETAIL_INVALID')
        }
        const next = value.detail as { taskId?: unknown; output?: unknown }
        if (next.taskId !== subagentTaskId) {
          throw new Error('PROJECT_AGENT_SUBAGENT_DETAIL_IDENTITY_MISMATCH')
        }
        setDetail({ taskId: subagentTaskId, output: next.output })
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setDetailError(true)
      })
    return () => abortController.abort()
  }, [props.projectId, subagentStatus, subagentTaskId])
  if (!subagent) return null

  return (
    <section role="tabpanel" className="mx-auto w-full max-w-2xl py-2 text-sm text-[var(--glass-text-primary)]">
      <div className="flex items-start gap-3 pb-2">
        <AppIcon name="brain" className="mt-0.5 h-5 w-5 shrink-0 text-[var(--glass-text-secondary)]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 leading-6">
            <span className="truncate font-semibold">{localizeOutputKind(subagent.outputKind, t)}</span>
            <span className="shrink-0 text-[var(--glass-text-tertiary)]">{t('subagents.label')}</span>
          </div>
          <p className="mt-1 leading-6 text-[var(--glass-text-secondary)]">{subagent.goal}</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[var(--glass-text-tertiary)]">
          <StatusGlyph status={subagent.status} />
          {localizeStatus(subagent.status, t)}
        </span>
      </div>

      <SubagentExecutionDisclosure
        key={subagent.subagentId}
        subagent={subagent}
        t={t}
      />

      {subagent.status === 'running' && props.structuredOutputText ? (
        <section className="mt-5" aria-live="polite">
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--glass-text-tertiary)]">
            <AppIcon name="loader" className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
            <span>{t('subagents.structuredOutputRunning')}</span>
          </div>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-neutral-950/[0.04] p-3 text-xs leading-5 text-[var(--glass-text-secondary)]">
            {props.structuredOutputText}
          </pre>
        </section>
      ) : null}

      {subagent.status === 'failed' ? (
        <SubagentFailureNotice
          taskId={subagent.taskId}
          errorCode={subagent.errorCode}
          t={t}
          tErrors={tErrors}
        />
      ) : null}

      {subagent.summary ? (
        <div className="mt-5 leading-6 text-[var(--glass-text-secondary)]">
          <div className="font-medium text-[var(--glass-text-primary)]">{t('subagents.result')}</div>
          <p className="mt-1 whitespace-pre-wrap">{subagent.summary}</p>
        </div>
      ) : null}
      {subagent.status === 'completed' ? (
        <details className="group mt-5 text-[var(--glass-text-secondary)]">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-[var(--glass-text-tertiary)]">
            <span>{t('subagents.fullResult')}</span>
            <AppIcon name="chevronDown" className="h-3 w-3 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="mt-2">
            {detail?.output !== undefined ? (
              <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-neutral-950/[0.04] p-3 text-xs leading-5">
                {JSON.stringify(detail.output, null, 2)}
              </pre>
            ) : detailError ? (
              <p className="text-[var(--glass-tone-warn-fg)]">{t('subagents.fullResultError')}</p>
            ) : (
              <p className="text-[var(--glass-text-tertiary)]">{t('subagents.fullResultLoading')}</p>
            )}
          </div>
        </details>
      ) : null}
    </section>
  )
}
