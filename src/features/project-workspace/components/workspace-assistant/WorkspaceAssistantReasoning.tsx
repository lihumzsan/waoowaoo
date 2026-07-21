'use client'

import {
  useMessage,
  type DataMessagePartProps,
  type ReasoningGroupProps,
  type ReasoningMessagePartProps,
} from '@assistant-ui/react'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { ProjectAgentRunPartData } from '@/lib/project-agent/types'
import { MarkdownTextPart } from './MarkdownTextPart'

export function WorkspaceAssistantReasoningPart({ text, status }: ReasoningMessagePartProps) {
  if (!text) return null
  return (
    <div className="border-l border-[var(--glass-stroke-base)] pl-3 text-sm leading-6 text-[var(--glass-text-secondary)]">
      <MarkdownTextPart type="text" text={text} status={status} />
    </div>
  )
}

function WorkspaceAssistantReasoningDisclosure({
  running,
  completedLabel,
  children,
}: {
  readonly running: boolean
  readonly completedLabel: string
  readonly children: ReactNode
}) {
  const t = useTranslations('assistantAgent')
  const [open, setOpen] = useState(running)
  const wasRunning = useRef(running)
  useEffect(() => {
    if (running) setOpen(true)
    else if (wasRunning.current) setOpen(false)
    wasRunning.current = running
  }, [running])

  return (
    <section className="text-sm text-[var(--glass-text-tertiary)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-2 py-0.5 text-left"
      >
        {running ? (
          <AppIcon name="loader" className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
        ) : (
          <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white" aria-hidden="true">
            <AppIcon name="check" className="h-2.5 w-2.5" />
          </span>
        )}
        <span>{running ? t('reasoning.running') : completedLabel}</span>
        <AppIcon
          name="chevronDown"
          className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open ? <div className="mt-2 space-y-3">{children}</div> : null}
    </section>
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isProjectAgentRunPartData(value: unknown): value is ProjectAgentRunPartData {
  if (!isRecord(value)) return false
  return typeof value.runId === 'string'
    && typeof value.requestId === 'string'
    && typeof value.controlKind === 'string'
    && typeof value.status === 'string'
}

export function WorkspaceAssistantReasoningGroup({ children }: ReasoningGroupProps) {
  const t = useTranslations('assistantAgent')
  const running = useMessage((state) => state.status?.type === 'running')

  return (
    <WorkspaceAssistantReasoningDisclosure
      running={running}
      completedLabel={t('reasoning.completed')}
    >
      {children}
    </WorkspaceAssistantReasoningDisclosure>
  )
}

export function WorkspaceAssistantRunReasoningStatus({
  data,
}: DataMessagePartProps<ProjectAgentRunPartData>) {
  const t = useTranslations('assistantAgent')
  const hasPublicReasoning = useMessage((state) => (
    state.content.some((part) => part.type === 'reasoning')
  ))
  const messageRunning = useMessage((state) => state.status?.type === 'running')
  const isLatestRunPart = useMessage((state) => {
    const latestRunPart = [...state.content].reverse().find((part) => (
      part.type === 'data'
      && part.name === 'agent-run'
      && isProjectAgentRunPartData(part.data)
    ))
    if (!latestRunPart || latestRunPart.type !== 'data' || !isProjectAgentRunPartData(latestRunPart.data)) {
      return false
    }
    return latestRunPart.data.runId === data.runId
      && latestRunPart.data.requestId === data.requestId
      && latestRunPart.data.status === data.status
  })

  if (hasPublicReasoning || !isLatestRunPart) return null
  if (data.status !== 'running' && data.status !== 'completed') return null
  if (data.status === 'running' && !messageRunning) return null
  const running = data.status === 'running'

  return (
    <WorkspaceAssistantReasoningDisclosure
      running={running}
      completedLabel={t('reasoning.completedWithoutDetails')}
    >
      <p className="border-l border-[var(--glass-stroke-base)] pl-3 text-sm leading-6 text-[var(--glass-text-secondary)]">
        {running ? t('reasoning.preparing') : t('reasoning.unavailable')}
      </p>
    </WorkspaceAssistantReasoningDisclosure>
  )
}

export function WorkspaceAssistantPendingReasoningStatus() {
  const t = useTranslations('assistantAgent')
  return (
    <WorkspaceAssistantReasoningDisclosure
      running
      completedLabel={t('reasoning.completedWithoutDetails')}
    >
      <p className="border-l border-[var(--glass-stroke-base)] pl-3 text-sm leading-6 text-[var(--glass-text-secondary)]">
        {t('reasoning.preparing')}
      </p>
    </WorkspaceAssistantReasoningDisclosure>
  )
}
