'use client'

import { useLocale, useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { localizeProjectAgentOperationTitle } from '@/lib/project-agent/copy'
import { normalizeProjectAgentLocale } from '@/lib/project-agent/locale'
import type { WorkspaceAssistantFailureView } from './workspace-assistant-panel-state'

export function WorkspaceAssistantActiveRunCard(props: {
  operationIds: readonly string[]
  progress: {
    total: number
    terminal: number
    failed: number
    cancelled: number
  }
  failures: readonly WorkspaceAssistantFailureView[]
}) {
  const t = useTranslations('assistantAgent')
  const locale = normalizeProjectAgentLocale(useLocale())
  const operationTitles = props.operationIds.map((operationId) => localizeProjectAgentOperationTitle(operationId, locale))
  const active = props.progress.terminal < props.progress.total
  const failed = props.progress.failed > 0
  const canceled = props.progress.cancelled > 0
  const succeeded = Math.max(
    0,
    props.progress.terminal - props.progress.failed - props.progress.cancelled,
  )
  const running = Math.max(0, props.progress.total - props.progress.terminal)
  const partial = succeeded > 0 && (failed || canceled)
  const summary = partial
    ? t('toolCall.partial')
    : active
      ? t('toolCall.running')
      : failed
        ? t('toolCall.failed')
        : canceled
          ? t('toolCall.interrupted')
          : t('toolCall.success')
  const iconName = active ? 'loader' : failed || canceled ? 'alert' : 'check'
  return (
    <div className={`order-last rounded-2xl border bg-white p-3 text-sm leading-5 ${
      failed || canceled
        ? 'border-[var(--glass-tone-warn-fg)]/25 text-[var(--glass-tone-warn-fg)]'
        : 'border-[var(--glass-stroke-base)] text-[var(--glass-text-secondary)]'
    }`}>
      <div className="flex items-center gap-2">
        <AppIcon
          name={iconName}
          className={`h-3.5 w-3.5 shrink-0 ${active ? 'animate-spin text-[var(--glass-text-tertiary)]' : ''}`}
        />
        <div className="min-w-0 flex-1 text-sm font-semibold text-[var(--glass-text-primary)]">
          <div>
            {summary} · {t('toolCall.progressSummary', {
              succeeded,
              failed: props.progress.failed,
              canceled: props.progress.cancelled,
              running,
            })}
          </div>
          {operationTitles.length > 0 ? (
            <div className="mt-1 space-y-0.5 text-sm font-medium text-[var(--glass-text-secondary)]">
              {operationTitles.map((title, index) => <div key={`${props.operationIds[index]}:${title}`}>{title}</div>)}
            </div>
          ) : null}
        </div>
      </div>
      {props.failures.length > 0 ? (
        <div role="alert" className="mt-2 space-y-1.5 border-t border-current/10 pt-2">
          {props.failures.map((failure) => (
            <div key={`${failure.headline}:${failure.technical ?? ''}`} className="break-words text-xs leading-4">
              <div className="font-semibold">{failure.headline}</div>
              {failure.technical ? (
                <div className="mt-0.5 break-all text-[11px] opacity-70">{failure.technical}</div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
