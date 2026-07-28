'use client'

import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { useLocale, useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { localizeProjectAgentOperationTitle } from '@/lib/project-agent/copy'
import { normalizeProjectAgentLocale } from '@/lib/project-agent/locale'
import type { OperationSubmissionState } from '@/lib/runtime/lifecycle-states'
import { useWorkspaceAssistantRunningSurface } from './WorkspaceAssistantReasoning'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readToolResultFailureMessage(result: unknown): string | null {
  if (!isRecord(result) || result.ok !== false) return null
  const error = isRecord(result.error) ? result.error : null
  const message = typeof error?.message === 'string' && error.message.trim() ? error.message.trim() : ''
  if (message) return message
  const code = typeof error?.code === 'string' && error.code.trim() ? error.code.trim() : ''
  return code || null
}

function readOperationSubmissionState(result: unknown): OperationSubmissionState | null {
  if (!isRecord(result) || result.ok !== true || !isRecord(result.data) || result.data.async !== true) return null
  const taskIds = typeof result.data.taskId === 'string'
    ? [result.data.taskId]
    : Array.isArray(result.data.taskIds)
      ? result.data.taskIds
      : []
  const taskRefs = taskIds.flatMap((taskId) => (
    typeof taskId === 'string' && taskId.trim() ? [{ taskId: taskId.trim() }] : []
  ))
  return taskRefs.length > 0 ? { phase: 'submitted', taskRefs } : null
}

export function WorkspaceAssistantToolCallCard(props: ToolCallMessagePartProps) {
  const t = useTranslations('assistantAgent')
  const locale = normalizeProjectAgentLocale(useLocale())
  const operationTitle = localizeProjectAgentOperationTitle(props.toolName, locale)
  const toolStatus = props.status.type
  useWorkspaceAssistantRunningSurface(
    `tool:${props.toolCallId}`,
    toolStatus === 'running' || toolStatus === 'requires-action',
  )
  const failureMessage = readToolResultFailureMessage(props.result)
  const submissionState = toolStatus === 'complete' ? readOperationSubmissionState(props.result) : null
  const summaryText = toolStatus === 'complete'
    ? failureMessage ? t('toolCall.failed') : submissionState?.phase === 'submitted' ? t('toolCall.submitted') : t('toolCall.success')
    : toolStatus === 'requires-action'
      ? t('toolCall.needsAction')
      : t('toolCall.running')
  const iconName = toolStatus === 'incomplete'
    ? 'loader'
    : failureMessage
      ? 'alert'
      : 'settingsHex'

  return (
    <div className={`text-sm leading-5 ${failureMessage ? 'text-[var(--glass-tone-warn-fg)]' : 'text-[var(--glass-text-tertiary)]'}`}>
      <div className="flex items-center gap-2">
        <AppIcon name={iconName} className={`h-3.5 w-3.5 shrink-0 ${toolStatus === 'incomplete' ? 'animate-spin' : ''}`} />
        <span className="min-w-0 truncate">{summaryText} · {operationTitle}</span>
      </div>
      {failureMessage ? (
        <div className="ml-5 mt-1 rounded-lg bg-[var(--glass-tone-warn-bg)]/45 px-2 py-1 text-xs leading-4">
          {t('toolCall.failedDetail')}
        </div>
      ) : null}
    </div>
  )
}
