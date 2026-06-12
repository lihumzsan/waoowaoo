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
import type { ChatStatus, UIMessage } from 'ai'
import type { ComponentProps } from 'react'
import { useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import ImagePreviewModal from '@/components/ui/ImagePreviewModal'
import { useTaskTargetStateMap, type TaskTargetState } from '@/lib/query/hooks/useTaskTargetStateMap'
import { useQuery } from '@tanstack/react-query'
import type {
  AgentPlanPartData,
  EditStylePreviewGenerationPartData,
  ProjectAgentChoiceCardPartData,
  ProjectAgentStopPartData,
  ProjectContextPartData,
  ProjectPhasePartData,
  TaskBatchSubmittedPartData,
  TaskSubmittedPartData,
} from '@/lib/project-agent/types'
import { useConfirmProjectEditStylePreview, useRevertMutationBatch } from '@/lib/query/hooks'
import { MarkdownTextPart } from './MarkdownTextPart'
import {
  isChoiceCardSubmitReady,
  resolveChoiceCardSelectionLabels,
  type ChoiceCardSelections,
} from './choice-card-actions'
import { EDIT_SCRIPT_VIDEO_RATIOS, type EditScriptVideoRatio } from '@/lib/edit-script/types'
import { TASK_TYPE } from '@/lib/task/types'
import { apiFetch } from '@/lib/api-fetch'
import type { ProjectEditScreenplay, ProjectEditStylePreview } from '@/types/project'
import { queryKeys } from '@/lib/query/keys'
import { WorkspaceAssistantThinkingIndicator } from './WorkspaceAssistantThinkingIndicator'
import { localizeProjectAgentOperationTitle } from '@/lib/project-agent/copy'
import { normalizeProjectAgentLocale } from '@/lib/project-agent/locale'

const AGENT_SKILL_LABEL_KEYS: Record<string, string> = {
  'creative-direction': 'creativeDirection',
  screenwriting: 'screenwriting',
  'story-structure': 'storyStructure',
  'storyboard-direction': 'storyboardDirection',
  'visual-continuity': 'visualContinuity',
  'location-selection': 'locationSelection',
  'character-selection': 'characterSelection',
  'audio-direction': 'audioDirection',
  'media-generation': 'mediaGeneration',
}

function formatSkillLabel(skillId: string | null | undefined, t: ReturnType<typeof useTranslations<'assistantAgent'>>): string {
  if (!skillId) return t('cards.skillLabels.unnamed')
  const labelKey = AGENT_SKILL_LABEL_KEYS[skillId]
  return labelKey ? t(`cards.skillLabels.${labelKey}`) : skillId
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isWorkspaceAssistantHiddenMetadata(metadata: unknown): boolean {
  if (!isRecord(metadata)) return false
  const custom = metadata.custom
  return isRecord(custom) && custom.workspaceAssistantHidden === true
}

type MessagePartComponents = NonNullable<ComponentProps<typeof MessagePrimitive.Parts>['components']>

export const WORKSPACE_ASSISTANT_USER_MESSAGE_CLASS = 'w-fit rounded-2xl bg-neutral-100 px-3 py-2.5 text-sm leading-6 text-[var(--glass-text-primary)]'
const WORKSPACE_ASSISTANT_MESSAGE_CLASS = 'flex flex-col gap-3 px-1 py-1 text-sm leading-6 text-[var(--glass-text-primary)]'

export function findLatestAssistantMessageIdAfterLatestUser(
  messages: readonly Pick<UIMessage, 'id' | 'role'>[],
): string | null {
  let latestUserMessageIndex = -1
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    if (messages[messageIndex]?.role === 'user') {
      latestUserMessageIndex = messageIndex
      break
    }
  }

  for (let messageIndex = messages.length - 1; messageIndex > latestUserMessageIndex; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (message?.role === 'assistant') return message.id
  }

  return null
}

export function shouldShowPendingAssistantTurnPlaceholder(params: {
  readonly status: ChatStatus
  readonly activeAssistantMessageId: string | null
}): boolean {
  return params.status === 'submitted' || (params.status === 'streaming' && !params.activeAssistantMessageId)
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
          {t('cards.projectPhase')} · {data.phase} · {t('cards.runs', { count: data.snapshot.activePlanRunCount })}
        </span>
        <AppIcon name="chevronDown" className="h-3 w-3 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="ml-5 mt-1 text-[11px] leading-5">
        {t('cards.clips', { count: data.snapshot.progress.clipCount })} · {t('cards.screenplays', { count: data.snapshot.progress.screenplayClipCount })} · {t('cards.storyboards', { count: data.snapshot.progress.storyboardCount })}
      </div>
    </details>
  )
}

export function AgentStopDataCard({ data }: DataMessagePartProps<ProjectAgentStopPartData>) {
  const t = useTranslations('assistantAgent')
  if (data.reason === 'awaiting_user_confirmation') return null
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

export function ApprovalCard(props: {
  planId: string
  summary: string
  reasons: string[]
  onApprove: (planId: string) => Promise<void>
  onReject: (params: { planId: string; note?: string }) => Promise<void>
  approvePending: boolean
  rejectPending: boolean
}) {
  const t = useTranslations('assistantAgent')
  const [note, setNote] = useState('')

  return (
    <div className="rounded-2xl border border-[var(--glass-tone-warn-fg)]/30 bg-[var(--glass-bg-muted)]/70 p-3">
      <div className="text-sm font-medium text-[var(--glass-text-primary)]">{t('cards.approvalRequired')}</div>
      <div className="mt-1 text-xs text-[var(--glass-text-secondary)]">{props.summary}</div>
      {props.reasons.length > 0 ? (
        <div className="mt-3 max-h-32 space-y-1 overflow-y-auto text-xs text-[var(--glass-tone-warn-fg)]">
          {props.reasons.map((reason) => (
            <div key={reason}>{reason}</div>
          ))}
        </div>
      ) : null}
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder={t('cards.rejectNotePlaceholder')}
        className="mt-3 min-h-20 w-full rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-3 py-2 text-sm text-[var(--glass-text-primary)] outline-none"
      />
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="flex-1 rounded-xl bg-[var(--glass-accent-from)] px-3 py-2 text-sm font-medium text-white"
          onClick={() => { void props.onApprove(props.planId) }}
          disabled={props.approvePending}
        >
          {t('cards.approve')}
        </button>
        <button
          type="button"
          className="flex-1 rounded-xl border border-[var(--glass-stroke-base)] px-3 py-2 text-sm font-medium text-[var(--glass-text-primary)]"
          onClick={() => { void props.onReject({ planId: props.planId, note }) }}
          disabled={props.rejectPending}
        >
          {t('cards.reject')}
        </button>
      </div>
    </div>
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

export function ConfirmationActionCard(props: {
  operationId: string
  title: string
  subtitle: string
  onConfirm: () => Promise<void>
  onCancel: () => Promise<void>
  confirmPending: boolean
  cancelPending: boolean
}) {
  const t = useTranslations('assistantAgent')
  return (
    <div className="rounded-2xl border border-[var(--glass-stroke-base)] bg-white/95 p-3 text-xs text-[var(--glass-text-secondary)] shadow-[0_18px_40px_rgba(15,23,42,0.10)] backdrop-blur-xl">
      <div className="text-sm font-semibold text-[var(--glass-text-primary)]">{props.title}</div>
      <div className="mt-1 leading-5">{props.subtitle}</div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="flex-1 rounded-xl bg-[var(--glass-accent-from)] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--glass-accent-to)]"
          onClick={() => { void props.onConfirm() }}
          disabled={props.confirmPending}
        >
          {props.confirmPending ? t('cards.confirmRunning') : t('cards.confirmContinue')}
        </button>
        <button
          type="button"
          className="flex-1 rounded-xl border border-[var(--glass-stroke-base)] bg-white px-3 py-2 text-sm font-medium text-[var(--glass-text-primary)] transition-colors hover:bg-neutral-100"
          onClick={() => { void props.onCancel() }}
          disabled={props.cancelPending}
        >
          {props.cancelPending ? t('cards.cancelRunning') : t('cards.cancelAction')}
        </button>
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
        className={`rounded-[4px] border-2 transition-colors ${props.selected ? 'border-[var(--glass-accent-from)] bg-[var(--glass-accent-from)]/10' : 'border-[var(--glass-stroke-strong)] bg-white'}`}
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
  }) => Promise<void>
  onSetProjectVideoRatioChoice: (params: {
    projectId: string
    aspectRatio: EditScriptVideoRatio
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
  const [activeGroupIndex, setActiveGroupIndex] = useState(0)
  const [replyText, setReplyText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isConfirmOrReply = card.variant === 'confirm_or_reply'
  const ready = isChoiceCardSubmitReady(card.groups, selections)
  const activeGroup = card.groups[activeGroupIndex] ?? card.groups[0] ?? null
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
      })
      props.onSubmitted?.(card.cardId)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmit = async () => {
    if (!ready || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const labels = resolveChoiceCardSelectionLabels(card.groups, selections)
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
            selections,
            labels,
          },
        })
        props.onSubmitted?.(card.cardId)
      } else if (card.submit.kind === 'set_project_video_ratio') {
        const aspectRatio = selections.aspectRatio
        if (!isEditScriptVideoRatio(aspectRatio)) {
          throw new Error('ASSISTANT_CHOICE_CARD_INVALID_ASPECT_RATIO')
        }
        await props.onSetProjectVideoRatioChoice({
          projectId: card.submit.projectId,
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
            durationSeconds: Number(selections.durationSeconds),
            aspectRatio,
            selections,
            labels,
          },
        })
        props.onSubmitted?.(card.cardId)
      } else {
        const stylePreviewId = selections.stylePreviewId
        const aspectRatio = card.submit.aspectRatio ?? selections.aspectRatio
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
            selections,
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

  return (
    <div className="rounded-2xl border border-[var(--glass-stroke-base)] bg-white/95 p-3 text-xs text-[var(--glass-text-secondary)] shadow-[0_18px_40px_rgba(15,23,42,0.10)] backdrop-blur-xl">
      <div className="flex items-center gap-2">
        {canGoBack ? (
          <button
            type="button"
            aria-label={t('cards.choiceBack')}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--glass-stroke-base)] bg-white text-[var(--glass-text-secondary)] transition-colors hover:bg-neutral-100 hover:text-[var(--glass-text-primary)] disabled:opacity-60"
            onClick={() => {
              setActiveGroupIndex((current) => Math.max(0, current - 1))
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
      {isConfirmOrReply ? (
        <div className="mt-3 space-y-2">
          <button
            type="button"
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--glass-accent-from)] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--glass-accent-to)] disabled:cursor-not-allowed disabled:bg-slate-400"
            onClick={() => { void handleSubmit() }}
            disabled={!ready || submitting}
          >
            {submitting ? t('cards.choiceSubmitting') : card.submitLabel}
          </button>
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold text-[var(--glass-text-tertiary)]">
              {card.replyLabel || t('cards.choiceReplyLabel')}
            </div>
            <textarea
              value={replyText}
              onChange={(event) => {
                setReplyText(event.target.value)
                setError(null)
              }}
              placeholder={card.replyPlaceholder || t('cards.choiceReplyPlaceholder')}
              className="min-h-20 w-full resize-none rounded-xl border border-[var(--glass-stroke-base)] bg-white/85 px-3 py-2 text-xs leading-5 text-[var(--glass-text-primary)] outline-none transition-colors placeholder:text-[var(--glass-text-tertiary)] hover:bg-neutral-50 focus:border-[var(--glass-accent-from)] focus:bg-white"
              disabled={submitting}
            />
            <button
              type="button"
              className="inline-flex w-full items-center justify-center rounded-xl border border-[var(--glass-stroke-base)] bg-white/85 px-3 py-2 text-sm font-medium text-[var(--glass-text-primary)] transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:text-[var(--glass-text-tertiary)] disabled:opacity-70"
              onClick={() => { void handleReplySubmit() }}
              disabled={submitting || !replyText.trim()}
            >
              {submitting ? t('cards.choiceSubmitting') : card.replySubmitLabel || t('cards.choiceReplySubmit')}
            </button>
          </div>
        </div>
      ) : activeGroup ? (
        <div className="mt-2 space-y-2">
          <div className="text-[11px] font-semibold text-[var(--glass-text-tertiary)]">{activeGroup.label}</div>
          <div className={isAspectRatioGroup ? 'grid grid-cols-3 gap-2' : isStylePreviewGroup ? 'grid grid-cols-1 gap-2' : 'grid grid-cols-2 gap-2'}>
            {activeGroup.options.map((option) => {
              const selected = selections[activeGroup.key] === option.value
              return (
                <button
                  key={`${activeGroup.key}:${option.value}`}
                  type="button"
                  className={`w-full overflow-hidden rounded-xl border text-left transition-colors ${selected ? 'border-[var(--glass-accent-from)] bg-[var(--glass-accent-from)]/5 ring-1 ring-[var(--glass-accent-from)]/30' : 'border-[var(--glass-stroke-base)] bg-white/80 hover:border-[var(--glass-stroke-strong)] hover:bg-neutral-100'}`}
                  onClick={() => {
                    setSelections((current) => ({
                      ...current,
                      [activeGroup.key]: option.value,
                    }))
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
                  <div className={`p-2 ${isAspectRatioGroup ? 'flex flex-col items-center gap-1.5 text-center' : 'space-y-0.5'}`}>
                    {isAspectRatioGroup ? <RatioChoiceShape ratio={option.value} selected={selected} /> : null}
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className={`min-w-0 flex-1 truncate text-sm font-semibold ${selected ? 'text-[var(--glass-accent-from)]' : 'text-[var(--glass-text-primary)]'}`}>{option.label}</span>
                      {selected ? <AppIcon name="check" className="h-3.5 w-3.5 shrink-0 text-[var(--glass-accent-from)]" /> : null}
                    </div>
                    {!isAspectRatioGroup && option.description ? (
                      <div className="line-clamp-1 text-[11px] leading-5 text-[var(--glass-text-secondary)]">{option.description}</div>
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
      ) : null}
      {error ? <div className="mt-3 text-[11px] leading-5 text-[var(--glass-tone-warn-fg)]">{t('cards.choiceSubmitFailed', { error })}</div> : null}
      {!isConfirmOrReply ? (
        <>
          <button
            type="button"
            className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--glass-accent-from)] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--glass-accent-to)] disabled:cursor-not-allowed disabled:bg-slate-400"
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
  const t = useTranslations('assistantAgent')
  const progressT = useTranslations('progress')
  const revertMutationBatch = useRevertMutationBatch()
  const [undoResult, setUndoResult] = useState<{ ok: boolean; message?: string } | null>(null)
  const taskTargets = useMemo(() => (
    data.targetType && data.targetId
      ? [{
          targetType: data.targetType,
          targetId: data.targetId,
          ...(data.taskType ? { types: [data.taskType] } : {}),
        }]
      : []
  ), [data.targetId, data.targetType, data.taskType])
  const taskState = useTaskTargetStateMap(data.projectId ?? null, taskTargets, {
    enabled: Boolean(data.projectId && taskTargets.length > 0),
  }).byKey.get(data.targetType && data.targetId ? `${data.targetType}:${data.targetId}` : '')
  const liveProgress = typeof taskState?.progress === 'number' ? Math.max(0, Math.min(100, taskState.progress)) : null
  const liveStatus = taskState && taskState.phase !== 'idle' ? taskState.phase : data.status
  const liveStageLabel = useMemo(() => {
    const raw = taskState?.stageLabel || taskState?.stage || null
    return resolveProgressStageLabel(raw, progressT)
  }, [progressT, taskState?.stage, taskState?.stageLabel])

  const handleUndo = async () => {
    if (!data.mutationBatchId) return
    if (!window.confirm(t('cards.undoConfirmSingle'))) return
    setUndoResult(null)
    try {
      const result = await revertMutationBatch.mutateAsync(data.mutationBatchId)
      if (result.ok) {
        setUndoResult({ ok: true, message: t('cards.undoSucceeded', { count: result.reverted }) })
      } else {
        setUndoResult({ ok: false, message: result.error || t('cards.undoFailed') })
      }
    } catch (error) {
      setUndoResult({ ok: false, message: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <details className="group text-[12px] leading-5 text-[var(--glass-text-tertiary)]">
      <summary className="flex cursor-pointer list-none items-center gap-2">
        <AppIcon name="play" className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">{t('cards.taskSubmitted')} · {data.operationId} · {liveStatus}</span>
        <AppIcon name="chevronDown" className="h-3 w-3 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="ml-5 mt-1 space-y-0.5 text-[11px]">
        <div>{t('cards.taskIdLabel')}: {data.taskId}</div>
        {liveStageLabel ? <div>{t('cards.stageLabel')}: {liveStageLabel}</div> : null}
        {liveProgress !== null ? (
          <div className="pt-1">
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-200/70">
              <div
                className="h-full rounded-full bg-slate-500 transition-[width] duration-300"
                style={{ width: `${liveProgress}%` }}
              />
            </div>
          </div>
        ) : null}
        {data.runId ? <div>{t('cards.runIdLabel')}: {data.runId}</div> : null}
        {typeof data.deduped === 'boolean' ? <div>{t('cards.dedupedLabel')}: {String(data.deduped)}</div> : null}
        {data.mutationBatchId ? <div>{t('cards.undoBatchIdLabel')}: {data.mutationBatchId}</div> : null}
      </div>
      {data.mutationBatchId ? (
        <div className="ml-5 mt-2 flex items-center gap-2 text-[11px]">
          <button
            type="button"
            className="rounded-md border border-[var(--glass-stroke-base)] bg-white/70 px-2 py-1 text-[11px] text-[var(--glass-text-secondary)] disabled:opacity-60"
            onClick={() => { void handleUndo() }}
            disabled={revertMutationBatch.isPending}
          >
            {revertMutationBatch.isPending ? t('cards.undoRunning') : t('cards.undoCurrentChange')}
          </button>
          {undoResult ? (
            <div className={undoResult.ok ? 'text-[var(--glass-tone-success-fg)]' : 'text-[var(--glass-tone-warn-fg)]'}>
              {undoResult.message}
            </div>
          ) : null}
        </div>
      ) : null}
    </details>
  )
}

function TaskBatchSubmittedDataCard({ data }: DataMessagePartProps<TaskBatchSubmittedPartData>) {
  const t = useTranslations('assistantAgent')
  const revertMutationBatch = useRevertMutationBatch()
  const [undoResult, setUndoResult] = useState<{ ok: boolean; message?: string } | null>(null)

  const handleUndo = async () => {
    if (!data.mutationBatchId) return
    if (!window.confirm(t('cards.undoConfirmBatch'))) return
    setUndoResult(null)
    try {
      const result = await revertMutationBatch.mutateAsync(data.mutationBatchId)
      if (result.ok) {
        setUndoResult({ ok: true, message: t('cards.undoSucceeded', { count: result.reverted }) })
      } else {
        setUndoResult({ ok: false, message: result.error || t('cards.undoFailed') })
      }
    } catch (error) {
      setUndoResult({ ok: false, message: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <details className="group text-[12px] leading-5 text-[var(--glass-text-tertiary)]">
      <summary className="flex cursor-pointer list-none items-center gap-2">
        <AppIcon name="play" className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">{t('cards.batchTaskSubmitted')} · {data.operationId} · {t('cards.totalLabel')}: {String(data.total)}</span>
        <AppIcon name="chevronDown" className="h-3 w-3 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="ml-5 mt-1 space-y-0.5 font-mono text-[11px]">
        {(data.taskIds || []).slice(0, 8).map((taskId: string) => (
          <div key={taskId}>{taskId}</div>
        ))}
        {(data.taskIds || []).length > 8 ? <div>…</div> : null}
      </div>
      {data.mutationBatchId ? <div className="ml-5 mt-1 text-[11px]">{t('cards.undoBatchIdLabel')}: {data.mutationBatchId}</div> : null}
      {data.mutationBatchId ? (
        <div className="ml-5 mt-2 flex items-center gap-2 text-[11px]">
          <button
            type="button"
            className="rounded-md border border-[var(--glass-stroke-base)] bg-white/70 px-2 py-1 text-[11px] text-[var(--glass-text-secondary)] disabled:opacity-60"
            onClick={() => { void handleUndo() }}
            disabled={revertMutationBatch.isPending}
          >
            {revertMutationBatch.isPending ? t('cards.undoRunning') : t('cards.undoCurrentBatch')}
          </button>
          {undoResult ? (
            <div className={undoResult.ok ? 'text-[var(--glass-tone-success-fg)]' : 'text-[var(--glass-tone-warn-fg)]'}>
              {undoResult.message}
            </div>
          ) : null}
        </div>
      ) : null}
    </details>
  )
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

function truncateStylePreviewErrorMessage(message: string | null | undefined): string | null {
  const normalized = message?.trim()
  if (!normalized) return null
  const singleLine = normalized.replace(/\s+/g, ' ')
  return singleLine.length > 180 ? `${singleLine.slice(0, 180)}...` : singleLine
}

export function EditStylePreviewGenerationDataCard(props: DataMessagePartProps<EditStylePreviewGenerationPartData> & {
  onStyleSelected?: (params: {
    runId: string
    stylePreviewId: string
    aspectRatio: EditScriptVideoRatio
  }) => Promise<void>
}) {
  const t = useTranslations('assistantAgent')
  const progressT = useTranslations('progress')
  const data: EditStylePreviewGenerationPartData = props.data
  const confirmStylePreview = useConfirmProjectEditStylePreview(data.projectId)
  const [selectingPreviewId, setSelectingPreviewId] = useState<string | null>(null)
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)
  const [expandedSummaryIds, setExpandedSummaryIds] = useState<ReadonlySet<string>>(() => new Set())
  const taskTargets = useMemo(() => data.items.map((item: EditStylePreviewGenerationPartData['items'][number]) => ({
    targetType: 'ProjectEditStylePreview',
    targetId: item.id,
    types: [TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE],
  })), [data.items])
  const taskTargetStateQuery = useTaskTargetStateMap(data.projectId, taskTargets, {
    enabled: taskTargets.length > 0,
  })
  const taskStateMap = taskTargetStateQuery.byKey
  const screenplayQuery = useQuery({
    queryKey: queryKeys.project.editScreenplay(data.projectId, data.episodeId),
    queryFn: async (): Promise<ProjectEditScreenplay | null> => {
      const response = await apiFetch(`/api/projects/${data.projectId}/edit-script/screenplay?episodeId=${encodeURIComponent(data.episodeId)}`)
      if (!response.ok) throw new Error('EDIT_STYLE_PREVIEW_SCREENPLAY_FETCH_FAILED')
      const payload = await response.json() as { screenplay?: ProjectEditScreenplay | null }
      return payload.screenplay ?? null
    },
    refetchInterval: (query) => {
      const screenplay = query.state.data ?? null
      const previews = screenplay?.stylePreviews ?? []
      const allTerminal = data.items.every((item) => {
        const preview = previews.find((candidate) => candidate.id === item.id) ?? null
        return isEditStylePreviewTerminal(preview)
      })
      return allTerminal ? false : 2500
    },
  })
  const previewsById = useMemo(() => {
    const previews = screenplayQuery.data?.stylePreviews ?? []
    return new Map(previews.map((preview) => [preview.id, preview]))
  }, [screenplayQuery.data?.stylePreviews])
  const cardStatuses = useMemo(() => data.items.map((item) => {
    const taskState = taskStateMap.get(`ProjectEditStylePreview:${item.id}`)
    const preview = previewsById.get(item.id) ?? null
    return resolveEditStylePreviewCardStatus({
      preview,
      taskState,
      loading: screenplayQuery.isLoading || taskTargetStateQuery.isLoading,
    })
  }), [data.items, previewsById, screenplayQuery.isLoading, taskStateMap, taskTargetStateQuery.isLoading])
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
  const toggleSummary = (itemId: string) => {
    setExpandedSummaryIds((current) => {
      const next = new Set(current)
      if (next.has(itemId)) {
        next.delete(itemId)
      } else {
        next.add(itemId)
      }
      return next
    })
  }

  return (
    <div className="order-last rounded-2xl border border-[var(--glass-stroke-base)] bg-white/95 p-3 text-xs text-[var(--glass-text-secondary)] shadow-[0_18px_40px_rgba(15,23,42,0.10)]">
      <div className="flex items-center gap-2">
        <AppIcon
          name={hasGeneratingPreview ? 'loader' : 'check'}
          className={`h-3.5 w-3.5 text-[var(--glass-text-tertiary)] ${hasGeneratingPreview ? 'animate-spin' : ''}`}
        />
        <div className="min-w-0 flex-1 text-sm font-semibold text-[var(--glass-text-primary)]">
          {hasGeneratingPreview ? t('cards.stylePreviewGenerationTitle') : t('cards.stylePreviewChoiceTitle')}
        </div>
        <div className="rounded-full border border-[var(--glass-stroke-base)] bg-white/85 px-2 py-0.5 text-[10px] font-semibold text-[var(--glass-text-tertiary)]">
          {t('cards.stylePreviewGenerationCount', { count: data.items.length })}
        </div>
      </div>
      <div className="mt-2 space-y-2">
        {data.items.map((item: EditStylePreviewGenerationPartData['items'][number]) => {
          const taskState = taskStateMap.get(`ProjectEditStylePreview:${item.id}`)
          const preview = previewsById.get(item.id) ?? null
          const rawStage = taskState?.stageLabel || taskState?.stage || null
          const stageLabel = resolveProgressStageLabel(rawStage, progressT)
          const cardStatus = resolveEditStylePreviewCardStatus({
            preview,
            taskState,
            loading: screenplayQuery.isLoading || taskTargetStateQuery.isLoading,
          })
          const ready = cardStatus === 'completed' && isEditStylePreviewChoiceReady(preview)
          const failed = cardStatus === 'failed'
          const loading = cardStatus === 'loading'
          const selecting = selectingPreviewId === item.id
          const summaryExpanded = expandedSummaryIds.has(item.id)
          const errorMessage = truncateStylePreviewErrorMessage(preview?.errorMessage || taskState?.lastError?.message)
          return (
            <div
              key={item.id}
              className={`overflow-hidden rounded-xl border bg-white/80 ${failed ? 'border-[var(--glass-tone-warn-fg)]/35' : 'border-[var(--glass-stroke-base)]'}`}
            >
              <div className="relative min-h-36 overflow-hidden bg-neutral-100">
                <div className="absolute left-2 top-2 z-10 max-w-[calc(100%-1rem)] rounded-lg bg-white/90 px-2 py-1 text-xs font-semibold text-[var(--glass-text-primary)] shadow-sm">
                  {item.title}
                </div>
                {preview?.imageUrl ? (
                  <button
                    type="button"
                    aria-label={t('cards.stylePreviewOpenPreview')}
                    className="block h-44 w-full cursor-zoom-in overflow-hidden text-left"
                    onClick={() => setPreviewImageUrl(preview.imageUrl)}
                  >
                    <Image
                      src={preview.imageUrl}
                      alt={item.title}
                      width={768}
                      height={432}
                      unoptimized
                      className="h-44 w-full object-cover transition-transform duration-200 hover:scale-[1.01]"
                    />
                  </button>
                ) : failed ? (
                  <div className="flex h-36 items-center justify-center bg-[var(--glass-tone-warn-bg)]/35 px-4 text-center text-xs font-medium text-[var(--glass-tone-warn-fg)]">
                    {t('cards.stylePreviewGenerationFailed')}
                  </div>
                ) : (
                  <div className="workspace-node-loading-surface h-36 bg-slate-100" />
                )}
              </div>
              <div className="space-y-1 p-2">
                <button
                  type="button"
                  aria-label={summaryExpanded ? t('cards.stylePreviewSummaryCollapse') : t('cards.stylePreviewSummaryExpand')}
                  className="group flex w-full items-start gap-1.5 text-left text-[11px] leading-5 text-[var(--glass-text-secondary)] transition-colors hover:text-[var(--glass-text-primary)]"
                  onClick={() => toggleSummary(item.id)}
                >
                  <span className={`min-w-0 flex-1 ${summaryExpanded ? 'block' : 'line-clamp-1'}`}>
                    {item.summary}
                  </span>
                  <AppIcon
                    name="chevronDown"
                    className={`mt-1 h-3 w-3 shrink-0 text-[var(--glass-text-tertiary)] transition-transform group-hover:text-[var(--glass-text-secondary)] ${summaryExpanded ? 'rotate-180' : ''}`}
                  />
                </button>
                <div className="flex items-center gap-1.5 text-[10px] font-medium text-[var(--glass-text-tertiary)]">
                  <AppIcon name={failed ? 'alert' : ready ? 'check' : 'loader'} className={`h-3 w-3 ${ready || failed ? '' : 'animate-spin'}`} />
                  <span>
                    {failed
                      ? t('cards.stylePreviewGenerationFailed')
                      : ready
                        ? t('cards.stylePreviewReady')
                        : loading
                          ? t('cards.stylePreviewLoading')
                          : stageLabel ?? t('cards.stylePreviewGenerationStatus', { status: cardStatus })}
                  </span>
                </div>
                {failed && errorMessage ? (
                  <div className="rounded-lg bg-[var(--glass-tone-warn-bg)]/45 px-2 py-1 text-[10px] leading-4 text-[var(--glass-tone-warn-fg)]">
                    {t('cards.stylePreviewGenerationFailedReason', { reason: errorMessage })}
                  </div>
                ) : null}
                {ready && preview.status !== 'confirmed' ? (
                  <button
                    type="button"
                    className="mt-1 inline-flex w-full items-center justify-center rounded-xl border border-[var(--glass-stroke-base)] bg-white/90 px-3 py-2 text-sm font-medium text-[var(--glass-text-primary)] transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={selecting || confirmStylePreview.isPending}
                    onClick={() => { void handleSelectStylePreview(item, preview) }}
                  >
                    {selecting ? t('cards.choiceSubmitting') : t('cards.stylePreviewSelect')}
                  </button>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
      {previewImageUrl ? (
        <ImagePreviewModal imageUrl={previewImageUrl} onClose={() => setPreviewImageUrl(null)} />
      ) : null}
    </div>
  )
}

export function AgentPlanDataCard({ data }: DataMessagePartProps<AgentPlanPartData>) {
  const t = useTranslations('assistantAgent')
  return (
    <details className="group text-[12px] leading-5 text-[var(--glass-text-tertiary)]">
      <summary className="flex cursor-pointer list-none items-center gap-2">
        <AppIcon name="bookOpen" className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">{data.summary || data.goal}</span>
        <AppIcon name="chevronDown" className="h-3 w-3 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="ml-5 mt-1 text-[11px]">
        {data.validation.ok ? t('cards.planValidated') : t('cards.planNeedsRevision')}
      </div>
      <div className="ml-5 mt-2 space-y-1 text-[11px]">
        {data.steps.map((step: AgentPlanPartData['steps'][number]) => (
          <div key={`${data.draftPlanId}:step:${step.stepKey}`}>
            <span className="text-[var(--glass-text-secondary)]">{formatSkillLabel(step.skillId, t)}</span>
            <span> · {step.operationId} · {step.reason}</span>
          </div>
        ))}
      </div>
    </details>
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


function readToolApprovalId(payload: unknown): string | null {
  if (!isRecord(payload)) return null
  const id = payload.id
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

export function WorkspaceAssistantToolCallCard(props: ToolCallMessagePartProps & {
  onRespondToolApproval?: (params: { approvalId: string; approved: boolean; reason?: string }) => Promise<void>
  confirmationSubmittingKey?: string | null
  approvalRespondedIds?: ReadonlySet<string>
  pendingApprovalId?: string | null
}) {
  const t = useTranslations('assistantAgent')
  const locale = normalizeProjectAgentLocale(useLocale())
  const operationTitle = localizeProjectAgentOperationTitle(props.toolName, locale)
  const toolStatus = props.status.type
  const inputText = JSON.stringify(props.args ?? {}, null, 2)
  const outputText = props.result === undefined ? '' : JSON.stringify(props.result, null, 2)
  const rawApprovalId = toolStatus === 'requires-action' && props.interrupt?.type === 'human'
    ? readToolApprovalId(props.interrupt.payload)
    : null
  if (rawApprovalId && props.approvalRespondedIds?.has(rawApprovalId)) return null
  // Only render an answerable approval card when the server has a matching
  // pending interruption row; orphaned approval requests degrade to the plain
  // tool-call detail row instead of an unanswerable card.
  const approvalId = rawApprovalId && props.pendingApprovalId === rawApprovalId ? rawApprovalId : null
  if (approvalId && props.onRespondToolApproval) {
    return (
      <ConfirmationActionCard
        operationId={props.toolName}
        title={operationTitle}
        subtitle={t('cards.confirmationRequired')}
        onConfirm={async () => props.onRespondToolApproval?.({ approvalId, approved: true })}
        onCancel={async () => props.onRespondToolApproval?.({ approvalId, approved: false })}
        confirmPending={props.confirmationSubmittingKey === `approval:${approvalId}:approve`}
        cancelPending={props.confirmationSubmittingKey === `approval:${approvalId}:deny`}
      />
    )
  }
  const summaryText = toolStatus === 'complete'
    ? t('toolCall.success')
    : toolStatus === 'requires-action'
      ? t('toolCall.needsAction')
      : t('toolCall.running')

  return (
    <details className="group text-[12px] leading-5 text-[var(--glass-text-tertiary)]">
      <summary className="flex cursor-pointer list-none items-center gap-2">
        <AppIcon name={toolStatus === 'incomplete' ? 'loader' : 'settingsHex'} className={`h-3.5 w-3.5 shrink-0 ${toolStatus === 'incomplete' ? 'animate-spin' : ''}`} />
        <span className="min-w-0 truncate">{summaryText} · {operationTitle}</span>
        <AppIcon name="chevronDown" className="h-3 w-3 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="ml-5 mt-1 space-y-2 text-[11px]">
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
  onRespondToolApproval: (params: { approvalId: string; approved: boolean; reason?: string }) => Promise<void>
  confirmationSubmittingKey: string | null
  approvalRespondedIds?: ReadonlySet<string>
  pendingApprovalId?: string | null
  hideChoiceCards?: boolean
  hideStylePreviewGenerationCards?: boolean
  onSubmitChoiceResponse: (params: {
    runId: string
    interruptionId: string | null
    choiceType: ProjectAgentChoiceCardPartData['choiceType']
    toolCallId: string | null
    output: Record<string, unknown>
  }) => Promise<void>
  onSetProjectVideoRatioChoice: (params: {
    projectId: string
    aspectRatio: EditScriptVideoRatio
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
}

export function useWorkspaceAssistantMessagePartComponents({
  onRespondToolApproval,
  confirmationSubmittingKey,
  approvalRespondedIds,
  pendingApprovalId,
  hideChoiceCards = false,
  hideStylePreviewGenerationCards = false,
  onSubmitChoiceResponse,
  onSetProjectVideoRatioChoice,
  onConfirmEditStylePreviewChoice,
  onStylePreviewSelected,
}: WorkspaceAssistantMessagePartComponentsOptions): MessagePartComponents {
  return useMemo<MessagePartComponents>(() => ({
    Text: MarkdownTextPart,
    Reasoning: WorkspaceAssistantReasoningPart,
    tools: {
      Fallback: (props) => (
        <WorkspaceAssistantToolCallCard
          {...props}
          onRespondToolApproval={onRespondToolApproval}
          confirmationSubmittingKey={confirmationSubmittingKey}
          approvalRespondedIds={approvalRespondedIds}
          pendingApprovalId={pendingApprovalId}
        />
      ),
    },
    data: {
      by_name: {
        'agent-run': HiddenRuntimeContextDataCard,
        'agent-stop': AgentStopDataCard,
        'agent-runtime-context': HiddenRuntimeContextDataCard,
        'assistant-choice-card': hideChoiceCards
          ? HiddenRuntimeContextDataCard
          : (props) => (
              <AssistantChoiceCardView
                data={props.data}
                onSubmitChoiceResponse={onSubmitChoiceResponse}
                onSetProjectVideoRatioChoice={onSetProjectVideoRatioChoice}
                onConfirmEditStylePreviewChoice={onConfirmEditStylePreviewChoice}
              />
            ),
        'edit-style-preview-generation': hideStylePreviewGenerationCards
          ? HiddenRuntimeContextDataCard
          : (props) => (
              <EditStylePreviewGenerationDataCard
                {...props}
                onStyleSelected={onStylePreviewSelected}
              />
            ),
        'agent-interruption-resolved': HiddenRuntimeContextDataCard,
        'assistant-choice-resolved': HiddenRuntimeContextDataCard,
        'project-phase': ProjectPhaseDataCard,
        'task-submitted': TaskSubmittedDataCard,
        'task-batch-submitted': TaskBatchSubmittedDataCard,
        plan: AgentPlanDataCard,
        'project-context': ProjectContextDataCard,
      },
    },
  }), [
    confirmationSubmittingKey,
    approvalRespondedIds,
    pendingApprovalId,
    hideChoiceCards,
    hideStylePreviewGenerationCards,
    onConfirmEditStylePreviewChoice,
    onRespondToolApproval,
    onSetProjectVideoRatioChoice,
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

export function WorkspaceAssistantThreadMessage(props: {
  messagePartComponents: MessagePartComponents
  activeThinkingAssistantMessageId: string | null
}) {
  const showInlineThinkingIndicator = useMessage((state) => (
    props.activeThinkingAssistantMessageId !== null
    && state.role === 'assistant'
    && state.id === props.activeThinkingAssistantMessageId
  ))

  return (
    <>
      <MessagePrimitive.If user>
        <HiddenConversationSummaryMessage>
          <div className="ml-auto flex w-full max-w-[88%] flex-col items-end">
            <MessagePrimitive.Root className={WORKSPACE_ASSISTANT_USER_MESSAGE_CLASS}>
              <MessagePrimitive.Parts />
            </MessagePrimitive.Root>
          </div>
        </HiddenConversationSummaryMessage>
      </MessagePrimitive.If>

      <MessagePrimitive.If assistant>
        <div className="space-y-1">
          <MessagePrimitive.Root className={WORKSPACE_ASSISTANT_MESSAGE_CLASS}>
            {showInlineThinkingIndicator ? (
              <WorkspaceAssistantThinkingIndicator status="streaming" />
            ) : null}
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

export function WorkspaceAssistantPendingTurnPlaceholder(props: {
  status: ChatStatus
}) {
  return (
    <div className="space-y-1">
      <div className={WORKSPACE_ASSISTANT_MESSAGE_CLASS}>
        <WorkspaceAssistantThinkingIndicator status={props.status} />
      </div>
    </div>
  )
}
