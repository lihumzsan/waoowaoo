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
import type { ComponentProps } from 'react'
import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { useTaskTargetStateMap } from '@/lib/query/hooks/useTaskTargetStateMap'
import type {
  AgentPlanPartData,
  ConfirmationRequestPartData,
  ProjectAgentChoiceCardPartData,
  ProjectAgentStopPartData,
  ProjectContextPartData,
  ProjectPhasePartData,
  TaskBatchSubmittedPartData,
  TaskSubmittedPartData,
} from '@/lib/project-agent/types'
import { useRevertMutationBatch } from '@/lib/query/hooks'
import { MarkdownTextPart } from './MarkdownTextPart'
import {
  interpolateChoiceCardTemplate,
  isChoiceCardSubmitReady,
  type ChoiceCardSelections,
} from './choice-card-actions'
import { EDIT_SCRIPT_VIDEO_RATIOS, type EditScriptVideoRatio } from '@/lib/edit-script/types'

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

type MessagePartComponents = NonNullable<ComponentProps<typeof MessagePrimitive.Parts>['components']>

export const WORKSPACE_ASSISTANT_USER_MESSAGE_CLASS = 'w-fit rounded-2xl bg-neutral-100 px-3 py-2.5 text-sm leading-6 text-[var(--glass-text-primary)]'

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
  const title = data.reason === 'step_cap'
    ? t('cards.maxSteps')
    : data.reason === 'awaiting_external_task'
      ? t('cards.awaitingExternalTask')
      : data.reason === 'awaiting_user_confirmation'
        ? t('cards.awaitingUserConfirmation')
        : data.reason === 'repeated_tool_call'
          ? t('cards.repeatedToolCall')
          : t('cards.toolErrorBoundary')
  const detail = data.reason === 'step_cap'
    ? t('cards.stepUsage', { stepCount: data.stepCount, maxSteps: data.maxSteps })
    : data.reason === 'awaiting_external_task'
      ? t('cards.awaitingExternalTaskDetail', {
          operations: data.operationIds.join(', '),
          tasks: data.taskIds.length > 0 ? data.taskIds.join(', ') : t('cards.unknownTask'),
          phases: data.phases.length > 0 ? data.phases.join(', ') : t('cards.none'),
        })
      : data.reason === 'awaiting_user_confirmation'
        ? t('cards.awaitingUserConfirmationDetail', {
            operations: data.operationIds.join(', '),
          })
        : data.reason === 'repeated_tool_call'
          ? t('cards.repeatedToolCallDetail', {
              tool: data.toolName,
              hash: data.argsHash,
            })
          : t('cards.toolErrorBoundaryDetail', {
          operations: data.operationIds.join(', '),
          codes: data.codes.length > 0 ? data.codes.join(', ') : t('cards.none'),
        })
  return (
    <details className="group border-l-2 border-[var(--glass-text-tertiary)]/40 pl-2 text-[12px] leading-5 text-[var(--glass-text-secondary)]">
      <summary className="flex cursor-pointer list-none items-center gap-2">
        <AppIcon name="alert" className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">{title} · {detail}</span>
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
  summary: string
  argsHint?: Record<string, unknown> | null
  onConfirm: () => Promise<void>
  onCancel: () => Promise<void>
  confirmPending: boolean
  cancelPending: boolean
}) {
  const t = useTranslations('assistantAgent')
  return (
    <div className="rounded-2xl border border-[var(--glass-tone-warn-fg)]/30 bg-[var(--glass-bg-muted)]/70 p-3 text-xs text-[var(--glass-text-secondary)]">
      <div className="text-sm font-medium text-[var(--glass-text-primary)]">{t('cards.confirmationRequired')}</div>
      <div className="mt-1">{props.summary}</div>
      <div className="mt-2 rounded-xl bg-[var(--glass-bg-surface)]/70 px-3 py-2 font-mono text-[10px] text-[var(--glass-text-tertiary)]">
        {t('cards.operationLabel')}: {props.operationId}
      </div>
      {props.argsHint ? (
        <pre className="mt-2 overflow-x-auto rounded-xl bg-[var(--glass-bg-surface)]/70 px-3 py-2 text-[10px] text-[var(--glass-text-tertiary)]">
          {JSON.stringify(props.argsHint, null, 2)}
        </pre>
      ) : null}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="flex-1 rounded-xl bg-[var(--glass-accent-from)] px-3 py-2 text-sm font-medium text-white"
          onClick={() => { void props.onConfirm() }}
          disabled={props.confirmPending}
        >
          {props.confirmPending ? t('cards.confirmRunning') : t('cards.confirmContinue')}
        </button>
        <button
          type="button"
          className="flex-1 rounded-xl border border-[var(--glass-stroke-base)] px-3 py-2 text-sm font-medium text-[var(--glass-text-primary)]"
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

function AssistantChoiceCard(props: DataMessagePartProps<ProjectAgentChoiceCardPartData> & {
  onSendChoiceMessage: (message: string) => Promise<void>
  onConfirmEditStylePreviewChoice: (params: {
    projectId: string
    episodeId: string
    stylePreviewId: string
    aspectRatio: EditScriptVideoRatio
    successMessage: string
  }) => Promise<void>
}) {
  const t = useTranslations('assistantAgent')
  const card: ProjectAgentChoiceCardPartData = props.data
  const [selections, setSelections] = useState<ChoiceCardSelections>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = isChoiceCardSubmitReady(card.groups, selections)

  const handleSubmit = async () => {
    if (!ready || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      if (card.submit.kind === 'send_message') {
        await props.onSendChoiceMessage(
          interpolateChoiceCardTemplate(card.submit.messageTemplate, selections, card.groups),
        )
      } else {
        const stylePreviewId = selections.stylePreviewId
        const aspectRatio = selections.aspectRatio
        if (!stylePreviewId || !isEditScriptVideoRatio(aspectRatio)) {
          throw new Error('ASSISTANT_CHOICE_CARD_INVALID_STYLE_SELECTION')
        }
        await props.onConfirmEditStylePreviewChoice({
          projectId: card.submit.projectId,
          episodeId: card.submit.episodeId,
          stylePreviewId,
          aspectRatio,
          successMessage: interpolateChoiceCardTemplate(
            card.submit.successMessageTemplate,
            selections,
            card.groups,
          ),
        })
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)]/70 p-3 text-xs text-[var(--glass-text-secondary)]">
      <div className="text-sm font-medium text-[var(--glass-text-primary)]">{card.title}</div>
      {card.description ? <div className="mt-1 leading-5">{card.description}</div> : null}
      <div className="mt-3 space-y-3">
        {card.groups.map((group) => (
          <div key={group.key} className="space-y-2">
            <div className="text-[11px] font-semibold text-[var(--glass-text-tertiary)]">{group.label}</div>
            <div className="space-y-2">
              {group.options.map((option) => {
                const selected = selections[group.key] === option.value
                return (
                  <button
                    key={`${group.key}:${option.value}`}
                    type="button"
                    className={`w-full overflow-hidden rounded-xl border text-left transition ${selected ? 'border-slate-950 bg-white ring-1 ring-slate-950' : 'border-[var(--glass-stroke-base)] bg-white/70 hover:border-slate-300'}`}
                    onClick={() => setSelections((current) => ({
                      ...current,
                      [group.key]: option.value,
                    }))}
                    disabled={submitting}
                  >
                    {option.imageUrl ? (
                      <Image
                        src={option.imageUrl}
                        alt={option.label}
                        width={640}
                        height={360}
                        unoptimized
                        className="h-32 w-full object-cover"
                      />
                    ) : null}
                    <div className="space-y-1 p-2.5">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 text-sm font-semibold text-[var(--glass-text-primary)]">{option.label}</span>
                        {selected ? <AppIcon name="check" className="h-4 w-4 shrink-0 text-slate-950" /> : null}
                      </div>
                      {option.description ? (
                        <div className="line-clamp-3 text-[11px] leading-5 text-[var(--glass-text-secondary)]">{option.description}</div>
                      ) : null}
                      {option.meta ? (
                        <div className="text-[10px] text-[var(--glass-text-tertiary)]">{option.meta}</div>
                      ) : null}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      {error ? <div className="mt-3 text-[11px] leading-5 text-[var(--glass-tone-warn-fg)]">{t('cards.choiceSubmitFailed', { error })}</div> : null}
      <button
        type="button"
        className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--glass-accent-from)] px-3 py-2.5 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:bg-slate-400"
        onClick={() => { void handleSubmit() }}
        disabled={!ready || submitting}
      >
        {submitting ? t('cards.choiceSubmitting') : card.submitLabel}
      </button>
      {!ready ? <div className="mt-2 text-[11px] text-[var(--glass-text-tertiary)]">{t('cards.choiceRequired')}</div> : null}
    </div>
  )
}

function InlineConfirmationRequestDataCard(props: DataMessagePartProps<ConfirmationRequestPartData> & {
  onConfirmOperation: (operationId: string, argsHint?: Record<string, unknown> | null) => Promise<void>
  onCancelOperation: (operationId: string) => Promise<void>
  confirmationSubmittingKey: string | null
}) {
  return (
    <ConfirmationActionCard
      operationId={props.data.operationId}
      summary={props.data.summary}
      argsHint={props.data.argsHint ?? null}
      onConfirm={async () => props.onConfirmOperation(props.data.operationId, props.data.argsHint ?? null)}
      onCancel={async () => props.onCancelOperation(props.data.operationId)}
      confirmPending={props.confirmationSubmittingKey === `confirm:${props.data.operationId}:continue`}
      cancelPending={props.confirmationSubmittingKey === `confirm:${props.data.operationId}:cancel`}
    />
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


export function WorkspaceAssistantToolCallCard(props: ToolCallMessagePartProps) {
  const t = useTranslations('assistantAgent')
  const toolStatus = props.status.type
  const inputText = JSON.stringify(props.args ?? {}, null, 2)
  const outputText = props.result === undefined ? '' : JSON.stringify(props.result, null, 2)
  const summaryText = toolStatus === 'complete'
    ? t('toolCall.success')
    : toolStatus === 'requires-action'
      ? t('toolCall.needsAction')
      : t('toolCall.running')

  return (
    <details className="group text-[12px] leading-5 text-[var(--glass-text-tertiary)]">
      <summary className="flex cursor-pointer list-none items-center gap-2">
        <AppIcon name={toolStatus === 'incomplete' ? 'loader' : 'settingsHex'} className={`h-3.5 w-3.5 shrink-0 ${toolStatus === 'incomplete' ? 'animate-spin' : ''}`} />
        <span className="min-w-0 truncate">{summaryText} · {props.toolName}</span>
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
  onConfirmOperation: (operationId: string, argsHint?: Record<string, unknown> | null) => Promise<void>
  onCancelOperation: (operationId: string) => Promise<void>
  confirmationSubmittingKey: string | null
  onSendChoiceMessage: (message: string) => Promise<void>
  onConfirmEditStylePreviewChoice: (params: {
    projectId: string
    episodeId: string
    stylePreviewId: string
    aspectRatio: EditScriptVideoRatio
    successMessage: string
  }) => Promise<void>
}

export function useWorkspaceAssistantMessagePartComponents({
  onConfirmOperation,
  onCancelOperation,
  confirmationSubmittingKey,
  onSendChoiceMessage,
  onConfirmEditStylePreviewChoice,
}: WorkspaceAssistantMessagePartComponentsOptions): MessagePartComponents {
  return useMemo<MessagePartComponents>(() => ({
    Text: MarkdownTextPart,
    Reasoning: WorkspaceAssistantReasoningPart,
    tools: {
      Fallback: WorkspaceAssistantToolCallCard,
    },
    data: {
      by_name: {
        'agent-stop': AgentStopDataCard,
        'agent-runtime-context': HiddenRuntimeContextDataCard,
        'assistant-choice-card': (props) => (
          <AssistantChoiceCard
            {...props}
            onSendChoiceMessage={onSendChoiceMessage}
            onConfirmEditStylePreviewChoice={onConfirmEditStylePreviewChoice}
          />
        ),
        'project-phase': ProjectPhaseDataCard,
        'confirmation-request': (props) => (
          <InlineConfirmationRequestDataCard
            {...props}
            onConfirmOperation={onConfirmOperation}
            onCancelOperation={onCancelOperation}
            confirmationSubmittingKey={confirmationSubmittingKey}
          />
        ),
        'task-submitted': TaskSubmittedDataCard,
        'task-batch-submitted': TaskBatchSubmittedDataCard,
        plan: AgentPlanDataCard,
        'project-context': ProjectContextDataCard,
      },
    },
  }), [
    confirmationSubmittingKey,
    onCancelOperation,
    onConfirmEditStylePreviewChoice,
    onConfirmOperation,
    onSendChoiceMessage,
  ])
}

function HiddenConversationSummaryMessage(props: {
  children: React.ReactNode
}) {
  const isSummary = useMessage((state) => state.metadata.custom?.projectAgentConversationSummary === true)
  if (isSummary) return null
  return <>{props.children}</>
}

export function WorkspaceAssistantThreadMessage(props: {
  messagePartComponents: MessagePartComponents
}) {
  return (
    <>
      <MessagePrimitive.If user>
        <div className="ml-auto flex w-full max-w-[88%] flex-col items-end">
          <MessagePrimitive.Root className={WORKSPACE_ASSISTANT_USER_MESSAGE_CLASS}>
            <MessagePrimitive.Parts />
          </MessagePrimitive.Root>
        </div>
      </MessagePrimitive.If>

      <MessagePrimitive.If assistant>
        <div className="space-y-1">
          <MessagePrimitive.Root className="space-y-3 px-1 py-1 text-sm leading-6 text-[var(--glass-text-primary)]">
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
