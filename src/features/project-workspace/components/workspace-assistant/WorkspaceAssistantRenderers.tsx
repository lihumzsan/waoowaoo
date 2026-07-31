'use client'

import React from 'react'
import {
  MessagePrimitive,
  useMessage,
  type DataMessagePartProps,
} from '@assistant-ui/react'
import type { ComponentProps } from 'react'
import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import BillingActionButton from '@/components/billing/BillingActionButton'
import { MediaAttachmentChips, TextAttachmentChips } from '@/components/project-assistant/AttachmentChips'
import {
  buildBillingActionQuotePreviewFromQuote,
  type BillingActionQuotePreview,
} from '@/lib/billing/action-quote-preview'
import type { ProjectContextPartData, TaskBatchSubmittedPartData } from '@/lib/project-agent/types'
import type { OperationPlanView } from '@/lib/operations/planning'
import { MarkdownTextPart } from './MarkdownTextPart'
import { readProjectAssistantTextAttachmentsFromMetadata } from '@/lib/project-agent/text-attachments'
import { readProjectAssistantMediaAttachmentsFromMetadata } from '@/lib/project-agent/media-attachments'
import { WorkspaceAssistantSubagentRecordsForMessage } from './WorkspaceAssistantSubagents'
import {
  HiddenWorkspaceAssistantReasoning,
  WorkspaceAssistantReasoningPart,
  WorkspaceAssistantWaitDots,
  useWorkspaceAssistantHasRunningSurface,
} from './WorkspaceAssistantReasoning'
import { WORKSPACE_ASSISTANT_HIDDEN_TRACE_TOOL_NAMES } from './workspace-assistant-run-trace'
import {
  summarizeBillingActionItems,
  type BillingActionItemSummary,
} from './billing-action-items'
import { WorkspaceAssistantToolCallCard } from './WorkspaceAssistantToolCall'
import {
  HiddenRuntimeContextDataCard,
} from './WorkspaceAssistantNotices'
import { WebSearchDataCard } from './WorkspaceAssistantWebSearch'
import { WorkspaceAssistantResourceLinks } from './WorkspaceAssistantResourceLinks'
import { isWorkspaceAssistantHiddenThreadMessageMetadata } from './workspace-assistant-panel-state'

type StandardMessagePartComponents = NonNullable<ComponentProps<typeof MessagePrimitive.Parts>['components']>
type WorkspaceAssistantMessagePartComponents = {
  readonly assistant: StandardMessagePartComponents
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

type ConfirmationActionDecision = 'idle' | 'confirming' | 'cancelling' | 'settled'

export function ConfirmationActionCard(props: {
  members: readonly {
    operationId: string
    title: string
    operationPlan: OperationPlanView | null
  }[]
  subtitle: string
  onConfirm: () => Promise<void>
  onCancel: () => Promise<void>
}) {
  const t = useTranslations('assistantAgent')
  // A pending approval accepts exactly one decision: the first click disables
  // both actions, and any submission failure is consumed here (the panel-level
  // control error shows the localized notice) instead of escaping to React.
  const [decision, setDecision] = React.useState<ConfirmationActionDecision>('idle')
  const members = props.members.map((member) => {
    const quote = member.operationPlan?.quote ?? null
    const quoteActionLabel = quote
      ? buildBillingActionSummaryLabel(quote, t)
      : null
    return {
      ...member,
      quotePreview: quote
        ? buildAssistantBillingQuotePreview({
            quote,
            actionLabel: quoteActionLabel,
            t,
          })
        : null,
    }
  })
  const submitDecision = (kind: 'confirm' | 'cancel'): void => {
    setDecision((current) => {
      if (current !== 'idle') return current
      void (async () => {
        try {
          await (kind === 'confirm' ? props.onConfirm() : props.onCancel())
          setDecision('settled')
        } catch {
          // The control layer already surfaced the failure; allow a retry.
          setDecision('idle')
        }
      })()
      return kind === 'confirm' ? 'confirming' : 'cancelling'
    })
  }
  const locked = decision !== 'idle'
  return (
    <div className="rounded-2xl border border-[var(--glass-stroke-base)] bg-white p-3 text-xs text-[var(--glass-text-secondary)]">
      <div className="mt-1 leading-5">{props.subtitle}</div>
      <div className="mt-2 space-y-2">
        {members.map((member) => (
          <div key={`${member.operationId}:${member.operationPlan?.planSnapshotId ?? ''}`}>
            <div className="text-sm font-semibold text-[var(--glass-text-primary)]">
              {member.title}
            </div>
            <BillingQuoteBlock preview={member.quotePreview} />
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <BillingActionButton
          type="button"
          icon="arrowRight"
          label={decision === 'confirming' ? t('cards.choiceSubmitting') : t('cards.confirmContinue')}
          quote={members.length === 1 ? members[0]?.quotePreview ?? null : null}
          className="flex-1 rounded-xl py-2 text-sm"
          disabled={locked}
          onClick={() => { submitDecision('confirm') }}
        />
        <button
          type="button"
          disabled={locked}
          className="shrink-0 whitespace-nowrap rounded-xl border border-[var(--glass-stroke-base)] bg-white px-3 py-2 text-sm font-medium text-[var(--glass-text-primary)] transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => { submitDecision('cancel') }}
        >
          {decision === 'cancelling' ? t('cards.choiceSubmitting') : t('cards.cancelAction')}
        </button>
      </div>
    </div>
  )
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


export function useWorkspaceAssistantMessagePartComponents(): WorkspaceAssistantMessagePartComponents {
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
        'agent-subagent-event': HiddenRuntimeContextDataCard,
        'assistant-resource-links': WorkspaceAssistantResourceLinks,
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
      },
      standard: {
        Text: MarkdownTextPart,
        Reasoning: HiddenWorkspaceAssistantReasoning,
        ReasoningGroup: HiddenWorkspaceAssistantReasoning,
        tools,
        data,
      },
    }
  }, [])
}

function HiddenWorkspaceAssistantInternalMessage(props: { children: React.ReactNode }) {
  const shouldHide = useMessage((state) => (
    isWorkspaceAssistantHiddenThreadMessageMetadata(state.metadata)
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

/**
 * "Undelivered" tag under the user bubble whose failed run rolled it back
 * from the model history. Pure projection (AR-07): the id is derived by the
 * panel from the persisted session run plus message order (see
 * resolveWorkspaceAssistantUndeliveredUserMessage in
 * workspace-assistant-panel-state.ts); this component stores no client-side
 * send state of its own.
 */
function WorkspaceAssistantUserUndeliveredMarker(props: {
  undeliveredUserMessageId: string | null
}) {
  const t = useTranslations('assistantAgent')
  const isUndelivered = useMessage((state) => (
    props.undeliveredUserMessageId !== null && state.id === props.undeliveredUserMessageId
  ))
  if (!isUndelivered) return null
  return (
    <div className="mt-1 flex items-center gap-1 text-[11px] leading-4 text-[var(--glass-tone-warn-fg)]">
      <AppIcon name="alert" className="h-3 w-3 shrink-0" />
      <span>{t('panel.undelivered')}</span>
    </div>
  )
}

export function WorkspaceAssistantThreadMessage(props: {
  messagePartComponents: WorkspaceAssistantMessagePartComponents
  subagents: ComponentProps<typeof WorkspaceAssistantSubagentRecordsForMessage>['subagents']
  onSelectSubagent: (subagentId: string) => void
  undeliveredUserMessageId?: string | null
}) {
  return (
    <>
      <MessagePrimitive.If user>
        <HiddenWorkspaceAssistantInternalMessage>
          <div className="ml-auto flex w-full max-w-[88%] flex-col items-end">
            <MessagePrimitive.Root className={WORKSPACE_ASSISTANT_USER_MESSAGE_CLASS}>
              <MessagePrimitive.Parts />
              <WorkspaceAssistantUserTextAttachments />
            </MessagePrimitive.Root>
            <WorkspaceAssistantUserUndeliveredMarker
              undeliveredUserMessageId={props.undeliveredUserMessageId ?? null}
            />
          </div>
        </HiddenWorkspaceAssistantInternalMessage>
      </MessagePrimitive.If>

      <MessagePrimitive.If assistant>
        <div className="space-y-1">
          <MessagePrimitive.Root className={WORKSPACE_ASSISTANT_MESSAGE_CLASS}>
            <MessagePrimitive.Parts
              components={props.messagePartComponents.assistant}
            />
            <WorkspaceAssistantSubagentRecordsForMessage subagents={props.subagents} onSelect={props.onSelectSubagent} />
          </MessagePrimitive.Root>
        </div>
      </MessagePrimitive.If>

      <MessagePrimitive.If system>
        <HiddenWorkspaceAssistantInternalMessage>
          <div className="space-y-1">
            <MessagePrimitive.Root className="space-y-2 px-1 py-1 text-sm leading-5 text-[var(--glass-text-tertiary)]">
              <MessagePrimitive.Parts components={props.messagePartComponents.standard} />
            </MessagePrimitive.Root>
          </div>
        </HiddenWorkspaceAssistantInternalMessage>
      </MessagePrimitive.If>
    </>
  )
}

export function WorkspaceAssistantPendingTurnPlaceholder(props: {
  readonly label?: string
}) {
  const hasRunningSurface = useWorkspaceAssistantHasRunningSurface()
  if (hasRunningSurface) return null

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
