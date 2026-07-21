'use client'

import { useMessage } from '@assistant-ui/react'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { getCreativeSkillDefinition } from '@/lib/creative-skills/registry'
import type {
  ProjectAgentSubagentEventPartData,
  ProjectAgentSubagentStatus,
  ProjectAgentSubagentView,
} from '@/lib/project-agent/subagent-events'
import { normalizeProjectAgentLocale } from '@/lib/project-agent/locale'

type AssistantAgentTranslator = ReturnType<typeof useTranslations<'assistantAgent'>>

function localizeOutputKind(
  outputKind: ProjectAgentSubagentView['outputKind'],
  t: AssistantAgentTranslator,
): string {
  switch (outputKind) {
    case 'screenplay_draft': return t('subagents.outputKinds.screenplayDraft')
    case 'edit_bible_bundle': return t('subagents.outputKinds.editBibleBundle')
    case 'continuity_analysis': return t('subagents.outputKinds.continuityAnalysis')
    case 'style_bible': return t('subagents.outputKinds.styleBible')
    case 'asset_prompt_set': return t('subagents.outputKinds.assetPromptSet')
    case 'video_prompt_set': return t('subagents.outputKinds.videoPromptSet')
    case 'music_direction': return t('subagents.outputKinds.musicDirection')
    case 'creative_review': return t('subagents.outputKinds.creativeReview')
  }
}

function localizeEvent(
  part: ProjectAgentSubagentEventPartData,
  locale: 'zh' | 'en',
  t: AssistantAgentTranslator,
): string {
  const event = part.event
  switch (event.kind) {
    case 'started': return t('subagents.events.started')
    case 'skill_read':
      return t('subagents.events.skillRead', {
        skill: getCreativeSkillDefinition(event.trace.skillId).title[locale],
      })
    case 'reasoning':
      return event.status === 'running'
        ? t('subagents.events.reasoningRunning')
        : t('subagents.events.reasoningCompleted')
    case 'tool_called':
      return t('subagents.events.toolCalled', {
        skill: getCreativeSkillDefinition(event.skillId).title[locale],
      })
    case 'tool_completed':
      return t('subagents.events.toolCompleted', {
        skill: getCreativeSkillDefinition(event.skillId).title[locale],
      })
    case 'tool_failed':
      return t('subagents.events.toolFailed', {
        skill: getCreativeSkillDefinition(event.skillId).title[locale],
      })
  }
}

function localizeStatus(status: ProjectAgentSubagentStatus, t: AssistantAgentTranslator): string {
  if (status === 'running') return t('subagents.status.running')
  if (status === 'completed') return t('subagents.status.completed')
  if (status === 'failed') return t('subagents.status.failed')
  return t('subagents.status.cancelled')
}

function StatusGlyph({ status }: { status: ProjectAgentSubagentStatus }) {
  if (status === 'running') {
    return <AppIcon name="loader" className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
  }
  if (status === 'completed') {
    return (
      <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white" aria-hidden="true">
        <AppIcon name="check" className="h-2.5 w-2.5" />
      </span>
    )
  }
  return <AppIcon name="alert" className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
}

function CompletedGlyph() {
  return (
    <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white" aria-hidden="true">
      <AppIcon name="check" className="h-2.5 w-2.5" />
    </span>
  )
}

function SubagentEventGlyph(props: {
  part: ProjectAgentSubagentEventPartData
  subagentStatus: ProjectAgentSubagentStatus
  isLast: boolean
}) {
  const event = props.part.event
  const eventIsOpen = event.kind === 'tool_called'
    || (event.kind === 'reasoning' && event.status === 'running')
  if (eventIsOpen && props.isLast && props.subagentStatus === 'running') {
    return <AppIcon name="loader" className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
  }
  if (event.kind === 'tool_failed' || (eventIsOpen && props.subagentStatus !== 'completed')) {
    return <AppIcon name="alert" className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
  }
  return <CompletedGlyph />
}

function SubagentEventBody(props: {
  part: ProjectAgentSubagentEventPartData
  locale: 'zh' | 'en'
  t: AssistantAgentTranslator
}) {
  const event = props.part.event
  const label = localizeEvent(props.part, props.locale, props.t)
  if (event.kind === 'reasoning') {
    return (
      <div className="min-w-0 flex-1">
        <div>{label}</div>
        {event.text ? (
          <div className="mt-1 whitespace-pre-wrap border-l border-[var(--glass-stroke-base)] pl-3 text-[var(--glass-text-tertiary)]">
            {event.text}
          </div>
        ) : null}
        {event.truncated ? (
          <div className="mt-1 text-xs text-[var(--glass-text-tertiary)]">
            {props.t('subagents.events.reasoningTruncated')}
          </div>
        ) : null}
      </div>
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
  return <span className="min-w-0 break-words">{label}</span>
}

function SubagentExecutionDisclosure(props: {
  subagent: ProjectAgentSubagentView
  locale: 'zh' | 'en'
  t: AssistantAgentTranslator
}) {
  const running = props.subagent.status === 'running'
  const [open, setOpen] = useState(running)
  const wasRunning = useRef(running)
  useEffect(() => {
    if (running) setOpen(true)
    else if (wasRunning.current) setOpen(false)
    wasRunning.current = running
  }, [running])

  return (
    <section className="mt-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-2 text-left font-medium text-[var(--glass-text-primary)]"
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
            <li key={`${event.subagentId}:${String(event.sequence)}`} className="flex items-start gap-3 leading-5 text-[var(--glass-text-secondary)]">
              <span className="mt-0.5">
                <SubagentEventGlyph
                  part={event}
                  subagentStatus={props.subagent.status}
                  isLast={index === props.subagent.events.length - 1}
                />
              </span>
              <SubagentEventBody part={event} locale={props.locale} t={props.t} />
            </li>
          ))}
          {running ? (
            <li className="flex items-start gap-3 leading-5 text-[var(--glass-text-secondary)]">
              <AppIcon name="loader" className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
              <span>{props.t('subagents.events.composing')}</span>
            </li>
          ) : null}
        </ol>
      ) : null}
    </section>
  )
}

function readRunIdsFromMessageParts(parts: readonly unknown[]): ReadonlySet<string> {
  const runIds = new Set<string>()
  for (const part of parts) {
    if (!part || typeof part !== 'object' || Array.isArray(part)) continue
    const record = part as { type?: unknown; data?: unknown }
    if (record.type !== 'data-agent-run' || !record.data || typeof record.data !== 'object' || Array.isArray(record.data)) continue
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
}) {
  const t = useTranslations('assistantAgent')
  if (props.subagents.length === 0) return null

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
          <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-current" aria-hidden="true" />
          <span className="min-w-0 truncate">{t('subagents.primary')}</span>
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

export function WorkspaceAssistantSubagentView(props: { subagent: ProjectAgentSubagentView | null }) {
  const t = useTranslations('assistantAgent')
  const locale = normalizeProjectAgentLocale(useLocale())
  const subagent = props.subagent
  if (!subagent) return null

  return (
    <section role="tabpanel" className="mx-auto w-full max-w-2xl py-2 text-sm text-[var(--glass-text-primary)]">
      <div className="flex items-start gap-3 border-b border-[var(--glass-stroke-base)] pb-4">
        <AppIcon name="brain" className="mt-0.5 h-5 w-5 shrink-0 text-[var(--glass-text-secondary)]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 leading-6">
            <span className="truncate font-semibold">{localizeOutputKind(subagent.outputKind, t)}</span>
            <span className="shrink-0 text-[var(--glass-text-tertiary)]">Subagent</span>
          </div>
          <p className="mt-1 leading-6 text-[var(--glass-text-secondary)]">{subagent.goal}</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[var(--glass-text-tertiary)]">
          <StatusGlyph status={subagent.status} />
          {localizeStatus(subagent.status, t)}
        </span>
      </div>

      <SubagentExecutionDisclosure subagent={subagent} locale={locale} t={t} />

      {subagent.summary ? (
        <div className="mt-5 border-t border-[var(--glass-stroke-base)] pt-4 leading-6 text-[var(--glass-text-secondary)]">
          <div className="font-medium text-[var(--glass-text-primary)]">{t('subagents.result')}</div>
          <p className="mt-1 whitespace-pre-wrap">{subagent.summary}</p>
        </div>
      ) : null}
    </section>
  )
}

export function WorkspaceAssistantSubagentRecords(props: {
  subagents: readonly ProjectAgentSubagentView[]
  onSelect: (subagentId: string) => void
}) {
  const t = useTranslations('assistantAgent')
  if (props.subagents.length === 0) return null
  return (
    <div className="space-y-2">
      {props.subagents.map((subagent) => (
        <button
          key={subagent.subagentId}
          type="button"
          onClick={() => props.onSelect(subagent.subagentId)}
          className="flex w-full items-center gap-2 rounded-xl border border-[var(--glass-stroke-base)] bg-white/88 px-3 py-2 text-left text-sm leading-5 text-[var(--glass-text-secondary)] transition-colors hover:bg-white"
        >
          <StatusGlyph status={subagent.status} />
          <span className="min-w-0 flex-1 truncate">
            {localizeStatus(subagent.status, t)} · {localizeOutputKind(subagent.outputKind, t)}
          </span>
          <AppIcon name="chevronUp" className="h-3.5 w-3.5 shrink-0 rotate-90 text-[var(--glass-text-tertiary)]" aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}

export function WorkspaceAssistantSubagentRecordsForMessage(props: {
  subagents: readonly ProjectAgentSubagentView[]
  onSelect: (subagentId: string) => void
}) {
  const parts = useMessage((state) => state.content)
  const messageRunIds = readRunIdsFromMessageParts(parts)
  const anchoredSubagents = props.subagents.filter((subagent) => messageRunIds.has(subagent.runId))
  return (
    <WorkspaceAssistantSubagentRecords
      subagents={anchoredSubagents}
      onSelect={props.onSelect}
    />
  )
}
