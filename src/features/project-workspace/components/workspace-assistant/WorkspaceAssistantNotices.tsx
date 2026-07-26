'use client'

import { useTranslations } from 'next-intl'
import type { DataMessagePartProps } from '@assistant-ui/react'
import { AppIcon } from '@/components/ui/icons'
import type {
  ProjectAgentContextCompactedPartData,
  ProjectAgentStopPartData,
} from '@/lib/project-agent/types'

/**
 * Small inline notices in the assistant message stream: things the user needs
 * to see about the run itself rather than about its output.
 */
export function AgentStopDataCard({ data }: DataMessagePartProps<ProjectAgentStopPartData>) {
  const t = useTranslations('assistantAgent')
  if (data.reason === 'awaiting_user_confirmation') return null
  return (
    <div className="flex items-center gap-2 border-l-2 border-[var(--glass-text-tertiary)]/40 pl-2 text-sm leading-5 text-[var(--glass-text-secondary)]">
      <AppIcon name="alert" className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 truncate">{t('cards.toolErrorBoundary')}</span>
    </div>
  )
}

/**
 * Marks where earlier conversation was condensed.
 *
 * Shedding tool results stays invisible because the assistant can re-read
 * them, but summarising conversation is lossy. Without this marker a later gap
 * in what the assistant remembers reads as carelessness, and the user has no
 * way to tell which stretch was condensed — so the notice is quiet but always
 * present, and opens to the exact text the model now sees in place of those
 * messages.
 */
export function AssistantContextCompactedDataCard({
  data,
}: DataMessagePartProps<ProjectAgentContextCompactedPartData>) {
  const t = useTranslations('assistantAgent')
  return (
    <details className="border-l-2 border-[var(--glass-text-tertiary)]/30 pl-2 text-xs leading-5 text-[var(--glass-text-tertiary)]">
      <summary className="flex cursor-pointer list-none items-center gap-1.5">
        <AppIcon name="alert" className="h-3 w-3 shrink-0 opacity-60" />
        <span className="min-w-0 truncate">
          {t('cards.contextCompacted', { count: data.summarizedMessageCount })}
        </span>
      </summary>
      <div className="mt-1 whitespace-pre-wrap text-[var(--glass-text-secondary)]">
        {data.summaryText}
      </div>
    </details>
  )
}
