'use client'

import { useLocale, useTranslations } from 'next-intl'
import type { DataMessagePartProps } from '@assistant-ui/react'
import { AppIcon } from '@/components/ui/icons'
import { localizeProjectAgentOperationTitle } from '@/lib/project-agent/copy'
import { normalizeProjectAgentLocale } from '@/lib/project-agent/locale'
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
  const errors = useTranslations('errors')
  const locale = normalizeProjectAgentLocale(useLocale())
  if (data.reason === 'awaiting_user_confirmation') return null
  const operationTitles = data.operationIds.map((operationId: string) => (
    localizeProjectAgentOperationTitle(operationId, locale)
  ))
  const reasons = data.codes.map((code: string) => ({
    code,
    message: errors.has(code) ? errors(code) : t('cards.toolErrorCorrection'),
  }))
  return (
    <div role="alert" className="flex items-start gap-2 pl-2 text-sm leading-5 text-[var(--glass-tone-danger-fg)]">
      <AppIcon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0">
        <div className="font-semibold">{t('cards.toolErrorBoundary')}</div>
        {operationTitles.length > 0 ? (
          <div className="break-words text-[var(--glass-text-secondary)]">
            {operationTitles.join(t('cards.toolErrorListSeparator'))}
          </div>
        ) : null}
        {reasons.map((reason: { readonly code: string; readonly message: string }) => (
          <div key={reason.code} className="mt-1 break-words text-xs text-[var(--glass-text-secondary)]">
            <span>{reason.message}</span>
            <span className="ml-1 font-mono text-[11px] opacity-70">({reason.code})</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Marks one successfully adopted context compression checkpoint. The
 * checkpoint body is model input, not user-facing message content.
 */
export function AssistantContextCompactedDataCard({
  data,
}: DataMessagePartProps<ProjectAgentContextCompactedPartData>) {
  const t = useTranslations('assistantAgent')
  return (
    <div className="flex items-center gap-1.5 pl-2 text-xs leading-5 text-[var(--glass-text-tertiary)]">
      <AppIcon name="check" className="h-3 w-3 shrink-0 opacity-60" />
      <span className="min-w-0 truncate">
        {t('cards.contextCompacted', { count: data.replacedItemCount })}
      </span>
    </div>
  )
}

/**
 * Parts the runtime needs in the stream but the reader never should see:
 * approval bookkeeping, runtime context snapshots and already-resolved
 * interruptions. Rendering nothing is the intended behaviour, not a stub.
 */
export function HiddenApprovalRequestDataCard() {
  return null
}

export function HiddenRuntimeContextDataCard() {
  return null
}
