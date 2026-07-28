'use client'

import React from 'react'
import {
  MessagePrimitive,
  useMessage,
  type DataMessagePartProps,
} from '@assistant-ui/react'
import type { ComponentProps } from 'react'
import { useMemo } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import BillingActionButton from '@/components/billing/BillingActionButton'
import { MediaAttachmentChips, TextAttachmentChips } from '@/components/project-assistant/AttachmentChips'
import {
  buildBillingActionQuotePreviewFromQuote,
  type BillingActionQuotePreview,
} from '@/lib/billing/action-quote-preview'
import type {
  ProjectAgentChoiceCardPartData,
  ProjectAgentOperationPlanPreviewPartData,
  ProjectContextPartData,
  TaskBatchSubmittedPartData,
  TaskSubmittedPartData,
} from '@/lib/project-agent/types'
import type { OperationPlanView } from '@/lib/operations/planning'
import { MarkdownTextPart } from './MarkdownTextPart'
import { localizeProjectAgentOperationTitle } from '@/lib/project-agent/copy'
import { normalizeProjectAgentLocale } from '@/lib/project-agent/locale'
import { readProjectAssistantTextAttachmentsFromMetadata } from '@/lib/project-agent/text-attachments'
import { readProjectAssistantMediaAttachmentsFromMetadata } from '@/lib/project-agent/media-attachments'
import { WorkspaceAssistantSubagentRecordsForMessage } from './WorkspaceAssistantSubagents'
import { AssistantChoiceCardView } from './WorkspaceAssistantChoiceCard'
import {
  HiddenWorkspaceAssistantReasoning,
  WorkspaceAssistantReasoningPart,
  WorkspaceAssistantRunReasoningStatus,
  WorkspaceAssistantRunTraceGroup,
  WorkspaceAssistantWaitDots,
} from './WorkspaceAssistantReasoning'
import {
  groupWorkspaceAssistantMessageParts,
  WORKSPACE_ASSISTANT_HIDDEN_TRACE_TOOL_NAMES,
} from './workspace-assistant-run-trace'
import {
  summarizeBillingActionItems,
  type BillingActionItemSummary,
} from './billing-action-items'
import { WorkspaceAssistantToolCallCard } from './WorkspaceAssistantToolCall'
import {
  AgentStopDataCard,
  AssistantContextCompactedDataCard,
  HiddenRuntimeContextDataCard,
} from './WorkspaceAssistantNotices'
import { WebSearchDataCard } from './WorkspaceAssistantWebSearch'
import { WorkspaceAssistantResourceLinks } from './WorkspaceAssistantResourceLinks'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isWorkspaceAssistantHiddenMetadata(metadata: unknown): boolean {
  if (!isRecord(metadata)) return false
  const custom = metadata.custom
  return isRecord(custom) && custom.workspaceAssistantHidden === true
}

type StandardMessagePartComponents = NonNullable<ComponentProps<typeof MessagePrimitive.Parts>['components']>
type GroupedMessagePartComponents = NonNullable<ComponentProps<typeof MessagePrimitive.Unstable_PartsGrouped>['components']>
type WorkspaceAssistantMessagePartComponents = {
  readonly assistant: GroupedMessagePartComponents
  readonly standard: StandardMessagePartComponents
}
type AssistantAgentTranslator = ReturnType<typeof useTranslations<'assistantAgent'>>

export const WORKSPACE_ASSISTANT_USER_MESSAGE_CLASS = 'max-w-full w-fit break-words rounded-2xl bg-neutral-100 px-3 py-2.5 text-base leading-6 text-[var(--glass-text-primary)] [overflow-wrap:anywhere]'
const WORKSPACE_ASSISTANT_MESSAGE_CLASS = 'flex min-w-0 max-w-full flex-col gap-3 px-1 py-1 text-base leading-6 text-[var(--glass-text-primary)]'
export function resolveProgressStageLabel(raw: string | null, progressT: ReturnType<typeof useTranslations<'progress'>>): string | null {
  if (!raw) return null
  if (!raw.startsWith('progress.')) return raw
  const key = raw.slice('progress.'.length)
  if (progressT.has(key)) return progressT(key)
  return `MISSING_MESSAGE:${raw}`
}

function translateBillingActionItemSummary(
  item: BillingActionItemSummary,
  t: AssistantAgentTranslator,
): string {
  switch (item.key) {
    case 'image':
      return t('cards.billingActionImageItems', { count: item.quantity })
    case 'video':
      return t('cards.billingActionVideoItems', { count: item.quantity })
    case 'music':
      return t('cards.billingActionMusicItems', { count: item.quantity })
    case 'voiceCharacters':
      return t('cards.billingActionVoiceCharacterItems', { count: item.quantity })
    case 'musicSeconds':
      return t('cards.billingActionMusicSecondItems', { count: item.quantity })
    case 'videoSeconds':
      return t('cards.billingActionVideoSecondItems', { count: item.quantity })
  }
}

function buildBillingActionSummaryLabel(
  quote: OperationPlanView['quote'],
  t: AssistantAgentTranslator,
): string | null {
  const items = summarizeBillingActionItems(quote.items)
  if (items.length === 0) return null
  const separator = t('cards.billingActionListSeparator')
  const label = items
    .map((item) => translateBillingActionItemSummary(item, t))
    .join(separator)
  return t('cards.billingActionSummary', { items: label })
}

function buildAssistantBillingQuotePreview(params: {
  readonly quote: OperationPlanView['quote']
  readonly actionLabel: string | null
  readonly t: AssistantAgentTranslator
}): BillingActionQuotePreview | null {
  const { quote, actionLabel, t } = params
  return buildBillingActionQuotePreviewFromQuote({
    quote,
    withCredits: (values) => actionLabel
      ? t('cards.billingActionQuoteWithCredits', { action: actionLabel, cost: values.cost })
      : t('cards.billingQuoteWithCredits', values),
    withoutCredits: (values) => actionLabel
      ? t('cards.billingActionQuoteWithoutCredits', { action: actionLabel })
      : t('cards.billingQuoteWithoutCredits', values),
  })
}

function BillingQuoteBlock(props: {
  preview: BillingActionQuotePreview | null
}) {
  const preview = props.preview
  if (!preview) return null
  return (
    <div className="mt-4 flex items-center gap-3 text-xs">
      <span className="shrink-0 whitespace-nowrap tabular-nums text-[var(--glass-text-tertiary)]">
        {preview.fullLabel}
      </span>
      <span className="h-px flex-1 bg-slate-200" />
    </div>
  )
}

export function ConfirmationActionCard(props: {
  operationId: string
  title: string
  subtitle: string
  operationPlan?: OperationPlanView | null
  onConfirm: () => Promise<void>
  onCancel: () => Promise<void>
}) {
  const t = useTranslations('assistantAgent')
  const quote = props.operationPlan?.quote ?? null
  const quoteActionLabel = quote ? buildBillingActionSummaryLabel(quote, t) : null
  const quotePreview = quote
    ? buildAssistantBillingQuotePreview({ quote, actionLabel: quoteActionLabel, t })
    : null
  return (
    <div className="rounded-2xl border border-[var(--glass-stroke-base)] bg-white p-3 text-xs text-[var(--glass-text-secondary)]">
      <div className="text-sm font-semibold text-[var(--glass-text-primary)]">{props.title}</div>
      <div className="mt-1 leading-5">{props.subtitle}</div>
      <BillingQuoteBlock preview={quotePreview} />
      <div className="mt-3 flex gap-2">
        <BillingActionButton
          type="button"
          icon="arrowRight"
          label={t('cards.confirmContinue')}
          quote={quotePreview}
          className="flex-1 rounded-xl py-2 text-sm"
          onClick={() => { void props.onConfirm() }}
        />
        <button
          type="button"
          className="shrink-0 whitespace-nowrap rounded-xl border border-[var(--glass-stroke-base)] bg-white px-3 py-2 text-sm font-medium text-[var(--glass-text-primary)] transition-colors hover:bg-neutral-100"
          onClick={() => { void props.onCancel() }}
        >
          {t('cards.cancelAction')}
        </button>
      </div>
    </div>
  )
}

function OperationPlanPreviewDataCard(props: DataMessagePartProps<ProjectAgentOperationPlanPreviewPartData>) {
  const t = useTranslations('assistantAgent')
  const locale = normalizeProjectAgentLocale(useLocale())
  const title = localizeProjectAgentOperationTitle(props.data.operationId, locale)
  const quoteActionLabel = buildBillingActionSummaryLabel(props.data.operationPlan.quote, t)
  const quotePreview = buildAssistantBillingQuotePreview({
    quote: props.data.operationPlan.quote,
    actionLabel: quoteActionLabel,
    t,
  })
  return (
    <div className="rounded-2xl border border-[var(--glass-stroke-base)] bg-white p-3 text-xs text-[var(--glass-text-secondary)]">
      <div className="text-sm font-semibold text-[var(--glass-text-primary)]">{title}</div>
      <div className="mt-1 leading-5">{t('cards.billingQuotePreview')}</div>
      <BillingQuoteBlock preview={quotePreview} />
    </div>
  )
}

function TaskSubmittedDataCard({ data }: DataMessagePartProps<TaskSubmittedPartData>) {
  void data
  return null
}

function TaskBatchSubmittedDataCard({ data }: DataMessagePartProps<TaskBatchSubmittedPartData>) {
  void data
  return null
}

function ProjectContextDataCard({ data }: DataMessagePartProps<ProjectContextPartData>) {
  const t = useTranslations('assistantAgent')
  return (
    <details className="group text-sm leading-5 text-[var(--glass-text-tertiary)]">
      <summary className="flex cursor-pointer list-none items-center gap-2">
        <AppIcon name="folder" className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">{t('cards.projectContext')} · {data.context.projectName} · {data.context.episodeName}</span>
        <AppIcon name="chevronDown" className="h-3 w-3 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="ml-5 mt-1 text-xs">
        {t('cards.workspaceLabel')}: {t('panel.workspaceStatus')}
      </div>
    </details>
  )
}


interface WorkspaceAssistantMessagePartComponentsOptions {
  hideChoiceCards?: boolean
  onSubmitChoiceResponse: (params: {
    runId: string
    interruptionId: string
    cardId: string
    toolCallId: string
    output: Record<string, unknown>
    visibleUserText?: string
  }) => Promise<void>
}

export function useWorkspaceAssistantMessagePartComponents({
  hideChoiceCards = false,
  onSubmitChoiceResponse,
}: WorkspaceAssistantMessagePartComponentsOptions): WorkspaceAssistantMessagePartComponents {
  return useMemo<WorkspaceAssistantMessagePartComponents>(() => {
    const tools = {
      Fallback: WorkspaceAssistantToolCallCard,
      by_name: Object.fromEntries(
        WORKSPACE_ASSISTANT_HIDDEN_TRACE_TOOL_NAMES.map((toolName) => [
          toolName,
          HiddenRuntimeContextDataCard,
        ]),
      ),
    }
    const data = {
      by_name: {
        'agent-run': WorkspaceAssistantRunReasoningStatus,
        'agent-operation-start': HiddenRuntimeContextDataCard,
        'agent-subagent-event': HiddenRuntimeContextDataCard,
        'agent-operation-plan-preview': OperationPlanPreviewDataCard,
        'agent-stop': AgentStopDataCard,
        'agent-runtime-context': HiddenRuntimeContextDataCard,
        'assistant-choice-card': hideChoiceCards
          ? HiddenRuntimeContextDataCard
          : (props: DataMessagePartProps<ProjectAgentChoiceCardPartData>) => (
              <AssistantChoiceCardView
                data={props.data}
                onSubmitChoiceResponse={onSubmitChoiceResponse}
              />
            ),
        'agent-interruption-resolved': HiddenRuntimeContextDataCard,
        'assistant-choice-resolved': HiddenRuntimeContextDataCard,
        'assistant-context-compacted': AssistantContextCompactedDataCard,
        'assistant-resource-links': WorkspaceAssistantResourceLinks,
        'task-submitted': TaskSubmittedDataCard,
        'task-batch-submitted': TaskBatchSubmittedDataCard,
        'project-context': ProjectContextDataCard,
        'web-search': WebSearchDataCard,
      },
    }
    return {
      assistant: {
        Text: MarkdownTextPart,
        Reasoning: WorkspaceAssistantReasoningPart,
        tools,
        data,
        Group: WorkspaceAssistantRunTraceGroup,
      },
      standard: {
        Text: MarkdownTextPart,
        Reasoning: HiddenWorkspaceAssistantReasoning,
        ReasoningGroup: HiddenWorkspaceAssistantReasoning,
        tools,
        data,
      },
    }
  }, [
    hideChoiceCards,
    onSubmitChoiceResponse,
  ])
}

function HiddenConversationSummaryMessage(props: { children: React.ReactNode }) {
  const shouldHide = useMessage((state) => (
    state.metadata.custom?.projectAgentConversationSummary === true
      || isWorkspaceAssistantHiddenMetadata(state.metadata)
  ))
  if (shouldHide) return null
  return <>{props.children}</>
}

function WorkspaceAssistantUserTextAttachments() {
  const metadata = useMessage((state) => state.metadata)
  const attachments = readProjectAssistantTextAttachmentsFromMetadata(metadata)
  const mediaAttachments = readProjectAssistantMediaAttachmentsFromMetadata(metadata)
  return (
    <>
      <TextAttachmentChips attachments={attachments} className={attachments.length > 0 ? 'mt-2' : undefined} />
      <MediaAttachmentChips attachments={mediaAttachments} className={mediaAttachments.length > 0 ? 'mt-2' : undefined} />
    </>
  )
}

export function WorkspaceAssistantThreadMessage(props: { messagePartComponents: WorkspaceAssistantMessagePartComponents; subagents: ComponentProps<typeof WorkspaceAssistantSubagentRecordsForMessage>['subagents']; onSelectSubagent: (subagentId: string) => void }) {
  return (
    <>
      <MessagePrimitive.If user>
        <HiddenConversationSummaryMessage>
          <div className="ml-auto flex w-full max-w-[88%] flex-col items-end">
            <MessagePrimitive.Root className={WORKSPACE_ASSISTANT_USER_MESSAGE_CLASS}>
              <MessagePrimitive.Parts />
              <WorkspaceAssistantUserTextAttachments />
            </MessagePrimitive.Root>
          </div>
        </HiddenConversationSummaryMessage>
      </MessagePrimitive.If>

      <MessagePrimitive.If assistant>
        <div className="space-y-1">
          <MessagePrimitive.Root className={WORKSPACE_ASSISTANT_MESSAGE_CLASS}>
            <MessagePrimitive.Unstable_PartsGrouped
              groupingFunction={groupWorkspaceAssistantMessageParts}
              components={props.messagePartComponents.assistant}
            />
            <WorkspaceAssistantSubagentRecordsForMessage subagents={props.subagents} onSelect={props.onSelectSubagent} />
          </MessagePrimitive.Root>
        </div>
      </MessagePrimitive.If>

      <MessagePrimitive.If system>
        <HiddenConversationSummaryMessage>
          <div className="space-y-1">
            <MessagePrimitive.Root className="space-y-2 px-1 py-1 text-sm leading-5 text-[var(--glass-text-tertiary)]">
              <MessagePrimitive.Parts components={props.messagePartComponents.standard} />
            </MessagePrimitive.Root>
          </div>
        </HiddenConversationSummaryMessage>
      </MessagePrimitive.If>
    </>
  )
}

export function WorkspaceAssistantPendingTurnPlaceholder(props: {
  readonly label?: string
}) {
  return (
    <div className="space-y-1">
      <div className={WORKSPACE_ASSISTANT_MESSAGE_CLASS}>
        <div className="flex items-center gap-2 text-sm text-[var(--glass-text-secondary)]">
          <WorkspaceAssistantWaitDots />
          {props.label ? <span>{props.label}</span> : null}
        </div>
      </div>
    </div>
  )
}
