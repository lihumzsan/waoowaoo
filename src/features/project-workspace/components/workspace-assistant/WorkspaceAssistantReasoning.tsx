'use client'

import {
  useMessage,
  type DataMessagePartProps,
} from '@assistant-ui/react'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { ProjectAgentRunPartData } from '@/lib/project-agent/types'
import { MarkdownTextPart } from './MarkdownTextPart'

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

export function HiddenWorkspaceAssistantReasoning() {
  return null
}

export function WorkspaceAssistantRunReasoningStatus({
  data,
}: DataMessagePartProps<ProjectAgentRunPartData>) {
  const t = useTranslations('assistantAgent')
  const publicReasoning = useMessage((state) => (
    state.content.flatMap((part) => (
      part.type === 'reasoning' && part.text ? [part.text] : []
    )).join('\n\n')
  ))
  const running = useMessage((state) => state.status?.type === 'running')
  const isFirstRunPart = useMessage((state) => {
    const firstRunPart = state.content.find((part) => (
      part.type === 'data'
      && part.name === 'agent-run'
      && isProjectAgentRunPartData(part.data)
    ))
    return Boolean(
      firstRunPart
      && firstRunPart.type === 'data'
      && isProjectAgentRunPartData(firstRunPart.data)
      && firstRunPart.data.runId === data.runId
      && firstRunPart.data.requestId === data.requestId,
    )
  })

  if (!isFirstRunPart || data.status !== 'running') return null

  if (publicReasoning) {
    return (
      <WorkspaceAssistantReasoningDisclosure
        running={running}
        completedLabel={t('reasoning.completed')}
      >
        <div className="border-l border-[var(--glass-stroke-base)] pl-3 text-sm leading-6 text-[var(--glass-text-secondary)]">
          <MarkdownTextPart text={publicReasoning} />
        </div>
      </WorkspaceAssistantReasoningDisclosure>
    )
  }

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
