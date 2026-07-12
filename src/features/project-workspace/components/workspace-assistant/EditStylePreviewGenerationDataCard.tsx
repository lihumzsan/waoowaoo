'use client'

import Image from 'next/image'
import { useState, type CSSProperties } from 'react'
import { useTranslations } from 'next-intl'
import ImagePreviewModal from '@/components/ui/ImagePreviewModal'
import { AppIcon } from '@/components/ui/icons'
import type { EditStylePreviewSetView } from '@/lib/edit-script/style-preview-set-view'
import type { ProjectAgentChoiceCardPartData } from '@/lib/project-agent/types'
import { useEstimatedTaskProgress } from '@/lib/query/hooks/useEstimatedTaskProgress'
import type { TaskRuntimeStateLike } from '@/lib/task/runtime-targets'
import { buildSingleOptionChoiceCardSelections } from './choice-card-actions'
import { buildWorkspaceAssistantChoiceSelectionOutput } from './WorkspaceAssistantRenderers'

function truncateStylePreviewErrorMessage(message: string | null | undefined): string | null {
  const normalized = message?.trim()
  if (!normalized) return null
  const singleLine = normalized.replace(/\s+/g, ' ')
  return singleLine.length > 180 ? `${singleLine.slice(0, 180)}...` : singleLine
}

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

function useStylePreviewRunningPercent(taskState: TaskRuntimeStateLike | null): number | null {
  const progress = useEstimatedTaskProgress(taskState)
  if (!progress || !progress.isRunning) return null
  return Math.floor(Math.max(0, Math.min(99, progress.percent)))
}

function StylePreviewGeneratingOverlay({ taskState }: { taskState: TaskRuntimeStateLike | null }) {
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

function StylePreviewRowProgress({ taskState }: { taskState: TaskRuntimeStateLike | null }) {
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

export function EditStylePreviewGenerationDataCard(props: {
  readonly view: EditStylePreviewSetView
  readonly choiceCard?: ProjectAgentChoiceCardPartData | null
  readonly onSubmitChoiceResponse: (params: {
    runId: string
    interruptionId: string
    toolCallId: string
    output: Record<string, unknown>
  }) => Promise<void>
  readonly onPreviewImage?: (imageUrl: string) => void
}) {
  const t = useTranslations('assistantAgent')
  const [localPreviewImageUrl, setLocalPreviewImageUrl] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [selectingId, setSelectingId] = useState<string | null>(null)
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const displayedItems = props.view.candidates
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
  const selectStylePreview = async (stylePreviewId: string) => {
    const card = props.choiceCard
    if (!card || selectingId) return
    setSelectingId(stylePreviewId)
    setSelectionError(null)
    try {
      const selections = buildSingleOptionChoiceCardSelections(card, stylePreviewId)
      await props.onSubmitChoiceResponse({
        runId: card.runId,
        interruptionId: card.interruptionId,
        toolCallId: card.toolCallId,
        output: buildWorkspaceAssistantChoiceSelectionOutput({
          card,
          groups: card.groups,
          selections,
        }),
      })
    } catch (error) {
      setSelectionError(error instanceof Error ? error.message : String(error))
    } finally {
      setSelectingId(null)
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--glass-stroke-base)] bg-white/95 p-3 text-xs text-[var(--glass-text-secondary)] shadow-[0_12px_30px_rgba(15,23,42,0.08)]">
      <div className="flex items-center gap-2">
        <AppIcon
          name={props.view.hasGeneratingPreview ? 'loader' : 'check'}
          className={`h-3.5 w-3.5 text-[var(--glass-text-tertiary)] ${props.view.hasGeneratingPreview ? 'animate-spin' : ''}`}
        />
        <div className="min-w-0 flex-1 text-sm font-semibold text-[var(--glass-text-primary)]">
          {props.view.hasConfirmedPreview
            ? t('cards.stylePreviewConfirmedTitle')
            : props.view.hasGeneratingPreview
              ? t('cards.stylePreviewGenerationTitle')
              : t('cards.stylePreviewChoiceTitle')}
        </div>
        <div className="rounded-full border border-[var(--glass-stroke-base)] bg-white/85 px-2 py-0.5 text-[10px] font-semibold text-[var(--glass-text-tertiary)]">
          {props.view.hasConfirmedPreview
            ? t('cards.stylePreviewConfirmedBadge')
            : t('cards.stylePreviewGenerationCount', { count: displayedItems.length })}
        </div>
      </div>
      <div className="mt-2.5 space-y-2">
        {displayedItems.map((item) => {
          const failed = item.status === 'failed'
          const inProgress = item.status === 'generating' || item.status === 'loading'
          const errorMessage = truncateStylePreviewErrorMessage(item.errorMessage)
          const selectable = Boolean(
            props.choiceCard
            && item.status === 'completed'
            && item.imageUrl
            && props.choiceCard.groups.some((group) => (
              group.options.some((option) => option.value === item.id)
            )),
          )

          if (item.id !== effectiveFocusId) {
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setFocusId(item.id)}
                className="flex w-full items-center gap-3 rounded-[14px] border border-[var(--glass-stroke-base)] bg-white/80 px-2.5 py-2 text-left transition-colors hover:bg-neutral-50"
              >
                <div className="relative h-10 w-14 shrink-0 overflow-hidden rounded-[10px] bg-[#0c111b] ring-1 ring-[var(--glass-stroke-base)]">
                  {item.imageUrl ? (
                    <Image src={item.imageUrl} alt={item.title} width={112} height={80} unoptimized className="h-full w-full object-cover" />
                  ) : (
                    <StylePreviewLoadingSurface />
                  )}
                  {inProgress ? <StylePreviewRowProgress taskState={item.taskState} /> : null}
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
                {item.confirmed ? (
                  <AppIcon name="badgeCheck" className="h-4 w-4 shrink-0 text-[var(--glass-accent-from)]" />
                ) : (
                  <AppIcon name="chevronRight" className="h-4 w-4 shrink-0 text-[var(--glass-text-tertiary)]" />
                )}
              </button>
            )
          }

          return (
            <div
              key={item.id}
              className={`overflow-hidden rounded-[16px] border bg-white/85 ${failed ? 'border-[var(--glass-tone-warn-fg)]/35' : 'border-[var(--glass-stroke-base)]'}`}
            >
              <div className="relative">
                <div className="relative aspect-[16/10] overflow-hidden bg-[#0c111b]">
                  {item.imageUrl ? (
                    <button
                      type="button"
                      aria-label={t('cards.stylePreviewOpenPreview')}
                      className="block h-full w-full cursor-zoom-in overflow-hidden text-left"
                      onClick={() => openPreviewImage(item.imageUrl as string)}
                    >
                      <Image
                        src={item.imageUrl}
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
                  {inProgress ? <StylePreviewGeneratingOverlay taskState={item.taskState} /> : null}
                </div>
                {item.confirmed ? (
                  <div className="absolute bottom-3 right-3 z-30 inline-flex items-center gap-1.5 rounded-full bg-white/92 px-3 py-1.5 text-[12px] font-semibold text-[var(--glass-text-primary)] shadow-[0_4px_14px_rgba(15,23,42,0.28)] backdrop-blur-md">
                    <AppIcon name="badgeCheck" className="h-3.5 w-3.5 text-[var(--glass-accent-from)]" />
                    {t('cards.stylePreviewConfirmed')}
                  </div>
                ) : selectable ? (
                  <button
                    type="button"
                    disabled={selectingId !== null}
                    onClick={() => void selectStylePreview(item.id)}
                    className="group/btn absolute bottom-3 right-3 z-30 inline-flex items-center gap-1 rounded-full bg-white/92 px-3.5 py-1.5 text-[12px] font-semibold text-[var(--glass-text-primary)] shadow-[0_4px_14px_rgba(15,23,42,0.28)] backdrop-blur-md transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {selectingId === item.id ? t('cards.choiceSubmitting') : t('cards.stylePreviewSelect')}
                    <AppIcon name="chevronRight" className="h-3.5 w-3.5 transition-transform group-hover/btn:translate-x-0.5" />
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
      {selectionError ? (
        <div className="mt-3 text-[11px] leading-5 text-[var(--glass-tone-warn-fg)]">
          {t('cards.choiceSubmitFailed', { error: selectionError })}
        </div>
      ) : null}
      {localPreviewImageUrl ? (
        <ImagePreviewModal imageUrl={localPreviewImageUrl} onClose={() => setLocalPreviewImageUrl(null)} />
      ) : null}
    </div>
  )
}
