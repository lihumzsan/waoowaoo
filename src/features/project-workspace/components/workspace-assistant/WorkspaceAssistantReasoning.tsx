'use client'

import {
  useMessage,
  type DataMessagePartProps,
  type ReasoningMessagePartProps,
} from '@assistant-ui/react'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { ProjectAgentRunPartData } from '@/lib/project-agent/types'
import { MarkdownTextPart } from './MarkdownTextPart'
import {
  resolveWorkspaceAssistantRunTraceView,
  WORKSPACE_ASSISTANT_RUN_TRACE_GROUP_KEY,
} from './workspace-assistant-run-trace'

function WorkspaceAssistantReasoningDisclosure({
  running,
  label,
  children,
}: {
  readonly running: boolean
  readonly label: string
  readonly children: ReactNode
}) {
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
        <span>{label}</span>
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

export function WorkspaceAssistantWaitDots() {
  return (
    <div
      className="assistant-thinking-indicator flex min-h-6 items-center text-[var(--glass-text-secondary)]"
      role="status"
      aria-live="polite"
    >
      <span className="assistant-thinking-minimal" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>

      <style>{`
        .assistant-thinking-minimal {
          display: inline-flex;
          flex-shrink: 0;
          align-items: center;
          justify-content: center;
          gap: 5px;
          width: 25px;
        }

        .assistant-thinking-minimal span {
          width: 5px;
          height: 5px;
          border-radius: 999px;
          background: currentColor;
          animation: assistant-thinking-minimal-pulse 1.2s ease-in-out infinite;
        }

        .assistant-thinking-minimal span:nth-child(2) {
          animation-delay: 160ms;
        }

        .assistant-thinking-minimal span:nth-child(3) {
          animation-delay: 320ms;
        }

        @keyframes assistant-thinking-minimal-pulse {
          0%, 72%, 100% {
            opacity: 0.32;
            transform: scale(0.82);
          }
          36% {
            opacity: 1;
            transform: scale(1.2);
          }
        }
      `}</style>
    </div>
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

export function WorkspaceAssistantReasoningPart({
  text,
}: ReasoningMessagePartProps) {
  const t = useTranslations('assistantAgent')
  if (!text.trim()) return null
  return (
    <div className="space-y-1 text-sm leading-6 text-[var(--glass-text-secondary)]">
      <div className="text-xs font-medium text-[var(--glass-text-tertiary)]">
        {t('reasoning.itemLabel')}
      </div>
      <MarkdownTextPart text={text} />
    </div>
  )
}

export function WorkspaceAssistantRunTraceGroup({
  groupKey,
  children,
}: {
  readonly groupKey: string | undefined
  readonly indices: number[]
  readonly children?: ReactNode
}) {
  const t = useTranslations('assistantAgent')
  const running = useMessage((state) => state.status?.type === 'running')
  const toolCallCount = useMessage((state) => (
    resolveWorkspaceAssistantRunTraceView(state.content).visibleToolCallCount
  ))

  if (groupKey !== WORKSPACE_ASSISTANT_RUN_TRACE_GROUP_KEY) return <>{children}</>

  const label = toolCallCount > 0
    ? running
      ? t('reasoning.executionRunning', { count: toolCallCount })
      : t('reasoning.executionCompleted', { count: toolCallCount })
    : running
      ? t('reasoning.running')
      : t('reasoning.completed')

  return (
    <WorkspaceAssistantReasoningDisclosure
      running={running}
      label={label}
    >
      <div className="space-y-3 border-l border-[var(--glass-stroke-base)] pl-3">
        {children}
      </div>
    </WorkspaceAssistantReasoningDisclosure>
  )
}

export function WorkspaceAssistantRunReasoningStatus({
  data,
}: DataMessagePartProps<ProjectAgentRunPartData>) {
  const running = useMessage((state) => state.status?.type === 'running')
  const view = useMessage((state) => resolveWorkspaceAssistantRunTraceView(state.content))
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

  if (
    !isFirstRunPart
    || data.status !== 'running'
    || !running
    || view.hasPublicReasoning
    || view.hasVisibleContent
  ) return null

  return <WorkspaceAssistantWaitDots />
}
