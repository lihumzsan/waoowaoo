'use client'

import {
  useMessage,
  type ReasoningGroupProps,
  type ReasoningMessagePartProps,
} from '@assistant-ui/react'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { MarkdownTextPart } from './MarkdownTextPart'

export function WorkspaceAssistantReasoningPart({ text, status }: ReasoningMessagePartProps) {
  if (!text) return null
  return (
    <div className="border-l border-[var(--glass-stroke-base)] pl-3 text-sm leading-6 text-[var(--glass-text-secondary)]">
      <MarkdownTextPart type="text" text={text} status={status} />
    </div>
  )
}

export function WorkspaceAssistantReasoningGroup({ children }: ReasoningGroupProps) {
  const t = useTranslations('assistantAgent')
  const running = useMessage((state) => state.status?.type === 'running')
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
        <span>{running ? t('reasoning.running') : t('reasoning.completed')}</span>
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
