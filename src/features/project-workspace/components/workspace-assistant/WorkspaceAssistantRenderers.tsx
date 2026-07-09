'use client'

import React from 'react'
import Image from 'next/image'
import {
  MessagePrimitive,
  useMessage,
  type DataMessagePartProps,
  type ReasoningMessagePartProps,
  type ToolCallMessagePartProps,
} from '@assistant-ui/react'
import type { ComponentProps, CSSProperties } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { useEstimatedTaskProgress } from '@/lib/query/hooks/useEstimatedTaskProgress'
import ImagePreviewModal from '@/components/ui/ImagePreviewModal'
import { useTaskTargetStateMap, type TaskTargetState } from '@/lib/query/hooks/useTaskTargetStateMap'
import { useQuery } from '@tanstack/react-query'
import BillingActionButton from '@/components/billing/BillingActionButton'
import { TextAttachmentChips } from '@/components/project-assistant/TextAttachmentUploadDialog'
import {
  buildBillingActionQuotePreviewFromQuote,
  type BillingActionQuotePreview,
} from '@/lib/billing/action-quote-preview'
import type {
  EditStylePreviewGenerationPartData,
  ProjectAgentChoiceCardPartData,
  ProjectAgentOperationPlanPreviewPartData,
  ProjectAgentStopPartData,
  ProjectContextPartData,
  ProjectPhasePartData,
  TaskBatchSubmittedPartData,
  TaskSubmittedPartData,
} from '@/lib/project-agent/types'
import type { OperationPlanView } from '@/lib/operations/planning'
import { useConfirmProjectEditStylePreview } from '@/lib/query/hooks'
import { MarkdownTextPart } from './MarkdownTextPart'
import {
  buildChoiceCardCustomOptionValue,
  isChoiceCardSubmitReady,
  mergeChoiceCardCustomOptions,
  resolveChoiceCardSelectionLabels,
  shouldShowChoiceCardManualSubmit,
  type ChoiceCardCustomOptions,
  type ChoiceCardSelections,
} from './choice-card-actions'
import { EDIT_SCRIPT_VIDEO_RATIOS, type EditScriptVideoRatio } from '@/lib/edit-script/types'
import { TASK_TYPE } from '@/lib/task/types'
import { apiFetch } from '@/lib/api-fetch'
import type { ProjectEditBible, ProjectEditStylePreview } from '@/types/project'
import { queryKeys } from '@/lib/query/keys'
import { WorkspaceAssistantThinkingIndicator } from './WorkspaceAssistantThinkingIndicator'
import { localizeProjectAgentOperationTitle } from '@/lib/project-agent/copy'
import { normalizeProjectAgentLocale } from '@/lib/project-agent/locale'
import { readProjectAssistantTextAttachmentsFromMetadata } from '@/lib/project-agent/text-attachments'
import { submitFromEnterKey } from '@/lib/ui/keyboard-submit'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isWorkspaceAssistantHiddenMetadata(metadata: unknown): boolean {
  if (!isRecord(metadata)) return false
  const custom = metadata.custom
  return isRecord(custom) && custom.workspaceAssistantHidden === true
}

type MessagePartComponents = NonNullable<ComponentProps<typeof MessagePrimitive.Parts>['components']>
type AssistantAgentTranslator = ReturnType<typeof useTranslations<'assistantAgent'>>
type BillingQuoteItemView = OperationPlanView['quote']['items'][number]
type BillingActionItemKey =
  | 'image'
  | 'video'
  | 'music'
  | 'musicSeconds'
  | 'videoSeconds'

interface BillingActionItemSummary {
  readonly key: BillingActionItemKey
  readonly quantity: number
}

export const WORKSPACE_ASSISTANT_USER_MESSAGE_CLASS = 'w-fit rounded-2xl bg-neutral-100 px-3 py-2.5 text-sm leading-6 text-[var(--glass-text-primary)]'
const WORKSPACE_ASSISTANT_MESSAGE_CLASS = 'flex flex-col gap-3 px-1 py-1 text-sm leading-6 text-[var(--glass-text-primary)]'
const workspaceAssistantToolDetailsOpenIds = new Set<string>()

export function isWorkspaceAssistantToolDetailsOpen(toolCallId: string): boolean {
  return workspaceAssistantToolDetailsOpenIds.has(toolCallId)
}

export function setWorkspaceAssistantToolDetailsOpen(toolCallId: string, open: boolean): void {
  if (!toolCallId.trim()) return
  if (open) {
    workspaceAssistantToolDetailsOpenIds.add(toolCallId)
    return
  }
  workspaceAssistantToolDetailsOpenIds.delete(toolCallId)
}

export function resolveProgressStageLabel(raw: string | null, progressT: ReturnType<typeof useTranslations<'progress'>>): string | null {
  if (!raw) return null
  if (!raw.startsWith('progress.')) return raw
  const key = raw.slice('progress.'.length)
  if (progressT.has(key)) return progressT(key)
  return `MISSING_MESSAGE:${raw}`
}

function ProjectPhaseDataCard({ data }: DataMessagePartProps<ProjectPhasePartData>) {
  const t = useTranslations('assistantAgent')
  return (
    <details className="group text-[12px] leading-5 text-[var(--glass-text-tertiary)]">
      <summary className="flex cursor-pointer list-none items-center gap-2">
        <AppIcon name="chart" className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">
          {t('cards.projectPhase')}
        </span>
        <AppIcon name="chevronDown" className="h-3 w-3 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="ml-5 mt-1 text-[11px] leading-5">
        {t('cards.storyboards', { count: data.snapshot.progress.storyboardCount })} · {t('cards.panels', { count: data.snapshot.progress.panelCount })}
      </div>
    </details>
  )
}

export function AgentStopDataCard({ data }: DataMessagePartProps<ProjectAgentStopPartData>) {
  const t = useTranslations('assistantAgent')
  if (data.reason === 'awaiting_user_confirmation' || data.reason === 'awaiting_external_task') return null
  const title = data.reason === 'awaiting_external_task'
      ? t('cards.awaitingExternalTask')
      : t('cards.toolErrorBoundary')
  const detail = data.reason === 'awaiting_external_task'
      ? t('cards.awaitingExternalTaskDetail', {
          operations: data.operationIds.join(', '),
          tasks: data.taskIds.length > 0 ? data.taskIds.join(', ') : t('cards.unknownTask'),
          phases: data.phases.length > 0 ? data.phases.join(', ') : t('cards.none'),
        })
      : t('cards.toolErrorBoundaryDetail', {
          operations: data.operationIds.join(', '),
          codes: data.codes.length > 0 ? data.codes.join(', ') : t('cards.none'),
        })
  return (
    <details className="group border-l-2 border-[var(--glass-text-tertiary)]/40 pl-2 text-[12px] leading-5 text-[var(--glass-text-secondary)]">
      <summary className="flex cursor-pointer list-none items-center gap-2">
        <AppIcon name="alert" className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">{detail ? `${title} · ${detail}` : title}</span>
        <AppIcon name="chevronDown" className="h-3 w-3 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="ml-5 mt-1 text-[11px] text-[var(--glass-text-tertiary)]">{t('cards.reason', { reason: data.reason })}</div>
    </details>
  )
}

export function HiddenApprovalRequestDataCard() {
  return null
}

export function HiddenRuntimeContextDataCard() {
  return null
}

export function WorkspaceAssistantReasoningPart(props: ReasoningMessagePartProps) {
  const text = props.text.trim()
  if (!text) return null
  return (
    <div className="whitespace-pre-wrap border-l-2 border-[var(--glass-stroke-base)] pl-3 text-xs leading-5 text-[var(--glass-text-tertiary)]">
      {text}
    </div>
  )
}

function toPositiveBillingQuantity(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return value
}

function resolveBillingActionItemKey(item: BillingQuoteItemView): BillingActionItemKey | null {
  if (item.unit === 'image') return 'image'
  if (item.unit === 'video') return 'video'
  if (item.unit === 'music') return 'music'
  if (item.unit === 'second' && item.apiType === 'music') return 'musicSeconds'
  if (item.unit === 'second' && item.apiType === 'video') return 'videoSeconds'
  if (item.unit === 'call' && item.apiType === 'music') return 'music'
  return null
}

function summarizeBillingActionItems(items: readonly BillingQuoteItemView[]): BillingActionItemSummary[] {
  const totals = new Map<BillingActionItemKey, number>()
  for (const item of items) {
    const key = resolveBillingActionItemKey(item)
    if (!key) continue
    const quantity = toPositiveBillingQuantity(item.quantity)
    if (quantity <= 0) continue
    totals.set(key, (totals.get(key) ?? 0) + quantity)
  }
  return Array.from(totals.entries()).map(([key, quantity]) => ({ key, quantity }))
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
  summaryLabel: string | null
}) {
  const t = useTranslations('assistantAgent')
  const preview = props.preview
  if (!preview) return null
  const summaryLabel = props.summaryLabel ?? t('cards.billingTaskCount', { count: preview.mediaTaskCount })
  return (
    <div className="mt-4 flex items-center gap-3 text-xs">
      <span className="shrink-0 whitespace-nowrap tabular-nums text-[var(--glass-text-tertiary)]">
        {summaryLabel}
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
      <BillingQuoteBlock preview={quotePreview} summaryLabel={quoteActionLabel} />
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
      <BillingQuoteBlock preview={quotePreview} summaryLabel={quoteActionLabel} />
    </div>
  )
}

export function WorkspaceAssistantActiveRunCard(props: {
  operationId: string | null
}) {
  const t = useTranslations('assistantAgent')
  const locale = normalizeProjectAgentLocale(useLocale())
  const operationTitle = localizeProjectAgentOperationTitle(props.operationId ?? '', locale)
  return (
    <div className="order-last rounded-2xl border border-[var(--glass-stroke-base)] bg-white p-3 text-xs text-[var(--glass-text-secondary)]">
      <div className="flex items-center gap-2">
        <AppIcon name="loader" className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--glass-text-tertiary)]" />
        <div className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--glass-text-primary)]">
          {t('toolCall.running')} · {operationTitle}
        </div>
      </div>
    </div>
  )
}

function isEditScriptVideoRatio(value: string | undefined): value is EditScriptVideoRatio {
  return typeof value === 'string' && EDIT_SCRIPT_VIDEO_RATIOS.includes(value as EditScriptVideoRatio)
}

function isAspectRatioChoiceGroupKey(key: string): boolean {
  return key === 'aspectRatio'
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

export function AssistantChoiceCardView(props: {
  data: ProjectAgentChoiceCardPartData
  onSubmitChoiceResponse: (params: {
    runId: string
    interruptionId: string | null
    choiceType: ProjectAgentChoiceCardPartData['choiceType']
    toolCallId: string | null
    output: Record<string, unknown>
    visibleUserText?: string
  }) => Promise<void>
  onConfirmEditStylePreviewChoice: (params: {
    projectId: string
    episodeId: string
    stylePreviewId: string
    aspectRatio: EditScriptVideoRatio
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
  const isConfirmOnly = card.variant === 'confirm'
  const isConfirmOrReply = card.variant === 'confirm_or_reply'
  const shouldAutoSubmitOnReady = card.autoSubmitOnReady === true
  const isAutoSelectionCard = shouldAutoSubmitOnReady || card.choiceType === 'script_intake'
  const usesPerQuestionReply = card.choiceType === 'script_intake'
  const showManualSubmit = shouldShowChoiceCardManualSubmit(card)
  const choiceGroups = useMemo(
    () => mergeChoiceCardCustomOptions(card.groups, customOptions),
    [card.groups, customOptions],
  )
  const ready = isChoiceCardSubmitReady(choiceGroups, selections)
  const activeGroup = choiceGroups[activeGroupIndex] ?? choiceGroups[0] ?? null
  const progressLabel = card.groups.length > 1 ? `${String(activeGroupIndex + 1)}/${String(card.groups.length)}` : null
  const canGoBack = activeGroupIndex > 0
  const isAspectRatioGroup = activeGroup ? isAspectRatioChoiceGroupKey(activeGroup.key) : false
  const isStylePreviewGroup = activeGroup?.key === 'stylePreviewId'

  const readChoiceRunId = (): string => {
    const runId = card.runId?.trim()
    if (!runId) throw new Error('ASSISTANT_CHOICE_CARD_RUN_ID_MISSING')
    return runId
  }

  const handleReplySubmit = async () => {
    const trimmedReply = replyText.trim()
    const replyKey = card.replyToolOutputKey?.trim() || 'replyText'
    if (!trimmedReply || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await props.onSubmitChoiceResponse({
        runId: readChoiceRunId(),
        interruptionId: card.interruptionId ?? null,
        choiceType: card.choiceType,
        toolCallId: card.toolCallId,
        output: {
          ok: true,
          choiceType: card.choiceType,
          cardId: card.cardId,
          decision: 'revise',
          [replyKey]: trimmedReply,
        },
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
      const labels = resolveChoiceCardSelectionLabels(submitGroups, submitSelections)
      if (card.submit.kind === 'submit_tool_output') {
        await props.onSubmitChoiceResponse({
          runId: readChoiceRunId(),
          interruptionId: card.interruptionId ?? null,
          choiceType: card.choiceType,
          toolCallId: card.toolCallId,
          output: {
            ok: true,
            choiceType: card.choiceType,
            cardId: card.cardId,
            decision: 'approve',
            selections: submitSelections,
            labels,
          },
        })
        props.onSubmitted?.(card.cardId)
      } else {
        const stylePreviewId = submitSelections.stylePreviewId
        const aspectRatio = card.submit.aspectRatio ?? submitSelections.aspectRatio
        if (!stylePreviewId || !isEditScriptVideoRatio(aspectRatio)) {
          throw new Error('ASSISTANT_CHOICE_CARD_INVALID_STYLE_SELECTION')
        }
        await props.onConfirmEditStylePreviewChoice({
          projectId: card.submit.projectId,
          episodeId: card.submit.episodeId,
          stylePreviewId,
          aspectRatio,
        })
        await props.onSubmitChoiceResponse({
          runId: readChoiceRunId(),
          interruptionId: card.interruptionId ?? null,
          choiceType: card.choiceType,
          toolCallId: card.toolCallId,
          output: {
            ok: true,
            choiceType: card.choiceType,
            cardId: card.cardId,
            stylePreviewId,
            aspectRatio,
            selections: submitSelections,
            labels,
          },
        })
        props.onSubmitted?.(card.cardId)
      }
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
    const nextGroups = mergeChoiceCardCustomOptions(card.groups, nextCustomOptions)
    setCustomOptions(nextCustomOptions)
    setSelections(nextSelections)
    setReplyText('')
    setError(null)
    if (activeGroupIndex < card.groups.length - 1) {
      setActiveGroupIndex((current) => Math.min(current + 1, card.groups.length - 1))
    }
    if (shouldAutoSubmitOnReady && isChoiceCardSubmitReady(nextGroups, nextSelections)) {
      await handleSubmit(nextSelections, nextGroups)
    }
  }

  const renderActiveGroup = () => {
    if (!activeGroup) return null
    const optionGridClass = isAspectRatioGroup
      ? 'grid grid-cols-3 gap-2'
      : isStylePreviewGroup || isAutoSelectionCard
        ? 'grid grid-cols-1 gap-2'
        : 'grid grid-cols-2 gap-2'
    const groupLabelClass = isAutoSelectionCard
      ? 'text-sm font-semibold leading-6 text-[var(--glass-text-primary)]'
      : 'text-[11px] font-semibold text-[var(--glass-text-tertiary)]'
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
                  if (shouldAutoSubmitOnReady && isChoiceCardSubmitReady(choiceGroups, nextSelections)) {
                    void handleSubmit(nextSelections)
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
                <div className={`${isAutoSelectionCard ? 'p-3' : 'p-2'} ${isAspectRatioGroup ? 'flex flex-col items-center gap-1.5 text-center' : 'space-y-1'}`}>
                  {isAspectRatioGroup ? <RatioChoiceShape ratio={option.value} selected={selected} /> : null}
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className={`min-w-0 flex-1 ${isAutoSelectionCard ? 'text-[13px] leading-5' : 'truncate text-sm'} font-semibold ${selected ? 'text-neutral-900' : 'text-[var(--glass-text-primary)]'}`}>{option.label}</span>
                    {selected ? <AppIcon name="check" className="h-3.5 w-3.5 shrink-0 text-neutral-900" /> : null}
                  </div>
                  {!isAspectRatioGroup && option.description ? (
                    <div className={`${isAutoSelectionCard ? 'text-xs leading-5' : 'line-clamp-1 text-[11px] leading-5'} text-[var(--glass-text-secondary)]`}>{option.description}</div>
                  ) : null}
                  {!isAspectRatioGroup && option.meta ? (
                    <div className="truncate text-[10px] text-[var(--glass-text-tertiary)]">{option.meta}</div>
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
          <div className="rounded-full border border-[var(--glass-stroke-base)] bg-white/85 px-2 py-0.5 text-[10px] font-semibold text-[var(--glass-text-tertiary)]">
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
          {!isAutoSelectionCard ? (
            <button
              type="button"
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-neutral-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:bg-slate-400"
              onClick={() => { void handleSubmit() }}
              disabled={!ready || submitting}
            >
              {submitting ? t('cards.choiceSubmitting') : card.submitLabel}
            </button>
          ) : null}
          {renderReplyInput()}
        </div>
      ) : activeGroup ? renderActiveGroup() : null}
      {error ? <div className="mt-3 text-[11px] leading-5 text-[var(--glass-tone-warn-fg)]">{t('cards.choiceSubmitFailed', { error })}</div> : null}
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
          {!ready ? <div className="mt-1.5 text-[11px] text-[var(--glass-text-tertiary)]">{t('cards.choiceRequired')}</div> : null}
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

function isEditStylePreviewChoiceReady(preview: ProjectEditStylePreview | null): preview is ProjectEditStylePreview {
  return Boolean(preview?.id && preview.imageUrl && (preview.status === 'completed' || preview.status === 'confirmed'))
}

function isEditStylePreviewTerminal(preview: ProjectEditStylePreview | null): boolean {
  return preview?.status === 'completed' || preview?.status === 'confirmed' || preview?.status === 'failed'
}

export type EditStylePreviewCardStatus = 'loading' | 'generating' | 'completed' | 'failed'

export function resolveEditStylePreviewCardStatus(params: {
  readonly preview: ProjectEditStylePreview | null
  readonly taskState: TaskTargetState | undefined
  readonly loading?: boolean
}): EditStylePreviewCardStatus {
  if (params.preview?.status === 'failed' || params.taskState?.phase === 'failed') return 'failed'
  if (isEditStylePreviewChoiceReady(params.preview)) return 'completed'
  // 'generating' requires positive evidence: an active task, or a preview row
  // that has not produced its image yet. Missing data is a loading state,
  // never fake progress (a finished batch must not show as generating after
  // a tab switch just because queries are refetching).
  if (params.taskState?.phase === 'queued' || params.taskState?.phase === 'processing') return 'generating'
  if (params.preview) return 'generating'
  return 'loading'
}

export function resolveDisplayedEditStylePreviewItems(params: {
  readonly items: EditStylePreviewGenerationPartData['items']
  readonly previewsById: ReadonlyMap<string, ProjectEditStylePreview>
}): EditStylePreviewGenerationPartData['items'] {
  const confirmedItem = params.items.find((item) => params.previewsById.get(item.id)?.status === 'confirmed')
  return confirmedItem ? [confirmedItem] : params.items
}

function truncateStylePreviewErrorMessage(message: string | null | undefined): string | null {
  const normalized = message?.trim()
  if (!normalized) return null
  const singleLine = normalized.replace(/\s+/g, ' ')
  return singleLine.length > 180 ? `${singleLine.slice(0, 180)}...` : singleLine
}

/* 纤细圆环：conic 渐变 + 径向遮罩,描边轻盈,替代旧的厚环黑芯 */
function StylePreviewRingMask(size: number): CSSProperties {
  const stroke = size < 40 ? 2 : 2.5
  return {
    WebkitMask: `radial-gradient(farthest-side, transparent calc(100% - ${stroke}px), #000 calc(100% - ${stroke}px))`,
    mask: `radial-gradient(farthest-side, transparent calc(100% - ${stroke}px), #000 calc(100% - ${stroke}px))`,
  }
}

function StylePreviewRing({ percent, size = 56 }: { percent: number; size?: number }) {
  const clamped = Math.max(0, Math.min(100, percent))
  const ringDegrees = clamped * 3.6
  return (
    <div className="relative" style={{ height: size, width: size }}>
      <div
        className="absolute inset-0 rounded-full drop-shadow-[0_0_6px_rgba(255,255,255,0.5)] transition-all duration-500 ease-out"
        style={{
          background: `conic-gradient(#fff 0deg ${ringDegrees}deg, rgba(255,255,255,0.25) ${ringDegrees}deg 360deg)`,
          ...StylePreviewRingMask(size),
        }}
      />
      {size >= 40 ? (
        <span className="absolute inset-0 flex items-center justify-center text-[13px] font-semibold tabular-nums text-white">
          {Math.floor(clamped)}
        </span>
      ) : null}
    </div>
  )
}

/* 进度未知时的不定态纤细环（自旋） */
function StylePreviewIndeterminateRing({ size = 56 }: { size?: number }) {
  return (
    <div
      className="style-preview-spin rounded-full drop-shadow-[0_0_6px_rgba(255,255,255,0.45)]"
      style={{
        height: size,
        width: size,
        background: 'conic-gradient(transparent 0deg 250deg, rgba(255,255,255,0.95) 360deg)',
        ...StylePreviewRingMask(size),
      }}
    />
  )
}

function useStylePreviewRunningPercent(taskState: TaskTargetState | undefined): number | null {
  const progress = useEstimatedTaskProgress(taskState ?? null)
  if (!progress || !progress.isRunning) return null
  return Math.floor(Math.max(0, Math.min(99, progress.percent)))
}

/* 生成中浮层：光环呼吸（aurora）+ 纤细圆环，进度内嵌于环中 */
function StylePreviewGeneratingOverlay({ taskState }: { taskState: TaskTargetState | undefined }) {
  const t = useTranslations('assistantAgent')
  const percent = useStylePreviewRunningPercent(taskState)
  const statusLabel = percent !== null ? `${t('cards.stylePreviewGenerating')} ${percent}%` : t('cards.stylePreviewLoading')
  return (
    <div className="absolute inset-0 z-20 overflow-hidden" role="status" aria-label={statusLabel}>
      <div className="style-preview-aura absolute inset-0" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-black/10" />
      <div className="relative flex h-full items-center justify-center">
        {percent !== null
          ? <StylePreviewRing percent={percent} size={56} />
          : <StylePreviewIndeterminateRing size={56} />}
      </div>
    </div>
  )
}

/* 折叠小行缩略图里的迷你进度：同款光环呼吸 + 迷你环 */
function StylePreviewRowProgress({ taskState }: { taskState: TaskTargetState | undefined }) {
  const percent = useStylePreviewRunningPercent(taskState)
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
      <div className="style-preview-aura absolute inset-0" />
      {percent !== null
        ? <StylePreviewRing percent={percent} size={26} />
        : <StylePreviewIndeterminateRing size={20} />}
    </div>
  )
}

/* 生成/加载占位：暗黑玻璃态模糊面（取代浅灰骨架） */
function StylePreviewLoadingSurface() {
  return (
    <div className="workspace-node-loading-surface absolute inset-0 bg-[#0c111b]">
      <div
        className="absolute inset-0 opacity-70 blur-2xl"
        style={{ background: 'radial-gradient(55% 60% at 28% 22%, #2c3f63 0%, transparent 60%), radial-gradient(50% 55% at 78% 82%, #1d3358 0%, transparent 60%)' }}
      />
      <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-transparent" />
    </div>
  )
}

export function EditStylePreviewGenerationDataCard(props: DataMessagePartProps<EditStylePreviewGenerationPartData> & {
  onStyleSelected?: (params: {
    runId: string
    stylePreviewId: string
    aspectRatio: EditScriptVideoRatio
  }) => Promise<void>
  onPreviewImage?: (imageUrl: string) => void
}) {
  const t = useTranslations('assistantAgent')
  const data: EditStylePreviewGenerationPartData = props.data
  const confirmStylePreview = useConfirmProjectEditStylePreview(data.projectId)
  const [selectingPreviewId, setSelectingPreviewId] = useState<string | null>(null)
  const [localPreviewImageUrl, setLocalPreviewImageUrl] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  // 第一性原理：候选清单的唯一事实来源是 editBible.stylePreviews（实时查询）。
  // part 携带的 data.items 仅作首帧种子；Bible 一到就接管 —— 追加候选会自动出现，
  // 不再依赖快照清单或 taskId 是否回填。
  const editBibleQuery = useQuery({
    queryKey: queryKeys.project.editBible(data.projectId, data.episodeId),
    queryFn: async (): Promise<ProjectEditBible | null> => {
      const response = await apiFetch(`/api/projects/${data.projectId}/bible?episodeId=${encodeURIComponent(data.episodeId)}`)
      if (!response.ok) throw new Error('EDIT_STYLE_PREVIEW_BIBLE_FETCH_FAILED')
      const payload = await response.json() as { editBible?: ProjectEditBible | null }
      return payload.editBible ?? null
    },
    refetchInterval: (query) => {
      const previews = query.state.data?.stylePreviews ?? []
      if (previews.some((preview) => preview.status === 'confirmed')) return false
      if (previews.length === 0) return 2500
      const allTerminal = previews.every((preview) => isEditStylePreviewTerminal(preview))
      return allTerminal ? false : 2500
    },
  })
  const liveStylePreviews = editBibleQuery.data?.stylePreviews ?? null
  const previewsById = useMemo(() => (
    new Map((liveStylePreviews ?? []).map((preview) => [preview.id, preview]))
  ), [liveStylePreviews])
  const liveItems = useMemo<EditStylePreviewGenerationPartData['items']>(() => {
    if (!liveStylePreviews) return data.items
    return liveStylePreviews.map((preview) => ({
      id: preview.id,
      styleKey: preview.styleKey,
      title: preview.title,
      summary: preview.summary,
      ...(preview.taskId ? { taskId: preview.taskId } : {}),
      aspectRatio: preview.aspectRatio,
    }))
  }, [liveStylePreviews, data.items])
  const taskTargets = useMemo(() => liveItems.map((item: EditStylePreviewGenerationPartData['items'][number]) => ({
    targetType: 'ProjectEditStylePreview',
    targetId: item.id,
    types: [TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE],
  })), [liveItems])
  const taskTargetStateQuery = useTaskTargetStateMap(data.projectId, taskTargets, {
    enabled: taskTargets.length > 0,
  })
  const taskStateMap = taskTargetStateQuery.byKey
  const displayedItems = useMemo(() => resolveDisplayedEditStylePreviewItems({
    items: liveItems,
    previewsById,
  }), [liveItems, previewsById])
  const cardStatuses = useMemo(() => displayedItems.map((item) => {
    const taskState = taskStateMap.get(`ProjectEditStylePreview:${item.id}`)
    const preview = previewsById.get(item.id) ?? null
    return resolveEditStylePreviewCardStatus({
      preview,
      taskState,
      loading: editBibleQuery.isLoading || taskTargetStateQuery.isLoading,
    })
  }), [displayedItems, previewsById, editBibleQuery.isLoading, taskStateMap, taskTargetStateQuery.isLoading])
  const hasConfirmedPreview = displayedItems.some((item) => previewsById.get(item.id)?.status === 'confirmed')
  const hasGeneratingPreview = cardStatuses.some((status) => status === 'generating')

  const handleSelectStylePreview = async (
    item: EditStylePreviewGenerationPartData['items'][number],
    preview: ProjectEditStylePreview,
  ) => {
    if (!isEditStylePreviewChoiceReady(preview)) return
    const runId = data.agentRunId?.trim()
    if (!runId) throw new Error('ASSISTANT_STYLE_PREVIEW_AGENT_RUN_ID_MISSING')
    setSelectingPreviewId(item.id)
    try {
      await confirmStylePreview.mutateAsync({
        episodeId: data.episodeId,
        stylePreviewId: item.id,
        aspectRatio: preview.aspectRatio,
      })
      await props.onStyleSelected?.({
        runId,
        stylePreviewId: item.id,
        aspectRatio: preview.aspectRatio,
      })
    } finally {
      setSelectingPreviewId(null)
    }
  }
  const openPreviewImage = (imageUrl: string) => {
    if (props.onPreviewImage) {
      props.onPreviewImage(imageUrl)
      return
    }
    setLocalPreviewImageUrl(imageUrl)
  }

  const effectiveFocusId = focusId && displayedItems.some((item) => item.id === focusId)
    ? focusId
    : displayedItems[0]?.id ?? null

  return (
    <div className="rounded-2xl border border-[var(--glass-stroke-base)] bg-white/95 p-3 text-xs text-[var(--glass-text-secondary)] shadow-[0_12px_30px_rgba(15,23,42,0.08)]">
      <div className="flex items-center gap-2">
        <AppIcon
          name={hasGeneratingPreview ? 'loader' : 'check'}
          className={`h-3.5 w-3.5 text-[var(--glass-text-tertiary)] ${hasGeneratingPreview ? 'animate-spin' : ''}`}
        />
        <div className="min-w-0 flex-1 text-sm font-semibold text-[var(--glass-text-primary)]">
          {hasConfirmedPreview
            ? t('cards.stylePreviewConfirmedTitle')
            : hasGeneratingPreview
              ? t('cards.stylePreviewGenerationTitle')
              : t('cards.stylePreviewChoiceTitle')}
        </div>
        <div className="rounded-full border border-[var(--glass-stroke-base)] bg-white/85 px-2 py-0.5 text-[10px] font-semibold text-[var(--glass-text-tertiary)]">
          {hasConfirmedPreview
            ? t('cards.stylePreviewConfirmedBadge')
            : t('cards.stylePreviewGenerationCount', { count: displayedItems.length })}
        </div>
      </div>
      <div className="mt-2.5 space-y-2">
        {displayedItems.map((item: EditStylePreviewGenerationPartData['items'][number]) => {
          const taskState = taskStateMap.get(`ProjectEditStylePreview:${item.id}`)
          const preview = previewsById.get(item.id) ?? null
          const cardStatus = resolveEditStylePreviewCardStatus({
            preview,
            taskState,
            loading: editBibleQuery.isLoading || taskTargetStateQuery.isLoading,
          })
          const ready = cardStatus === 'completed' && isEditStylePreviewChoiceReady(preview)
          const failed = cardStatus === 'failed'
          const inProgress = cardStatus === 'generating' || cardStatus === 'loading'
          const selecting = selectingPreviewId === item.id
          const confirmed = preview?.status === 'confirmed'
          const imageUrl = preview?.imageUrl ?? null
          const errorMessage = truncateStylePreviewErrorMessage(preview?.errorMessage || taskState?.lastError?.message)

          // 未展开的候选：缩小为可点击的小行，副标题展示风格文案
          if (item.id !== effectiveFocusId) {
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setFocusId(item.id)}
                className="flex w-full items-center gap-3 rounded-[14px] border border-[var(--glass-stroke-base)] bg-white/80 px-2.5 py-2 text-left transition-colors hover:bg-neutral-50"
              >
                <div className="relative h-10 w-14 shrink-0 overflow-hidden rounded-[10px] bg-[#0c111b] ring-1 ring-[var(--glass-stroke-base)]">
                  {imageUrl ? (
                    <Image src={imageUrl} alt={item.title} width={112} height={80} unoptimized className="h-full w-full object-cover" />
                  ) : (
                    <StylePreviewLoadingSurface />
                  )}
                  {inProgress ? <StylePreviewRowProgress taskState={taskState} /> : null}
                  {failed ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-[var(--glass-tone-warn-bg)]/55">
                      <AppIcon name="alert" className="h-4 w-4 text-[var(--glass-tone-warn-fg)]" />
                    </div>
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-[var(--glass-text-primary)]">{item.title}</div>
                  <div className="truncate text-[11px] leading-4 text-[var(--glass-text-tertiary)]">{item.summary}</div>
                </div>
                {confirmed ? (
                  <AppIcon name="badgeCheck" className="h-4 w-4 shrink-0 text-[var(--glass-accent-from)]" />
                ) : (
                  <AppIcon name="chevronRight" className="h-4 w-4 shrink-0 text-[var(--glass-text-tertiary)]" />
                )}
              </button>
            )
          }

          // 焦点候选：放大显示，确认按钮叠在图片右下角，文案在图片下方
          return (
            <div
              key={item.id}
              className={`overflow-hidden rounded-[16px] border bg-white/85 ${failed ? 'border-[var(--glass-tone-warn-fg)]/35' : 'border-[var(--glass-stroke-base)]'}`}
            >
              <div className="relative">
                <div className="relative aspect-[16/10] overflow-hidden bg-[#0c111b]">
                  {imageUrl ? (
                    <button
                      type="button"
                      aria-label={t('cards.stylePreviewOpenPreview')}
                      className="block h-full w-full cursor-zoom-in overflow-hidden text-left"
                      onClick={() => openPreviewImage(imageUrl)}
                    >
                      <Image
                        src={imageUrl}
                        alt={item.title}
                        width={768}
                        height={480}
                        unoptimized
                        className="h-full w-full object-cover transition-transform duration-200 hover:scale-[1.02]"
                      />
                    </button>
                  ) : failed ? (
                    <div className="flex h-full items-center justify-center bg-[var(--glass-tone-warn-bg)]/35 px-4 text-center text-xs font-medium text-[var(--glass-tone-warn-fg)]">
                      {t('cards.stylePreviewGenerationFailed')}
                    </div>
                  ) : (
                    <StylePreviewLoadingSurface />
                  )}
                  {inProgress ? <StylePreviewGeneratingOverlay taskState={taskState} /> : null}
                </div>
                {confirmed ? (
                  <div className="absolute bottom-3 right-3 z-30 inline-flex items-center gap-1.5 rounded-full bg-white/92 px-3 py-1.5 text-[12px] font-semibold text-[var(--glass-text-primary)] shadow-[0_4px_14px_rgba(15,23,42,0.28)] backdrop-blur-md">
                    <AppIcon name="badgeCheck" className="h-3.5 w-3.5 text-[var(--glass-accent-from)]" />
                    {t('cards.stylePreviewConfirmed')}
                  </div>
                ) : ready ? (
                  <button
                    type="button"
                    disabled={selecting || confirmStylePreview.isPending}
                    onClick={() => { void handleSelectStylePreview(item, preview) }}
                    className="group/btn absolute bottom-3 right-3 z-30 inline-flex items-center gap-1 rounded-full bg-white/92 px-3.5 py-1.5 text-[12px] font-semibold text-[var(--glass-text-primary)] shadow-[0_4px_14px_rgba(15,23,42,0.28)] backdrop-blur-md transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {selecting ? t('cards.choiceSubmitting') : t('cards.stylePreviewSelect')}
                    {!selecting ? <AppIcon name="chevronRight" className="h-3.5 w-3.5 text-[var(--glass-accent-from)] transition-transform group-hover/btn:translate-x-0.5" /> : null}
                  </button>
                ) : null}
              </div>
              <div className="p-3">
                <div className="text-[15px] font-semibold text-[var(--glass-text-primary)]">{item.title}</div>
                <p className="mt-1.5 text-[12px] leading-5 text-[var(--glass-text-secondary)]">{item.summary}</p>
                {failed && errorMessage ? (
                  <div className="mt-2 rounded-lg bg-[var(--glass-tone-warn-bg)]/45 px-2 py-1 text-[10px] leading-4 text-[var(--glass-tone-warn-fg)]">
                    {t('cards.stylePreviewGenerationFailedReason', { reason: errorMessage })}
                  </div>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
      {localPreviewImageUrl ? (
        <ImagePreviewModal imageUrl={localPreviewImageUrl} onClose={() => setLocalPreviewImageUrl(null)} />
      ) : null}
    </div>
  )
}

function ProjectContextDataCard({ data }: DataMessagePartProps<ProjectContextPartData>) {
  const t = useTranslations('assistantAgent')
  return (
    <details className="group text-[12px] leading-5 text-[var(--glass-text-tertiary)]">
      <summary className="flex cursor-pointer list-none items-center gap-2">
        <AppIcon name="folder" className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">{t('cards.projectContext')} · {data.context.projectName} · {data.context.episodeName}</span>
        <AppIcon name="chevronDown" className="h-3 w-3 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="ml-5 mt-1 text-[11px]">
        {t('cards.workspaceLabel')}: {t('panel.workspaceStatus')}
      </div>
    </details>
  )
}


function readToolResultFailureMessage(result: unknown): string | null {
  if (!isRecord(result) || result.ok !== false) return null
  const error = isRecord(result.error) ? result.error : null
  const message = typeof error?.message === 'string' && error.message.trim() ? error.message.trim() : ''
  if (message) return message
  const code = typeof error?.code === 'string' && error.code.trim() ? error.code.trim() : ''
  return code || null
}

export function WorkspaceAssistantToolCallCard(props: ToolCallMessagePartProps) {
  const t = useTranslations('assistantAgent')
  const locale = normalizeProjectAgentLocale(useLocale())
  const operationTitle = localizeProjectAgentOperationTitle(props.toolName, locale)
  const toolStatus = props.status.type
  const [detailsOpen, setDetailsOpen] = useState(() => isWorkspaceAssistantToolDetailsOpen(props.toolCallId))
  const inputText = JSON.stringify(props.args ?? {}, null, 2)
  const outputText = props.result === undefined ? '' : JSON.stringify(props.result, null, 2)
  useEffect(() => {
    setDetailsOpen(isWorkspaceAssistantToolDetailsOpen(props.toolCallId))
  }, [props.toolCallId])
  const failureMessage = readToolResultFailureMessage(props.result)
  const summaryText = toolStatus === 'complete'
    ? failureMessage ? t('toolCall.failed') : t('toolCall.success')
    : toolStatus === 'requires-action'
      ? t('toolCall.needsAction')
      : t('toolCall.running')
  const iconName = toolStatus === 'incomplete'
    ? 'loader'
    : failureMessage
      ? 'alert'
      : 'settingsHex'

  return (
    <details
      className={`group text-[12px] leading-5 ${failureMessage ? 'text-[var(--glass-tone-warn-fg)]' : 'text-[var(--glass-text-tertiary)]'}`}
      open={detailsOpen}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open
        setWorkspaceAssistantToolDetailsOpen(props.toolCallId, nextOpen)
        setDetailsOpen(nextOpen)
      }}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2">
        <AppIcon name={iconName} className={`h-3.5 w-3.5 shrink-0 ${toolStatus === 'incomplete' ? 'animate-spin' : ''}`} />
        <span className="min-w-0 truncate">{summaryText} · {operationTitle}</span>
        <AppIcon name="chevronDown" className="h-3 w-3 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="ml-5 mt-1 space-y-2 text-[11px]">
        {failureMessage ? (
          <div className="rounded-lg bg-[var(--glass-tone-warn-bg)]/45 px-2 py-1 leading-4">
            {failureMessage}
          </div>
        ) : null}
        <div>
          <div>{t('toolCall.arguments')}</div>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all leading-5">{inputText}</pre>
        </div>
        <div>
          <div>{t('toolCall.result')}</div>
          {props.result === undefined ? (
            <div className="mt-1">{t('toolCall.waiting')}</div>
          ) : (
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all leading-5">{outputText}</pre>
          )}
        </div>
      </div>
    </details>
  )
}

interface WorkspaceAssistantMessagePartComponentsOptions {
  hideChoiceCards?: boolean
  hideStylePreviewGenerationCards?: boolean
  onSubmitChoiceResponse: (params: {
    runId: string
    interruptionId: string | null
    choiceType: ProjectAgentChoiceCardPartData['choiceType']
    toolCallId: string | null
    output: Record<string, unknown>
    visibleUserText?: string
  }) => Promise<void>
  onConfirmEditStylePreviewChoice: (params: {
    projectId: string
    episodeId: string
    stylePreviewId: string
    aspectRatio: EditScriptVideoRatio
  }) => Promise<void>
  onStylePreviewSelected?: (params: {
    runId: string
    stylePreviewId: string
    aspectRatio: EditScriptVideoRatio
  }) => Promise<void>
  onPreviewImage?: (imageUrl: string) => void
}

export function useWorkspaceAssistantMessagePartComponents({
  hideChoiceCards = false,
  hideStylePreviewGenerationCards = false,
  onSubmitChoiceResponse,
  onConfirmEditStylePreviewChoice,
  onStylePreviewSelected,
  onPreviewImage,
}: WorkspaceAssistantMessagePartComponentsOptions): MessagePartComponents {
  return useMemo<MessagePartComponents>(() => ({
    Text: MarkdownTextPart,
    Reasoning: WorkspaceAssistantReasoningPart,
    tools: {
      Fallback: WorkspaceAssistantToolCallCard,
    },
    data: {
      by_name: {
        'agent-run': HiddenRuntimeContextDataCard,
        'agent-operation-start': HiddenRuntimeContextDataCard,
        'agent-operation-plan-preview': OperationPlanPreviewDataCard,
        'agent-stop': AgentStopDataCard,
        'agent-runtime-context': HiddenRuntimeContextDataCard,
        'assistant-choice-card': hideChoiceCards
          ? HiddenRuntimeContextDataCard
          : (props) => (
              <AssistantChoiceCardView
                data={props.data}
                onSubmitChoiceResponse={onSubmitChoiceResponse}
                onConfirmEditStylePreviewChoice={onConfirmEditStylePreviewChoice}
              />
            ),
        'edit-style-preview-generation': hideStylePreviewGenerationCards
          ? HiddenRuntimeContextDataCard
          : (props) => (
              <EditStylePreviewGenerationDataCard
                {...props}
                onStyleSelected={onStylePreviewSelected}
                onPreviewImage={onPreviewImage}
              />
            ),
        'agent-interruption-resolved': HiddenRuntimeContextDataCard,
        'assistant-choice-resolved': HiddenRuntimeContextDataCard,
        'project-phase': ProjectPhaseDataCard,
        'task-submitted': TaskSubmittedDataCard,
        'task-batch-submitted': TaskBatchSubmittedDataCard,
        'project-context': ProjectContextDataCard,
      },
    },
  }), [
    hideChoiceCards,
    hideStylePreviewGenerationCards,
    onConfirmEditStylePreviewChoice,
    onPreviewImage,
    onStylePreviewSelected,
    onSubmitChoiceResponse,
  ])
}

function HiddenConversationSummaryMessage(props: {
  children: React.ReactNode
}) {
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

export function WorkspaceAssistantThreadMessage(props: {
  messagePartComponents: MessagePartComponents
}) {
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
            <MessagePrimitive.Parts components={props.messagePartComponents} />
          </MessagePrimitive.Root>
        </div>
      </MessagePrimitive.If>

      <MessagePrimitive.If system>
        <HiddenConversationSummaryMessage>
          <div className="space-y-1">
            <MessagePrimitive.Root className="space-y-2 px-1 py-1 text-[12px] leading-5 text-[var(--glass-text-tertiary)]">
              <MessagePrimitive.Parts components={props.messagePartComponents} />
            </MessagePrimitive.Root>
          </div>
        </HiddenConversationSummaryMessage>
      </MessagePrimitive.If>
    </>
  )
}

export function WorkspaceAssistantPendingTurnPlaceholder() {
  return (
    <div className="space-y-1">
      <div className={WORKSPACE_ASSISTANT_MESSAGE_CLASS}>
        <WorkspaceAssistantThinkingIndicator status="streaming" />
      </div>
    </div>
  )
}
