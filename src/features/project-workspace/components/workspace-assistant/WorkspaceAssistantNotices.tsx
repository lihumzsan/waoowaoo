import { useTranslations } from 'next-intl'
import type { DataMessagePartProps } from '@assistant-ui/react'
import { AppIcon } from '@/components/ui/icons'
import type { ProjectAgentContextCompactedPartData } from '@/lib/project-agent/types'

export function AssistantContextCompactedDataCard({
  data,
}: DataMessagePartProps<ProjectAgentContextCompactedPartData>) {
  const t = useTranslations('assistantAgent')
  return (
    <div className="flex items-center gap-1.5 border-l-2 border-[var(--glass-text-tertiary)]/30 pl-2 text-xs leading-5 text-[var(--glass-text-tertiary)]">
      <AppIcon name="alert" className="h-3 w-3 shrink-0 opacity-60" />
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
