'use client'

import { useLocale, useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { localizeProjectAgentOperationTitle } from '@/lib/project-agent/copy'
import { normalizeProjectAgentLocale } from '@/lib/project-agent/locale'

export function WorkspaceAssistantActiveRunCard(props: {
  operationIds: readonly string[]
  taskCount: number
}) {
  const t = useTranslations('assistantAgent')
  const locale = normalizeProjectAgentLocale(useLocale())
  const operationTitles = props.operationIds.map((operationId) => localizeProjectAgentOperationTitle(operationId, locale))
  return (
    <div className="order-last rounded-2xl border border-[var(--glass-stroke-base)] bg-white p-3 text-sm leading-5 text-[var(--glass-text-secondary)]">
      <div className="flex items-center gap-2">
        <AppIcon name="loader" className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--glass-text-tertiary)]" />
        <div className="min-w-0 flex-1 text-sm font-semibold text-[var(--glass-text-primary)]">
          <div>{t('toolCall.running')} · {t('toolCall.taskCount', { count: props.taskCount })}</div>
          <div className="mt-1 space-y-0.5 text-sm font-medium text-[var(--glass-text-secondary)]">
            {operationTitles.map((title, index) => <div key={`${props.operationIds[index]}:${title}`}>{title}</div>)}
          </div>
        </div>
      </div>
    </div>
  )
}
