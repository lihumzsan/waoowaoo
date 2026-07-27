'use client'

import React from 'react'
import Image from 'next/image'
import {
  MessagePrimitive,
  useMessage,
  type DataMessagePartProps,
} from '@assistant-ui/react'
import type { ComponentProps } from 'react'
import { useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import BillingActionButton from '@/components/billing/BillingActionButton'
import { TextAttachmentChips } from '@/components/project-assistant/TextAttachmentUploadDialog'
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
import type { ProjectAgentChoiceSelection } from '@/lib/project-agent/choice-result'
import type { OperationPlanView } from '@/lib/operations/planning'
import { MarkdownTextPart } from './MarkdownTextPart'
import {
  buildChoiceCardCustomOptionValue,
  CHOICE_CARD_CUSTOM_OPTION_VALUE_PREFIX,
  isChoiceCardSubmitReady,
  mergeChoiceCardCustomOptions,
  shouldShowChoiceCardManualSubmit,
  type ChoiceCardCustomOptions,
  type ChoiceCardSelections,
} from './choice-card-actions'
import { localizeProjectAgentOperationTitle } from '@/lib/project-agent/copy'
import { normalizeProjectAgentLocale } from '@/lib/project-agent/locale'
import { readProjectAssistantTextAttachmentsFromMetadata } from '@/lib/project-agent/text-attachments'
import { submitFromEnterKey } from '@/lib/ui/keyboard-submit'
import { WorkspaceAssistantSubagentRecordsForMessage } from './WorkspaceAssistantSubagents'
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

function RatioChoiceShape(props: {
  ratio: string
  selected: boolean
}) {
  const [rawWidth, rawHeight] = props.ratio.split(':').map(Number)
  const width = Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : 1
  const height = Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : 1
  const max = Math.max(width, height)
  return (
    <div className="flex h-9 w-12 items-center justify-center">
      <div
        className={`rounded-[4px] border-2 transition-colors ${props.selected ? 'border-neutral-900 bg-neutral-900/10' : 'border-[var(--glass-stroke-strong)] bg-white'}`}
        style={{
          width: `${String(Math.max(14, Math.round(34 * (width / max))))}px`,
          height: `${String(Math.max(14, Math.round(34 * (height / max))))}px`,
        }}
      />
    </div>
  )
}

export function buildWorkspaceAssistantChoiceSelectionOutput(params: {
  card: Pick<ProjectAgentChoiceCardPartData, 'mode'>
  groups: ProjectAgentChoiceCardPartData['groups']
  selections: ChoiceCardSelections
}): Record<string, unknown> {
  if (params.card.mode === 'confirm' || params.card.mode === 'confirm_or_text') {
    return { kind: 'confirm' }
  }
  const selections: ProjectAgentChoiceSelection[] = params.groups.flatMap<ProjectAgentChoiceSelection>((group) => {
    const selectedValue = params.selections[group.key]
    if (!selectedValue) return []
    const option = group.options.find((candidate) => candidate.value === selectedValue)
    if (!option) throw new Error(`ASSISTANT_CHOICE_OPTION_NOT_FOUND:${group.key}:${selectedValue}`)
    return selectedValue.startsWith(CHOICE_CARD_CUSTOM_OPTION_VALUE_PREFIX)
      ? [{ groupKey: group.key, kind: 'text', text: option.label }]
      : [{ groupKey: group.key, kind: 'option', value: selectedValue }]
  })
  return {
    kind: 'select',
    selections,
  }
}

export function AssistantChoiceCardView(props: {
  data: ProjectAgentChoiceCardPartData
  onSubmitChoiceResponse: (params: {
    runId: string
    interruptionId: string
    cardId: string
    toolCallId: string
    output: Record<string, unknown>
    visibleUserText?: string
  }) => Promise<void>
  onSubmitted?: (cardId: string) => void
}) {
  const t = useTranslations('assistantAgent')
  const card = props.data
  const [selections, setSelections] = useState<ChoiceCardSelections>({})
  const [customOptions, setCustomOptions] = useState<ChoiceCardCustomOptions>({})
  const [activeGroupIndex, setActiveGroupIndex] = useState(0)
  const [replyText, setReplyText] = useState('')
  const [replyFocused, setReplyFocused] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isConfirmOnly = card.mode === 'confirm'
  const isConfirmOrReply = card.mode === 'confirm_or_text'
  const usesPerQuestionReply = card.replyMode === 'per_group'
  const showManualSubmit = shouldShowChoiceCardManualSubmit(card)
  const choiceGroups = useMemo(
    () => mergeChoiceCardCustomOptions(card.groups, customOptions),
    [card.groups, customOptions],
  )
  const ready = isChoiceCardSubmitReady(choiceGroups, selections)
  const activeGroup = choiceGroups[activeGroupIndex] ?? choiceGroups[0] ?? null
  const progressLabel = card.groups.length > 1 ? `${String(activeGroupIndex + 1)}/${String(card.groups.length)}` : null
  const canGoBack = activeGroupIndex > 0
  const isAspectRatioGroup = activeGroup?.presentation === 'aspect_ratio'
  const isImageGroup = activeGroup?.presentation === 'image'

  const readChoiceRunId = (): string => {
    const runId = card.runId?.trim()
    if (!runId) throw new Error('ASSISTANT_CHOICE_CARD_RUN_ID_MISSING')
    return runId
  }

  const handleReplySubmit = async () => {
    const trimmedReply = replyText.trim()
    if (!trimmedReply || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await props.onSubmitChoiceResponse({
        runId: readChoiceRunId(),
        interruptionId: card.interruptionId,
        cardId: card.cardId,
        toolCallId: card.toolCallId,
        output: { kind: 'text', text: trimmedReply },
        visibleUserText: trimmedReply,
      })
      props.onSubmitted?.(card.cardId)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmit = async (
    submitSelections: ChoiceCardSelections = selections,
    submitGroups = choiceGroups,
  ) => {
    if (!isChoiceCardSubmitReady(submitGroups, submitSelections) || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await props.onSubmitChoiceResponse({
        runId: readChoiceRunId(),
        interruptionId: card.interruptionId,
        cardId: card.cardId,
        toolCallId: card.toolCallId,
        output: buildWorkspaceAssistantChoiceSelectionOutput({
          card,
          groups: submitGroups,
          selections: submitSelections,
        }),
      })
      props.onSubmitted?.(card.cardId)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
    } finally {
      setSubmitting(false)
    }
  }

  const handlePerQuestionReplySubmit = async () => {
    const group = activeGroup
    const trimmedReply = replyText.trim()
    if (!group || !trimmedReply || submitting) return
    const customOption = {
      value: buildChoiceCardCustomOptionValue(group.key),
      label: trimmedReply,
      description: null,
    }
    const nextCustomOptions = {
      ...customOptions,
      [group.key]: customOption,
    }
    const nextSelections = {
      ...selections,
      [group.key]: customOption.value,
    }
    setCustomOptions(nextCustomOptions)
    setSelections(nextSelections)
    setReplyText('')
    setError(null)
    if (activeGroupIndex < card.groups.length - 1) {
      setActiveGroupIndex((current) => Math.min(current + 1, card.groups.length - 1))
    }
  }

  const renderActiveGroup = () => {
    if (!activeGroup) return null
    const optionGridClass = isAspectRatioGroup
      ? 'grid grid-cols-3 gap-2'
      : isImageGroup
        ? 'grid grid-cols-1 gap-2'
        : 'grid grid-cols-2 gap-2'
    const groupLabelClass = 'text-xs font-semibold text-[var(--glass-text-tertiary)]'
    return (
      <div className="mt-2 space-y-2">
        <div className={groupLabelClass}>{activeGroup.label}</div>
        <div className={optionGridClass}>
          {activeGroup.options.map((option) => {
            const selected = selections[activeGroup.key] === option.value
            return (
              <button
                key={`${activeGroup.key}:${option.value}`}
                type="button"
                className={`w-full overflow-hidden rounded-xl border text-left transition-colors ${selected ? 'border-neutral-900 bg-neutral-50 ring-1 ring-neutral-900/10' : 'border-[var(--glass-stroke-base)] bg-white/80 hover:border-[var(--glass-stroke-strong)] hover:bg-neutral-100'}`}
                onClick={() => {
                  const nextSelections = {
                    ...selections,
                    [activeGroup.key]: option.value,
                  }
                  setSelections(nextSelections)
                  setReplyText('')
                  setError(null)
                  if (activeGroupIndex < card.groups.length - 1) {
                    setActiveGroupIndex((current) => Math.min(current + 1, card.groups.length - 1))
                  }
                }}
                disabled={submitting}
              >
                {option.imageUrl ? (
                  <Image
                    src={option.imageUrl}
                    alt={option.label}
                    width={640}
                    height={360}
                    unoptimized
                    className="h-28 w-full object-cover"
                  />
                ) : null}
                <div className={`p-2 ${isAspectRatioGroup ? 'flex flex-col items-center gap-1.5 text-center' : 'space-y-1'}`}>
                  {isAspectRatioGroup ? <RatioChoiceShape ratio={option.value} selected={selected} /> : null}
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className={`min-w-0 flex-1 truncate text-sm font-semibold ${selected ? 'text-neutral-900' : 'text-[var(--glass-text-primary)]'}`}>{option.label}</span>
                    {selected ? <AppIcon name="check" className="h-3.5 w-3.5 shrink-0 text-neutral-900" /> : null}
                  </div>
                  {!isAspectRatioGroup && option.description ? (
                    <div className="line-clamp-1 text-xs leading-5 text-[var(--glass-text-secondary)]">{option.description}</div>
                  ) : null}
                  {!isAspectRatioGroup && option.meta ? (
                    <div className="truncate text-xs text-[var(--glass-text-tertiary)]">{option.meta}</div>
                  ) : null}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  const renderReplyInput = () => {
    const perQuestionLabel = usesPerQuestionReply && activeGroup ? activeGroup.label : null
    const replyAriaLabel = perQuestionLabel
      ? t('cards.choiceCustomOptionLabel', { label: perQuestionLabel })
      : card.replyLabel || t('cards.choiceReplyLabel')
    const replyPlaceholder = perQuestionLabel
      ? t('cards.choiceCustomOptionPlaceholder', { label: perQuestionLabel })
      : card.replyPlaceholder || t('cards.choiceReplyPlaceholder')
    const replySubmitLabel = perQuestionLabel
      ? t('cards.choiceCustomOptionSubmit', { label: perQuestionLabel })
      : card.replySubmitLabel || t('cards.choiceReplySubmit')
    return (
      <div className="relative">
        <textarea
          value={replyText}
          rows={1}
          aria-label={replyAriaLabel}
          onFocus={() => setReplyFocused(true)}
          onBlur={() => setReplyFocused(false)}
          onChange={(event) => {
            setReplyText(event.target.value)
            setError(null)
          }}
          onKeyDown={(event) => {
            submitFromEnterKey(event, () => {
              if (usesPerQuestionReply) {
                void handlePerQuestionReplySubmit()
                return
              }
              void handleReplySubmit()
            })
          }}
          placeholder={replyFocused ? '' : replyPlaceholder}
          className="min-h-11 max-h-28 w-full resize-none overflow-y-auto rounded-xl border border-[var(--glass-stroke-base)] bg-white/85 px-3 py-2.5 pr-12 text-xs leading-5 text-[var(--glass-text-primary)] outline-none transition-colors [field-sizing:content] placeholder:text-[var(--glass-text-tertiary)] hover:bg-neutral-50 focus:border-neutral-400 focus:bg-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={submitting}
        />
        <button
          type="button"
          aria-label={replySubmitLabel}
          className="absolute bottom-2 right-2 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--glass-text-primary)] text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-55"
          onClick={() => {
            if (usesPerQuestionReply) {
              void handlePerQuestionReplySubmit()
              return
            }
            void handleReplySubmit()
          }}
          disabled={submitting || !replyText.trim()}
        >
          <AppIcon name="arrowRight" className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-[var(--glass-stroke-base)] bg-white p-3 text-xs text-[var(--glass-text-secondary)]">
      <div className="flex items-center gap-2">
        {canGoBack ? (
          <button
            type="button"
            aria-label={t('cards.choiceBack')}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--glass-stroke-base)] bg-white text-[var(--glass-text-secondary)] transition-colors hover:bg-neutral-100 hover:text-[var(--glass-text-primary)] disabled:opacity-60"
            onClick={() => {
              setActiveGroupIndex((current) => Math.max(0, current - 1))
              setReplyText('')
              setError(null)
            }}
            disabled={submitting}
          >
            <AppIcon name="chevronLeft" className="h-4 w-4" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1 text-sm font-semibold text-[var(--glass-text-primary)]">{card.title}</div>
        {progressLabel ? (
          <div className="rounded-full border border-[var(--glass-stroke-base)] bg-white/85 px-2 py-0.5 text-xs font-semibold text-[var(--glass-text-tertiary)]">
            {progressLabel}
          </div>
        ) : null}
      </div>
      {card.description ? <div className="mt-1 line-clamp-2 leading-5">{card.description}</div> : null}
      {isConfirmOnly || isConfirmOrReply ? renderActiveGroup() : null}
      {isConfirmOnly ? (
        <div className="mt-3">
          <button
            type="button"
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            onClick={() => { void handleSubmit() }}
            disabled={!ready || submitting}
          >
            {submitting ? t('cards.choiceSubmitting') : card.submitLabel}
          </button>
        </div>
      ) : isConfirmOrReply ? (
        <div className="mt-3 space-y-2">
          <button
            type="button"
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            onClick={() => { void handleSubmit() }}
            disabled={!ready || submitting}
          >
            {submitting ? t('cards.choiceSubmitting') : card.submitLabel}
          </button>
          {renderReplyInput()}
        </div>
      ) : activeGroup ? renderActiveGroup() : null}
      {error ? <div className="mt-3 text-xs leading-5 text-[var(--glass-tone-warn-fg)]">{t('cards.choiceSubmitFailed', { error })}</div> : null}
      {showManualSubmit ? (
        <>
          <button
            type="button"
            className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            onClick={() => { void handleSubmit() }}
            disabled={!ready || submitting}
          >
            {submitting ? t('cards.choiceSubmitting') : card.submitLabel}
          </button>
          {!ready ? <div className="mt-1.5 text-xs text-[var(--glass-text-tertiary)]">{t('cards.choiceRequired')}</div> : null}
        </>
      ) : null}
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
  return <TextAttachmentChips attachments={attachments} className={attachments.length > 0 ? 'mt-2' : undefined} />
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

export function WorkspaceAssistantPendingTurnPlaceholder() {
  return <div className="space-y-1"><div className={WORKSPACE_ASSISTANT_MESSAGE_CLASS}><WorkspaceAssistantWaitDots /></div></div>
}
